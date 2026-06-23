<script setup>

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import ChatHeader from './ChatHeader.vue';

import ChatMessages from './ChatMessages.vue';

import ChatInput from './ChatInput.vue';

import ChatContinueBanner from './ChatContinueBanner.vue';
import ChatThemeBanner from './ChatThemeBanner.vue';

import ChatSettings from './ChatSettings.vue';
import ChatCustomPrompt from './ChatCustomPrompt.vue';

import ChatActivityStatus from './ChatActivityStatus.vue';

import PanelLoading from './PanelLoading.vue';

import { useAgent } from '../composables/useAgent.js';

import { useConnectionMonitor } from '../composables/useConnectionMonitor.js';

import { fetchAgentSettings } from '../utils/settingsApi.js';

import { TOOL_LABELS } from '../agent/tools/definitions.js';
import { getToolTitle, extractToolArgsFromResult } from '../utils/toolDisplay.js';
import { listHistoryItems } from '../utils/chatStorage.js';
import { exportChatSession } from '../utils/chatExport.js';
import { getDtmConfig } from '../utils/dtmConfig.js';



const chatHistory = ref([]);



const messages = ref([]);

const activeChatId = ref(null);

const isChatLoading = ref(true);

const showSettings = ref(false);
const showCustomPrompt = ref(false);

const chatInputRef = ref(null);

const agentInitError = ref('');
const pageThemeMessage = ref(getDtmConfig().theme?.message || '');



const AGENT_SETTINGS_CACHE_KEY = 'dtm-agent-settings';



const {

  isInitialized,

  isRunning,

  isInterrupted,

  activityStatus,

  streamingContent,

  toolStreamState,

  messages: agentMessages,

  todos: agentTodos,

  initialize,

  sendMessage,

  resumeAgent,

  stopAgent,

  restoreSession,

  loadSession,

  startNewSession,

  persistSession,

  clearConversation,

  updateSettings,

  currentSessionId,

  themeReady,

  themeError,

  getStats,

} = useAgent();



const {

  status: connectionStatus,

  statusLabel: connectionLabel,

} = useConnectionMonitor({ isBusy: isRunning });

const canExportChat = computed(() => (
  agentMessages.value.length > 0
  || Boolean(streamingContent.value)
  || Boolean(toolStreamState.value)
));

function getActiveSessionTitle() {
  const active = chatHistory.value.find((item) => item.id === currentSessionId.value);
  return active?.title || null;
}

function handleExportChat() {
  if (!canExportChat.value) {
    return;
  }

  exportChatSession({
    sessionId: currentSessionId.value,
    title: getActiveSessionTitle(),
    interrupted: isInterrupted.value,
    messages: agentMessages.value,
    todos: agentTodos.value,
    streamingContent: streamingContent.value,
    toolStreamState: toolStreamState.value,
    displayMessages: messages.value,
    stats: getStats(),
    isRunning: isRunning.value,
  });
}



function createAssistantNotice(content) {

  return {

    id: `assistant-${Date.now()}`,

    role: 'assistant',

    type: 'text',

    content,

    time: 'اکنون',

  };

}



function refreshChatHistory() {

  chatHistory.value = listHistoryItems();

  activeChatId.value = currentSessionId.value;

}



function getMessageType(message) {

  return message?.getType?.() || message?._getType?.() || message?.role || 'unknown';

}



function getMessageContent(message) {

  const content = message?.content;



  if (typeof content === 'string') {

    return content;

  }



  if (Array.isArray(content)) {

    return content

      .map((item) => {

        if (typeof item === 'string') {

          return item;

        }



        if (item?.type === 'thinking' || item?.type === 'reasoning') {

          return '';

        }



        return item?.text || item?.content || '';

      })

      .join('');

  }



  if (content == null) {

    return '';

  }



  return String(content);

}



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



function mapTaskStatus(status) {

  const statusMap = {

    pending: 'pending',

    in_progress: 'in-progress',

    completed: 'done',

    failed: 'failed',

  };



  return statusMap[status] || 'pending';

}



function buildPlanTasks(todos) {

  if (!Array.isArray(todos) || todos.length === 0) {

    return null;

  }



  return todos.map((task, index) => ({

    id: String(task.id || `todo-${index}`),

    label: task.description || task.id || '',

    status: mapTaskStatus(task.status),

  }));

}



function createPlanMessage(id, todos, { streaming = false } = {}) {

  const tasks = buildPlanTasks(todos);

  if (!tasks) {

    return null;

  }



  return {

    id,

    role: 'assistant',

    type: 'plan',

    tasks,

    streaming,

    time: 'اکنون',

  };

}



