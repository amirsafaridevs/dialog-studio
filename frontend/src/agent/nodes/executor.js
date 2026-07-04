/**
 * Node: executor — runs after planner produced state.tasks.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents), same as planner. Goes
 * through state.tasks one by one (in order) and, for each, runs an agent that
 * carries out that single task against the real workspace. Unlike planner,
 * this agent has the FULL tool set — every tool toolExecutor supports
 * (read_file, search_files, search_content, replace_in_file, edit_file,
 * write_file, preview_* browser tools, check_theme, validate_code,
 * code_graph, graph_query) — it is the one allowed to actually change files
 * and inspect the live preview to confirm a change rendered.
 *
 * Each task carries a lifecycle state: planner creates it as 'queued'; this
 * node flips it to 'in_progress' right before running it, then to 'done' or
 * 'failed' once the run + verification finish — so state.tasks always
 * reflects where each task currently stands (queued/in_progress/done/failed).
 *
 * Each task is given to the agent as fresh input (title/description/
 * objective/target_files) plus the original conversation for context. The
 * agent is instructed to verify its own edit (re-read the file / re-check
 * the preview) before declaring the task done. As a hard backstop, we also
 * track — in code, not just via the model's word — whether any write tool
 * call in the run actually returned success; if the model claims a task is
 * done but no write call succeeded, we mark that task failed regardless of
 * what the model said. We don't carry the full message history between
 * tasks in the agent's own context — each task run is independent — but we
 * do collect a short result summary per task into state.taskResults so the
 * final_answer node can present, in order, what each task actually did.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { configureAgentsRuntime, runStreamed } from '../providers/agentsRuntime.js';
import { buildSkillCatalogBlock, buildLoadedSkillsBlock, buildDesignBriefBlock } from '../skills/prompt.js';
import { buildSkillTools } from '../skills/tools.js';
import { Timeline } from '../timeline.js';

const EXECUTOR_INSTRUCTIONS = `You are the executor of a WordPress theme-building agent. You are given ONE task from a larger plan, plus the original conversation for context. Carry out this task, and only this task, against the real workspace.

You have full access to every tool: read_file, search_files, search_content to inspect; replace_in_file, edit_file, write_file to change real files; preview_navigate, preview_reload, preview_get_html, preview_get_loaded_assets, preview_get_element_styles to inspect the live rendered preview; and check_theme, validate_code, code_graph, graph_query for deeper theme inspection. Use replace_in_file for targeted edits, write_file only to create a new file or fully overwrite one, edit_file only when there is no stable text to anchor a replace on.

You also have the skill tools (use_skill, read_skill_resource, search_skill_data) described in the skill catalog below. Skills the planner already loaded appear in a LOADED SKILLS block in your input — follow their guidance while implementing. If the task turns out to touch an area covered by a not-yet-loaded skill (a design style, WooCommerce, security, a specific WordPress subsystem), load it with use_skill BEFORE making changes in that area. When a loaded skill provides datasets, use search_skill_data for concrete design values (palettes, font pairings, UX rules) instead of inventing them.

Rules:
- Do exactly what the task describes — do not expand scope beyond it, do not touch files outside "target_files" unless the task genuinely requires it.
- Before editing a file you have not already read in this run, read it first so your edit is grounded in the real current content.
- Make real tool calls to actually apply the change — do not just describe what you would do.
- ALWAYS check the actual result object returned by each tool call. A tool call that returns success:false or an error DID NOT apply the change, even if it looked like a normal call — read the error and correct your approach (e.g. re-read the file if old_string didn't match, fix the path if the file wasn't found). Never assume a write worked just because you called the tool.
- MANDATORY VERIFICATION: after applying a change, before you reply, re-read the affected part of the file (or, for a visual/CSS change, use preview_navigate/preview_reload + preview_get_element_styles or preview_get_html against the relevant page) to CONFIRM the new content is actually present and the old content is gone. For PHP/CSS/JS edits, also run validate_code on the touched directory to catch syntax errors you introduced. If verification shows the change is missing, wrong, or broke syntax, fix it and verify again — do not stop until the file on disk (or the rendered preview) actually reflects the task, or you have exhausted reasonable attempts.
- If after retrying you cannot get the change to apply, do not claim success — say clearly in your summary what failed and why.
- When the task is complete AND verified, reply with a SHORT plain-text summary (1-3 sentences, in the user's language) of what you changed, in which files, and how you verified it. No JSON, no markdown fences.`;

const WRITE_TOOL_NAMES = new Set(['replace_in_file', 'edit_file', 'write_file']);

/**
 * Wrap the shared toolExecutor's full tool set (read, write, preview/browser,
 * theme inspection) as SDK tools. `writeLog` — a plain array supplied by the
 * caller — is pushed to on every write-tool call with { tool, path, success,
 * error } so the node can verify, in code, whether any edit truly succeeded,
 * independent of what the model claims in its final reply.
 *
 * `logger` (`{ toolCall, toolResult }`, backed by the current task's Timeline
 * — see createExecutorNode) records every call/result, in order, regardless
 * of tool kind (read or write), so the timeline reflects everything the
 * executor actually did.
 */
