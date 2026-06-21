<script setup>
const emit = defineEmits(['start', 'resize', 'end']);

let startX = 0;

function onMouseDown(event) {
  startX = event.clientX;
  emit('start');
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(event) {
  const container = document.querySelector('.dtm-layout');
  if (!container) {
    return;
  }

  const deltaPx = event.clientX - startX;
  startX = event.clientX;
  const deltaRatio = (deltaPx / container.clientWidth) * 100;
  emit('resize', deltaRatio);
}

function onMouseUp() {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  emit('end');
}
</script>

<template>
  <div
    class="resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize panels"
    @mousedown="onMouseDown"
  >
    <span class="resize-handle__grip" />
  </div>
</template>

<style scoped>
.resize-handle {
  flex: 0 0 5px;
  position: relative;
  cursor: col-resize;
  background: transparent;
  z-index: 2;
}

.resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--dtm-border-subtle);
  transition: background var(--dtm-transition), width var(--dtm-transition);
}

.resize-handle:hover::before,
.resize-handle:active::before {
  width: 2px;
  background: rgba(255, 255, 255, 0.18);
}

.resize-handle__grip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 32px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  opacity: 0;
  transition: opacity var(--dtm-transition);
}

.resize-handle:hover .resize-handle__grip {
  opacity: 1;
}
</style>
