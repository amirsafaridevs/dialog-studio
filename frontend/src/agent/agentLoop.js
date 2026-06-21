/**
 * Simple ReAct agent loop — no LangGraph.
 * Full conversation history (messages + tool results) is sent on every LLM call.
 */

import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { buildToolDefinitions, TOOL_LABELS } from './tools/definitions.js';
import { browserTools } from './tools/browser.js';
import { getToolTitle, formatToolContext } from '../utils/toolDisplay.js';
import {
  buildThemeContextBlock,
  buildSelectedElementBlock,
  formatToolResultForLLM,
  guardSearchContent,
  trimMessagesForLLM,
} from './contextManager.js';
import { getPreviewController } from '../utils/previewController.js';
import systemPromptMd from './system/system.md?raw';
import { resolveCustomPrompt } from './system/defaultCustomPrompt.js';

/** Max individual tool runs allowed per user message. */
const MAX_TOOL_EXECUTIONS = 200;

/** Legacy/alternate tool names the model may emit despite the registered schema. */
const TOOL_NAME_ALIASES = {
  grep_content: 'search_content',
  grep: 'search_content',
};

function normalizeToolName(toolName) {
  return TOOL_NAME_ALIASES[toolName] || toolName;
}

/** After this many identical calls, warn the model to stop repeating itself. */
const DUPLICATE_CALL_WARN_THRESHOLD = 1;

/** Stable signature for a tool call so identical repeats can be detected. */
function toolCallSignature(toolName, toolArgs) {
  let serializedArgs = '';
  try {
    const sortedKeys = Object.keys(toolArgs || {}).sort();
    const ordered = {};
    for (const key of sortedKeys) {
      ordered[key] = toolArgs[key];
    }
    serializedArgs = JSON.stringify(ordered);
  } catch {
    serializedArgs = String(toolArgs);
  }
  return `${toolName}:${serializedArgs}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Agent stopped by user', 'AbortError');
  }
}

/**
 * Fill missing tool results after an interrupted turn so the loop can resume safely.
 */
export function repairInterruptedToolCalls(messages) {
  let lastAiIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = message?.getType?.() || message?._getType?.();

    if (type === 'ai' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      lastAiIndex = index;
      break;
    }
  }

  if (lastAiIndex < 0) {
    return false;
  }

  const aiMessage = messages[lastAiIndex];
  const toolCalls = aiMessage.tool_calls || [];
  const answeredIds = new Set(
    messages
      .slice(lastAiIndex + 1)
      .filter((message) => (message?.getType?.() || message?._getType?.()) === 'tool')
      .map((message) => message.tool_call_id)
      .filter(Boolean),
  );

  let repaired = false;

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const toolCallId = toolCall.id || `call_repair_${index}`;

    if (answeredIds.has(toolCallId)) {
      continue;
    }

    messages.push(
      new ToolMessage({
        content: JSON.stringify({
          success: false,
          error: 'Operation interrupted before completion.',
        }),
        tool_call_id: toolCallId,
        name: toolCall.name || 'tool',
      }),
    );
    repaired = true;
  }

  return repaired;
}

function loadSystemPromptFromMarkdown(markdown) {
  const fenced = markdown.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return markdown.trim();
}

const AGENT_SYSTEM_PROMPT = loadSystemPromptFromMarkdown(systemPromptMd);

function buildCustomPromptBlock(customPrompt) {
  const text = resolveCustomPrompt(customPrompt);
  return `## User design preferences\n\n${text}`;
}

function buildSystemPrompt(themeContext, customPrompt = '') {
  const parts = [AGENT_SYSTEM_PROMPT];
  const customBlock = buildCustomPromptBlock(customPrompt);
  const themeBlock = buildThemeContextBlock(themeContext);

  if (customBlock) {
    parts.push(customBlock);
  }
  if (themeBlock) {
    parts.push(themeBlock);
  }

  return parts.join('\n\n');
}

/**
 * Live state of the preview browser, re-read every turn.
 * Surfaces the page the user is currently looking at so the agent never has to
 * guess what "this page" / "here" / "the current page" means.
 */