function summarizeToolMessage(message, callArgs = null) {

  const toolName = message?.name || 'tool';

  const raw = getMessageContent(message);



  try {

    const parsed = JSON.parse(raw);

    const resultArgs = extractToolArgsFromResult(toolName, parsed);
    const args = resultArgs
      ? { ...(callArgs && typeof callArgs === 'object' ? callArgs : {}), ...resultArgs }
      : (callArgs || null);

    if (parsed.success === false) {

      return {
        toolName,
        title: getToolTitle(toolName, { failed: true, args }),
        detail: parsed.error || '',
        failed: true,
      };

    }

    if (toolName === 'update_todos' && Array.isArray(parsed.todos)) {

      return {
        toolName,
        title: getToolTitle(toolName, { args: { todos: parsed.todos } }),
        detail: '',
        todos: parsed.todos,
      };

    }

    if (toolName === 'write_file' && parsed.data?.path) {

      return {
        toolName,
        title: getToolTitle(toolName, { args }),
        detail: parsed.data.bytes_written != null ? `${parsed.data.bytes_written} بایت نوشته شد` : '',
      };

    }

    if (toolName === 'edit_file' && parsed.data?.path) {

      const changeSummary = parsed.data.lines_removed != null
        ? `${parsed.data.lines_removed} خط حذف، ${parsed.data.lines_added ?? 0} خط اضافه`
        : '';

      return {
        toolName,
        title: getToolTitle(toolName, { args }),
        detail: changeSummary,
      };

    }

    return {
      toolName,
      title: getToolTitle(toolName, { args }),
      detail: '',
    };

  } catch {

    const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;

    return {
      toolName,
      title: getToolTitle(toolName, { args: callArgs }),
      detail: preview,
    };

  }

}



function buildStreamingMessages(state) {

  if (!state) {

    return [];

  }



  const messages = [];

  const tools = Array.isArray(state.tools) ? state.tools : [];



  if (state.phase === 'thinking') {

    if (state.text && tools.length === 0) {

      return [];

    }



    messages.push({

      id: 'streaming-thinking',

      role: 'assistant',

      type: 'thinking',

      content: state.text || '',

      detail: state.text || '',

      streaming: true,

      time: 'اکنون',

    });



    return messages;

  }



  if (state.phase === 'tool-args') {

    if (state.text) {

      messages.push({

        id: 'streaming-thinking',

        role: 'assistant',

        type: 'thinking',

        content: state.text,

        detail: state.text,

        streaming: true,

        time: 'اکنون',

      });

    }



    for (const tool of tools) {

      if (tool.name === 'update_todos' && Array.isArray(tool.args?.todos)) {

        const planMessage = createPlanMessage(

          `streaming-plan-${tool.id || tool.name}`,

          tool.args.todos,

          { streaming: true },

        );

        if (planMessage) {

          messages.push(planMessage);

          continue;

        }

      }



      messages.push({

        id: `streaming-tool-${tool.id || tool.name}`,

        role: 'assistant',

        type: 'tool',

        toolName: tool.name,

        title: getToolTitle(tool.name, { streaming: true, fallback: tool.label, args: tool.args }),

        detail: tool.preview || '',

        streaming: true,

        time: 'اکنون',

      });

    }



    if (!messages.length) {

      messages.push({

        id: 'streaming-thinking',

        role: 'assistant',

        type: 'thinking',

        content: '',

        detail: '',

        streaming: true,

        time: 'اکنون',

      });

    }



    return messages;

  }



  if (state.phase === 'running') {

    if (state.toolName === 'update_todos' && Array.isArray(state.args?.todos)) {

      const planMessage = createPlanMessage('streaming-plan-running', state.args.todos, { streaming: true });

      if (planMessage) {

        messages.push(planMessage);

        return messages;

      }

    }



    messages.push({

      id: 'streaming-tool',

      role: 'assistant',

      type: 'tool',

      toolName: state.toolName,

      title: getToolTitle(state.toolName, { streaming: true, fallback: state.label, args: state.args }),

      detail: state.preview || '',

      streaming: true,

      time: 'اکنون',

    });



    return messages;

  }



  // 'done' is omitted — the persisted tool result message renders the completed card.

  return messages;

}



function countFollowingToolMessages(messages, startIndex) {
  let count = 0;

  for (let i = startIndex + 1; i < messages.length; i += 1) {
    if (getMessageType(messages[i]) === 'tool') {
      count += 1;
      continue;
    }
    break;
  }

  return count;
}

