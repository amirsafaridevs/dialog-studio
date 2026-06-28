<script setup>
import { ref } from 'vue';
import { KeyRound, Loader2, AlertCircle } from 'lucide-vue-next';
import { activateApiKey } from '../utils/settingsApi.js';

const emit = defineEmits(['activated']);

const apiKeyInput = ref('');
const isActivating = ref(false);
const activationError = ref('');

async function handleActivate() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    activationError.value = 'لطفاً کلید API را وارد کنید.';
    return;
  }

  isActivating.value = true;
  activationError.value = '';

  try {
    const data = await activateApiKey(key);
    emit('activated', { server: data, client: { llm: { api_key: key } } });
  } catch (error) {
    activationError.value = error.message || 'فعال‌سازی کلید API ناموفق بود.';
  } finally {
    isActivating.value = false;
  }
}
</script>

<template>
  <div class="api-key-modal__overlay">
    <div class="api-key-modal__backdrop" />
    <div class="api-key-modal__dialog" role="dialog" aria-modal="true" dir="rtl">
      <div class="api-key-modal__icon-wrap">
        <KeyRound :size="28" :stroke-width="1.5" class="api-key-modal__icon" />
      </div>
      <h2 class="api-key-modal__title">کلید API مورد نیاز است</h2>
      <p class="api-key-modal__desc">
        برای استفاده از Dialog Studio، ابتدا کلید API خود را از
        <a href="https://wpagentify.ir" target="_blank" rel="noopener" class="api-key-modal__link">wpagentify.ir</a>
        دریافت و در اینجا وارد کنید.
      </p>

      <div class="api-key-modal__field">
        <input
          v-model="apiKeyInput"
          type="password"
          class="api-key-modal__input"
          placeholder="sk-..."
          autocomplete="off"
          spellcheck="false"
          dir="ltr"
          :disabled="isActivating"
          @keyup.enter="handleActivate"
        />
      </div>

      <div v-if="activationError" class="api-key-modal__error">
        <AlertCircle :size="14" :stroke-width="2" />
        <span>{{ activationError }}</span>
      </div>

      <button
        type="button"
        class="api-key-modal__btn"
        :disabled="isActivating || !apiKeyInput.trim()"
        @click="handleActivate"
      >
        <Loader2 v-if="isActivating" :size="16" :stroke-width="2" class="api-key-modal__spinner" />
        <span>{{ isActivating ? 'در حال فعال‌سازی…' : 'فعال‌سازی کلید API' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.api-key-modal__overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.api-key-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.api-key-modal__dialog {
  position: relative;
  z-index: 1;
  background: var(--dtm-bg-secondary, #1e1e1e);
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.08));
  border-radius: 16px;
  padding: 32px 28px 28px;
  width: min(400px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

.api-key-modal__icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.api-key-modal__icon {
  color: var(--dtm-accent, #7c6af7);
}

.api-key-modal__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--dtm-text-primary, #fff);
  margin: 0;
  text-align: center;
}

.api-key-modal__desc {
  font-size: 13px;
  color: var(--dtm-text-secondary, rgba(255,255,255,0.55));
  margin: 0;
  text-align: center;
  line-height: 1.6;
}

.api-key-modal__link {
  color: var(--dtm-accent, #7c6af7);
  text-decoration: none;
}

.api-key-modal__link:hover {
  text-decoration: underline;
}

.api-key-modal__field {
  width: 100%;
}

.api-key-modal__input {
  width: 100%;
  padding: 10px 14px;
  background: var(--dtm-bg-input, rgba(255,255,255,0.06));
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  color: var(--dtm-text-primary, #fff);
  font-size: 13px;
  font-family: 'Courier New', monospace;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.api-key-modal__input:focus {
  border-color: var(--dtm-accent, #7c6af7);
}

.api-key-modal__input:disabled {
  opacity: 0.5;
}

.api-key-modal__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #f87171;
  width: 100%;
  background: rgba(248, 113, 113, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  box-sizing: border-box;
}

.api-key-modal__btn {
  width: 100%;
  padding: 11px 16px;
  background: var(--dtm-accent, #7c6af7);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s;
  margin-top: 2px;
}

.api-key-modal__btn:hover:not(:disabled) {
  opacity: 0.88;
}

.api-key-modal__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.api-key-modal__spinner {
  animation: spin 0.8s linear infinite;
}
</style>
