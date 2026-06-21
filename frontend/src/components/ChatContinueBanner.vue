<script setup>
defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['continue']);
</script>

<template>
  <div v-if="visible" class="chat-continue" dir="rtl">
    <p class="chat-continue__text">ارتباط قطع شد.</p>
    <button type="button" class="chat-continue__button" @click="$emit('continue')">
      ادامه
    </button>
  </div>
</template>

<style scoped>
.chat-continue {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dtm-space-3);
  margin: 0 var(--dtm-space-4) var(--dtm-space-2);
  padding: var(--dtm-space-2) var(--dtm-space-3);
  border-radius: var(--dtm-radius-md);
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.22);
}

.chat-continue__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dtm-text-secondary);
  text-align: right;
}

.chat-continue__button {
  flex-shrink: 0;
  padding: 5px 12px;
  border-radius: var(--dtm-radius-sm);
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
  font-size: 12px;
  font-weight: 500;
  transition: background var(--dtm-transition);
}

.chat-continue__button:hover {
  background: rgba(251, 191, 36, 0.28);
}
</style>
