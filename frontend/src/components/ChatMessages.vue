<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import TaskPlan from './TaskPlan.vue';
import ChatEmptyState from './ChatEmptyState.vue';
import ChatStreamBlock from './ChatStreamBlock.vue';
import ChatMessageBody from './ChatMessageBody.vue';
import { getToolIcon, getToolTitle } from '../utils/toolDisplay.js';

const props = defineProps({
  messages: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits(['select-prompt']);

const containerRef = ref(null);
const stickToBottom = ref(true);
const SCROLL_THRESHOLD = 48;

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_THRESHOLD;
}

function scrollToBottom() {
  const element = containerRef.value;
  if (!element) {
    return;
  }

  element.scrollTop = element.scrollHeight;
}

function handleScroll() {
  const element = containerRef.value;
  if (!element) {
    return;
  }

  stickToBottom.value = isNearBottom(element);
}

async function maybeScrollToBottom() {
  await nextTick();
  if (stickToBottom.value) {
    scrollToBottom();
  }
}

watch(
  () => props.messages,
  () => {
    maybeScrollToBottom();
  },
  { deep: true },
);

onMounted(() => {
  containerRef.value?.addEventListener('scroll', handleScroll, { passive: true });
  maybeScrollToBottom();
});

onUnmounted(() => {
  containerRef.value?.removeEventListener('scroll', handleScroll);
});

function resolveToolTitle(message) {
  if (message.title) {
    return message.title;
  }

  return getToolTitle(message.toolName, {
    streaming: message.streaming,
    failed: message.failed,
    fallback: message.content,
    args: message.args,
  });
}
</script>

<template>
  <div ref="containerRef" class="chat-messages">
    <ChatEmptyState
      v-if="messages.length === 0"
      @select-prompt="emit('select-prompt', $event)"
    />

    <template v-else>
      <article
        v-for="message in messages"
        :key="message.id"
        class="chat-message"
        :class="[
          `chat-message--${message.role}`,
          message.type === 'plan' ? 'chat-message--plan' : '',
        ]"
      >
        <TaskPlan
          v-if="message.type === 'plan'"
          :tasks="message.tasks"
          class="chat-message__plan"
        />

        <ChatStreamBlock
          v-else-if="message.type === 'thinking'"
          title="thinking"
          :detail="message.detail || message.content"
          :streaming="message.streaming"
        />

        <ChatStreamBlock
          v-else-if="message.type === 'tool'"
          :title="resolveToolTitle(message)"
          :detail="message.detail"
          :icon="getToolIcon(message.toolName)"
          :streaming="message.streaming"
        />

        <div
          v-else
          class="chat-message__bubble"
          :class="{
            'chat-message__bubble--assistant': message.role === 'assistant',
            'chat-message__bubble--streaming': message.streaming,
            'chat-message__markdown': message.role === 'assistant',
          }"
        >
          <ChatMessageBody
            :content="message.content"
            :role="message.role"
            :streaming="Boolean(message.streaming)"
          />
          <span v-if="message.streaming" class="chat-message__cursor" />
        </div>
      </article>
    </template>
  </div>
</template>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--dtm-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--dtm-space-4);
  text-align: right;
  min-height: 0;
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: var(--dtm-space-2);
  max-width: 100%;
}

.chat-message--user {
  align-items: flex-start;
}

.chat-message--assistant {
  align-items: stretch;
}

.chat-message__bubble {
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: right;
}

.chat-message__markdown {
  white-space: normal;
}

.chat-message__markdown-body :deep(p) {
  margin: 0 0 0.75em;
}

.chat-message__markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-message__markdown-body :deep(h1),
.chat-message__markdown-body :deep(h2),
.chat-message__markdown-body :deep(h3),
.chat-message__markdown-body :deep(h4) {
  margin: 1em 0 0.5em;
  font-weight: 600;
  line-height: 1.4;
  color: var(--dtm-text-primary);
}

.chat-message__markdown-body :deep(h1) {
  font-size: 1.25em;
}

.chat-message__markdown-body :deep(h2) {
  font-size: 1.15em;
}

.chat-message__markdown-body :deep(h3),
.chat-message__markdown-body :deep(h4) {
  font-size: 1.05em;
}

.chat-message__markdown-body :deep(ul),
.chat-message__markdown-body :deep(ol) {
  margin: 0 0 0.75em;
  padding-inline-start: 1.25em;
}

.chat-message__markdown-body :deep(li + li) {
  margin-top: 0.25em;
}

.chat-message__markdown-body :deep(blockquote) {
  margin: 0 0 0.75em;
  padding: 0.25em 0.75em;
  border-inline-start: 3px solid var(--dtm-border-default);
  color: var(--dtm-text-muted);
}

.chat-message__markdown-body :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: var(--dtm-radius-sm);
  background: rgba(255, 255, 255, 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.chat-message__markdown-body :deep(pre) {
  margin: 0 0 0.75em;
  padding: var(--dtm-space-3);
  overflow-x: auto;
  border-radius: var(--dtm-radius-md);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--dtm-border-subtle);
}

.chat-message__markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.88em;
  line-height: 1.6;
}

.chat-message__markdown-body :deep(a) {
  color: var(--dtm-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-message__markdown-body :deep(hr) {
  margin: 1em 0;
  border: none;
  border-top: 1px solid var(--dtm-border-subtle);
}

.chat-message__markdown-body :deep(table) {
  width: 100%;
  margin: 0 0 0.75em;
  border-collapse: collapse;
  font-size: 0.92em;
}

.chat-message__markdown-body :deep(th),
.chat-message__markdown-body :deep(td) {
  padding: 0.4em 0.6em;
  border: 1px solid var(--dtm-border-subtle);
  text-align: right;
}

.chat-message__markdown-body :deep(th) {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
}

.chat-message__bubble--assistant {
  padding: 0 var(--dtm-space-1);
  color: var(--dtm-text-secondary);
}

.chat-message__bubble--streaming {
  color: var(--dtm-text-primary);
}

.chat-message__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-inline-start: 2px;
  background: var(--dtm-text-muted);
  vertical-align: text-bottom;
  animation: chat-message-cursor 1s step-end infinite;
}

@keyframes chat-message-cursor {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0;
  }
}

.chat-message--user .chat-message__bubble {
  padding: var(--dtm-space-3) var(--dtm-space-4);
  border-radius: var(--dtm-radius-lg) var(--dtm-radius-lg) var(--dtm-radius-lg) 4px;
  background: #ffffff;
  color: #000000;
  max-width: 92%;
}

.chat-message__plan {
  padding: 0 var(--dtm-space-1);
}
</style>
