/**
 * Node: planner — runs in two situations (see agentLoop.js topology):
 *
 * 1. First pass, from quick_analyze (state.validationResults is empty): the
 *    agent receives the conversation plus the analysis produced by
 *    quick_analyze, and breaks the work into an ordered list of tasks.
 * 2. Re-plan pass, from validator (state.validationResults has entries):
 *    validator decided the user's goal is NOT yet satisfied. The agent
 *    receives the same conversation/analysis PLUS the full record of what
 *    was already tried — every previously planned task, its description,
 *    and the executor's result for it — PLUS the complete history of every
 *    validator pass (satisfied/summary/reasons for each), so it can see
 *    exactly what's still wrong and plan a fix instead of repeating or
 *    ignoring prior attempts.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents) running in the browser
 * against the wpagentify proxy. Each task is
 * { title, description, objective, target_files }. The list is written to
 * state.tasks (replacing the previous pass's tasks — taskResults/
 * validationResults keep the full history, so nothing is lost).
 *
 * To ground tasks in the real file layout (beyond the preloaded code index),
 * the agent has read-only tool access (read_file, search_files, search_content)
 * plus read-only preview/browser inspection (preview_navigate, preview_reload,
 * preview_get_html, preview_get_loaded_assets, preview_get_element_styles)
 * backed by the same toolExecutor the main agent loop uses. It cannot write,
 * edit, or otherwise change anything on the site.
 *
 * We deliberately do NOT use the SDK's `outputType` (strict structured output):
 * the proxy models (e.g. deepseek) frequently return slightly malformed JSON
 * (unescaped quotes/newlines inside long descriptions), and the SDK's parser
 * throws "Invalid output type" on the whole run. Instead we put the JSON
 * contract in the instructions and parse the reply ourselves, forgivingly.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { configureAgentsRuntime, runStreamed } from '../providers/agentsRuntime.js';
import { buildCodeIndexBlock, buildKnowledgeGraphBlock } from '../contextManager.js';
import { buildSkillCatalogBlock, buildLoadedSkillsBlock, buildDesignBriefBlock } from '../skills/prompt.js';
import { buildSkillTools } from '../skills/tools.js';
import { Timeline } from '../timeline.js';

const PLANNER_INSTRUCTIONS = `You are the planner of a WordPress theme-building agent. You are given the conversation and an ANALYSIS of what the user wants. Break the work into an ordered list of concrete, actionable tasks.

You run in one of two situations, distinguished by whether a "PREVIOUS ATTEMPT" block is present in your input:
- No PREVIOUS ATTEMPT block: this is the first planning pass for this request. Plan from scratch.
- A PREVIOUS ATTEMPT block IS present: a plan was already executed and a validator checked it against the user's real goal and found it NOT yet satisfied. That block contains every task tried so far (with the executor's own result for each) and the full history of validator passes (each pass's satisfied/summary/reasons). Read it carefully: figure out exactly what is still missing or wrong per the validator's reasons, and plan ONLY the additional/corrective tasks needed to actually satisfy the goal — do not blindly repeat tasks that already succeeded, and do not ignore issues the validator already flagged more than once.

You have READ-ONLY tools to inspect the real workspace before planning — use them whenever the preloaded code map is not enough to be concrete. read_file, search_files, search_content let you confirm a function/selector actually exists or find files the index didn't surface. preview_navigate, preview_reload, preview_get_html, preview_get_loaded_assets, and preview_get_element_styles let you inspect the live rendered site preview — use them to confirm current rendered markup/CSS/loaded assets before planning a change to them. You cannot write, edit, or change anything — use the tools only to look, never to modify.

You also have the skill tools (use_skill, read_skill_resource, search_skill_data) described in the skill catalog below. Load the relevant skill(s) BEFORE writing the plan — the loaded guidance must shape the tasks themselves (which files, which values, which patterns), and note that the executor will see the same loaded skills while implementing. When a loaded skill tells you to search its datasets to establish concrete design values (style, palette, fonts), do that during planning and put the chosen values INTO the task descriptions.

Before producing tasks, check whether you can actually proceed:
- If the request is AMBIGUOUS (multiple reasonable interpretations, missing information you cannot discover with your tools, e.g. "which page", "which color", "which of these two menus") — do NOT invent an assumption and do NOT produce tasks. Instead ask the user via "question".
- If the request is genuinely NOT DOABLE (impossible, outside what this agent can do, contradicts how WordPress/the theme works, etc.) — do NOT produce tasks. Explain why in "final_answer".
- Otherwise, produce "tasks" normally and leave "question" as null and "final_answer" as "".

Reply with a SINGLE JSON object and nothing else, always containing all three keys:

{"tasks": [...], "final_answer": "<string>", "question": <object-or-null>}

Exactly ONE of the following three outcomes applies per reply:
1. Normal planning: "tasks" is a non-empty array (shape below), "final_answer" is "", "question" is null.
2. Not doable / already answerable without touching the site: "tasks" is [], "final_answer" contains the full explanation/answer to give the user (in their language), "question" is null.
3. Ambiguous — need to ask: "tasks" is [], "final_answer" is "", "question" is a single object:
   {"text": "<the question, in the user's language>", "type": "single"|"multiple", "options": ["<option 1>", "<option 2>", ...]}
   - Use "type": "single" when only one option can apply (radio-button choice).
   - Use "type": "multiple" when more than one option can be selected at once (checkbox choice).
   - "options" must have at least 2 concrete, mutually distinguishable choices in the user's language.
   - Ask only ONE question per reply (pick the single most important ambiguity to resolve first).

Task shape (used only for outcome 1):
{"title": "<short task title>", "description": "<what this task does and how>", "objective": "<the main goal/purpose this task serves>", "target_files": ["<WordPress-root-relative file path>", ...]}

Rules for tasks:
- Each task must have "title" (short), "description", "objective", and "target_files".
- "objective" states the main purpose of the task — why it's being done / what outcome it achieves for the user — in one short sentence, not a restatement of the description.
- "target_files" is an array of the WordPress-root-relative file paths this task will touch (e.g. "wp-content/themes/{slug}/style.css") — the same format the indexed code map and your read_file/search tool calls already use. Use real paths, never invented ones. Use [] only if the task genuinely creates a brand-new file whose path is stated in the description, or touches no files.
- The "description" must state the exact technical details needed to execute the task, not a vague summary. Whenever they apply, include:
  - the concrete file(s) and paths to touch (use the paths from the indexed code map above, or verified via your tools — never invent paths);
  - the specific function, hook, template part, CSS selector/class, or option involved;
  - what to add/change/remove, and where in the file (which section, which function, near which anchor);
  - concrete values — CSS properties and their values, colors (hex), sizes/units, breakpoints, text/labels, and any WordPress function or hook names.
- Prefer naming real symbols and paths over generic phrasing (e.g. "in functions.php, hook a callback onto wp_enqueue_scripts to enqueue assets/front/css/header.css" — not "add the required styles").
- Order the tasks in the sequence they should be executed.
- Keep the list as short as the work genuinely needs — no filler steps — but do not sacrifice technical detail to be brief.
- Write titles, descriptions, objectives, final_answer, and question text in the user's language (technical tokens — file paths, function names, CSS properties, hex values — stay verbatim in English/code).

Output rules (critical):
- Output ONLY the JSON object — no markdown fences, no commentary before or after.
- The JSON must be valid: escape every " and newline inside string values (use \\" and \\n). Do not put raw line breaks inside a string value.`;

/**
 * Wrap the read-only subset of the shared toolExecutor as SDK tools, so the
 * planner agent can look at real files/search results and the live preview
 * before committing to a plan. No write/edit/theme-mutation tools are exposed
 * here — the preview tools included (preview_navigate, preview_reload,
 * preview_get_html, preview_get_loaded_assets, preview_get_element_styles)
 * are read-only inspection of the rendered site, not mutations.
 *
 * Every call is recorded via `logger` (tool_call before execution, tool_result
 * after) so the ordered history of what the planner looked at is preserved.
 * `logger` is `{ toolCall, toolResult }`, backed by whichever Timeline the
 * current node invocation is using (see createPlannerNode).
 */
