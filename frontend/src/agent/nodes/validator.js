/**
 * Node: validator — runs after executor finished state.tasks.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents), same pattern as planner
 * and executor. Given the user's original message, the analysis produced by
 * quick_analyze, and the executor's taskResults (what was done, per task, and
 * its outcome), this node checks — against the REAL, currently-rendered site,
 * not just the model's own claims — whether the user's goal was actually
 * achieved.
 *
 * It has ONLY front-end inspection tools: the live-preview/browser tools
 * (preview_navigate, preview_reload, preview_get_html,
 * preview_get_loaded_assets, preview_get_element_styles) plus the debugger
 * tools (toggle_debug, clear_debug_log, read_debug_log). It has NO
 * filesystem tools (no read_file/search_files/search_content) and NO write
 * tools — it only checks the rendered site and the debug log, it never reads
 * source files and never fixes anything.
 *
 * It is required to also verify there are no fatal errors via the debugger,
 * following a strict sequence: check whether debug mode is on (turning it on
 * if not), clear the debug log, reload/navigate the affected page(s), then
 * read the debug log for fatal errors — and always turn debug mode back off
 * at the end of the pass, regardless of outcome.
 *
 * Every run appends one entry to state.validationResults — an ordered log of
 * every validation pass, so nothing from a prior pass is lost. Each entry:
 * { satisfied, summary, reasons: string[], checkedAt }. `reasons` is the
 * itemized list of what's missing/wrong when satisfied is false (empty when
 * satisfied is true).
 *
 * state.needs_more_action mirrors the latest entry's `!satisfied` and is what
 * routing keys off: true sends the graph back to planner (with full context
 * of what was attempted and why validation says it's not done yet), false
 * sends it to finalize.
 *
 * The agent is also given the full validationResults history so far (as
 * input, not just written to state) — so if this is a second/third pass, it
 * knows what was already flagged before and can tell whether earlier issues
 * were actually resolved instead of re-discovering them from scratch.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { configureAgentsRuntime, runStreamed } from '../providers/agentsRuntime.js';
import { buildLoadedSkillsBlock, buildDesignBriefBlock } from '../skills/prompt.js';
import { Timeline } from '../timeline.js';

const VALIDATOR_INSTRUCTIONS = `You are the validator of a WordPress theme-building agent. A plan was executed against the real workspace (child theme). Your job is to check — using your own tool calls against the REAL live site, never by trusting the executor's own summary at face value — whether the user's original goal has actually been achieved.

You have ONLY two kinds of tools:
1. Live-preview/browser tools: preview_navigate, preview_reload, preview_get_html, preview_get_loaded_assets, preview_get_element_styles.
2. Debugger tools: toggle_debug, clear_debug_log, read_debug_log.

You have NO file tools (no read_file/search_files/search_content) and NO write tools — you cannot read source files and you cannot change anything. Everything you check must go through the rendered front-end (the live preview) and the debug log.

You are given:
- The user's ORIGINAL request (conversation).
- The ANALYSIS of what the user wants (from the triage step).
- The TASKS that were planned and their EXECUTION RESULTS (what each task did, per the executor).
- The HISTORY of previous validation passes, if any (so you know what was already flagged and whether it was fixed).

Check thoroughly, in this order:

A) Front-end check — for every task, and for the user's goal as a whole, use preview_navigate/preview_reload/preview_get_html/preview_get_loaded_assets/preview_get_element_styles to confirm the change is ACTUALLY rendered on the real page(s) — do not assume the executor's summary is accurate. For every task marked "failed" or "no_changes_made", treat the underlying goal as NOT met unless something else already covers it. Judge against the user's ORIGINAL goal as a whole, not just task-by-task.

B) Debugger check (mandatory, every pass, in this exact sequence):
  1. Call toggle_debug to check the current debug state; if debug/debug_log is not already on, call toggle_debug again with debug=true and debug_log=true to turn it on.
  2. Call clear_debug_log to clear out any stale log content, so only errors from this check will appear.
  3. Use preview_navigate/preview_reload to load the page(s) relevant to the work being validated (so any fatal error on those pages gets triggered and logged).
  4. Call read_debug_log and inspect it for PHP fatal errors, warnings, or notices caused by the change. Any fatal error means the goal is NOT satisfied, regardless of what the front-end looked like.
  5. Regardless of what you found — satisfied or not, error or clean — call toggle_debug again at the end to restore debug mode to OFF (debug=false, debug_log=false, debug_display=false). Never skip this step, even if an earlier step failed.

Reply with a SINGLE JSON object and nothing else:

{"satisfied": <true|false>, "summary": "<short overall verdict, in the user's language>", "reasons": ["<reason 1>", "<reason 2>", ...]}

Rules:
- "satisfied": true only if the user's goal, as stated, is now genuinely and verifiably achieved on the real site AND the debug log shows no fatal errors from the change.
- "reasons": when satisfied is false, an itemized list of concrete, specific problems — what is missing, wrong, unverifiable, or which fatal error appeared (quote the relevant debug.log line), and (where relevant) which selector/page it concerns. Be precise enough that a planner could turn each reason directly into a fix task. When satisfied is true, this must be [].
- "summary": one or two sentences, in the user's language, giving the overall verdict.
- Output ONLY the JSON object — no markdown fences, no commentary before or after. Escape every " and newline inside string values.`;

/**
 * Wrap the front-end (preview/browser) + debugger subset of the shared
 * toolExecutor as SDK tools — everything the validator is allowed to use to
 * check the real rendered site and the debug log, nothing that reads source
 * files and nothing that can change site content. Every call is logged via
 * `logger` the same way planner/executor do, so the timeline captures what
 * the validator actually inspected.
 */
