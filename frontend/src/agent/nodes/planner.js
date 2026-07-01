/**
 * Node: planner — runs only when quick_analyze decided needs_action = true.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents) running in the browser
 * against the wpagentify proxy. A single tool-free agent run receives the
 * conversation plus the analysis produced by quick_analyze, and breaks the work
 * into an ordered list of tasks. Each task is { title, description }. The list
 * is written to state.tasks.
 *
 * We deliberately do NOT use the SDK's `outputType` (strict structured output):
 * the proxy models (e.g. deepseek) frequently return slightly malformed JSON
 * (unescaped quotes/newlines inside long descriptions), and the SDK's parser
 * throws "Invalid output type" on the whole run. Instead we put the JSON
 * contract in the instructions and parse the reply ourselves, forgivingly.
 */

import { Agent, run } from '@openai/agents';
import { configureAgentsRuntime } from '../providers/agentsRuntime.js';
import { buildCodeIndexBlock, buildKnowledgeGraphBlock } from '../contextManager.js';

const PLANNER_INSTRUCTIONS = `You are the planner of a WordPress theme-building agent. You are given the conversation and an ANALYSIS of what the user wants. Break the work into an ordered list of concrete, actionable tasks.

Reply with a SINGLE JSON object and nothing else:

{"tasks": [{"title": "<short task title>", "description": "<what this task does and how>"}, ...]}

Rules:
- Each task must have both a "title" (short) and a "description".
- The "description" must state the exact technical details needed to execute the task, not a vague summary. Whenever they apply, include:
  - the concrete file(s) and paths to touch (use the paths from the indexed code map above, never invent paths);
  - the specific function, hook, template part, CSS selector/class, or option involved;
  - what to add/change/remove, and where in the file (which section, which function, near which anchor);
  - concrete values — CSS properties and their values, colors (hex), sizes/units, breakpoints, text/labels, and any WordPress function or hook names.
- Prefer naming real symbols and paths over generic phrasing (e.g. "in functions.php, hook a callback onto wp_enqueue_scripts to enqueue assets/front/css/header.css" — not "add the required styles").
- Order the tasks in the sequence they should be executed.
- Keep the list as short as the work genuinely needs — no filler steps — but do not sacrifice technical detail to be brief.
- Write titles and descriptions in the user's language (technical tokens — file paths, function names, CSS properties, hex values — stay verbatim in English/code).

Output rules (critical):
- Output ONLY the JSON object — no markdown fences, no commentary before or after.
- The JSON must be valid: escape every " and newline inside "title"/"description" (use \\" and \\n). Do not put raw line breaks inside a string value.`;

/**
 * Render the preloaded theme code index (and knowledge graph, if present) as a
 * prompt block so the planner knows the actual file layout when it breaks the
 * work into tasks — the same index the previous agent injected into its context.
 */
function buildIndexInstructions(themeContext) {
  if (!themeContext) return '';

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

export function createPlannerNode({ llmProvider, themeContext = null, signal }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  const agent = new Agent({
    name: 'Planner',
    instructions: PLANNER_INSTRUCTIONS + buildIndexInstructions(themeContext),
    model,
  });

  return async function plannerNode(state) {
    console.log('[planner] given state:', state);

    const input = [
      ...state.messages.map(toAgentItem),
      { role: 'system', content: `ANALYSIS of what the user wants:\n${state.analysis}` },
    ];

    const result = await run(agent, input, signal ? { signal } : undefined);
    const tasks = parseTasks(extractText(result));

    console.log('[planner] tasks:', tasks);
    return { tasks };
  };
}
