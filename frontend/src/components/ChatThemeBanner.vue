<script setup>
defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  message: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <div v-if="visible" class="chat-theme-banner" dir="rtl">
    <p class="chat-theme-banner__text">{{ message }}</p>
  </div>
</template>

<style scoped>
.chat-theme-banner {
  margin: 0 var(--dtm-space-4) var(--dtm-space-2);
  padding: var(--dtm-space-3);
  border-radius: var(--dtm-radius-md);
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.24);
}

.chat-theme-banner__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #fecaca;
  text-align: right;
}
</style>
