<script setup>
import { Check, X } from 'lucide-vue-next';

defineProps({
  tasks: {
    type: Array,
    required: true,
  },
});
</script>

<template>
  <ul class="task-plan">
    <li
      v-for="task in tasks"
      :key="task.id"
      class="task-plan__item"
      :class="`task-plan__item--${task.status}`"
    >
      <span class="task-plan__marker" aria-hidden="true">
        <Check
          v-if="task.status === 'done'"
          :size="9"
          :stroke-width="3"
          class="task-plan__marker-glyph"
        />
        <X
          v-else-if="task.status === 'failed'"
          :size="9"
          :stroke-width="3"
          class="task-plan__marker-glyph"
        />
      </span>
      <span class="task-plan__label">{{ task.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.task-plan {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dtm-text-muted);
}

.task-plan__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  text-align: right;
}

/* Square status marker — 12px, sits on the text baseline. */
.task-plan__marker {
  flex-shrink: 0;
  margin-top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: var(--dtm-text-muted);
  transition: background-color 0.2s ease;
}

.task-plan__marker-glyph {
  display: block;
}

/* Queued: filled gray square (default above), muted label. */
.task-plan__item--pending .task-plan__label {
  color: var(--dtm-text-muted);
}

/* In progress: spinning square outline, brighter label. */
.task-plan__item--in-progress .task-plan__label {
  color: var(--dtm-text-primary);
}

.task-plan__item--in-progress .task-plan__marker {
  background: transparent;
  border: 1.5px solid var(--dtm-accent);
  border-top-color: transparent;
  animation: task-plan-spin 0.7s linear infinite;
}

/* Done: filled green square with a check. */
.task-plan__item--done .task-plan__marker {
  background: #2ecc71;
}

.task-plan__item--done .task-plan__label {
  color: var(--dtm-text-secondary);
}

/* Failed: amber square with an ✕. */
.task-plan__item--failed .task-plan__marker {
  background: #d4a054;
}

.task-plan__item--failed .task-plan__label {
  color: var(--dtm-text-secondary);
}

@keyframes task-plan-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
