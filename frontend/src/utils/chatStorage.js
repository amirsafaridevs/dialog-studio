/**
 * Persist agent chat sessions to localStorage for history and resume after interruption.
 */

import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

const HISTORY_KEY = 'dtm-chat-history';
const LEGACY_SESSION_KEY = 'dtm-chat-session';
const MAX_SESSIONS = 10;

function safeStorageGet(key) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`[chatStorage] Failed to read ${key}:`, error.message);
    return null;
  }
}

function safeStorageSet(key, value) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[chatStorage] Failed to write ${key}:`, error.message);
    return false;
  }
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function serializeAgentMessages(messages = []) {
  return messages.map((message) => {
    const type = message?.getType?.() || message?._getType?.() || 'unknown';

    const base = {
      type,
      content: message?.content ?? '',
      id: message?.id,
    };

    if (message?.additional_kwargs && Object.keys(message.additional_kwargs).length > 0) {
      base.additional_kwargs = message.additional_kwargs;
    }

    if (message?.response_metadata && Object.keys(message.response_metadata).length > 0) {
      base.response_metadata = message.response_metadata;
    }

    if (type === 'ai' && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
      base.tool_calls = message.tool_calls;
    }

    if (type === 'tool') {
      base.tool_call_id = message?.tool_call_id;
      base.name = message?.name;
    }

    return base;
  });
}

export function deserializeAgentMessages(data = []) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => {
    switch (item.type) {
      case 'human':
      case 'user':
        return new HumanMessage({
          content: item.content || '',
          id: item.id,
        });

      case 'ai':
      case 'assistant':
        return new AIMessage({
          content: item.content ?? '',
          tool_calls: item.tool_calls?.length ? item.tool_calls : undefined,
          additional_kwargs: item.additional_kwargs,
          response_metadata: item.response_metadata,
          id: item.id,
        });

      case 'tool':
        return new ToolMessage({
          content: item.content || '',
          tool_call_id: item.tool_call_id || '',
          name: item.name || 'tool',
          id: item.id,
        });

      default:
        return new HumanMessage({ content: String(item.content || ''), id: item.id });
    }
  });
}

export function deriveSessionTitle(messages = []) {
  for (const message of messages) {
    const type = message?.getType?.() || message?._getType?.() || message?.type;

    if (type !== 'human' && type !== 'user') {
      continue;
    }

    const content = typeof message?.content === 'string'
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((part) => part?.text || part?.content || '').join('')
        : String(message?.content || '');

    const trimmed = content.trim();
    if (trimmed) {
      return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
    }
  }

  return 'گفتگوی جدید';
}

export function formatSessionTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return 'اکنون';
  }

  if (minutes < 60) {
    return `${minutes} دقیقه پیش`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ساعت پیش`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} روز پیش`;
  }

  return new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function normalizeStoredSession(session) {
  if (!session?.id) {
    return null;
  }

  return {
    id: session.id,
    title: session.title || deriveSessionTitle(deserializeAgentMessages(session.messages || [])),
    updatedAt: session.updatedAt || Date.now(),
    messages: Array.isArray(session.messages) ? session.messages : [],
    todos: Array.isArray(session.todos) ? session.todos : [],
    interrupted: Boolean(session.interrupted),
    pendingStream: session.pendingStream || null,
  };
}

function migrateLegacySession() {
  const legacy = safeStorageGet(LEGACY_SESSION_KEY);
  if (!legacy?.messages?.length) {
    return null;
  }

  const session = normalizeStoredSession({
    id: createSessionId(),
    title: deriveSessionTitle(deserializeAgentMessages(legacy.messages)),
    updatedAt: legacy.updatedAt || Date.now(),
    messages: legacy.messages,
    todos: legacy.todos,
    interrupted: legacy.interrupted,
    pendingStream: legacy.pendingStream,
  });

  try {
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }

  return session;
}

export function loadChatHistoryStore() {
  const stored = safeStorageGet(HISTORY_KEY);
  if (stored?.sessions?.length) {
    return {
      activeId: stored.activeId || stored.sessions[0].id,
      sessions: stored.sessions
        .map(normalizeStoredSession)
        .filter(Boolean)
        .slice(0, MAX_SESSIONS),
    };
  }

  const migrated = migrateLegacySession();
  if (migrated) {
    return {
      activeId: migrated.id,
      sessions: [migrated],
    };
  }

  return {
    activeId: null,
    sessions: [],
  };
}

function normalizeStoreSessions(sessions = []) {
  return sessions
    .map(normalizeStoredSession)
    .filter(Boolean)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SESSIONS);
}

export function saveChatHistoryStore(store) {
  let sessions = normalizeStoreSessions(store?.sessions || []);
  let activeId = store?.activeId || sessions[0]?.id || null;

  while (true) {
    const saved = safeStorageSet(HISTORY_KEY, { activeId, sessions });
    if (saved) {
      return true;
    }

    if (sessions.length <= 1) {
      return safeStorageSet(HISTORY_KEY, { activeId: null, sessions: [] });
    }

    sessions = sessions.slice(0, -1);
    if (activeId && !sessions.some((session) => session.id === activeId)) {
      activeId = sessions[0]?.id || null;
    }
  }
}

/** Make room for a new chat when the history is already at capacity. */
export function prepareStoreForNewSession(store = loadChatHistoryStore()) {
  const session = createEmptySession();
  let sessions = normalizeStoreSessions(store?.sessions || []);

  if (sessions.length >= MAX_SESSIONS) {
    sessions = sessions.slice(0, MAX_SESSIONS - 1);
  }

  return {
    session,
    store: {
      activeId: session.id,
      sessions,
    },
  };
}

export function listHistoryItems(store = loadChatHistoryStore()) {
  return store.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updatedAt: formatSessionTime(session.updatedAt),
  }));
}

export function getStoredSession(sessionId, store = loadChatHistoryStore()) {
  return store.sessions.find((session) => session.id === sessionId) || null;
}

export function upsertStoredSession(session, store = loadChatHistoryStore()) {
  const normalized = normalizeStoredSession(session);
  if (!normalized) {
    return store;
  }

  const sessions = store.sessions.filter((item) => item.id !== normalized.id);
  sessions.unshift(normalized);

  return {
    activeId: normalized.id,
    sessions: sessions
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS),
  };
}

export function removeStoredSession(sessionId, store = loadChatHistoryStore()) {
  const sessions = store.sessions.filter((session) => session.id !== sessionId);
  const activeId = store.activeId === sessionId
    ? (sessions[0]?.id || null)
    : store.activeId;

  return { activeId, sessions };
}

export function createEmptySession() {
  return {
    id: createSessionId(),
    title: 'گفتگوی جدید',
    updatedAt: Date.now(),
    messages: [],
    todos: [],
    interrupted: false,
    pendingStream: null,
  };
}

export function buildStoredSession({
  id,
  messages = [],
  todos = [],
  interrupted = false,
  pendingStream = null,
  title,
}) {
  const deserialized = Array.isArray(messages) && messages[0]?.getType
    ? messages
    : deserializeAgentMessages(messages);

  return normalizeStoredSession({
    id: id || createSessionId(),
    title: title || deriveSessionTitle(deserialized),
    updatedAt: Date.now(),
    messages: serializeAgentMessages(deserialized),
    todos,
    interrupted,
    pendingStream,
  });
}

/** @deprecated Use loadChatHistoryStore + getStoredSession */
export function loadChatSession() {
  const store = loadChatHistoryStore();
  if (!store.activeId) {
    return null;
  }

  return getStoredSession(store.activeId, store);
}

/** @deprecated Use upsertStoredSession */
export function saveChatSession(session) {
  if (!session) {
    return;
  }

  const store = loadChatHistoryStore();
  const next = upsertStoredSession(buildStoredSession(session), store);
  saveChatHistoryStore(next);
}

/** @deprecated Use removeStoredSession */
export function clearChatSession() {
  const store = loadChatHistoryStore();
  if (!store.activeId) {
    return;
  }

  const next = removeStoredSession(store.activeId, store);
  saveChatHistoryStore(next);
}

export default {
  serializeAgentMessages,
  deserializeAgentMessages,
  deriveSessionTitle,
  formatSessionTime,
  loadChatHistoryStore,
  saveChatHistoryStore,
  listHistoryItems,
  getStoredSession,
  upsertStoredSession,
  removeStoredSession,
  createEmptySession,
  prepareStoreForNewSession,
  buildStoredSession,
  loadChatSession,
  saveChatSession,
  clearChatSession,
};