function buildPlannerTools(toolExecutor, signal, logger) {
  if (!toolExecutor) return [];

  const execOptions = signal ? { signal } : {};

  const withLogging = (name, execute) => async (args) => {
    logger.toolCall(name, args, { node: 'planner' });
    const result = await execute(args);
    logger.toolResult(name, result, { node: 'planner', success: result?.success !== false });
    return result;
  };

  return [
    tool({
      name: 'read_file',
      description: 'Read workspace (child theme) files, plugins, or core. Paths are WordPress-root-relative (e.g. wp-content/themes/{slug}/style.css).',
      parameters: z.object({
        path: z.string().describe('WordPress-root-relative file path'),
        start_line: z.number().int().nullable().describe('Optional first line (1-indexed)'),
        end_line: z.number().int().nullable().describe('Optional last line (1-indexed, inclusive)'),
      }),
      execute: withLogging('read_file', ({ path, start_line, end_line }) =>
        toolExecutor.execute('read_file', { path, start_line, end_line }, execOptions)),
    }),
    tool({
      name: 'search_files',
      description: 'Search files by name. Omit directory to search workspace (child theme).',
      parameters: z.object({
        keywords: z.array(z.string()),
        directory: z.string().nullable().describe('Directory to search. Omit for workspace.'),
        operator: z.enum(['AND', 'OR']).nullable(),
      }),
      execute: withLogging('search_files', ({ keywords, directory, operator }) =>
        toolExecutor.execute('search_files', { keywords, directory, operator: operator ?? 'AND' }, execOptions)),
    }),
    tool({
      name: 'search_content',
      description: 'Search text content in files. Omit path to search workspace (child theme).',
      parameters: z.object({
        keywords: z.array(z.string()),
        path: z.string().nullable(),
        context_lines: z.number().nullable(),
        max_results: z.number().nullable(),
      }),
      execute: withLogging('search_content', ({ keywords, path, context_lines, max_results }) =>
        toolExecutor.execute('search_content', {
          keywords,
          path,
          context_lines: context_lines ?? 2,
          max_results: max_results ?? 100,
        }, execOptions)),
    }),
    tool({
      name: 'preview_navigate',
      description: 'Navigate the live site preview iframe to a URL or site-relative path (e.g. /, /about/). Use to inspect a page before planning changes to it.',
      parameters: z.object({
        url: z.string().describe('URL or site-relative path to navigate the live preview to'),
      }),
      execute: withLogging('preview_navigate', ({ url }) =>
        toolExecutor.execute('preview_navigate', { url }, execOptions)),
    }),
    tool({
      name: 'preview_reload',
      description: 'Reload the current page in the live site preview iframe.',
      parameters: z.object({}),
      execute: withLogging('preview_reload', () =>
        toolExecutor.execute('preview_reload', {}, execOptions)),
    }),
    tool({
      name: 'preview_get_html',
      description: 'Read rendered HTML from the live site preview iframe. Omit selector and dom_path to get the full page HTML.',
      parameters: z.object({
        selector: z.string().nullable().describe('Optional CSS selector to scope the returned HTML'),
        dom_path: z.string().nullable().describe('Optional DOM path from element picker (e.g. div.hero > h1.title)'),
      }),
      execute: withLogging('preview_get_html', ({ selector, dom_path }) =>
        toolExecutor.execute('preview_get_html', { selector, dom_path }, execOptions)),
    }),
    tool({
      name: 'preview_get_loaded_assets',
      description: 'List all CSS stylesheets and JS scripts currently loaded in the live site preview iframe.',
      parameters: z.object({}),
      execute: withLogging('preview_get_loaded_assets', () =>
        toolExecutor.execute('preview_get_loaded_assets', {}, execOptions)),
    }),
    tool({
      name: 'preview_get_element_styles',
      description: 'Inspect the CSS applied to a specific element in the live site preview iframe (matched rules, inline styles, computed styles). Requires selector or dom_path.',
      parameters: z.object({
        selector: z.string().nullable().describe('CSS selector for the target element (e.g. ".site-header .welcome-user")'),
        dom_path: z.string().nullable().describe('DOM path from the element picker (e.g. "header#site-header > span.welcome-user")'),
      }),
      execute: withLogging('preview_get_element_styles', ({ selector, dom_path }) =>
        toolExecutor.execute('preview_get_element_styles', { selector, dom_path }, execOptions)),
    }),
  ];
}