function buildValidatorTools(toolExecutor, signal, logger) {
  if (!toolExecutor) return [];

  const execOptions = signal ? { signal } : {};

  const wrap = (name, paramsSchema, toArgs, description) => tool({
    name,
    description,
    parameters: paramsSchema,
    execute: async (input) => {
      const args = toArgs(input);
      logger.toolCall(name, args, { node: 'validator' });
      const result = await toolExecutor.execute(name, args, execOptions);
      logger.toolResult(name, result, { node: 'validator', success: result?.success !== false });
      return result;
    },
  });

  return [
    wrap('toggle_debug', z.object({
      debug: z.boolean().describe('Set WP_DEBUG on/off'),
      debug_log: z.boolean().nullable().describe('Set WP_DEBUG_LOG on/off'),
      debug_display: z.boolean().nullable().describe('Set WP_DEBUG_DISPLAY on/off'),
    }), ({ debug, debug_log, debug_display }) => ({
      debug,
      debug_log: debug_log ?? debug,
      debug_display: debug_display ?? false,
    }),
    'Enable or disable WordPress debug mode. Call first (with debug=true, debug_log=true) to make sure debugging is on before checking for fatal errors, and again at the very end of every pass (with debug=false, debug_log=false, debug_display=false) to turn it back off.'),

    wrap('clear_debug_log', z.object({}), () => ({}),
    'Clear the WordPress debug.log file content. Call this right after enabling debug mode and before reloading the affected page(s), so only errors from this check appear in the log.'),

    wrap('read_debug_log', z.object({}), () => ({}),
    'Read the WordPress debug.log file. Call after reloading/navigating the affected page(s), to check for PHP fatal errors, warnings, or notices caused by the change.'),

    wrap('preview_navigate', z.object({
      url: z.string().describe('URL or site-relative path to navigate the live preview to'),
    }), ({ url }) => ({ url }),
    'Navigate the live preview iframe to a URL/path, so you can inspect the actually-rendered result.'),

    wrap('preview_reload', z.object({}), () => ({}),
    'Reload the live preview iframe (use to pick up the latest changes before inspecting).'),

    wrap('preview_get_html', z.object({
      selector: z.string().nullable().describe('Optional CSS selector to scope the returned HTML'),
    }), ({ selector }) => ({ selector }),
    'Get the rendered HTML from the live preview, optionally scoped to a CSS selector.'),

    wrap('preview_get_loaded_assets', z.object({}), () => ({}),
    'List CSS/JS assets currently loaded in the live preview — use to confirm a stylesheet/script actually loaded.'),

    wrap('preview_get_element_styles', z.object({
      selector: z.string().describe('CSS selector of the element to inspect'),
    }), ({ selector }) => ({ selector }),
    'Get the computed CSS styles of an element in the live preview, by selector — use to verify a visual/CSS change actually rendered.'),
  ];
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
  if (output && typeof output === 'object' && typeof output.text === 'string') return output.text;
  return typeof result?.finalOutputText === 'string' ? result.finalOutputText : '';
}