function mapAgentMessages() {

  const display = [];

  const toolCallArgsById = new Map();



  agentMessages.value.forEach((message, index) => {

    const type = getMessageType(message);



    if (type === 'human' || type === 'user') {

      if (message?.additional_kwargs?._system_resume) return;

      display.push({

        id: message?.id || `user-${index}`,

        role: 'user',

        type: 'text',

        content: getMessageContent(message),

        time: 'اکنون',

      });

      return;

    }



    if (type === 'tool') {

      const callArgs = toolCallArgsById.get(message?.tool_call_id) || null;

      const summary = summarizeToolMessage(message, callArgs);



      if (summary.todos) {

        const planMessage = createPlanMessage(message?.id || `plan-${index}`, summary.todos);

        if (planMessage) {

          display.push(planMessage);

          return;

        }

      }



      display.push({

        id: message?.id || `tool-${index}`,

        role: 'assistant',

        type: 'tool',

        toolName: summary.toolName,

        title: summary.title,

        detail: summary.detail,

        failed: summary.failed,

        time: 'اکنون',

      });

      return;

    }



    const text = getMessageContent(message);
    const reasoning = extractThinkingContent(message);
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;

    if (hasToolCalls) {
      toolCallArgsById.clear();
      message.tool_calls.forEach((call) => {
        if (call?.id) {
          toolCallArgsById.set(call.id, call.args || {});
        }
      });
    }



    if (reasoning) {

      display.push({

        id: `${message?.id || `assistant-thinking-${index}`}-thinking`,

        role: 'assistant',

        type: 'thinking',

        content: reasoning,

        detail: reasoning,

        time: 'اکنون',

      });

    }



    if (text) {

      display.push({

        id: message?.id || `assistant-${index}`,

        role: 'assistant',

        type: 'text',

        content: text,

        time: 'اکنون',

      });

    } else if (hasToolCalls) {
      // Completed tools are rendered from tool result messages below.
      // Only surface calls that never received a result (e.g. interrupted mid-run).
      const answeredCount = countFollowingToolMessages(agentMessages.value, index);
      message.tool_calls.slice(answeredCount).forEach((call, callIndex) => {
        if (call.name === 'update_todos') {
          return;
        }

        display.push({
          id: `${message?.id || `assistant-tools-${index}`}-${callIndex}`,
          role: 'assistant',
          type: 'tool',
          toolName: call.name,
          title: getToolTitle(call.name, { fallback: TOOL_LABELS[call.name], args: call.args }),
          detail: '',
          time: 'اکنون',
        });
      });
    }

  });



  const streamingMessages = buildStreamingMessages(toolStreamState.value);

  if (streamingMessages.length) {

    display.push(...streamingMessages);

  } else if (streamingContent.value) {

    display.push({

      id: 'streaming-response',

      role: 'assistant',

      type: 'text',

      content: streamingContent.value,

      time: 'اکنون',

      streaming: true,

    });

  }



  messages.value = display;

}



let mapMessagesFrame = null;



function scheduleMapAgentMessages() {

  if (mapMessagesFrame) {

    return;

  }



  mapMessagesFrame = window.requestAnimationFrame(() => {

    mapMessagesFrame = null;

    mapAgentMessages();

  });

}



function loadCachedAgentSettings() {

  if (typeof window === 'undefined') {

    return null;

  }



  try {

    const raw = window.sessionStorage.getItem(AGENT_SETTINGS_CACHE_KEY);

    return raw ? JSON.parse(raw) : null;

  } catch {

    return null;

  }

}



function cacheAgentSettings(settings) {

  if (typeof window === 'undefined' || !settings) {

    return;

  }



  try {

    window.sessionStorage.setItem(AGENT_SETTINGS_CACHE_KEY, JSON.stringify(settings));

  } catch {

    // Ignore storage failures.

  }

}



function buildAgentSettings(source, apiKey = '') {

  const llm = source?.llm ?? {};

  const permissions = source?.permissions ?? {};

  const useCustomEndpoint = Boolean(llm.use_custom_endpoint);



  return {

    llm: {

      provider: useCustomEndpoint ? 'custom' : llm.provider,

      model: llm.model,

      api_key: apiKey || llm.api_key || '',

      use_custom_endpoint: useCustomEndpoint,

      custom_endpoint: llm.custom_endpoint ?? '',

      custom_model: llm.custom_model ?? '',

    },

    permissions: {

      read_files: permissions.read_files !== false,

      write_files: permissions.write_files !== false,

      debugger: Boolean(permissions.debugger),

      manage_pages: Boolean(permissions.manage_pages),

    },

    custom_prompt: source?.custom_prompt ?? '',

  };

}



