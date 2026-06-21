<script setup>
defineProps({
  status: {
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
  <div v-if="visible && status" class="chat-activity" role="status" aria-live="polite">
    <span class="chat-activity__dots" aria-hidden="true">
      <span class="chat-activity__dot" />
      <span class="chat-activity__dot" />
      <span class="chat-activity__dot" />
    </span>
    <span class="chat-activity__text">{{ status }}</span>
  </div>
</template>

<style scoped>
.chat-activity {
  display: flex;
  align-items: center;
  gap: var(--dtm-space-2);
  padding: 0 var(--dtm-space-4) var(--dtm-space-2);
  min-height: 20px;
}

.chat-activity__dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.chat-activity__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dtm-text-muted);
  animation: chat-activity-bounce 1.2s ease-in-out infinite;
}

.chat-activity__dot:nth-child(2) {
  animation-delay: 0.15s;
}

.chat-activity__dot:nth-child(3) {
  animation-delay: 0.3s;
}

.chat-activity__text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dtm-text-muted);
  text-align: right;
}

@keyframes chat-activity-bounce {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
