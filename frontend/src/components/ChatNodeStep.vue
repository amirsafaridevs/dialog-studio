<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  // 'node' → active step title; 'summary' → quieter per-node summary line.
  variant: {
    type: String,
    default: 'node',
  },
});
</script>

<template>
  <div class="chat-node-step" :class="`chat-node-step--${variant}`">{{ title }}</div>
</template>

<style scoped>
.chat-node-step {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--dtm-text-primary);
}

.chat-node-step--summary {
  font-size: 12px;
  font-weight: 400;
  color: var(--dtm-text-muted);
}
</style>
