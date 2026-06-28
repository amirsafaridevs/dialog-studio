/**
 * Agent loop — powered by LangGraph StateGraph.
 *
 * Graph topology:
 *   START → classify_node → [route]
 *             ├─ answer  → finalize_node → END
 *             ├─ clarify → finalize_node → END
 *             └─ code    → llm_node ⇄ tool_node (ReAct loop)
 *                              ↘ finalize_node → END
 *
 * classify_node is the front door (the user's diagram): one cheap call decides
 * whether the request is a direct answer, needs a clarifying question, or is a
 * real code change. finalize_node is the single terminal node every branch funnels
 * into — it decides what the user is told and closes the turn.
 *
 * State carries `messages`, `route`, and `decisionReply`. Everything else
 * (callbacks, LLM, permissions, counters, scratchpad) is closed over inside
 * `runAgentLoop` so nodes stay pure-ish while the graph handles routing.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
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
import { buildCorePrompt, buildClassifierPrompt } from './system/core.js';
import { selectSkills } from './skills/registry.js';
import { createScratchpad, recordToolFacts } from './scratchpad.js';
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
    for (const key of sortedKeys) ordered[key] = toolArgs[key];
    serializedArgs = JSON.stringify(ordered);
  } catch {
    serializedArgs = String(toolArgs);
  }
  return `${toolName}:${serializedArgs}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Agent stopped by user', 'AbortError');
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

  if (lastAiIndex < 0) return false;

  const aiMessage = messages[lastAiIndex];
  const toolCalls = aiMessage.tool_calls || [];
  const answeredIds = new Set(
    messages
      .slice(lastAiIndex + 1)
      .filter((m) => (m?.getType?.() || m?._getType?.()) === 'tool')
      .map((m) => m.tool_call_id)
      .filter(Boolean),
  );

  let repaired = false;

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const toolCallId = toolCall.id || `call_repair_${index}`;
    if (answeredIds.has(toolCallId)) continue;

    messages.push(
      new ToolMessage({
        content: JSON.stringify({ success: false, error: 'Operation interrupted before completion.' }),
        tool_call_id: toolCallId,
        name: toolCall.name || 'tool',
      }),
    );
    repaired = true;
  }

  return repaired;
}

/** Thin, always-on core. Domain depth comes from skills injected per turn. */
const AGENT_SYSTEM_PROMPT = buildCorePrompt();

/** Only inject design preferences the user explicitly set — defaults live in the css-design skill. */
function buildCustomPromptBlock(customPrompt) {
  const text = (customPrompt || '').trim();
  if (!text) return '';
  return `## User design preferences\n\n${resolveCustomPrompt(text)}`;
}

/** Latest human-message text — drives skill selection and classification. */
function getLatestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = message?.getType?.() || message?._getType?.() || message?.role;
    if (type !== 'human' && type !== 'user') continue;

    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => part?.text || part?.content || '').join('');
    }
    return content == null ? '' : String(content);
  }
  return '';
}

/** Parse the classifier's single-line JSON ({type, reply}). Falls back to 'code'. */
function parseClassifierOutput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { route: 'code', reply: '' };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] || text).trim();
  const braceMatch = candidate.match(/\{[\s\S]*\}/);

  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      const type = String(parsed.type || '').toLowerCase();
      if (type === 'answer' || type === 'clarify') {
        const reply = String(parsed.reply || '').trim();
        // An answer/clarify with no text is useless — let the main loop respond instead.
        return reply ? { route: type, reply } : { route: 'code', reply: '' };
      }
      if (type === 'code') return { route: 'code', reply: '' };
    } catch {
      // fall through to heuristic below
    }
  }

  const typeMatch = candidate.match(/"type"\s*:\s*"(answer|clarify|code)"/i);
  if (typeMatch) {
    const type = typeMatch[1].toLowerCase();
    if (type === 'code') return { route: 'code', reply: '' };
    const replyMatch = candidate.match(/"reply"\s*:\s*"([\s\S]*?)"\s*}/);
    return { route: type, reply: replyMatch ? replyMatch[1] : '' };
  }

  // Unparseable — safest to act rather than strand an actionable request.
  return { route: 'code', reply: '' };
}

