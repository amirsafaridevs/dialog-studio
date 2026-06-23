/**
 * Vue composable — simple streaming ReAct agent with full message history.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import runAgentLoop, { repairInterruptedToolCalls } from '../agent/agentLoop.js';
import {
  repairMessageSequence,
  sanitizeIncompleteToolChains,
} from '../agent/contextManager.js';
import { createLLMProvider } from '../agent/providers/llmProvider.js';
import { ToolExecutor } from '../agent/tools/index.js';
import ApiClient from '../utils/apiClient.js';
import {
  buildStoredSession,
  createEmptySession,
  deserializeAgentMessages,
  getStoredSession,
  loadChatHistoryStore,
  prepareStoreForNewSession,
  saveChatHistoryStore,
  upsertStoredSession,
} from '../utils/chatStorage.js';
import { getDtmConfig } from '../utils/dtmConfig.js';
import { isAbortError as isAgentAbortError } from '../utils/abortSignal.js';

const MAX_AUTO_RESUME_ATTEMPTS = 3;
const STREAM_PERSIST_MS = 100;

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Agent stopped by user', 'AbortError'));
      return;
    }

    const timeoutId = window.setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException('Agent stopped by user', 'AbortError'));
      }, { once: true });
    }
  });
}

function isRetryableAgentError(err) {
  if (!err) {
    return false;
  }

  const message = (err.message || '').toLowerCase();
  return (
    message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('connection')
    || message.includes('econnreset')
    || message.includes('timeout')
    || message.includes('socket')
    || message.includes('stream failed')
    || message.includes('api connection')
    || message.includes('rate limit')
    || err.name === 'TypeError'
  );
}

export function useAgent() {
  const isInitialized = ref(false);
  const isRunning = ref(false);
  const isInterrupted = ref(false);
  const streamingContent = ref('');
  const toolStreamState = ref(null);
  const activityStatus = ref('');
  const messages = ref([]);
  const todos = ref([]);
  const error = ref(null);
  const settings = ref(null);
  const currentSessionId = ref(null);
  const themeReady = ref(getDtmConfig().theme?.ready !== false);
  const themeError = ref(getDtmConfig().theme?.message || '');

  let llmProvider = null;
  let apiClient = null;
  let toolExecutor = null;
  let themeContext = null;
  let themeCodeIndex = null;
  let abortController = null;
  let streamPersistTimer = null;

  function hasUncommittedStream() {
    return Boolean(
      streamingContent.value
      || (toolStreamState.value && toolStreamState.value.phase !== 'idle'),
    );
  }

  function writeSessionToStorage() {
    if (!messages.value.length && !isInterrupted.value && !isRunning.value && !hasUncommittedStream()) {
      if (!currentSessionId.value) {
        return loadChatHistoryStore();
      }

      const store = loadChatHistoryStore();
      const existsInStore = store.sessions.some(
        (session) => session.id === currentSessionId.value,
      );

      if (!existsInStore) {
        return store;
      }

      const next = {
        activeId: store.activeId === currentSessionId.value ? null : store.activeId,
        sessions: store.sessions.filter((session) => session.id !== currentSessionId.value),
      };
      saveChatHistoryStore(next);
      currentSessionId.value = null;
      return next;
    }

    const shouldPersistPendingStream = isRunning.value || hasUncommittedStream();

    const session = buildStoredSession({
      id: ensureSessionId(),
      messages: messages.value,
      todos: todos.value,
      interrupted: isInterrupted.value,
      pendingStream: shouldPersistPendingStream
        ? {
            content: streamingContent.value,
            toolStreamState: toolStreamState.value,
          }
        : null,
    });

    const store = loadChatHistoryStore();
    const next = upsertStoredSession(session, {
      ...store,
      activeId: session.id,
    });
    saveChatHistoryStore(next);
    return next;
  }

  function flushPersistSession() {
    if (streamPersistTimer) {
      window.clearTimeout(streamPersistTimer);
      streamPersistTimer = null;
    }

    return writeSessionToStorage();
  }

  function persistImmediately() {
    flushPersistSession();
  }

  function scheduleStreamPersist() {
    if (streamPersistTimer) {
      return;
    }

    streamPersistTimer = window.setTimeout(() => {
      streamPersistTimer = null;
      writeSessionToStorage();
    }, STREAM_PERSIST_MS);
  }

  const canSendMessage = computed(
    () => isInitialized.value && !isRunning.value && settings.value && themeReady.value,
  );

  function clearStreamingBuffers() {
    streamingContent.value = '';
    toolStreamState.value = null;
  }

  function capturePartialTurnWithoutInterrupt() {
    if (!hasUncommittedStream()) {
      return false;
    }

    const captured = capturePartialTurn();
    clearStreamingBuffers();
    return captured;
  }

  function finalizePendingStream() {
    const captured = capturePartialTurnWithoutInterrupt();
    if (captured) {
      isInterrupted.value = true;
    }

    return captured;
  }

  function prepareMessagesForResume() {
    repairInterruptedToolCalls(messages.value);
    const cleaned = repairMessageSequence(
      sanitizeIncompleteToolChains(messages.value),
    );
    messages.value.splice(0, messages.value.length, ...cleaned);
  }

  function applyStoredSession(session) {
    if (!session) {
      messages.value = [];
      todos.value = [];
      isInterrupted.value = false;
      streamingContent.value = '';
      toolStreamState.value = null;
      currentSessionId.value = null;
      return;
    }

    currentSessionId.value = session.id;
    messages.value = deserializeAgentMessages(session.messages || []);
    todos.value = Array.isArray(session.todos) ? session.todos : [];
    isInterrupted.value = Boolean(session.interrupted);
    streamingContent.value = '';
    toolStreamState.value = null;

    if (session.pendingStream) {
      streamingContent.value = session.pendingStream.content || '';
      toolStreamState.value = session.pendingStream.toolStreamState || null;
      finalizePendingStream();
      flushPersistSession();
    }
  }

  function ensureSessionId() {
    if (!currentSessionId.value) {
      currentSessionId.value = createEmptySession().id;
    }

    return currentSessionId.value;
  }

  function persistSession() {
    return flushPersistSession();
  }

  function restoreSession() {
    const store = loadChatHistoryStore();
    if (!store.activeId) {
      return false;
    }

    const session = getStoredSession(store.activeId, store);
    if (!session) {
      return false;
    }

    const hasContent = session.messages?.length || session.interrupted || session.pendingStream;
    if (!hasContent) {
      return false;
    }

    applyStoredSession(session);
    return true;
  }

  function loadSession(sessionId) {
    const store = loadChatHistoryStore();
    const session = getStoredSession(sessionId, store);
    if (!session) {
      return false;
    }

    applyStoredSession(session);
    saveChatHistoryStore({
      ...store,
      activeId: sessionId,
    });
    return true;
  }

  function startNewSession() {
    persistSession();

    const { session, store: nextStore } = prepareStoreForNewSession(loadChatHistoryStore());
    currentSessionId.value = session.id;
    messages.value = [];
    todos.value = [];
    error.value = null;
    isInterrupted.value = false;
    streamingContent.value = '';
    toolStreamState.value = null;

    saveChatHistoryStore(nextStore);

    return session.id;
  }

  function capturePartialTurn() {
    const content = streamingContent.value || '';
    const state = toolStreamState.value;
    let toolCalls;

    if (state?.phase === 'tool-args' && Array.isArray(state.tools) && state.tools.length > 0) {
      toolCalls = state.tools.map((tool, index) => ({
        id: tool.id || `call_partial_${Date.now()}_${index}`,
        name: tool.name || 'tool',
        args: tool.args || {},
      }));
    }

    if (!content.trim() && !toolCalls?.length) {
      return false;
    }

    messages.value.push(
      new AIMessage({
        content,
        tool_calls: toolCalls?.length ? toolCalls : undefined,
      }),
    );

    return true;
  }

  function handlePageHide() {
    if (isRunning.value || hasUncommittedStream()) {
      finalizePendingStream();
    }

    flushPersistSession();
  }

  onMounted(() => {
    window.addEventListener('pagehide', handlePageHide);
  });

  onUnmounted(() => {
    window.removeEventListener('pagehide', handlePageHide);
    handlePageHide();
  });

  function normalizeSettingsForAgent(nextSettings, previousSettings = null) {
    if (!nextSettings?.llm) {
      throw new Error('LLM settings not provided');
    }

    const currentApiKey =
      nextSettings.llm.api_key ||
      previousSettings?.llm?.api_key ||
      llmProvider?.config?.apiKey ||
      '';

    return {
      ...nextSettings,
      llm: {
        ...previousSettings?.llm,
        ...nextSettings.llm,
        api_key: currentApiKey,
      },
      permissions: {
        ...previousSettings?.permissions,
        ...nextSettings.permissions,
      },
      custom_prompt:
        nextSettings.custom_prompt ??
        previousSettings?.custom_prompt ??
        '',
    };
  }

  async function initialize(userSettings) {
    try {
      applyThemeGate(getDtmConfig().theme);

      const resolvedSettings = normalizeSettingsForAgent(userSettings);
      settings.value = resolvedSettings;

      apiClient = new ApiClient();
      const healthCheck = await apiClient.healthCheck();
      if (!healthCheck.healthy) {
        throw new Error(`API connection failed: ${healthCheck.message}`);
      }

      llmProvider = createLLMProvider(resolvedSettings);
      toolExecutor = new ToolExecutor(apiClient);
      themeContext = await loadThemeContext(apiClient);

      if (!themeReady.value) {
        isInitialized.value = false;
        return false;
      }

      isInitialized.value = true;
      return true;
    } catch (err) {
      setError(`Agent initialization failed: ${err.message}`);
      throw err;
    }
  }

  function createAbortController() {
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    return abortController;
  }

  function stopAgent() {
    if (abortController) {
      abortController.abort();
    }
  }

  function isAbortError(err) {
    return isAgentAbortError(err);
  }

  async function executeAgentLoop() {
    const controller = createAbortController();
    let autoResumeAttempt = 0;

    isRunning.value = true;
    error.value = null;
    clearStreamingBuffers();

    try {
      while (true) {
        try {
          if (autoResumeAttempt === 0) {
            clearStreamingBuffers();
            activityStatus.value = 'در حال به‌روزرسانی ایندکس قالب...';
            await refreshThemeCodeIndex(apiClient, controller.signal);
          }

          await runAgentLoop({
            messages: messages.value,
            llmProvider,
            toolExecutor,
            permissions: settings.value.permissions || {},
            todosRef: todos,
            themeContext: getAgentThemeContext(),
            customPrompt: settings.value.custom_prompt || '',
            signal: controller.signal,
            onMessagesChange: () => {
              persistImmediately();
            },
            onStreamToken: (_token, fullContent) => {
              streamingContent.value = fullContent;
              scheduleStreamPersist();
            },
            onToolStream: (state) => {
              if (!state || state.phase === 'idle') {
                toolStreamState.value = null;
                persistImmediately();
                return;
              }

              toolStreamState.value = {
                ...state,
                updatedAt: Date.now(),
              };

              if (state.phase === 'done' || state.phase === 'running') {
                persistImmediately();
              } else {
                scheduleStreamPersist();
              }
            },
            onActivity: (status) => {
              activityStatus.value = status;
            },
          });

          isInterrupted.value = false;
          persistSession();
          return;
        } catch (err) {
          if (isAbortError(err)) {
            finalizePendingStream();
            prepareMessagesForResume();
            isInterrupted.value = true;
            persistSession();
            return;
          }

          capturePartialTurnWithoutInterrupt();
          prepareMessagesForResume();
          persistImmediately();

          if (!isRetryableAgentError(err) || autoResumeAttempt >= MAX_AUTO_RESUME_ATTEMPTS) {
            isInterrupted.value = true;
            setError(`Message execution failed: ${err.message}`);
            persistSession();
            throw err;
          }

          autoResumeAttempt += 1;
          activityStatus.value = `قطع ارتباط — تلاش مجدد (${autoResumeAttempt}/${MAX_AUTO_RESUME_ATTEMPTS})...`;
          await sleep(1000 * autoResumeAttempt, controller.signal);
        }
      }
    } finally {
      isRunning.value = false;
      activityStatus.value = '';
      clearStreamingBuffers();
      abortController = null;
      flushPersistSession();
    }
  }

  async function sendMessage(content) {
    if (!canSendMessage.value) {
      throw new Error('Agent not ready to receive messages');
    }

    const text = (content || '').trim();
    if (!text) {
      return;
    }

    ensureSessionId();
    messages.value.push(new HumanMessage(text));
    todos.value = [];
    isInterrupted.value = false;
    persistSession();

    await executeAgentLoop();
  }

  async function resumeAgent() {
    if (!isInitialized.value || isRunning.value || !isInterrupted.value) {
      return;
    }

    if (!messages.value.length) {
      isInterrupted.value = false;
      persistSession();
      return;
    }

    prepareMessagesForResume();

    isInterrupted.value = false;
    const resumeMsg = new HumanMessage({ content: 'ادامه بده' });
    resumeMsg.additional_kwargs = { ...resumeMsg.additional_kwargs, _system_resume: true };
    messages.value.push(resumeMsg);
    persistSession();

    await executeAgentLoop();
  }

  function clearConversation() {
    stopAgent();
    messages.value = [];
    todos.value = [];
    error.value = null;
    isInterrupted.value = false;
    streamingContent.value = '';
    toolStreamState.value = null;
    persistSession();
  }

  function applyThemeGate(themeData) {
    const pageTheme = getDtmConfig().theme || {};
    const ready = Boolean(themeData?.ready ?? pageTheme.ready ?? true);
    themeReady.value = ready;
    themeError.value = themeData?.message || pageTheme.message || '';
    return ready;
  }

  async function loadThemeContext(client) {
    try {
      const response = await client.post('/theme/check');
      if (response?.success && response.data) {
        applyThemeGate(response.data);
        return response.data;
      }

      applyThemeGate(null);
      return null;
    } catch (loadError) {
      applyThemeGate(null);
      console.warn('[useAgent] Theme context preload failed:', loadError.message);
      return null;
    }
  }

  function getAgentThemeContext() {
    if (!themeContext && !themeCodeIndex) {
      return null;
    }

    return {
      ...(themeContext || {}),
      ...(themeCodeIndex ? { code_index: themeCodeIndex } : {}),
    };
  }

  async function refreshThemeCodeIndex(client, signal = null) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 35000);

    if (signal) {
      if (signal.aborted) {
        window.clearTimeout(timeoutId);
        throw new DOMException('Agent stopped by user', 'AbortError');
      }

      signal.addEventListener(
        'abort',
        () => controller.abort(),
        { once: true },
      );
    }

    try {
      const response = await client.get('/theme/index', null, { signal: controller.signal });

      if (response?.success && response.data?.index) {
        themeCodeIndex = response.data.index;

        if (!response.data.available) {
          console.warn('[useAgent] Theme code index unavailable — agent continues without it.');
        }

        return themeCodeIndex;
      }

      return themeCodeIndex;
    } catch (loadError) {
      if (isAgentAbortError(loadError)) {
        throw loadError;
      }

      console.warn('[useAgent] Theme code index refresh failed:', loadError.message);
      return themeCodeIndex;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function getStats() {
    return {
      initialized: isInitialized.value,
      running: isRunning.value,
      interrupted: isInterrupted.value,
      message_count: messages.value.length,
      todo_count: todos.value.length,
      has_error: !!error.value,
      llm_provider: llmProvider?.getProviderInfo() || null,
      session_id: currentSessionId.value,
    };
  }

  function setError(errorMessage) {
    error.value = errorMessage;
    console.error('[useAgent]', errorMessage);
  }

  async function updateSettings(newSettings) {
    if (isRunning.value) {
      throw new Error('Cannot update settings while agent is running');
    }

    const resolvedSettings = normalizeSettingsForAgent(newSettings, settings.value);
    settings.value = resolvedSettings;
    llmProvider = createLLMProvider(resolvedSettings);
    if (apiClient) {
      themeContext = await loadThemeContext(apiClient);
    }
  }

  function markInterrupted() {
    if (isRunning.value) {
      stopAgent();
      return;
    }

    if (messages.value.length || hasUncommittedStream()) {
      finalizePendingStream();
      persistSession();
    }
  }

  return {
    isInitialized,
    isRunning,
    isInterrupted,
    streamingContent,
    toolStreamState,
    activityStatus,
    messages,
    todos,
    error,
    settings,
    currentSessionId,
    themeReady,
    themeError,
    canSendMessage,
    initialize,
    sendMessage,
    resumeAgent,
    stopAgent,
    markInterrupted,
    restoreSession,
    loadSession,
    startNewSession,
    persistSession,
    clearConversation,
    getStats,
    updateSettings,
  };
}

export default useAgent;