/** Forgivingly pull the {satisfied, summary, reasons} object out of a free-text reply. */
function parseValidatorOutput(text) {
  const empty = { satisfied: false, summary: '', reasons: [] };
  if (!text) return empty;

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;

  try {
    const parsed = JSON.parse(match[0]);
    return {
      satisfied: Boolean(parsed.satisfied),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.filter((r) => typeof r === 'string') : [],
    };
  } catch (error) {
    console.warn('[validator] failed to parse validator JSON:', error.message);
    return empty;
  }
}

/** One timeline line stating the validator's verdict + its own (full) summary. */
function summarizeValidation({ satisfied, summary }) {
  const glyph = satisfied ? '✓' : '✗';
  const body = (typeof summary === 'string' && summary.trim())
    || (satisfied ? 'هدف کاربر محقق شد' : 'هدف کاربر هنوز محقق نشده است');
  return `${glyph} ${body}`;
}

function formatTaskResults(taskResults) {
  if (!Array.isArray(taskResults) || taskResults.length === 0) return '(no tasks were executed)';
  return taskResults
    .map((entry, i) => `${i + 1}. [${entry.status}] ${entry.title}\n   Result: ${entry.summary}`)
    .join('\n');
}

function formatValidationHistory(validationResults) {
  if (!Array.isArray(validationResults) || validationResults.length === 0) return '(no previous validation passes)';
  return validationResults
    .map((entry, i) => {
      const reasons = Array.isArray(entry.reasons) && entry.reasons.length
        ? entry.reasons.map((r) => `     - ${r}`).join('\n')
        : '     (none)';
      return `Pass ${i + 1}: satisfied=${entry.satisfied}\n   Summary: ${entry.summary}\n   Reasons:\n${reasons}`;
    })
    .join('\n\n');
}

export function createValidatorNode({ llmProvider, toolExecutor = null, designPrefs = null, signal, onProgress = null }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  const timelineRef = { current: new Timeline() };

  const agent = new Agent({
    name: 'Validator',
    // The design brief is part of the goal: work that renders fine but ignores
    // the owner's configured style/colors is NOT satisfied.
    instructions: VALIDATOR_INSTRUCTIONS + buildDesignBriefBlock(designPrefs),
    model,
    tools: buildValidatorTools(toolExecutor, signal, {
      toolCall: (...args) => timelineRef.current.toolCall(...args),
      toolResult: (...args) => timelineRef.current.toolResult(...args),
    }),
  });

  return async function validatorNode(state) {
    console.log('[validator] given state:', state);

    const timeline = Timeline.from(state.timeline);
    timelineRef.current = timeline;
    timeline.nodeEnter('validator');

    const previousResults = Array.isArray(state.validationResults) ? state.validationResults : [];

    // The skills the planner/executor worked under: the validator judges the
    // rendered result against their style rules / pre-delivery checklists too.
    const loadedSkillsBlock = buildLoadedSkillsBlock(
      state.loaded_skills,
      'LOADED SKILLS — the executor implemented the tasks following these skill documents. When judging whether the goal is satisfied, also check the rendered result against their concrete style rules, anti-patterns, and any pre-delivery checklist they contain:',
    );

    const input = [
      ...state.messages.map(toAgentItem),
      {
        role: 'system',
        content: [
          `ANALYSIS of what the user wants:\n${state.analysis}`,
          `TASKS planned and executed:\n${formatTaskResults(state.taskResults)}`,
          `PREVIOUS VALIDATION PASSES:\n${formatValidationHistory(previousResults)}`,
          ...(loadedSkillsBlock ? [loadedSkillsBlock] : []),
        ].join('\n\n'),
      },
    ];

    const result = await runStreamed(
      agent,
      input,
      { maxTurns: 100, toolNotFoundBehavior: 'return_error_to_model', ...(signal ? { signal } : {}) },
      () => onProgress?.(timeline.toArray()),
    );
    const { satisfied, summary, reasons } = parseValidatorOutput(extractText(result));

    const entry = { satisfied, summary, reasons, checkedAt: Date.now() };
    const validationResults = [...previousResults, entry];
    const needs_more_action = !satisfied;

    console.log('[validator] entry:', entry, 'needs_more_action:', needs_more_action);
    timeline.event('validation_result', 'validator', entry);
    timeline.nodeSummary('validator', summarizeValidation({ satisfied, summary }));
    timeline.nodeExit('validator', { satisfied, needs_more_action });

    return { validationResults, needs_more_action, timeline: timeline.toArray() };
  };
}

export default createValidatorNode;