function buildPreviewStateBlock() {
  const controller = getPreviewController();
  if (!controller?.getCurrentUrl) return '';

  let currentUrl = '';
  try { currentUrl = controller.getCurrentUrl() || ''; } catch { currentUrl = ''; }
  if (!currentUrl) return '';

  return [
    'CURRENT BROWSER STATE (live — refreshed every turn):',
    `- The preview the user is looking at right now is on: ${currentUrl}`,
    '- When the user says "this page", "the page we are on", "here", "currently", or refers to the visible state of the site without naming a URL, they mean THIS exact URL. Never guess or substitute a different URL (e.g. /wp-login.php).',
    '- To examine what is rendered, call preview_get_html (optionally with a selector) on this page before changing anything. Only call preview_navigate when you genuinely need a different URL.',
  ].join('\n');
}

function buildTodosStateBlock(todos = []) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return [
      'PLAN: none yet.',
      'Plan in proportion to the work — this is your judgement, not a ritual:',
      '- A single, obvious change (one file, one clear edit) → skip the plan and just do it.',
      '- Multi-step, multi-file, ambiguous-but-actionable, or any visual change that needs verifying → call update_todos first.',
      'A good plan names the user-visible OUTCOME of each step and how you will verify it (e.g. "sticky header with right-aligned logo — confirm in preview"), never mechanical steps like "read the file".',
    ].join('\n');
  }

  const lines = todos.map((todo) => {
    const status = todo.status || 'pending';
    const label = todo.description || todo.id || 'step';
    return `- [${status}] ${label}`;
  });

  const inProgress = todos.filter((t) => t.status === 'in_progress');
  const pending = todos.filter((t) => t.status === 'pending');
  const guidance = inProgress.length
    ? 'Execute the in_progress step next, then call update_todos to mark it completed and advance.'
    : pending.length
      ? 'No step is in_progress — set the next pending step to in_progress via update_todos, then execute it.'
      : 'All steps appear completed — verify the result, then reply to the user.';

  return ['CURRENT PLAN (برنامه اجرا — update via update_todos as you progress):', ...lines, guidance].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────

