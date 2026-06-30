<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import ChatSidebar from './components/ChatSidebar.vue';
import ResizeHandle from './components/ResizeHandle.vue';
import ApiKeyModal from './components/ApiKeyModal.vue';

const showApiKeyModal = ref(false);
const chatSidebarRef = ref(null);
const isAgentRunning = ref(false);

function handleNeedApiKey() {
  showApiKeyModal.value = true;
}

function handleRunningChange(running) {
  isAgentRunning.value = running;
}

async function handleApiKeyActivated(payload) {
  showApiKeyModal.value = false;
  await chatSidebarRef.value?.handleApiKeyActivated(payload);
}

const browserWidth = ref(80);
const isResizing = ref(false);
const layoutRef = ref(null);

const MIN_BROWSER = 55;
const MAX_BROWSER = 88;

function onResizeStart() {
  isResizing.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onResize(deltaRatio) {
  const next = browserWidth.value + deltaRatio;
  browserWidth.value = Math.min(MAX_BROWSER, Math.max(MIN_BROWSER, next));
}

function onResizeEnd() {
  isResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function onWindowMouseUp() {
  if (isResizing.value) {
    onResizeEnd();
  }
}

onMounted(() => {
  window.addEventListener('mouseup', onWindowMouseUp);
});

onUnmounted(() => {
  window.removeEventListener('mouseup', onWindowMouseUp);
});
</script>

<template>
  <ApiKeyModal
    v-if="showApiKeyModal"
    @activated="handleApiKeyActivated"
  />
  <div
    ref="layoutRef"
    class="dtm-layout"
    :class="{ 'dtm-layout--resizing': isResizing, 'dtm-layout--blurred': showApiKeyModal }"
  >
    <div class="dtm-layout__browser-wrap" :style="{ flex: `0 0 ${browserWidth}%` }">
      <BrowserPanel class="dtm-layout__browser" />
      <div v-if="isAgentRunning" class="dtm-layout__browser-lock" aria-hidden="true" />
    </div>
    <ResizeHandle
      @start="onResizeStart"
      @resize="onResize"
      @end="onResizeEnd"
    />
    <ChatSidebar
      ref="chatSidebarRef"
      class="dtm-layout__chat"
      :style="{ flex: `0 0 ${100 - browserWidth}%` }"
      @need-api-key="handleNeedApiKey"
      @running-change="handleRunningChange"
    />
  </div>
</template>

<style scoped>
.dtm-layout {
  display: flex;
  flex-direction: row;
  direction: ltr;
  width: 100vw;
  height: 100vh;
  background: var(--dtm-bg-primary);
  overflow: hidden;
}

.dtm-layout--resizing {
  cursor: col-resize;
}

.dtm-layout--blurred {
  filter: blur(4px);
  pointer-events: none;
  user-select: none;
}

.dtm-layout__browser-wrap {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dtm-layout__browser {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.dtm-layout__browser-lock {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: not-allowed;
}

.dtm-layout__chat {
  min-width: 280px;
}
</style>
