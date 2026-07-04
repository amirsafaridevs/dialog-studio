<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  answered: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['answer']);

const isMultiple = computed(() => props.question?.type === 'multiple');
const options = computed(() => (Array.isArray(props.question?.options) ? props.question.options : []));

const selected = ref(isMultiple.value ? [] : null);

const canSubmit = computed(() => (
  isMultiple.value ? selected.value.length > 0 : selected.value !== null
));

function toggleOption(option) {
  if (props.answered) return;

  if (isMultiple.value) {
    const index = selected.value.indexOf(option);
    if (index === -1) {
      selected.value = [...selected.value, option];
    } else {
      selected.value = selected.value.filter((item) => item !== option);
    }
  } else {
    selected.value = option;
  }
}

function isSelected(option) {
  return isMultiple.value ? selected.value.includes(option) : selected.value === option;
}

function submit() {
  if (!canSubmit.value || props.answered) return;

  const answer = isMultiple.value ? selected.value : [selected.value];
  emit('answer', answer);
}
</script>

<template>
  <div class="chat-question" dir="rtl">
    <p v-if="question.text" class="chat-question__text">{{ question.text }}</p>

    <ul class="chat-question__options">
      <li v-for="option in options" :key="option">
        <label
          class="chat-question__option"
          :class="{ 'chat-question__option--selected': isSelected(option), 'chat-question__option--disabled': answered }"
        >
          <input
            :type="isMultiple ? 'checkbox' : 'radio'"
            :name="`chat-question-${question.text}`"
            :checked="isSelected(option)"
            :disabled="answered"
            @change="toggleOption(option)"
          >
          <span>{{ option }}</span>
        </label>
      </li>
    </ul>

    <button
      v-if="!answered"
      type="button"
      class="chat-question__submit"
      :disabled="!canSubmit"
      @click="submit"
    >
      تأیید
    </button>
  </div>
</template>

<style scoped>
.chat-question {
  display: flex;
  flex-direction: column;
  gap: var(--dtm-space-3);
  padding: var(--dtm-space-3);
  border-radius: var(--dtm-radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--dtm-border-subtle);
}

.chat-question__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--dtm-text-primary);
}

.chat-question__options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-question__option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid var(--dtm-border-subtle);
  font-size: 12px;
  color: var(--dtm-text-secondary);
  cursor: pointer;
  transition: background var(--dtm-transition), border-color var(--dtm-transition);
}

.chat-question__option:hover:not(.chat-question__option--disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.chat-question__option--selected {
  border-color: var(--dtm-accent);
  color: var(--dtm-text-primary);
  background: rgba(37, 99, 235, 0.08);
}

.chat-question__option--disabled {
  cursor: default;
  opacity: 0.7;
}

.chat-question__submit {
  align-self: flex-start;
  padding: 6px 16px;
  border-radius: var(--dtm-radius-sm);
  background: var(--dtm-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  transition: opacity var(--dtm-transition);
}

.chat-question__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
