<script setup>
import { Sparkle } from 'lucide-vue-next';

defineProps({
  title: {
    type: String,
    default: '',
  },
  visible: {
    type: Boolean,
    default: false,
  },
});
</script>

<template>
  <div v-if="visible && title" class="chat-tool-activity" role="status" aria-live="polite">
    <Sparkle :size="14" :stroke-width="1.75" class="chat-tool-activity__icon" aria-hidden="true" />
    <span class="chat-tool-activity__title">{{ title }}</span>
  </div>
</template>

<style scoped>
.chat-tool-activity {
  display: flex;
  align-items: center;
  gap: var(--dtm-space-2);
  min-height: 20px;
}

.chat-tool-activity__icon {
  flex-shrink: 0;
  color: var(--dtm-accent);
  animation: chat-tool-activity-pulse 1.4s ease-in-out infinite;
  transform-origin: center;
}

.chat-tool-activity__title {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dtm-text-muted);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes chat-tool-activity-pulse {
  0%,
  100% {
    transform: scale(0.85);
    opacity: 0.6;
    color: var(--dtm-accent);
  }

  50% {
    transform: scale(1.15);
    opacity: 1;
    color: var(--dtm-text-primary);
  }
}
</style>
