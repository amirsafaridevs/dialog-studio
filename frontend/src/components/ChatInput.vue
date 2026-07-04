<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ArrowUp, Download, Paperclip, Square } from 'lucide-vue-next';
import { useElementPicker } from '../composables/useElementPicker.js';
import { createElementTagNode } from '../utils/elementTag.js';

const emit = defineEmits(['send', 'stop', 'export']);

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  isRunning: {
    type: Boolean,
    default: false,
  },
  connectionStatus: {
    type: String,
    default: 'ok',
  },
  connectionLabel: {
    type: String,
    default: '',
  },
  canExport: {
    type: Boolean,
    default: false,
  },
});

const editorRef = ref(null);
const isEmpty = ref(true);
const savedRange = ref(null);

const { pickVersion, lastPick } = useElementPicker();

const MAX_LINES = 10;

const canSend = computed(() => !isEmpty.value && !props.disabled && !props.isRunning);
const showConnectionWarning = computed(
  () => Boolean(props.connectionLabel) && props.connectionStatus !== 'ok',
);

function syncEmptyState() {
  const editor = editorRef.value;
  if (!editor) {
    isEmpty.value = true;
    return;
  }

  const text = (editor.textContent || '').replace(/\u00A0/g, ' ').trim();
  const hasTags = editor.querySelector('.chat-input__inline-tag') !== null;
  isEmpty.value = !text && !hasTags;
}

function resizeEditor() {
  const editor = editorRef.value;
  if (!editor) {
    return;
  }

  editor.style.height = 'auto';
  const style = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(style.lineHeight) || 22;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const maxHeight = lineHeight * MAX_LINES + paddingTop + paddingBottom;

  editor.style.height = `${Math.min(editor.scrollHeight, maxHeight)}px`;
  editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function saveSelection() {
  const editor = editorRef.value;
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) {
    savedRange.value = range.cloneRange();
  }
}

function getEditorRange() {
  const editor = editorRef.value;
  if (!editor) {
    return null;
  }

  if (savedRange.value) {
    return savedRange.value.cloneRange();
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    const fallback = document.createRange();
    fallback.selectNodeContents(editor);
    fallback.collapse(false);
    return fallback;
  }

  return range;
}

function placeCaretAfter(node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertElementChip(element) {
  const editor = editorRef.value;
  if (!editor) {
    return;
  }

  editor.focus();

  const chip = createElementTagNode(element);

  const range = getEditorRange();
  if (!range) {
    return;
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  range.deleteContents();
  range.insertNode(chip);

  const spacer = document.createTextNode('\u00A0');
  range.setStartAfter(chip);
  range.collapse(true);
  range.insertNode(spacer);
  placeCaretAfter(spacer);

  saveSelection();
  syncEmptyState();
  nextTick(resizeEditor);
}

function serializeEditorContent() {
  const editor = editorRef.value;
  if (!editor) {
    return '';
  }

  let result = '';

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent.replace(/\u00A0/g, ' ');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    if (node.classList.contains('chat-input__inline-tag')) {
      const metaAttr = node.dataset.meta ? ` meta="${node.dataset.meta.replace(/"/g, '&quot;')}"` : '';
      result += `<Dialog:element tag="${node.dataset.tag}" path="${node.dataset.path}"${metaAttr}>${node.dataset.label}</Dialog:element>`;
      return;
    }

    node.childNodes.forEach(walk);
  }

  editor.childNodes.forEach(walk);
  return result.trim();
}

function clearEditor() {
  const editor = editorRef.value;
  if (!editor) {
    return;
  }

  editor.innerHTML = '';
  syncEmptyState();
  nextTick(resizeEditor);
}

function submit() {
  if (props.isRunning) {
    return;
  }

  const message = serializeEditorContent();
  if (!message) {
    return;
  }

  emit('send', message);
  clearEditor();
}

function handleActionClick() {
  if (props.isRunning) {
    emit('stop');
    return;
  }

  submit();
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!props.isRunning) {
      submit();
    }
  }
}

function onInput() {
  syncEmptyState();
  resizeEditor();
}

function onPaste(event) {
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text) {
    return;
  }

  const range = getEditorRange();
  if (!range) {
    return;
  }

  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  syncEmptyState();
  resizeEditor();
}

watch(pickVersion, () => {
  if (!lastPick.value) {
    return;
  }

  insertElementChip(lastPick.value);
});

onMounted(() => {
  syncEmptyState();
  resizeEditor();
});