function buildPreviewStateBlock() {
  const controller = getPreviewController();
  if (!controller?.getCurrentUrl) {
    return '';
  }

  let currentUrl = '';
  try {
    currentUrl = controller.getCurrentUrl() || '';
  } catch {
    currentUrl = '';
  }

  if (!currentUrl) {
    return '';
  }

  return [
    'CURRENT BROWSER STATE (live — refreshed every turn):',
    `- The preview the user is looking at right now is on: ${currentUrl}`,
    '- When the user says "this page", "the page we are on", "here", "currently", or refers to the visible state of the site without naming a URL, they mean THIS exact URL. Never guess or substitute a different URL (e.g. /wp-login.php).',
    '- To examine what is rendered, call preview_get_html (optionally with a selector) on this page before changing anything. Only call preview_navigate when you genuinely need a different URL.',
  ].join('\n');
}

/**
 * Live execution plan from update_todos — re-read every turn so the model
 * follows the plan it committed to (shown to the user as "برنامه اجرا").
 */
function buildTodosStateBlock(todos = []) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return [
      'CURRENT PLAN: none.',
      'You have not created a plan yet. Call update_todos as your FIRST tool before read_file, preview_get_html, edit_file, or any other tool.',
    ].join('\n');
  }

  const lines = todos.map((todo) => {
    const status = todo.status || 'pending';
    const label = todo.description || todo.id || 'step';
    return `- [${status}] ${label}`;
  });

  const inProgress = todos.filter((todo) => todo.status === 'in_progress');
  const pending = todos.filter((todo) => todo.status === 'pending');
  const guidance = inProgress.length
    ? `Execute the in_progress step next, then call update_todos to mark it completed and advance.`
    : pending.length
      ? 'No step is in_progress — set the next pending step to in_progress via update_todos, then execute it.'
      : 'All steps appear completed — verify the result, then reply to the user.';

  return ['CURRENT PLAN (برنامه اجرا — update via update_todos as you progress):', ...lines, guidance].join('\n');
}

/**
 * Run the agent until the model stops calling tools or max tool executions is reached.
 *
 * @param {object} options
 * @param {import('@langchain/core/messages').BaseMessage[]} options.messages - Mutable message history
 * @param {import('./providers/llmProvider.js').LLMProvider} options.llmProvider
 * @param {import('./tools/index.js').ToolExecutor} options.toolExecutor
 * @param {object} options.permissions
 * @param {import('vue').Ref|null} options.todosRef - Reactive todo list for UI
 * @param {function} [options.onMessagesChange]
 * @param {function} [options.onStreamToken]
 * @param {function} [options.onToolStream]
 * @param {function} [options.onActivity]
 * @param {object|null} [options.themeContext]
 * @param {string} [options.customPrompt]
 * @param {AbortSignal|null} [options.signal]
 * @returns {Promise<{ messages: import('@langchain/core/messages').BaseMessage[], todos: object[] }>}
 */
