<script setup>
import { Sparkles } from 'lucide-vue-next';

const emit = defineEmits(['select-prompt']);

const suggestions = [
  'یک فروشگاه آنلاین مینیمال با تم تیره',
  'صفحه معرفی استارتاپ با لحن حرفه‌ای',
  'لندینگ پیج برای دوره آموزشی',
];
</script>

<template>
  <div class="chat-empty">
    <div class="chat-empty__icon" aria-hidden="true">
      <Sparkles :size="20" :stroke-width="1.75" />
    </div>
    <h2 class="chat-empty__title">گفتگوی جدید</h2>
    <p class="chat-empty__text">چه می‌خواهید بسازید؟</p>
    <ul class="chat-empty__suggestions">
      <li v-for="(suggestion, index) in suggestions" :key="index">
        <button
          type="button"
          class="chat-empty__suggestion"
          @click="emit('select-prompt', suggestion)"
        >
          {{ suggestion }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dtm-space-3);
  padding: var(--dtm-space-6) var(--dtm-space-5);
  text-align: center;
  min-height: 0;
}

.chat-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--dtm-radius-md);
  color: var(--dtm-text-muted);
  border: 1px solid var(--dtm-border-subtle);
  background: rgba(255, 255, 255, 0.02);
}

.chat-empty__title {
  margin: var(--dtm-space-1) 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dtm-text-primary);
}

.chat-empty__text {
  margin: 0;
  max-width: 280px;
  font-size: 13px;
  line-height: 1.75;
  color: var(--dtm-text-muted);
}

.chat-empty__suggestions {
  list-style: none;
  margin: var(--dtm-space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--dtm-space-2);
  width: 100%;
  max-width: 300px;
}

.chat-empty__suggestion {
  width: 100%;
  padding: 10px var(--dtm-space-4);
  border-radius: var(--dtm-radius-md);
  border: 1px solid var(--dtm-border-subtle);
  background: transparent;
  color: var(--dtm-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  text-align: right;
  transition: background var(--dtm-transition), border-color var(--dtm-transition), color var(--dtm-transition);
}

.chat-empty__suggestion:hover {
  background: var(--dtm-hover-bg);
  border-color: var(--dtm-border-default);
  color: var(--dtm-text-primary);
}
</style>