/**
 * Render the preloaded theme code index (and knowledge graph, if present) as a
 * prompt block so the planner knows the actual file layout when it breaks the
 * work into tasks — the same index the previous agent injected into its context.
 */
function buildIndexInstructions(themeContext) {
  if (!themeContext) return '';
  console.log('[planner] building index instructions from themeContext:', themeContext);
  const block = [
    buildKnowledgeGraphBlock(themeContext.knowledge_graph),
    buildCodeIndexBlock(themeContext.code_index),
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!block) return '';

  return `\n\nThe theme has already been indexed. Use this map of the real files when planning — reference concrete files/paths in your tasks instead of guessing:\n\n${block}`;
}

/** Render every previously planned task + its executor result, in order. */
function formatPreviousTasks(tasks, taskResults) {
  const resultByTitle = new Map(
    (Array.isArray(taskResults) ? taskResults : []).map((entry) => [entry.title, entry])
  );

  return (Array.isArray(tasks) ? tasks : [])
    .map((task, i) => {
      const result = resultByTitle.get(task?.title);
      const status = result?.status ?? task?.state ?? 'unknown';
      const summary = result?.summary ?? '(no result recorded)';
      return `${i + 1}. "${task?.title ?? ''}" [${status}]\n   Objective: ${task?.objective ?? ''}\n   Description: ${task?.description ?? ''}\n   Executor result: ${summary}`;
    })
    .join('\n\n') || '(no tasks were planned in the previous attempt)';
}