export async function runAgentLoop({
  messages,
  llmProvider,
  toolExecutor,
  permissions,
  todosRef,
  onMessagesChange,
  onStreamToken,
  onToolStream,
  onActivity,
  themeContext = null,
  customPrompt = '',
  signal = null,
}) {
  const tools = buildToolDefinitions(permissions);
  const llmWithTools = llmProvider.bindTools(tools);
  const systemPrompt = buildSystemPrompt(themeContext, customPrompt);
  let toolExecutionCount = 0;
  const toolCallCounts = new Map();
  let consecutiveDiscoveryCalls = 0;

  while (true) {
    throwIfAborted(signal);
    onActivity?.('در حال فکر کردن...');

    const previewState = buildPreviewStateBlock();
    const todosState = buildTodosStateBlock(todosRef?.value ?? []);
    const selectedElementState = buildSelectedElementBlock(messages);
    const liveSystemPrompt = [
      systemPrompt,
      selectedElementState,
      todosState,
      previewState,
    ].filter(Boolean).join('\n\n');
    const llmInput = [new SystemMessage(liveSystemPrompt), ...trimMessagesForLLM(messages)];
    const { message: aiMessage, streamedText } = await streamAssistantTurn(
      llmWithTools,
      llmInput,
      onStreamToken,
      onToolStream,
      signal,
    );

    messages.push(aiMessage);
    onMessagesChange?.();

    const toolCalls = aiMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      onToolStream?.({ phase: 'idle' });
      onStreamToken?.('', '');
      return {
        messages,
        todos: todosRef?.value ?? [],
      };
    }

    for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
      throwIfAborted(signal);

      if (toolExecutionCount >= MAX_TOOL_EXECUTIONS) {
        throw new Error(
          `حداکثر تعداد اجرای ابزار (${MAX_TOOL_EXECUTIONS}) رسید. لطفاً دوباره تلاش کنید.`,
        );
      }

      toolExecutionCount += 1;
      const toolCall = toolCalls[toolIndex];
      const toolName = normalizeToolName(toolCall.name);
      const toolArgs = toolCall.args ?? {};
      const label = TOOL_LABELS[toolName] || toolName;
      onActivity?.(getToolTitle(toolName, { streaming: true, args: toolArgs }));
      onStreamToken?.('', '');
      onToolStream?.({
        phase: 'running',
        toolName,
        label,
        args: toolArgs,
        preview: buildToolPreview(toolName, toolArgs),
      });

      const signature = toolCallSignature(toolName, toolArgs);
      const priorIdenticalCalls = toolCallCounts.get(signature) || 0;
      toolCallCounts.set(signature, priorIdenticalCalls + 1);

      const result = await executeToolCall({
        toolName,
        toolArgs,
        toolExecutor,
        permissions,
        todosRef,
        themeContext,
        signal,
      });

      const toolCallId = toolCall.id || `call_${toolExecutionCount}_${toolIndex}`;

      let toolContent = formatToolResultForLLM(toolName, result.payload);
      if (priorIdenticalCalls >= DUPLICATE_CALL_WARN_THRESHOLD) {
        toolContent += `\n\n[LOOP WARNING] You have already called \`${toolName}\` with these exact arguments ${priorIdenticalCalls + 1} times and got the same result. Stop repeating it. Use what you already know to act now — make the change with edit_file/write_file, or give your final answer.`;
      }

      const isDiscoveryTool = ['search_content', 'search_files', 'grep_content', 'grep', 'read_file', 'code_graph', 'validate_code'].includes(toolName);
      const isActionTool = ['edit_file', 'write_file'].includes(toolName);

      if (isDiscoveryTool && result.success) {
        consecutiveDiscoveryCalls += 1;
      } else if (isActionTool && result.success) {
        consecutiveDiscoveryCalls = 0;
      }

      if (consecutiveDiscoveryCalls >= 4) {
        toolContent += '\n\n[LOOP WARNING] You have made several read/search calls without editing anything. You already have file paths and line numbers — call edit_file now or answer the user.';
        consecutiveDiscoveryCalls = 0;
      }

      messages.push(
        new ToolMessage({
          content: toolContent,
          tool_call_id: toolCallId,
          name: toolName,
        }),
      );
      onMessagesChange?.();

      onToolStream?.({
        phase: 'done',
        toolName,
        label,
        args: toolArgs,
        success: result.success,
        error: result.success ? null : (result.payload?.error || 'خطا'),
      });
    }

    onToolStream?.({ phase: 'idle' });
  }
}

async function streamAssistantTurn(llm, messages, onStreamToken, onToolStream, signal = null) {
  let gathered = null;
  let streamedText = '';
  let reasoningText = '';
  const partialToolCalls = [];

  throwIfAborted(signal);
  const stream = await llm.stream(messages, signal ? { signal } : undefined);

  for await (const chunk of stream) {
    throwIfAborted(signal);
    gathered = gathered ? gathered.concat(chunk) : chunk;

    const reasoningDelta = typeof chunk.additional_kwargs?.reasoning_content === 'string'
      ? chunk.additional_kwargs.reasoning_content
      : '';
    if (reasoningDelta) {
      reasoningText += reasoningDelta;
    }

    const token = typeof chunk.content === 'string' ? chunk.content : '';
    if (token) {
      streamedText += token;
      onStreamToken?.(token, streamedText);
    }

    accumulateToolCallChunks(chunk, partialToolCalls);
    const activeTools = summarizePartialToolCalls(partialToolCalls);
    if (activeTools.length > 0) {
      onToolStream?.({
        phase: 'tool-args',
        text: streamedText,
        tools: activeTools,
      });
    } else if (reasoningText && !streamedText) {
      // Surface live chain-of-thought before any real content/tool args arrive.
      onToolStream?.({ phase: 'thinking', text: reasoningText });
    }
  }

  if (!gathered) {
    throwIfAborted(signal);
    const response = await llm.invoke(messages, signal ? { signal } : undefined);
    return {
      message: normalizeAssistantMessage(response, streamedText, reasoningText),
      streamedText: response.content || streamedText || '',
    };
  }

  return {
    message: normalizeAssistantMessage(gathered, streamedText, reasoningText),
    streamedText,
  };
}