function buildExecutorTools(toolExecutor, signal, writeLog, logger) {
  if (!toolExecutor) return [];

  const execOptions = signal ? { signal } : {};

  const wrap = (name, paramsSchema, toArgs) => tool({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: paramsSchema,
    execute: async (input) => {
      const args = toArgs(input);
      logger.toolCall(name, args, { node: 'executor' });
      const result = await toolExecutor.execute(name, args, execOptions);
      logger.toolResult(name, result, { node: 'executor', success: result?.success !== false });
      if (WRITE_TOOL_NAMES.has(name)) {
        writeLog.push({
          tool: name,
          path: args.path,
          success: result?.success === true,
          error: result?.success === true ? null : (result?.error ?? 'unknown error'),
        });
      }
      return result;
    },
  });

  return [
    wrap('read_file', z.object({
      path: z.string().describe('WordPress-root-relative file path (e.g. wp-content/themes/{slug}/style.css)'),
      start_line: z.number().int().nullable().describe('Optional first line (1-indexed)'),
      end_line: z.number().int().nullable().describe('Optional last line (1-indexed, inclusive)'),
    }), ({ path, start_line, end_line }) => ({ path, start_line, end_line })),

    wrap('search_files', z.object({
      keywords: z.array(z.string()),
      directory: z.string().nullable().describe('Directory to search. Omit for workspace.'),
      operator: z.enum(['AND', 'OR']).nullable(),
    }), ({ keywords, directory, operator }) => ({ keywords, directory, operator: operator ?? 'AND' })),

    wrap('search_content', z.object({
      keywords: z.array(z.string()),
      path: z.string().nullable(),
      context_lines: z.number().nullable(),
      max_results: z.number().nullable(),
    }), ({ keywords, path, context_lines, max_results }) => ({
      keywords,
      path,
      context_lines: context_lines ?? 2,
      max_results: max_results ?? 100,
    })),

    wrap('replace_in_file', z.object({
      path: z.string().describe('WordPress-root-relative path inside the workspace (e.g. wp-content/themes/{slug}/style.css)'),
      old_string: z.string().describe('Exact text to find, copied verbatim from the current file'),
      new_string: z.string().describe('Replacement text'),
      replace_all: z.boolean().nullable().describe('Replace every occurrence of old_string. Default false.'),
    }), ({ path, old_string, new_string, replace_all }) => ({
      path, old_string, new_string, replace_all: replace_all ?? false,
    })),

    wrap('edit_file', z.object({
      path: z.string().describe('WordPress-root-relative path inside the workspace (e.g. wp-content/themes/{slug}/style.css)'),
      start_line: z.number().int().describe('First line to replace (1-indexed, inclusive)'),
      end_line: z.number().int().describe('Last line to replace (1-indexed, inclusive)'),
      content: z.string().describe('New text to insert in place of the range. Empty string deletes the range.'),
    }), ({ path, start_line, end_line, content }) => ({ path, start_line, end_line, content })),

    wrap('write_file', z.object({
      path: z.string().describe('WordPress-root-relative path inside the workspace (e.g. wp-content/themes/{slug}/style.css)'),
      content: z.string(),
      mode: z.enum(['create', 'overwrite']).nullable(),
    }), ({ path, content, mode }) => ({ path, content, mode: mode ?? 'create' })),

    wrap('preview_navigate', z.object({
      url: z.string().describe('URL or site-relative path to navigate the live preview to'),
    }), ({ url }) => ({ url })),

    wrap('preview_reload', z.object({}), () => ({})),

    wrap('preview_get_html', z.object({
      selector: z.string().nullable().describe('Optional CSS selector to scope the returned HTML'),
    }), ({ selector }) => ({ selector })),

    wrap('preview_get_loaded_assets', z.object({}), () => ({})),

    wrap('preview_get_element_styles', z.object({
      selector: z.string().describe('CSS selector of the element to inspect'),
    }), ({ selector }) => ({ selector })),

    wrap('check_theme', z.object({}), () => ({})),

    wrap('validate_code', z.object({
      directory: z.string().nullable().describe('Optional WordPress-root-relative directory to validate. Omit to validate the whole active theme workspace.'),
    }), ({ directory }) => ({ directory })),

    wrap('code_graph', z.object({
      directory: z.string().nullable().describe('Optional WordPress-root-relative directory. Omit to use the active theme workspace.'),
    }), ({ directory }) => ({ directory })),

    wrap('graph_query', z.object({
      mode: z.enum(['explain', 'path']).nullable().describe('"explain" for a focused concept, "path" for a relationship between two symbols. Default "explain".'),
      target: z.string().nullable().describe('Symbol/concept to explain (used when mode is "explain")'),
      from: z.string().nullable().describe('Start symbol (used when mode is "path")'),
      to: z.string().nullable().describe('End symbol (used when mode is "path")'),
    }), ({ mode, target, from, to }) => ({ mode: mode ?? 'explain', target, from, to })),
  ];
}