/** Render every validator pass so far — satisfied/summary/reasons — oldest first. */
function formatValidationHistory(validationResults) {
  return (Array.isArray(validationResults) ? validationResults : [])
    .map((entry, i) => {
      const reasons = Array.isArray(entry.reasons) && entry.reasons.length
        ? entry.reasons.map((r) => `     - ${r}`).join('\n')
        : '     (none)';
      return `Pass ${i + 1}: satisfied=${entry.satisfied}\n   Summary: ${entry.summary}\n   Reasons:\n${reasons}`;
    })
    .join('\n\n') || '(no previous validation passes)';
}

/**
 * Build the "PREVIOUS ATTEMPT" context block that tells the planner exactly
 * what was already tried and why the validator says it's not done yet. Only
 * produced when re-planning after a validator rejection (state.validationResults
 * has entries) — the first-pass planner input never includes this block.
 */
function buildPreviousAttemptBlock(state) {
  const validationResults = Array.isArray(state.validationResults) ? state.validationResults : [];
  if (validationResults.length === 0) return null;

  return [
    'PREVIOUS ATTEMPT — the validator found the goal NOT yet satisfied. Plan the fix, do not start over blindly:',
    `Tasks already tried:\n${formatPreviousTasks(state.tasks, state.taskResults)}`,
    `Validation history (oldest first):\n${formatValidationHistory(validationResults)}`,
  ].join('\n\n');
}

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
  if (output && typeof output === 'object') {
    // Already-parsed shape (shouldn't happen without outputType, but be safe).
    if (Array.isArray(output.tasks)) return JSON.stringify(output);
    if (typeof output.text === 'string') return output.text;
  }
  return typeof result?.finalOutputText === 'string' ? result.finalOutputText : '';
}

/** Forgivingly pull the {tasks, final_answer, question} object out of a free-text reply. */
function parsePlannerOutput(text) {
  const empty = { tasks: [], final_answer: '', question: null };
  if (!text) return empty;

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;

  try {
    const parsed = JSON.parse(match[0]);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((task) => ({ ...task, state: 'queued' }))
      : [];
    return {
      tasks,
      final_answer: typeof parsed.final_answer === 'string' ? parsed.final_answer : '',
      question: parsed.question && typeof parsed.question === 'object' ? parsed.question : null,
    };
  } catch (error) {
    console.warn('[planner] failed to parse planner JSON:', error.message);
    return empty;
  }
}