function setDraft(text) {
  const editor = editorRef.value;
  if (!editor) {
    return;
  }

  editor.textContent = text;
  syncEmptyState();
  nextTick(() => {
    resizeEditor();
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

function focus() {
  editorRef.value?.focus();
}

defineExpose({ setDraft, focus });
</script>

<template>
  <footer class="chat-input" dir="rtl">
    <div
      v-if="showConnectionWarning"
      class="chat-input__connection"
      :class="`chat-input__connection--${connectionStatus}`"
      role="status"
      aria-live="polite"
    >
      <span class="chat-input__connection-dot" aria-hidden="true" />
      <span class="chat-input__connection-text">{{ connectionLabel }}</span>
    </div>

    <div class="chat-input__box">
      <div
        ref="editorRef"
        class="chat-input__editor"
        :class="{ 'chat-input__editor--empty': isEmpty, 'chat-input__editor--locked': isRunning }"
        :contenteditable="isRunning ? 'false' : 'true'"
        role="textbox"
        aria-multiline="true"
        data-placeholder="پیام خود را بنویسید..."
        @keydown="onKeydown"
        @input="onInput"
        @paste="onPaste"
        @blur="saveSelection"
      />
      <div class="chat-input__toolbar">
        <button
          type="button"
          class="chat-input__send"
          :class="{ 'chat-input__send--stop': isRunning }"
          :disabled="!isRunning && !canSend"
          :title="isRunning ? 'توقف' : 'ارسال پیام'"
          @click="handleActionClick"
        >
          <Square v-if="isRunning" :size="12" :stroke-width="2" fill="currentColor" />
          <ArrowUp v-else :size="16" :stroke-width="2" />
        </button>
        <div class="chat-input__actions">
          <button
            type="button"
            class="chat-input__export"
            title="خروجی JSON"
            :disabled="!canExport"
            @click="emit('export')"
          >
            <Download :size="17" :stroke-width="1.75" />
          </button>
          <button type="button" class="chat-input__attach" title="پیوست" :disabled="isRunning">
            <Paperclip :size="17" :stroke-width="1.75" />
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.chat-input {
  padding: var(--dtm-space-3) var(--dtm-space-4);
}

.chat-input__connection {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--dtm-space-2);
  padding: 4px 8px;
  border-radius: var(--dtm-radius-sm);
  background: rgba(255, 255, 255, 0.03);
}

.chat-input__connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--dtm-text-muted);
}

.chat-input__connection--offline .chat-input__connection-dot,
.chat-input__connection--api-down .chat-input__connection-dot {
  background: #f87171;
  animation: chat-input-pulse 1.6s ease-in-out infinite;
}

.chat-input__connection-text {
  font-size: 11px;
  line-height: 1.4;
  color: var(--dtm-text-muted);
}

.chat-input__box {
  display: flex;
  flex-direction: column;
  gap: var(--dtm-space-2);
  padding: 10px 14px 8px;
  background: #101010;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  transition: border-color var(--dtm-transition), box-shadow var(--dtm-transition);
}

.chat-input__box:focus-within {
  border-color: rgba(255, 255, 255, 0.12);
}

.chat-input__editor {
  flex: 1;
  min-width: 0;
  min-height: 24px;
  max-height: none;
  border: none;
  background: transparent;
  color: var(--dtm-text-primary);
  outline: none;
  line-height: 1.65;
  padding: 4px 0;
  text-align: right;
  overflow-y: hidden;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-input__editor--empty::before {
  content: attr(data-placeholder);
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}

.chat-input__editor--locked {
  cursor: default;
  opacity: 0.45;
}

.chat-input__editor :deep(.chat-element-tag) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0 2px;
  padding: 1px 8px;
  border-radius: var(--dtm-radius-sm);
  background: rgba(37, 99, 235, 0.18);
  border: 1px solid rgba(37, 99, 235, 0.35);
  color: #93c5fd;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  direction: ltr;
  vertical-align: baseline;
  cursor: default;
  user-select: none;
}

.chat-input__editor :deep(.chat-element-tag__icon) {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.chat-input__editor :deep(.chat-element-tag__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dtm-space-2);
}

.chat-input__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.chat-input__export,
.chat-input__attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--dtm-radius-sm);
  color: rgba(255, 255, 255, 0.6);
  transition: background var(--dtm-transition), color var(--dtm-transition);
}

.chat-input__export:hover:not(:disabled),
.chat-input__attach:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

.chat-input__export:disabled,
.chat-input__attach:disabled {
  opacity: 0.45;
  cursor: default;
}

.chat-input__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: #2b2f38;
  color: rgba(255, 255, 255, 0.85);
  transition: transform var(--dtm-transition), opacity var(--dtm-transition), background var(--dtm-transition);
}

.chat-input__send--stop {
  background: #282828;
  color: #ffffff;
}

.chat-input__send:hover:not(:disabled) {
  background: #363b45;
}

.chat-input__send:disabled {
  opacity: 0.55;
  cursor: default;
}

@keyframes chat-input-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}
</style>