const TOOL_DESCRIPTIONS = {
  read_file: 'Read workspace (child theme) files, plugins, or core. Paths are WordPress-root-relative (e.g. wp-content/themes/{slug}/style.css).',
  search_files: 'Search files by name. Omit directory to search workspace (child theme). Results come back WordPress-root-relative — reuse them as-is.',
  search_content: 'Search text content in files. Omit path to search workspace (child theme). Results come back WordPress-root-relative — reuse them as-is.',
  replace_in_file: 'PREFERRED way to change an existing workspace file. Replaces an exact snippet (old_string) with new_string. old_string must be copied VERBATIM from the file and unique.',
  edit_file: 'FALLBACK editor — prefer replace_in_file. Replaces lines start_line through end_line (1-indexed, inclusive) with new content.',
  write_file: 'Create or overwrite a file inside the workspace (child theme). Path is WordPress-root-relative.',
  preview_navigate: 'Navigate the live preview iframe to a URL/path, so you can inspect the rendered result of your change.',
  preview_reload: 'Reload the live preview iframe (use after an edit to see the updated render).',
  preview_get_html: 'Get the rendered HTML from the live preview, optionally scoped to a CSS selector.',
  preview_get_loaded_assets: 'List CSS/JS assets currently loaded in the live preview — use to confirm a stylesheet/script actually loaded.',
  preview_get_element_styles: 'Get the computed CSS styles of an element in the live preview, by selector — use to verify a visual/CSS change actually rendered.',
  check_theme: 'Check the active theme/child-theme setup status.',
  validate_code: 'Validate PHP/CSS/SCSS/JS/HTML syntax under a workspace directory (defaults to the whole active theme). Use after edits to catch syntax errors.',
  code_graph: 'Build/get the indexed code graph (PHP symbol registry + relationships) for a workspace directory (defaults to the active theme).',
  graph_query: 'Query the project knowledge graph — mode "explain" for a focused concept/symbol (target), or mode "path" for how two symbols relate (from/to).',
};

const ROLE_BY_TYPE = { human: 'user', ai: 'assistant', system: 'system' };

/** Convert a LangChain message into the SDK's { role, content } item. */
function toAgentItem(message) {
  const type = message?._getType?.() ?? message?.type;
  const role = ROLE_BY_TYPE[type] ?? 'user';
  const content = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
      : String(message?.content ?? '');
  return { role, content };
}

/** Extract the plain-text reply from a run() result, across SDK output shapes. */
function extractText(result) {
  const output = result?.finalOutput;
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object' && typeof output.text === 'string') return output.text;
  return typeof result?.finalOutputText === 'string' ? result.finalOutputText : '';
}

function formatTaskPrompt(task) {
  const targetFiles = Array.isArray(task?.target_files) && task.target_files.length
    ? task.target_files.join(', ')
    : '(none specified)';

  return `TASK to execute now:\nTitle: ${task?.title ?? ''}\nObjective: ${task?.objective ?? ''}\nDescription: ${task?.description ?? ''}\nTarget files: ${targetFiles}`;
}

/**
 * True if the model's own summary reads like it reported success/completion
 * (as opposed to explicitly saying it failed). This is only a weak signal
 * used for logging/diagnostics — the real done/failed verdict for taskResults
 * comes from writeLog (did any write tool call actually return success).
 */