export function createPlannerNode({ llmProvider, themeContext = null, toolExecutor = null, designPrefs = null, signal, onProgress = null }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  // Tool closures capture `timelineRef` by reference; plannerNode reassigns
  // `.current` to that run's Timeline before each run() call so tool_call/
  // tool_result entries land on the right invocation without rebuilding the
  // agent/tools per call.
  const timelineRef = { current: new Timeline() };

  // Same by-reference pattern for the ids loaded via use_skill: plannerNode
  // reseeds `.current` from state.loaded_skills before each run, the tool adds
  // to it during the run, and the node returns it into state afterwards.
  const loadedRef = { current: new Set() };

  const timelineLogger = {
    toolCall: (...args) => timelineRef.current.toolCall(...args),
    toolResult: (...args) => timelineRef.current.toolResult(...args),
  };

  const agent = new Agent({
    name: 'Planner',
    instructions: PLANNER_INSTRUCTIONS
      + buildDesignBriefBlock(designPrefs)
      + buildSkillCatalogBlock()
      + buildIndexInstructions(themeContext),
    model,
    tools: [
      ...buildPlannerTools(toolExecutor, signal, timelineLogger),
      ...buildSkillTools({ node: 'planner', logger: timelineLogger, loadedRef }),
    ],
  });

  /** One short timeline line describing the plan the planner produced. */
  function summarizePlan({ tasks, final_answer, question }) {
    if (question) return 'برای برنامه‌ریزی نیاز به پرسیدن یک سؤال است';
    const count = Array.isArray(tasks) ? tasks.length : 0;
    if (count === 0) {
      return final_answer ? 'بدون نیاز به وظیفه؛ پاسخ آماده شد' : 'وظیفه‌ای برای اجرا لازم نبود';
    }
    const first = tasks[0]?.title?.trim();
    if (count === 1 && first) return `۱ وظیفه: ${first}`;
    return `${count} وظیفه برنامه‌ریزی شد${first ? ` (شروع با: ${first})` : ''}`;
  }

  return async function plannerNode(state) {
    console.log('[planner] given state:', state);

    const previousAttemptBlock = buildPreviousAttemptBlock(state);

    const timeline = Timeline.from(state.timeline);
    timelineRef.current = timeline;
    timeline.nodeEnter('planner', { replan: Boolean(previousAttemptBlock) });

    // Skills loaded earlier this turn (e.g. before a replan pass) — re-inject
    // their bodies so this run stays consistent with what already guided the work.
    loadedRef.current = new Set(Array.isArray(state.loaded_skills) ? state.loaded_skills : []);
    const loadedSkillsBlock = buildLoadedSkillsBlock([...loadedRef.current]);

    const input = [
      ...state.messages.map(toAgentItem),
      { role: 'system', content: `ANALYSIS of what the user wants:\n${state.analysis}` },
      ...(loadedSkillsBlock ? [{ role: 'system', content: loadedSkillsBlock }] : []),
      ...(previousAttemptBlock ? [{ role: 'system', content: previousAttemptBlock }] : []),
    ];

    const result = await runStreamed(
      agent,
      input,
      { maxTurns: 500, toolNotFoundBehavior: 'return_error_to_model', ...(signal ? { signal } : {}) },
      () => onProgress?.(timeline.toArray()),
    );
    const { tasks, final_answer, question } = parsePlannerOutput(extractText(result));

    console.log('[planner] tasks:', tasks, 'final_answer:', final_answer, 'question:', question, 'loaded_skills:', [...loadedRef.current]);
    timeline.nodeSummary('planner', summarizePlan({ tasks, final_answer, question }));
    // Note: the live task-plan block is recorded by the executor (so it renders
    // nested under "در حال اجرای وظیفه"), not here.
    timeline.nodeExit('planner', { taskCount: tasks.length, hasQuestion: Boolean(question) });

    return {
      tasks,
      final_answer,
      question,
      needs_more_action: false,
      loaded_skills: [...loadedRef.current],
      timeline: timeline.toArray(),
    };
  };
}