function accumulateToolCallChunks(chunk, partialToolCalls) {
  const chunks = chunk?.tool_call_chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return;
  }

  for (const toolChunk of chunks) {
    const index = Number.isInteger(toolChunk.index) ? toolChunk.index : partialToolCalls.length;
    if (!partialToolCalls[index]) {
      partialToolCalls[index] = {
        id: toolChunk.id || '',
        name: toolChunk.name || '',
        argsText: '',
      };
    }

    const entry = partialToolCalls[index];
    if (toolChunk.id) entry.id = toolChunk.id;
    if (toolChunk.name) entry.name = toolChunk.name;
    if (typeof toolChunk.args === 'string') {
      entry.argsText += toolChunk.args;
    }
  }
}

function summarizePartialToolCalls(partialToolCalls) {
  return partialToolCalls
    .filter(Boolean)
    .map((entry) => {
      const toolName = entry.name || 'tool';
      const args = safeJsonParse(entry.argsText || '{}');
      return {
        id: entry.id,
        name: toolName,
        label: TOOL_LABELS[toolName] || toolName,
        args,
        preview: buildToolPreview(toolName, args, entry.argsText),
      };
    });
}

function buildToolPreview(toolName, args = {}, rawArgsText = '') {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const path = args.path ? String(args.path) : '';
    const content = typeof args.content === 'string'
      ? args.content
      : extractStreamingField(rawArgsText, 'content');
    const parts = [];
    if (toolName === 'edit_file' && args.start_line) {
      parts.push(`lines ${args.start_line}-${args.end_line || args.start_line}`);
    }
    if (content) parts.push(content);
    return parts.join('\n\n');
  }

  if (toolName === 'read_file' && args.path) {
    return '';
  }

  if (toolName === 'search_files') {
    const keywords = Array.isArray(args.keywords)
      ? args.keywords.join('، ')
      : extractStreamingField(rawArgsText, 'keywords');
    const directory = args.directory ? String(args.directory) : '';
    if (keywords && directory) {
      return `${keywords}\n${directory}`;
    }
    return keywords || directory || '';
  }

  if (toolName === 'search_content') {
    const keywords = Array.isArray(args.keywords)
      ? args.keywords.join('، ')
      : extractStreamingField(rawArgsText, 'keywords');
    const path = args.path ? String(args.path) : '';
    if (keywords && path) {
      return `${keywords}\n${path}`;
    }
    return keywords || path || '';
  }

  if (toolName === 'code_graph' && args.directory) {
    return String(args.directory);
  }

  if (toolName === 'validate_code' && args.directory) {
    return String(args.directory);
  }

  if (toolName === 'toggle_debug') {
    return formatToolContext(toolName, args);
  }

  if (toolName === 'update_todos' && Array.isArray(args.todos)) {
    return args.todos.map((todo) => `- ${todo.description || todo.id}`).join('\n');
  }

  if (rawArgsText) {
    return rawArgsText;
  }

  const serialized = JSON.stringify(args);
  return serialized === '{}' ? '' : serialized;
}

function extractStreamingField(rawArgsText, fieldName) {
  if (!rawArgsText) {
    return '';
  }

  const marker = `"${fieldName}"`;
  const markerIndex = rawArgsText.indexOf(marker);
  if (markerIndex < 0) {
    return '';
  }

  const colonIndex = rawArgsText.indexOf(':', markerIndex + marker.length);
  if (colonIndex < 0) {
    return '';
  }

  let cursor = colonIndex + 1;
  while (cursor < rawArgsText.length && /\s/.test(rawArgsText[cursor])) {
    cursor += 1;
  }

  if (rawArgsText[cursor] !== '"') {
    return '';
  }

  cursor += 1;
  let value = '';
  let escaped = false;

  for (; cursor < rawArgsText.length; cursor += 1) {
    const char = rawArgsText[cursor];
    if (escaped) {
      if (char === 'n') value += '\n';
      else if (char === 't') value += '\t';
      else if (char === 'r') value += '\r';
      else value += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      break;
    }

    value += char;
  }

  return value;
}

