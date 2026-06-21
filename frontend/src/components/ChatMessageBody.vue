<script setup>
import { computed } from 'vue';
import { renderMarkdown } from '../utils/renderMarkdown.js';
import { renderUserMessage } from '../utils/elementTag.js';

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  role: {
    type: String,
    required: true,
  },
  streaming: {
    type: Boolean,
    default: false,
  },
});

const markdownHtml = computed(() => {
  if (props.role !== 'assistant' || props.streaming) {
    return '';
  }

  return renderMarkdown(props.content);
});

const userMessageHtml = computed(() => {
  if (props.role !== 'user') {
    return '';
  }

  return renderUserMessage(props.content);
});
</script>

<template>
  <template v-if="role === 'assistant'">
    <span v-if="streaming">{{ content }}</span>
    <div v-else class="chat-message__markdown-body" v-html="markdownHtml" />
  </template>
  <span v-else class="chat-message__user-body" v-html="userMessageHtml" />
</template>

<style scoped>
.chat-message__user-body :deep(.chat-element-tag) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0 2px;
  padding: 1px 8px;
  border-radius: var(--dtm-radius-sm);
  background: rgba(37, 99, 235, 0.1);
  border: 1px solid rgba(37, 99, 235, 0.35);
  color: #1d4ed8;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  direction: ltr;
  vertical-align: baseline;
  cursor: default;
  user-select: none;
}

.chat-message__user-body :deep(.chat-element-tag__icon) {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.chat-message__user-body :deep(.chat-element-tag__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