async function resolveAgentSettings(preferred = null) {

  const cachedSettings = loadCachedAgentSettings();

  let apiKey =

    preferred?.llm?.api_key ||

    cachedSettings?.llm?.api_key ||

    '';



  let serverSettings = null;



  try {

    serverSettings = await fetchAgentSettings();

    if (!apiKey) {

      apiKey = serverSettings?.llm?.api_key || '';

    }

  } catch {

    if (!apiKey && cachedSettings) {

      return cachedSettings;

    }

  }



  const source = serverSettings || preferred || cachedSettings;

  if (!source?.llm) {

    return null;

  }



  const agentSettings = buildAgentSettings(source, apiKey);

  if (!agentSettings.llm.api_key) {

    return null;

  }



  return agentSettings;

}



async function bootstrapAgent(preferred = null) {

  const agentSettings = await resolveAgentSettings(preferred);

  if (!agentSettings) {

    return false;

  }



  cacheAgentSettings(agentSettings);



  if (isInitialized.value) {

    await updateSettings(agentSettings);

  } else {

    const initialized = await initialize(agentSettings);
    if (!initialized && !themeReady.value) {
      pageThemeMessage.value = themeError.value || pageThemeMessage.value;
      messages.value = [
        createAssistantNotice(
          pageThemeMessage.value || 'پوشه wp-content/dialog آماده نیست. پلاگین Dialog Maker را غیرفعال و دوباره فعال کنید.',
        ),
      ];
      return false;
    }

  }



  mapAgentMessages();

  agentInitError.value = '';

  return true;

}



watch(

  agentMessages,

  () => {

    scheduleMapAgentMessages();

    refreshChatHistory();

  },

  { deep: true, immediate: true },

);



watch(

  [streamingContent, toolStreamState, isRunning],

  () => {

    scheduleMapAgentMessages();

  },

);



watch(isRunning, (running, wasRunning) => {

  if (wasRunning && !running) {

    refreshChatHistory();

  }

});



onMounted(async () => {

  isChatLoading.value = true;



  try {

    await bootstrapAgent();

    restoreSession();

    refreshChatHistory();

    mapAgentMessages();

  } catch (error) {

    agentInitError.value = error.message || 'راه‌اندازی Agent ناموفق بود.';

    messages.value = [createAssistantNotice(agentInitError.value)];

  } finally {

    isChatLoading.value = false;

  }

});



async function handleSend(text) {

  if (!text.trim()) {

    return;

  }



  if (!isInitialized.value) {

    const notice =
      !themeReady.value
        ? pageThemeMessage.value || themeError.value || 'پوشه wp-content/dialog آماده نیست. پلاگین Dialog Maker را غیرفعال و دوباره فعال کنید.'
        : agentInitError.value || 'برای ارسال پیام، ابتدا تنظیمات LLM را ذخیره کنید.';

    messages.value = [...messages.value, createAssistantNotice(notice)];

    return;

  }



  try {

    await sendMessage(text.trim());

    refreshChatHistory();

    mapAgentMessages();

  } catch (error) {

    const notice = error.message || 'ارسال پیام ناموفق بود.';

    messages.value = [...messages.value, createAssistantNotice(notice)];

  }

}



function handleStop() {

  stopAgent();

}



async function handleContinue() {

  if (!isInitialized.value || isRunning.value) {

    return;

  }



  try {

    await resumeAgent();

    refreshChatHistory();

    mapAgentMessages();

  } catch (error) {

    const notice = error.message || 'ادامه گفتگو ناموفق بود.';

    messages.value = [...messages.value, createAssistantNotice(notice)];

  }

}



async function handleNewChat() {

  if (showSettings.value) {

    showSettings.value = false;

  }

  if (showCustomPrompt.value) {

    showCustomPrompt.value = false;

  }



  agentInitError.value = '';



  if (isInitialized.value) {

    persistSession();

    startNewSession();

    mapAgentMessages();

  } else {

    messages.value = [];

    activeChatId.value = null;

  }



  refreshChatHistory();



  nextTick(() => {

    chatInputRef.value?.focus();

  });

}