function extractToolCalls(message) {
  if (!message) {
    return [];
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls;
  }

  const fromKwargs = message.additional_kwargs?.tool_calls;
  if (Array.isArray(fromKwargs) && fromKwargs.length > 0) {
    return fromKwargs.map((call, index) => ({
      id: call.id || `call_kw_${index}`,
      name: call.function?.name || call.name,
      args: typeof call.function?.arguments === 'string'
        ? safeJsonParse(call.function.arguments)
        : (call.args || call.function?.arguments || {}),
    }));
  }

  return [];
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeAssistantMessage(message, fallbackContent = '', reasoningFallback = '') {
  const toolCalls = extractToolCalls(message).map((call, index) => {
    let args = call.args;
    if (!args && typeof call.function?.arguments === 'string') {
      args = safeJsonParse(call.function.arguments);
    }

    return {
      ...call,
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.name || call.function?.name,
      args: args ?? {},
    };
  });

  const additional_kwargs = { ...(message?.additional_kwargs || {}) };
  delete additional_kwargs.tool_calls;

  // Reasoning (chain-of-thought) must never become the persisted/replayed content.
  // Only fall back to it for display when this is a final turn with no real content
  // and no tool calls — otherwise the model would have nothing to show the user.
  let content = message?.content || fallbackContent || '';
  if (!content && toolCalls.length === 0 && reasoningFallback) {
    content = reasoningFallback;
  }

  return new AIMessage({
    content,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    additional_kwargs,
    response_metadata: message?.response_metadata,
  });
}

async function executeToolCall({
  toolName,
  toolArgs,
  toolExecutor,
  permissions,
  todosRef,
  themeContext = null,
  signal = null,
}) {
  throwIfAborted(signal);
  toolName = normalizeToolName(toolName);

  if (toolName === 'search_content') {
    const guard = guardSearchContent(themeContext?.code_index, toolArgs);
    if (guard) {
      return {
        success: false,
        payload: guard,
      };
    }
  }

  if (toolName === 'update_todos') {
    const todos = normalizeTodos(toolArgs.todos);
    if (todosRef) {
      todosRef.value = todos;
    }
    return {
      success: true,
      payload: { success: true, todos },
    };
  }

  if (!isToolPermitted(toolName, permissions)) {
    return {
      success: false,
      payload: { success: false, error: `Permission denied for tool: ${toolName}` },
    };
  }

  const apiResult = await toolExecutor.execute(toolName, toolArgs, { signal });
  return {
    success: apiResult.success !== false,
    payload: apiResult,
  };
}

function normalizeTodos(todos) {
  if (!Array.isArray(todos)) {
    return [];
  }

  return todos.map((todo, index) => ({
    id: String(todo.id || `todo_${index + 1}`),
    description: String(todo.description || ''),
    status: todo.status || 'pending',
  }));
}

function isToolPermitted(toolName, permissions = {}) {
  if (toolName === 'update_todos') {
    return true;
  }

  const readFiles = permissions.read_files !== false;
  const writeFiles = permissions.write_files !== false;

  const readTools = ['read_file', 'search_files', 'search_content', 'code_graph', 'validate_code'];
  const writeTools = ['write_file', 'edit_file'];
  const templateReadTools = ['list_templates'];
  const templateWriteTools = ['create_template', 'update_template', 'delete_template'];
  const debugTools = ['toggle_debug', 'read_debug_log', 'clear_debug_log'];
  const themeTools = ['check_theme'];
  const pluginTools = ['list_plugins'];
  const pageTools = ['create_page', 'update_page'];

  if (readTools.includes(toolName)) return readFiles;
  if (writeTools.includes(toolName)) return writeFiles;
  if (templateReadTools.includes(toolName)) return readFiles;
  if (templateWriteTools.includes(toolName)) return writeFiles;
  if (debugTools.includes(toolName)) return Boolean(permissions.debugger);
  if (themeTools.includes(toolName)) return true;
  if (pluginTools.includes(toolName)) return true;
  if (pageTools.includes(toolName)) return Boolean(permissions.manage_pages);
  if (browserTools.includes(toolName)) return true;

  return false;
}

export { AGENT_SYSTEM_PROMPT };
export default runAgentLoop;