/**
 * Run the agent until the model stops calling tools or max tool executions is reached.
 * Internally uses a LangGraph StateGraph: llm_node ↔ tool_node loop.
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

  // Stable, cacheable prefix: thin core + session theme/index + explicit user prefs.
  const corePrompt = buildCorePrompt();
  const customBlock = buildCustomPromptBlock(customPrompt);
  const themeBlock = buildThemeContextBlock(themeContext);

  // ── Session working memory + skill-selection signals (closed over by nodes) ──
  const scratchpad = createScratchpad();
  let toolExecutionCount = 0;
  const toolCallCounts = new Map();
  let consecutiveDiscoveryCalls = 0;
  let lastEditTarget = '';
  let lastToolName = '';
  let hadError = false;

  /**
   * Compose the live system prompt for a turn: stable core first (cacheable),
   * then only the skills relevant right now, then live session state.
   */
  function buildLiveSystemPrompt(stateMessages) {
    const userText = getLatestUserText(stateMessages);
    const skills = selectSkills({ userText, editTarget: lastEditTarget, lastTool: lastToolName, hadError });

    return [
      corePrompt,
      themeBlock,
      customBlock,
      ...skills.map((skill) => skill.body),
      scratchpad.render(),
      buildSelectedElementBlock(stateMessages),
      buildTodosStateBlock(todosRef?.value ?? []),
      buildPreviewStateBlock(),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // ─────────────────────────────────────────────────────────
  // Node: classify_node (the front door)
  // One cheap, tool-free call routes the request: answer | clarify | code.
  // ─────────────────────────────────────────────────────────
  async function classifyNode(state) {
    throwIfAborted(signal);
    onActivity?.('در حال تحلیل درخواست...');
    onToolStream?.({ phase: 'thinking', text: '' });

    const input = [new SystemMessage(buildClassifierPrompt()), ...trimMessagesForLLM(state.messages)];

    try {
      const response = await llmProvider.invoke(input, signal ? { signal } : undefined);
      const raw = (typeof response?.content === 'string' && response.content)
        || response?.additional_kwargs?.reasoning_content
        || '';
      const { route, reply } = parseClassifierOutput(raw);
      return { messages: state.messages, route, decisionReply: reply };
    } catch (error) {
      throwIfAborted(signal);
      // Classifier failed (not an abort) — fail open into the code path.
      return { messages: state.messages, route: 'code', decisionReply: '' };
    }
  }

  // ─────────────────────────────────────────────────────────
  // Node: llm_node
  // Rebuilds live context each iteration, calls LLM, streams tokens.
  // ─────────────────────────────────────────────────────────
  async function llmNode(state) {
    throwIfAborted(signal);
    onActivity?.('در حال فکر کردن...');

    const liveSystemPrompt = buildLiveSystemPrompt(state.messages);
    const llmInput = [new SystemMessage(liveSystemPrompt), ...trimMessagesForLLM(state.messages)];

    const { message: aiMessage } = await streamAssistantTurn(
      llmWithTools, llmInput, onStreamToken, onToolStream, signal,
    );

    const updatedMessages = [...state.messages, aiMessage];
    onMessagesChange?.();

    return { messages: updatedMessages };
  }

  // ─────────────────────────────────────────────────────────
  // Node: tool_node
  // Executes every tool call from the last AIMessage, fires UI callbacks.
  // ─────────────────────────────────────────────────────────
  async function toolNode(state) {
    const currentMessages = state.messages;
    const lastAi = currentMessages[currentMessages.length - 1];
    const toolCalls = lastAi?.tool_calls || [];
    const updatedMessages = [...currentMessages];

    for (let i = 0; i < toolCalls.length; i += 1) {
      throwIfAborted(signal);

      if (toolExecutionCount >= MAX_TOOL_EXECUTIONS) {
        throw new Error(`حداکثر تعداد اجرای ابزار (${MAX_TOOL_EXECUTIONS}) رسید. لطفاً دوباره تلاش کنید.`);
      }

      toolExecutionCount += 1;
      const toolCall = toolCalls[i];
      const toolName = normalizeToolName(toolCall.name);
      const toolArgs = toolCall.args ?? {};
      const label = TOOL_LABELS[toolName] || toolName;

      // ── Notify UI: tool starting ──────────────────────────
      onActivity?.(getToolTitle(toolName, { streaming: true, args: toolArgs }));
      onStreamToken?.('', '');
      onToolStream?.({
        phase: 'running',
        toolName,
        label,
        args: toolArgs,
        preview: buildToolPreview(toolName, toolArgs),
      });

      // ── Duplicate-call detection ──────────────────────────
      const signature = toolCallSignature(toolName, toolArgs);
      const priorIdenticalCalls = toolCallCounts.get(signature) || 0;
      toolCallCounts.set(signature, priorIdenticalCalls + 1);

      // ── Execute ───────────────────────────────────────────
      const result = await executeToolCall({
        toolName, toolArgs, toolExecutor, permissions, todosRef, themeContext, signal,
      });

      // ── Update skill-selection signals + working memory ───
      lastToolName = toolName;
      if ((toolName === 'edit_file' || toolName === 'write_file') && toolArgs.path) {
        lastEditTarget = String(toolArgs.path);
      }
      if (!result.success) hadError = true;
      recordToolFacts(scratchpad, toolName, toolArgs, result.payload);

      const toolCallId = toolCall.id || `call_${toolExecutionCount}_${i}`;

      // ── Format result + loop warnings ─────────────────────
      let toolContent = formatToolResultForLLM(toolName, result.payload);

      if (priorIdenticalCalls >= DUPLICATE_CALL_WARN_THRESHOLD) {
        toolContent += `\n\n[LOOP WARNING] You have already called \`${toolName}\` with these exact arguments ${priorIdenticalCalls + 1} times and got the same result. Stop repeating it. Use what you already know to act now — make the change with edit_file/write_file, or give your final answer.`;
      }

      const isDiscoveryTool = ['search_content', 'search_files', 'grep_content', 'grep', 'read_file', 'code_graph', 'graph_query', 'validate_code'].includes(toolName);
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

      // ── Add ToolMessage to history ────────────────────────
      updatedMessages.push(
        new ToolMessage({ content: toolContent, tool_call_id: toolCallId, name: toolName }),
      );
      onMessagesChange?.();

      // ── Notify UI: tool done ──────────────────────────────
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
    return { messages: updatedMessages };
  }

  // ─────────────────────────────────────────────────────────
  // Node: finalize_node (the single terminal node)
  // Every branch funnels here: it decides what the user is told and
  // closes the turn. For answer/clarify it emits the classifier's reply;
  // for the code path the final assistant message is already in history.
  // ─────────────────────────────────────────────────────────
  async function finalizeNode(state) {
    throwIfAborted(signal);

    const updatedMessages = [...state.messages];

    if (state.route !== 'code' && state.decisionReply) {
      onActivity?.('در حال آماده‌سازی پاسخ...');
      updatedMessages.push(new AIMessage({ content: state.decisionReply }));
      onMessagesChange?.();
    }

    onToolStream?.({ phase: 'idle' });
    onStreamToken?.('', '');
    onActivity?.('');

    return { messages: updatedMessages };
  }

  // ─────────────────────────────────────────────────────────
  // Router after classify: answer | clarify → finalize, code → llm loop.
  // ─────────────────────────────────────────────────────────
  function routeAfterClassify(state) {
    return state.route === 'answer' || state.route === 'clarify' ? state.route : 'code';
  }

  // ─────────────────────────────────────────────────────────
  // Router: should_continue
  // Runs after llm_node. Returns 'tools' or 'end' (→ finalize).
  // ─────────────────────────────────────────────────────────
  function shouldContinue(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls = lastMessage?.tool_calls || [];

    if (toolCalls.length === 0) {
      onToolStream?.({ phase: 'idle' });
      onStreamToken?.('', '');
      return 'end';
    }

    return 'tools';
  }

  // ─────────────────────────────────────────────────────────
  // Build & compile the LangGraph StateGraph
  // ─────────────────────────────────────────────────────────
  const graph = new StateGraph({
    channels: {
      messages: {
        // Reducer: incoming update replaces current value outright.
        value: (current, update) => update ?? current ?? [],
        default: () => [],
      },
      route: {
        value: (current, update) => update ?? current ?? null,
        default: () => null,
      },
      decisionReply: {
        value: (current, update) => update ?? current ?? '',
        default: () => '',
      },
    },
  })
    .addNode('classify_node', classifyNode)
    .addNode('llm_node', llmNode)
    .addNode('tool_node', toolNode)
    .addNode('finalize_node', finalizeNode)
    .addEdge(START, 'classify_node')
    .addConditionalEdges('classify_node', routeAfterClassify, {
      answer: 'finalize_node',
      clarify: 'finalize_node',
      code: 'llm_node',
    })
    .addConditionalEdges('llm_node', shouldContinue, { tools: 'tool_node', end: 'finalize_node' })
    .addEdge('tool_node', 'llm_node')
    .addEdge('finalize_node', END)
    .compile();

  // ─────────────────────────────────────────────────────────
  // Stream graph updates — each node completion fires one update.
  // The UI already gets live feedback through the callbacks above;
  // here we just drive the graph forward and collect final state.
  // ─────────────────────────────────────────────────────────
  let finalMessages = messages;

  const stream = await graph.stream(
    { messages },
    { streamMode: 'updates', recursionLimit: 200 },
  );

  for await (const update of stream) {
    const nodeName = Object.keys(update)[0];
    const nodeState = update[nodeName];

    if (nodeState?.messages) {
      finalMessages = nodeState.messages;
      // splice evaluates ...finalMessages before mutating the array, so it is
      // safe even when finalMessages and messages are the same reference
      // (e.g. classify_node returns state.messages unchanged).
      messages.splice(0, messages.length, ...finalMessages);
    }
  }

  return {
    messages: finalMessages,
    todos: todosRef?.value ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
// LLM streaming helpers (unchanged from original)
// ─────────────────────────────────────────────────────────────

function isWpagentifyApiError(error) {
  return error?.name === 'WpagentifyApiError';
}

async function streamAssistantTurn(llm, messages, onStreamToken, onToolStream, signal = null) {
  let gathered = null;
  let streamedText = '';
  let reasoningText = '';
  const partialToolCalls = [];

  throwIfAborted(signal);

  let stream;
  try {
    stream = await llm.stream(messages, signal ? { signal } : undefined);
  } catch (error) {
    if (isWpagentifyApiError(error)) throw error;
    throw error;
  }

  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      gathered = gathered ? gathered.concat(chunk) : chunk;

      const reasoningDelta = typeof chunk.additional_kwargs?.reasoning_content === 'string'
        ? chunk.additional_kwargs.reasoning_content
        : '';
      if (reasoningDelta) reasoningText += reasoningDelta;

      const token = typeof chunk.content === 'string' ? chunk.content : '';
      if (token) {
        streamedText += token;
        onStreamToken?.(token, streamedText);
      }

      accumulateToolCallChunks(chunk, partialToolCalls);
      const activeTools = summarizePartialToolCalls(partialToolCalls);
      if (activeTools.length > 0) {
        onToolStream?.({ phase: 'tool-args', text: streamedText, tools: activeTools });
      } else if (reasoningText && !streamedText) {
        onToolStream?.({ phase: 'thinking', text: reasoningText });
      }
    }
  } catch (error) {
    throw error;
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
  if (!Array.isArray(chunks) || chunks.length === 0) return;

  for (const toolChunk of chunks) {
    const index = Number.isInteger(toolChunk.index) ? toolChunk.index : partialToolCalls.length;
    if (!partialToolCalls[index]) {
      partialToolCalls[index] = { id: toolChunk.id || '', name: toolChunk.name || '', argsText: '' };
    }
    const entry = partialToolCalls[index];
    if (toolChunk.id) entry.id = toolChunk.id;
    if (toolChunk.name) entry.name = toolChunk.name;
    if (typeof toolChunk.args === 'string') entry.argsText += toolChunk.args;
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
    const content = typeof args.content === 'string'
      ? args.content
      : extractStreamingField(rawArgsText, 'content');
    const parts = [];
    if (toolName === 'edit_file' && args.start_line) parts.push(`lines ${args.start_line}-${args.end_line || args.start_line}`);
    if (content) parts.push(content);
    return parts.join('\n\n');
  }
  if (toolName === 'read_file' && args.path) return '';
  if (toolName === 'search_files') {
    const keywords = Array.isArray(args.keywords) ? args.keywords.join('، ') : extractStreamingField(rawArgsText, 'keywords');
    const directory = args.directory ? String(args.directory) : '';
    return keywords && directory ? `${keywords}\n${directory}` : keywords || directory || '';
  }
  if (toolName === 'search_content') {
    const keywords = Array.isArray(args.keywords) ? args.keywords.join('، ') : extractStreamingField(rawArgsText, 'keywords');
    const path = args.path ? String(args.path) : '';
    return keywords && path ? `${keywords}\n${path}` : keywords || path || '';
  }
  if (toolName === 'code_graph' && args.directory) return String(args.directory);
  if (toolName === 'validate_code' && args.directory) return String(args.directory);
  if (toolName === 'toggle_debug') return formatToolContext(toolName, args);
  if (toolName === 'update_todos' && Array.isArray(args.todos)) {
    return args.todos.map((t) => `- ${t.description || t.id}`).join('\n');
  }
  if (rawArgsText) return rawArgsText;
  const serialized = JSON.stringify(args);
  return serialized === '{}' ? '' : serialized;
}

function extractStreamingField(rawArgsText, fieldName) {
  if (!rawArgsText) return '';
  const marker = `"${fieldName}"`;
  const markerIndex = rawArgsText.indexOf(marker);
  if (markerIndex < 0) return '';
  const colonIndex = rawArgsText.indexOf(':', markerIndex + marker.length);
  if (colonIndex < 0) return '';

  let cursor = colonIndex + 1;
  while (cursor < rawArgsText.length && /\s/.test(rawArgsText[cursor])) cursor += 1;
  if (rawArgsText[cursor] !== '"') return '';

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
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') break;
    value += char;
  }

  return value;
}

function extractToolCalls(message) {
  if (!message) return [];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return message.tool_calls;

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
  try { return JSON.parse(value); } catch { return {}; }
}

function normalizeAssistantMessage(message, fallbackContent = '', reasoningFallback = '') {
  const toolCalls = extractToolCalls(message).map((call, index) => {
    let args = call.args;
    if (!args && typeof call.function?.arguments === 'string') args = safeJsonParse(call.function.arguments);
    return {
      ...call,
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.name || call.function?.name,
      args: args ?? {},
    };
  });

  const additional_kwargs = { ...(message?.additional_kwargs || {}) };
  delete additional_kwargs.tool_calls;

  let content = message?.content || fallbackContent || '';
  if (!content && toolCalls.length === 0 && reasoningFallback) content = reasoningFallback;

  return new AIMessage({
    content,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    additional_kwargs,
    response_metadata: message?.response_metadata,
  });
}

// ─────────────────────────────────────────────────────────────
// Tool execution helpers (unchanged from original)
// ─────────────────────────────────────────────────────────────

async function executeToolCall({ toolName, toolArgs, toolExecutor, permissions, todosRef, themeContext = null, signal = null }) {
  throwIfAborted(signal);
  toolName = normalizeToolName(toolName);

  if (toolName === 'search_content') {
    const guard = guardSearchContent(themeContext?.code_index, toolArgs);
    if (guard) return { success: false, payload: guard };
  }

  if (toolName === 'update_todos') {
    const todos = normalizeTodos(toolArgs.todos);
    if (todosRef) todosRef.value = todos;
    return { success: true, payload: { success: true, todos } };
  }

  if (!isToolPermitted(toolName, permissions)) {
    return { success: false, payload: { success: false, error: `Permission denied for tool: ${toolName}` } };
  }

  const apiResult = await toolExecutor.execute(toolName, toolArgs, { signal });
  return { success: apiResult.success !== false, payload: apiResult };
}

function normalizeTodos(todos) {
  if (!Array.isArray(todos)) return [];
  return todos.map((todo, index) => ({
    id: String(todo.id || `todo_${index + 1}`),
    description: String(todo.description || ''),
    status: todo.status || 'pending',
  }));
}

function isToolPermitted(toolName, permissions = {}) {
  if (toolName === 'update_todos') return true;

  const readFiles = permissions.read_files !== false;
  const writeFiles = permissions.write_files !== false;

  const readTools = ['read_file', 'search_files', 'search_content', 'code_graph', 'graph_query', 'validate_code'];
  const writeTools = ['write_file', 'edit_file'];
  const templateReadTools = [];
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