function summaryClaimsSuccess(summary) {
  if (!summary) return false;
  return !/(failed|could not|couldn't|unable to|not (found|applied|possible)|خطا|نتوانست|ناموفق|امکان‌پذیر نبود)/i.test(summary);
}

const TASK_STATUS_LABELS = {
  done: '✓',
  failed: '✗',
  no_changes_made: '—',
};

/**
 * One timeline line for a finished task: a status glyph + the model's own
 * summary (falling back to the task title). The full summary is kept so the
 * text under the node is shown complete.
 */
function summarizeTaskResult({ title, status, summary }) {
  const glyph = TASK_STATUS_LABELS[status] ?? '';
  const body = (typeof summary === 'string' && summary.trim())
    || (typeof title === 'string' ? title.trim() : '')
    || 'وظیفه انجام شد';
  return glyph ? `${glyph} ${body}` : body;
}

export function createExecutorNode({ llmProvider, toolExecutor = null, designPrefs = null, signal, onProgress = null }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  // writeLog is cleared before each task and captured by reference in the
  // tool closures below, so every task run gets its own write-attempt log
  // without having to rebuild the agent/tools per task.
  const writeLog = [];

  // Same pattern as writeLog: tool closures capture timelineRef by reference,
  // executorNode repoints `.current` at the live Timeline for this state so
  // tool_call/tool_result entries land in order without rebuilding the agent.
  const timelineRef = { current: new Timeline() };

  // Ids loaded via use_skill — seeded from state.loaded_skills (what the
  // planner loaded), grown across this node's task runs, returned into state.
  const loadedRef = { current: new Set() };

  const timelineLogger = {
    toolCall: (...args) => timelineRef.current.toolCall(...args),
    toolResult: (...args) => timelineRef.current.toolResult(...args),
  };

  const agent = new Agent({
    name: 'Executor',
    instructions: EXECUTOR_INSTRUCTIONS
      + buildDesignBriefBlock(designPrefs)
      + buildSkillCatalogBlock(),
    model,
    tools: [
      ...buildExecutorTools(toolExecutor, signal, writeLog, timelineLogger),
      ...buildSkillTools({ node: 'executor', logger: timelineLogger, loadedRef }),
    ],
  });

  return async function executorNode(state) {
    console.log('[executor] given state:', state);

    const timeline = Timeline.from(state.timeline);
    timelineRef.current = timeline;
    timeline.nodeEnter('executor');

    // Work on copies so each task's `state` transition (queued → in_progress
    // → done/failed) is reflected in the tasks array the graph carries
    // forward, not just in the separate taskResults summary list.
    const tasks = (Array.isArray(state.tasks) ? state.tasks : []).map((task) => ({ ...task }));
    const conversation = state.messages.map(toAgentItem);
    const taskResults = [];

    // Seed from what the planner (or an earlier pass) loaded. Each task run is
    // an independent SDK run, so a skill loaded during task 1 is re-injected
    // into task 2's input via the block below rather than lost.
    loadedRef.current = new Set(Array.isArray(state.loaded_skills) ? state.loaded_skills : []);

    // Re-record the live task plan and flush it to the UI immediately, so the
    // list (with its per-task queued → in_progress → done markers) updates on
    // every state transition rather than only when the whole node returns.
    const publishPlan = () => {
      timeline.plan(tasks, 'executor');
      onProgress?.(timeline.toArray());
    };

    // Show the full list under "در حال اجرای وظیفه" up front, all still queued.
    if (tasks.length > 0) {
      publishPlan();
    }

    for (const task of tasks) {
      task.state = 'in_progress';
      writeLog.length = 0;
      timeline.event('task_start', 'executor', { title: task?.title ?? '' });
      publishPlan();

      // Rendered fresh per task so a skill loaded during an earlier task in
      // this same loop is visible to the later tasks too.
      const loadedSkillsBlock = buildLoadedSkillsBlock([...loadedRef.current]);
      const input = [
        ...conversation,
        ...(loadedSkillsBlock ? [{ role: 'system', content: loadedSkillsBlock }] : []),
        { role: 'system', content: formatTaskPrompt(task) },
      ];

      const result = await runStreamed(
        agent,
        input,
        { maxTurns: 100, toolNotFoundBehavior: 'return_error_to_model', ...(signal ? { signal } : {}) },
        () => onProgress?.(timeline.toArray()),
      );
      const summary = extractText(result);

      // Code-level backstop: don't just trust the model's prose. A task only
      // counts as done if at least one write tool call in this run actually
      // returned success:true from the backend.
      const attemptedWrites = writeLog.filter((entry) => WRITE_TOOL_NAMES.has(entry.tool));
      const successfulWrites = attemptedWrites.filter((entry) => entry.success);
      const verified = successfulWrites.length > 0;
      const status = verified ? 'done' : (attemptedWrites.length > 0 ? 'failed' : 'no_changes_made');

      if (!verified && summaryClaimsSuccess(summary)) {
        console.warn('[executor] task claimed success but no write tool call succeeded:', task?.title, { attemptedWrites });
      }

      task.state = status === 'done' ? 'done' : 'failed';

      console.log('[executor] task', status, ':', task?.title, summary, { attemptedWrites });
      timeline.event('task_end', 'executor', { title: task?.title ?? '', status, summary });
      publishPlan();
      timeline.nodeSummary('executor', summarizeTaskResult({ title: task?.title, status, summary }));
      taskResults.push({
        title: task?.title ?? '',
        summary,
        status,
        writes: attemptedWrites,
      });
    }

    timeline.nodeExit('executor', { taskCount: tasks.length });
    return { tasks, taskResults, loaded_skills: [...loadedRef.current], timeline: timeline.toArray() };
  };
}
