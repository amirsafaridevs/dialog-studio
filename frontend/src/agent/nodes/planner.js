/**
 * Node: planner — runs only when quick_analyze decided needs_action = true.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents) running in the browser
 * against the wpagentify proxy. The agent receives the conversation plus the
 * analysis produced by quick_analyze, and breaks the work into an ordered
 * list of tasks. Each task is { title, description, objective, target_files }.
 * The list is written to state.tasks.
 *
 * To ground tasks in the real file layout (beyond the preloaded code index),
 * the agent has read-only tool access (read_file, search_files, search_content)
 * backed by the same toolExecutor the main agent loop uses. It cannot write,
 * edit, or otherwise change anything on the site.
 *
 * We deliberately do NOT use the SDK's `outputType` (strict structured output):
 * the proxy models (e.g. deepseek) frequently return slightly malformed JSON
 * (unescaped quotes/newlines inside long descriptions), and the SDK's parser
 * throws "Invalid output type" on the whole run. Instead we put the JSON
 * contract in the instructions and parse the reply ourselves, forgivingly.
 */

import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { configureAgentsRuntime } from '../providers/agentsRuntime.js';
import { buildCodeIndexBlock, buildKnowledgeGraphBlock } from '../contextManager.js';

const PLANNER_INSTRUCTIONS = `You are the planner of a WordPress theme-building agent. You are given the conversation and an ANALYSIS of what the user wants. Break the work into an ordered list of concrete, actionable tasks.

You have READ-ONLY tools (read_file, search_files, search_content) to inspect the real workspace before planning — use them whenever the preloaded code map is not enough to be concrete (e.g. to confirm a function/selector actually exists, or to find files the index didn't surface). You cannot write, edit, or change anything — use the tools only to look, never to modify.

Reply with a SINGLE JSON object and nothing else:

{"tasks": [{"title": "<short task title>", "description": "<what this task does and how>", "objective": "<the main goal/purpose this task serves>", "target_files": ["<workspace-relative file path>", ...]}, ...]}

Rules:
- Each task must have "title" (short), "description", "objective", and "target_files".
- "objective" states the main purpose of the task — why it's being done / what outcome it achieves for the user — in one short sentence, not a restatement of the description.
- "target_files" is an array of the workspace-relative file paths this task will touch. Use real paths (from the indexed code map or from your read_file/search tool calls), never invented ones. Use [] only if the task genuinely creates a brand-new file whose path is stated in the description, or touches no files.
- The "description" must state the exact technical details needed to execute the task, not a vague summary. Whenever they apply, include:
  - the concrete file(s) and paths to touch (use the paths from the indexed code map above, or verified via your tools — never invent paths);
  - the specific function, hook, template part, CSS selector/class, or option involved;
  - what to add/change/remove, and where in the file (which section, which function, near which anchor);
  - concrete values — CSS properties and their values, colors (hex), sizes/units, breakpoints, text/labels, and any WordPress function or hook names.
- Prefer naming real symbols and paths over generic phrasing (e.g. "in functions.php, hook a callback onto wp_enqueue_scripts to enqueue assets/front/css/header.css" — not "add the required styles").
- Order the tasks in the sequence they should be executed.
- Keep the list as short as the work genuinely needs — no filler steps — but do not sacrifice technical detail to be brief.
- Write titles, descriptions, and objectives in the user's language (technical tokens — file paths, function names, CSS properties, hex values — stay verbatim in English/code).

Output rules (critical):
- Output ONLY the JSON object — no markdown fences, no commentary before or after.
- The JSON must be valid: escape every " and newline inside string values (use \\" and \\n). Do not put raw line breaks inside a string value.`;

/**
 * Wrap the read-only subset of the shared toolExecutor as SDK tools, so the
 * planner agent can look at real files/search results before committing to a
 * plan. No write/edit/browser/theme-mutation tools are exposed here.
 */
function buildPlannerTools(toolExecutor, signal) {
  if (!toolExecutor) return [];

  const execOptions = signal ? { signal } : {};

  return [
    tool({
      name: 'read_file',
      description: 'Read workspace (child theme) files, plugins, or core. Use workspace-relative paths for child theme files.',
      parameters: z.object({
        path: z.string().describe('Workspace-relative or WordPress-relative file path'),
        start_line: z.number().int().nullable().describe('Optional first line (1-indexed)'),
        end_line: z.number().int().nullable().describe('Optional last line (1-indexed, inclusive)'),
      }),
      execute: async ({ path, start_line, end_line }) =>
        toolExecutor.execute('read_file', { path, start_line, end_line }, execOptions),
    }),
    tool({
      name: 'search_files',
      description: 'Search files by name. Omit directory to search workspace (child theme).',
      parameters: z.object({
        keywords: z.array(z.string()),
        directory: z.string().nullable().describe('Directory to search. Omit for workspace.'),
        operator: z.enum(['AND', 'OR']).nullable(),
      }),
      execute: async ({ keywords, directory, operator }) =>
        toolExecutor.execute('search_files', { keywords, directory, operator: operator ?? 'AND' }, execOptions),
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
      execute: async ({ keywords, path, context_lines, max_results }) =>
        toolExecutor.execute('search_content', {
          keywords,
          path,
          context_lines: context_lines ?? 2,
          max_results: max_results ?? 100,
        }, execOptions),
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

/** Forgivingly pull the {tasks:[...]} object out of a free-text reply. */
function parseTasks(text) {
  if (!text) return [];

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (error) {
    console.warn('[planner] failed to parse tasks JSON:', error.message);
    return [];
  }
}

export function createPlannerNode({ llmProvider, themeContext = null, toolExecutor = null, signal }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  const agent = new Agent({
    name: 'Planner',
    instructions: PLANNER_INSTRUCTIONS + buildIndexInstructions(themeContext),
    model,
    tools: buildPlannerTools(toolExecutor, signal),
  });

  return async function plannerNode(state) {
    console.log('[planner] given state:', state);

    const input = [
      ...state.messages.map(toAgentItem),
      { role: 'system', content: `ANALYSIS of what the user wants:\n${state.analysis}` },
    ];

    const result = await run(agent, input, { maxTurns: 100, ...(signal ? { signal } : {}) });
    const tasks = parseTasks(extractText(result));

    console.log('[planner] tasks:', tasks);
    return { tasks };
  };
}