async function handleSelectChat(id) {

  if (showSettings.value) {

    showSettings.value = false;

  }

  if (showCustomPrompt.value) {

    showCustomPrompt.value = false;

  }



  if (!isInitialized.value || id === currentSessionId.value) {

    return;

  }



  isChatLoading.value = true;



  try {

    persistSession();

    loadSession(id);

    refreshChatHistory();

    mapAgentMessages();

  } finally {

    isChatLoading.value = false;

  }

}



function handleSelectPrompt(text) {

  chatInputRef.value?.setDraft(text);

}



async function handleSettingsSaved(payload) {

  const clientSettings = payload?.client;

  if (!clientSettings?.llm) {

    return;

  }



  showSettings.value = false;

  agentInitError.value = '';

  isChatLoading.value = true;



  try {

    const agentSettings = await resolveAgentSettings(clientSettings);

    if (!agentSettings) {

      throw new Error('کلید API یافت نشد. لطفاً API Key را دوباره وارد کنید.');

    }



    await bootstrapAgent(agentSettings);

  } catch (error) {

    const notice = error.message || 'راه‌اندازی Agent ناموفق بود.';

    agentInitError.value = notice;

    messages.value = [...messages.value, createAssistantNotice(notice)];

    showSettings.value = true;

  } finally {

    isChatLoading.value = false;

  }

}



function handleCloseSettings() {

  showSettings.value = false;

}



function handleToggleSettings() {

  showCustomPrompt.value = false;

  showSettings.value = true;

}



function handleTogglePrompt() {

  showSettings.value = false;

  showCustomPrompt.value = true;

}



function handleClosePrompt() {

  showCustomPrompt.value = false;

}



async function handleCustomPromptSaved(payload) {

  showCustomPrompt.value = false;

  const customPrompt = payload?.custom_prompt ?? '';

  try {

    const agentSettings = await resolveAgentSettings();

    if (!agentSettings) {

      return;

    }



    agentSettings.custom_prompt = customPrompt;

    cacheAgentSettings(agentSettings);



    if (isInitialized.value) {

      await updateSettings(agentSettings);

    }

  } catch (error) {

    const notice = error.message || 'به‌روزرسانی پرامپت ناموفق بود.';

    agentInitError.value = notice;

    messages.value = [...messages.value, createAssistantNotice(notice)];

    showCustomPrompt.value = true;

  }

}

</script>



<template>

  <aside class="chat-sidebar" dir="rtl">

    <ChatHeader

      :history="chatHistory"

      :active-chat-id="activeChatId"

      :settings-open="showSettings"

      :prompt-open="showCustomPrompt"

      @new-chat="handleNewChat"

      @select-chat="handleSelectChat"

      @toggle-settings="handleToggleSettings"

      @close-settings="handleCloseSettings"

      @toggle-prompt="handleTogglePrompt"

      @close-prompt="handleClosePrompt"

    />

    <div class="chat-sidebar__body">

      <PanelLoading v-if="isChatLoading && !showSettings && !showCustomPrompt" />

      <ChatSettings v-else-if="showSettings" @saved="handleSettingsSaved" />

      <ChatCustomPrompt v-else-if="showCustomPrompt" @saved="handleCustomPromptSaved" />

      <ChatMessages

        v-else

        :messages="messages"

        @select-prompt="handleSelectPrompt"

      />

    </div>

    <ChatActivityStatus

      v-if="!showSettings && !showCustomPrompt"

      :visible="isRunning"

      :status="activityStatus"

    />

    <ChatThemeBanner
      v-if="!showSettings && !showCustomPrompt"
      :visible="!themeReady"
      :message="themeError || pageThemeMessage"
    />

    <ChatContinueBanner

      v-if="!showSettings && !showCustomPrompt"

      :visible="isInterrupted && !isRunning && messages.length > 0"

      @continue="handleContinue"

    />

    <ChatInput

      v-if="!showSettings && !showCustomPrompt"

      ref="chatInputRef"

      :disabled="!isInitialized || !themeReady"

      :is-running="isRunning"

      :connection-status="connectionStatus"

      :connection-label="connectionLabel"

      :can-export="canExportChat"

      @send="handleSend"

      @stop="handleStop"

      @export="handleExportChat"

    />

  </aside>

</template>



<style scoped>

.chat-sidebar {

  display: flex;

  flex-direction: column;

  height: 100%;

  background: var(--dtm-bg-primary);

}



.chat-sidebar__body {

  position: relative;

  flex: 1;

  min-height: 0;

  display: flex;

  flex-direction: column;

}

</style>


