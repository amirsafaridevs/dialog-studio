<script setup>
import { onMounted, ref } from 'vue';
import { Check, Loader2 } from 'lucide-vue-next';
import { DEFAULT_CUSTOM_PROMPT } from '../agent/system/defaultCustomPrompt.js';
import { fetchSettings, saveSettings } from '../utils/settingsApi.js';

const emit = defineEmits(['saved']);

const isLoading = ref(true);
const isSaving = ref(false);
const saveMessage = ref('');
const saveError = ref('');
const customPrompt = ref('');

onMounted(async () => {
  isLoading.value = true;
  saveError.value = '';

  try {
    const data = await fetchSettings();
    const savedPrompt = data?.custom_prompt ?? '';
    customPrompt.value = savedPrompt !== '' ? savedPrompt : DEFAULT_CUSTOM_PROMPT;
  } catch (error) {
    saveError.value = error.message || 'بارگذاری پرامپت ناموفق بود.';
  } finally {
    isLoading.value = false;
  }
});

async function handleSave() {
  isSaving.value = true;
  saveMessage.value = '';
  saveError.value = '';

  try {
    const data = await saveSettings({
      custom_prompt: customPrompt.value,
    });
    customPrompt.value = data?.custom_prompt ?? customPrompt.value;
    saveMessage.value = 'پرامپت ذخیره شد.';
    emit('saved', {
      custom_prompt: data?.custom_prompt ?? customPrompt.value,
    });
  } catch (error) {
    saveError.value = error.message || 'ذخیره پرامپت ناموفق بود.';
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="chat-custom-prompt">
    <div v-if="isLoading" class="chat-custom-prompt__loading">
      <Loader2 class="chat-custom-prompt__spinner" :size="20" :stroke-width="1.75" />
      <span>در حال بارگذاری پرامپت…</span>
    </div>

    <template v-else>
      <div class="chat-custom-prompt__scroll">
        <section class="chat-custom-prompt__section">
          <h2 class="chat-custom-prompt__section-title">پرامپت اختصاصی</h2>
          <p class="chat-custom-prompt__section-desc">
            دستورالعمل‌های طراحی خود را بنویسید. این متن به پرامپت سیستم اضافه می‌شود و در هر گفتگو اعمال می‌گردد.
          </p>

          <label class="chat-custom-prompt__field">
            <span class="chat-custom-prompt__label">دستورالعمل طراحی</span>
            <textarea
              v-model="customPrompt"
              class="chat-custom-prompt__textarea"
              rows="10"
              placeholder="مثلاً: طراحی Material Design با رنگ‌های روشن و فضای سفید زیاد…"
            />
          </label>
        </section>
      </div>

      <footer class="chat-custom-prompt__footer">
        <p v-if="saveError" class="chat-custom-prompt__feedback chat-custom-prompt__feedback--error">
          {{ saveError }}
        </p>
        <p
          v-else-if="saveMessage"
          class="chat-custom-prompt__feedback chat-custom-prompt__feedback--success"
        >
          <Check :size="14" :stroke-width="2" />
          {{ saveMessage }}
        </p>

        <button
          type="button"
          class="chat-custom-prompt__save"
          :disabled="isSaving"
          @click="handleSave"
        >
          <Loader2
            v-if="isSaving"
            class="chat-custom-prompt__save-spinner"
            :size="15"
            :stroke-width="2"
          />
          <span>{{ isSaving ? 'در حال ذخیره…' : 'ذخیره پرامپت' }}</span>
        </button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.chat-custom-prompt {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-custom-prompt__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dtm-space-3);
  color: var(--dtm-text-muted);
  font-size: 13px;
}

.chat-custom-prompt__spinner,
.chat-custom-prompt__save-spinner {
  animation: chat-custom-prompt-spin 0.8s linear infinite;
}

@keyframes chat-custom-prompt-spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-custom-prompt__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--dtm-space-4) var(--dtm-space-4) var(--dtm-space-2);
}

.chat-custom-prompt__section-title {
  margin: 0 0 var(--dtm-space-1);
  font-size: 13px;
  font-weight: 600;
  color: var(--dtm-text-primary);
}

.chat-custom-prompt__section-desc {
  margin: 0 0 var(--dtm-space-4);
  font-size: 12px;
  line-height: 1.6;
  color: var(--dtm-text-muted);
}

.chat-custom-prompt__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-custom-prompt__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dtm-text-secondary);
}

.chat-custom-prompt__textarea {
  width: 100%;
  min-height: 180px;
  padding: 11px 12px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid var(--dtm-border-default);
  background: var(--dtm-bg-surface);
  color: var(--dtm-text-primary);
  font-size: 12.5px;
  line-height: 1.7;
  resize: vertical;
  transition:
    border-color var(--dtm-transition),
    box-shadow var(--dtm-transition);
}

.chat-custom-prompt__textarea:focus {
  outline: none;
  border-color: rgba(80, 200, 121, 0.45);
  box-shadow: var(--dtm-focus-ring);
}

.chat-custom-prompt__footer {
  flex-shrink: 0;
  padding: var(--dtm-space-3) var(--dtm-space-4) var(--dtm-space-4);
  border-top: 1px solid var(--dtm-border-subtle);
}

.chat-custom-prompt__feedback {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 var(--dtm-space-3);
  font-size: 12px;
  line-height: 1.5;
}

.chat-custom-prompt__feedback--error {
  color: #f87171;
}

.chat-custom-prompt__feedback--success {
  color: var(--dtm-accent);
}

.chat-custom-prompt__save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--dtm-radius-sm);
  background: var(--dtm-accent);
  color: #0a0a0a;
  font-size: 13px;
  font-weight: 600;
  transition: opacity var(--dtm-transition);
}

.chat-custom-prompt__save:hover:not(:disabled) {
  opacity: 0.92;
}

.chat-custom-prompt__save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
