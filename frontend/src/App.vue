<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import ChatSidebar from './components/ChatSidebar.vue';
import ResizeHandle from './components/ResizeHandle.vue';

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
  <div
    ref="layoutRef"
    class="dtm-layout"
    :class="{ 'dtm-layout--resizing': isResizing }"
  >
    <BrowserPanel
      class="dtm-layout__browser"
      :style="{ flex: `0 0 ${browserWidth}%` }"
    />
    <ResizeHandle
      @start="onResizeStart"
      @resize="onResize"
      @end="onResizeEnd"
    />
    <ChatSidebar
      class="dtm-layout__chat"
      :style="{ flex: `0 0 ${100 - browserWidth}%` }"
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

.dtm-layout__browser {
  min-width: 0;
}

.dtm-layout__chat {
  min-width: 280px;
}
</style>
