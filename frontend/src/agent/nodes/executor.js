/**
 * Node: executor — runs after planner produced state.tasks.
 *
 * Powered by the OpenAI Agents SDK (@openai/agents), same as planner. Goes
 * through state.tasks one by one (in order) and, for each, runs an agent that
 * carries out that single task against the real workspace. Unlike planner,
 * this agent has read AND write tools (read_file, search_files,
 * search_content, replace_in_file, edit_file, write_file) backed by the same
 * toolExecutor — it is the one allowed to actually change files.
 *
 * Each task is given to the agent as fresh input (title/description/
 * objective/target_files) plus the original conversation for context. We
 * don't carry the full message history between tasks in the agent's own
 * context — each task run is independent — but we do collect a short result
 * summary per task into state.taskResults so later steps (verify/finalize)
 * can see what happened.
 */

import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { configureAgentsRuntime } from '../providers/agentsRuntime.js';

const EXECUTOR_INSTRUCTIONS = `You are the executor of a WordPress theme-building agent. You are given ONE task from a larger plan, plus the original conversation for context. Carry out this task, and only this task, against the real workspace.

You have tools to inspect (read_file, search_files, search_content) and change (replace_in_file, edit_file, write_file) real files. Use replace_in_file for targeted edits, write_file only to create a new file or fully overwrite one, edit_file only when there is no stable text to anchor a replace on.

Rules:
- Do exactly what the task describes — do not expand scope beyond it, do not touch files outside "target_files" unless the task genuinely requires it.
- Before editing a file you have not already read in this run, read it first so your edit is grounded in the real current content.
- Make real tool calls to actually apply the change — do not just describe what you would do.
- When the task is complete, reply with a SHORT plain-text summary (1-3 sentences, in the user's language) of what you changed and in which files. No JSON, no markdown fences.`;

/** Wrap the shared toolExecutor's read+write file tools as SDK tools. */
function buildExecutorTools(toolExecutor, signal) {
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
    tool({
      name: 'replace_in_file',
      description: 'PREFERRED way to change an existing workspace file. Replaces an exact snippet (old_string) with new_string. old_string must be copied VERBATIM from the file and unique.',
      parameters: z.object({
        path: z.string().describe('Relative path inside workspace'),
        old_string: z.string().describe('Exact text to find, copied verbatim from the current file'),
        new_string: z.string().describe('Replacement text'),
        replace_all: z.boolean().nullable().describe('Replace every occurrence of old_string. Default false.'),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) =>
        toolExecutor.execute('replace_in_file', { path, old_string, new_string, replace_all: replace_all ?? false }, execOptions),
    }),
    tool({
      name: 'edit_file',
      description: 'FALLBACK editor — prefer replace_in_file. Replaces lines start_line through end_line (1-indexed, inclusive) with new content.',
      parameters: z.object({
        path: z.string().describe('Relative path inside workspace'),
        start_line: z.number().int().describe('First line to replace (1-indexed, inclusive)'),
        end_line: z.number().int().describe('Last line to replace (1-indexed, inclusive)'),
        content: z.string().describe('New text to insert in place of the range. Empty string deletes the range.'),
      }),
      execute: async ({ path, start_line, end_line, content }) =>
        toolExecutor.execute('edit_file', { path, start_line, end_line, content }, execOptions),
    }),
    tool({
      name: 'write_file',
      description: 'Create or overwrite a file inside the workspace (child theme).',
      parameters: z.object({
        path: z.string().describe('Relative path inside workspace'),
        content: z.string(),
        mode: z.enum(['create', 'overwrite']).nullable(),
      }),
      execute: async ({ path, content, mode }) =>
        toolExecutor.execute('write_file', { path, content, mode: mode ?? 'create' }, execOptions),
    }),
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

function formatTaskPrompt(task) {
  const targetFiles = Array.isArray(task?.target_files) && task.target_files.length
    ? task.target_files.join(', ')
    : '(none specified)';

  return `TASK to execute now:\nTitle: ${task?.title ?? ''}\nObjective: ${task?.objective ?? ''}\nDescription: ${task?.description ?? ''}\nTarget files: ${targetFiles}`;
}

export function createExecutorNode({ llmProvider, toolExecutor = null, signal }) {
  const { model, apiKey } = llmProvider?.config ?? {};
  configureAgentsRuntime({ apiKey });

  const agent = new Agent({
    name: 'Executor',
    instructions: EXECUTOR_INSTRUCTIONS,
    model,
    tools: buildExecutorTools(toolExecutor, signal),
  });

  return async function executorNode(state) {
    console.log('[executor] given state:', state);

    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const conversation = state.messages.map(toAgentItem);
    const taskResults = [];

    for (const task of tasks) {
      const input = [
        ...conversation,
        { role: 'system', content: formatTaskPrompt(task) },
      ];

      const result = await run(agent, input, { maxTurns: 100, ...(signal ? { signal } : {}) });
      const summary = extractText(result);

      console.log('[executor] task done:', task?.title, summary);
      taskResults.push({ title: task?.title ?? '', summary });
    }

    return { taskResults };
  };
}
