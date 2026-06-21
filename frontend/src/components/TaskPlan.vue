<script setup>
import { CheckCircle2, Circle, ListTodo, LoaderCircle, XCircle } from 'lucide-vue-next';

defineProps({
  tasks: {
    type: Array,
    required: true,
  },
});

const statusIcon = {
  pending: Circle,
  'in-progress': LoaderCircle,
  done: CheckCircle2,
  failed: XCircle,
};
</script>

<template>
  <div class="task-plan">
    <div class="task-plan__title">
      <ListTodo :size="14" :stroke-width="1.75" class="task-plan__title-icon" />
      <span>برنامه اجرا</span>
    </div>
    <ul class="task-plan__list">
      <li
        v-for="task in tasks"
        :key="task.id"
        class="task-plan__item"
        :class="`task-plan__item--${task.status}`"
      >
        <component
          :is="statusIcon[task.status] || Circle"
          :size="12"
          :stroke-width="1.75"
          class="task-plan__item-icon"
        />
        <span>{{ task.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.task-plan {
  width: 100%;
  color: var(--dtm-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.task-plan__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--dtm-space-2);
  font-weight: 500;
  color: var(--dtm-text-secondary);
}

.task-plan__title-icon {
  flex-shrink: 0;
  color: var(--dtm-text-muted);
}

.task-plan__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-plan__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  text-align: right;
}

.task-plan__item-icon {
  flex-shrink: 0;
  margin-top: 5px;
  color: var(--dtm-text-muted);
}

.task-plan__item--in-progress {
  color: var(--dtm-text-primary);
}

.task-plan__item--in-progress .task-plan__item-icon {
  color: var(--dtm-accent);
  animation: spin 1s linear infinite;
}

.task-plan__item--done .task-plan__item-icon {
  color: var(--dtm-accent);
}

.task-plan__item--failed .task-plan__item-icon {
  color: #d4a054;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
