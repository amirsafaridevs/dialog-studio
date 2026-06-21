/**
 * Build and download a full JSON export of the current chat session.
 */

import { deriveSessionTitle, serializeAgentMessages } from './chatStorage.js';

const EXPORT_VERSION = 1;

function extractThinkingContent(message) {
  const content = message?.content;

  if (Array.isArray(content)) {
    const blocks = content
      .filter((item) => item?.type === 'thinking' || item?.type === 'reasoning')
      .map((item) => item?.text || item?.content || '')
      .filter(Boolean);

    if (blocks.length) {
      return blocks.join('\n\n');
    }
  }

  const raw = message?.additional_kwargs?.__raw_response;
  const reasoning = raw?.choices?.[0]?.message?.reasoning_content
    || raw?.choices?.[0]?.delta?.reasoning_content;

  return typeof reasoning === 'string' ? reasoning : '';
}

function tryParseToolResult(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function enrichSerializedMessages(rawMessages = [], serialized = []) {
  return serialized.map((message, index) => {
    const source = rawMessages[index];
    const enriched = { ...message };

    if (message.type === 'ai') {
      const thinking = extractThinkingContent(source);
      if (thinking) {
        enriched.thinking = thinking;
      }
    }

    if (message.type === 'tool') {
      const parsed = tryParseToolResult(message.content);
      if (parsed) {
        enriched.parsed_result = parsed;
      }
    }

    return enriched;
  });
}

export function buildChatExportPayload({
  sessionId = null,
  title = null,
  updatedAt = Date.now(),
  interrupted = false,
  messages = [],
  todos = [],
  streamingContent = '',
  toolStreamState = null,
  displayMessages = [],
  stats = null,
  isRunning = false,
} = {}) {
  const serialized = serializeAgentMessages(messages);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      id: sessionId,
      title: title || deriveSessionTitle(messages),
      updatedAt,
      interrupted,
      isRunning,
    },
    stats,
    todos: Array.isArray(todos) ? todos : [],
    messages: enrichSerializedMessages(messages, serialized),
    pendingStream: streamingContent || toolStreamState
      ? {
          content: streamingContent || '',
          toolStreamState: toolStreamState || null,
        }
      : null,
    displayMessages: Array.isArray(displayMessages) ? displayMessages : [],
  };
}

export function downloadChatExport(payload, filename = 'dtm-chat-export.json') {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportChatSession(options = {}) {
  const payload = buildChatExportPayload(options);
  const date = new Date().toISOString().slice(0, 10);
  const id = options.sessionId?.slice(0, 8) || 'chat';
  downloadChatExport(payload, `dtm-chat-${id}-${date}.json`);
  return payload;
}

export default {
  buildChatExportPayload,
  downloadChatExport,
  exportChatSession,
};
