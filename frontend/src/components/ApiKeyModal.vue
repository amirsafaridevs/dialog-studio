<script setup>
import { ref, computed } from 'vue';
import {
  KeyRound, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  Check, RefreshCw, Bot, ShieldCheck, FileText
} from 'lucide-vue-next';
import { fetchWpagentifyKeyInfo, fetchWpagentifyModels, saveSettings } from '../utils/settingsApi.js';
import { ALL_MODELS } from '../utils/llmProviders.js';

const emit = defineEmits(['activated']);

// ── Step state ──────────────────────────────────────────────────────────────
const step = ref(1); // 1=API Key, 2=Model, 3=Permissions, 4=System Prompt

// ── Step 1: API Key ──────────────────────────────────────────────────────────
const apiKeyInput = ref('');
const isValidatingKey = ref(false);
const keyError = ref('');

async function validateAndNext() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyError.value = 'لطفاً کلید API را وارد کنید.';
    return;
  }
  isValidatingKey.value = true;
  keyError.value = '';
  try {
    // Validate key via wpagentify (no save yet)
    await fetchWpagentifyKeyInfo(key);
    // Load available models for step 2
    const models = await fetchWpagentifyModels(key);
    if (models && models.length > 0) availableModels.value = models;
    step.value = 2;
  } catch (err) {
    keyError.value = err.message || 'کلید API نامعتبر است.';
  } finally {
    isValidatingKey.value = false;
  }
}

// ── Step 2: Model ────────────────────────────────────────────────────────────
const availableModels = ref(ALL_MODELS);
const selectedModel = ref('deepseek-v4-flash');
const isFetchingModels = ref(false);

async function refreshModels() {
  isFetchingModels.value = true;
  try {
    const models = await fetchWpagentifyModels(apiKeyInput.value.trim());
    if (models && models.length > 0) availableModels.value = models;
  } catch {}
  finally { isFetchingModels.value = false; }
}

const modelsByGroup = computed(() => {
  const groups = {};
  for (const m of availableModels.value) {
    const g = m.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  }
  return groups;
});

// ── Step 3: Permissions ──────────────────────────────────────────────────────
const permissions = ref({
  readFiles: false,
  writeFiles: false,
  debugger: false,
  managePages: false,
});

const allPermissionsEnabled = computed(() =>
  Object.values(permissions.value).every(Boolean)
);

const permissionItems = [
  {
    key: 'readFiles',
    label: 'خواندن فایل‌ها',
    hint: 'اجازه خواندن هر فایل در وردپرس (پلاگین‌ها، قالب‌ها، core و ...)',
  },
  {
    key: 'writeFiles',
    label: 'نوشتن فایل‌ها',
    hint: 'ایجاد و ویرایش فایل‌ها در wp-content/dialog',
  },
  {
    key: 'debugger',
    label: 'دیباگر',
    hint: 'دسترسی به ابزارهای دیباگ پیش‌نمایش',
  },
  {
    key: 'managePages',
    label: 'مدیریت برگه‌ها',
    hint: 'ایجاد و ویرایش برگه‌های وردپرس',
  },
];

// ── Step 4: System Prompt ────────────────────────────────────────────────────
const systemPrompt = ref('');

// ── Final Submit ─────────────────────────────────────────────────────────────
const isSaving = ref(false);
const saveError = ref('');

async function handleFinish() {
  isSaving.value = true;
  saveError.value = '';
  try {
    const clientPayload = {
      llm: {
        api_key: apiKeyInput.value.trim(),
        model: selectedModel.value,
      },
      permissions: {
        read_files: permissions.value.readFiles,
        write_files: permissions.value.writeFiles,
        debugger: permissions.value.debugger,
        manage_pages: permissions.value.managePages,
      },
      custom_prompt: systemPrompt.value,
    };
    const data = await saveSettings(clientPayload);
    emit('activated', { server: data, client: clientPayload });
  } catch (err) {
    saveError.value = err.message || 'ذخیره تنظیمات ناموفق بود.';
  } finally {
    isSaving.value = false;
  }
}

const stepTitles = ['کلید API', 'انتخاب مدل', 'دسترسی‌ها', 'پرامپت سیستم'];
const stepIcons = [KeyRound, Bot, ShieldCheck, FileText];
</script>

<template>
  <div class="api-key-modal__overlay">
    <div class="api-key-modal__backdrop" />
    <div class="api-key-modal__dialog" role="dialog" aria-modal="true" dir="rtl">

      <!-- Progress dots -->
      <div class="api-key-modal__steps">
        <div
          v-for="n in 4"
          :key="n"
          class="api-key-modal__step-dot"
          :class="{
            'api-key-modal__step-dot--active': n === step,
            'api-key-modal__step-dot--done': n < step,
          }"
        />
      </div>

      <!-- Step icon + title -->
      <div class="api-key-modal__icon-wrap">
        <component :is="stepIcons[step - 1]" :size="26" :stroke-width="1.5" class="api-key-modal__icon" />
      </div>
      <h2 class="api-key-modal__title">{{ stepTitles[step - 1] }}</h2>

      <!-- ── Step 1: API Key ── -->
      <template v-if="step === 1">
        <p class="api-key-modal__desc">
          برای شروع، کلید API خود را از
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
            :disabled="isValidatingKey"
            @keyup.enter="validateAndNext"
          />
        </div>
        <div v-if="keyError" class="api-key-modal__error">
          <AlertCircle :size="14" :stroke-width="2" />
          <span>{{ keyError }}</span>
        </div>
        <button
          type="button"
          class="api-key-modal__btn"
          :disabled="isValidatingKey || !apiKeyInput.trim()"
          @click="validateAndNext"
        >
          <Loader2 v-if="isValidatingKey" :size="16" :stroke-width="2" class="api-key-modal__spinner" />
          <span>{{ isValidatingKey ? 'در حال بررسی…' : 'مرحله بعد' }}</span>
          <ChevronLeft v-if="!isValidatingKey" :size="16" :stroke-width="2" />
        </button>
      </template>

      <!-- ── Step 2: Model ── -->
      <template v-else-if="step === 2">
        <p class="api-key-modal__desc">
          مدل هوش مصنوعی مورد نظر را انتخاب کنید.
          <br />
          <span class="api-key-modal__hint-note">می‌توانید بعداً از تنظیمات این مدل را تغییر دهید.</span>
        </p>

        <div class="api-key-modal__field api-key-modal__field--model">
          <div class="api-key-modal__select-wrap">
            <select v-model="selectedModel" class="api-key-modal__select" :disabled="isFetchingModels">
              <optgroup v-for="(models, group) in modelsByGroup" :key="group" :label="group">
                <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
              </optgroup>
            </select>
            <button
              type="button"
              class="api-key-modal__refresh-btn"
              :disabled="isFetchingModels"
              title="بروزرسانی لیست مدل‌ها"
              @click="refreshModels"
            >
              <Loader2 v-if="isFetchingModels" :size="14" :stroke-width="2" class="api-key-modal__spinner" />
              <RefreshCw v-else :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>

        <div class="api-key-modal__nav">
          <button type="button" class="api-key-modal__btn api-key-modal__btn--ghost" @click="step = 1">
            <ChevronRight :size="16" :stroke-width="2" />
            <span>قبلی</span>
          </button>
          <button type="button" class="api-key-modal__btn" :disabled="!selectedModel" @click="step = 3">
            <span>مرحله بعد</span>
            <ChevronLeft :size="16" :stroke-width="2" />
          </button>
        </div>
      </template>

      <!-- ── Step 3: Permissions ── -->
      <template v-else-if="step === 3">
        <p class="api-key-modal__desc">
          برای ادامه باید همه دسترسی‌ها را فعال کنید.
        </p>

        <div class="api-key-modal__permissions">
          <div
            v-for="item in permissionItems"
            :key="item.key"
            class="api-key-modal__perm-row"
          >
            <div class="api-key-modal__perm-copy">
              <span class="api-key-modal__perm-label">{{ item.label }}</span>
              <span class="api-key-modal__perm-hint">{{ item.hint }}</span>
            </div>
            <button
              type="button"
              class="api-key-modal__switch"
              :class="{ 'api-key-modal__switch--on': permissions[item.key] }"
              role="switch"
              :aria-checked="permissions[item.key]"
              @click="permissions[item.key] = !permissions[item.key]"
            >
              <span class="api-key-modal__switch-thumb" />
            </button>
          </div>
        </div>

        <div v-if="!allPermissionsEnabled" class="api-key-modal__error api-key-modal__error--warn">
          <AlertCircle :size="14" :stroke-width="2" />
          <span>برای ادامه باید همه دسترسی‌ها را فعال کنید.</span>
        </div>

        <div class="api-key-modal__nav">
          <button type="button" class="api-key-modal__btn api-key-modal__btn--ghost" @click="step = 2">
            <ChevronRight :size="16" :stroke-width="2" />
            <span>قبلی</span>
          </button>
          <button
            type="button"
            class="api-key-modal__btn"
            :disabled="!allPermissionsEnabled"
            @click="step = 4"
          >
            <span>مرحله بعد</span>
            <ChevronLeft :size="16" :stroke-width="2" />
          </button>
        </div>
      </template>

      <!-- ── Step 4: System Prompt ── -->
      <template v-else-if="step === 4">
        <p class="api-key-modal__desc">
          یک پرامپت سیستم سفارشی برای Agent تعریف کنید.
          <br />
          <span class="api-key-modal__hint-note">این مرحله اختیاری است — می‌توانید خالی بگذارید.</span>
        </p>

        <div class="api-key-modal__field">
          <textarea
            v-model="systemPrompt"
            class="api-key-modal__textarea"
            placeholder="پرامپت سیستم سفارشی..."
            rows="5"
            dir="rtl"
          />
        </div>

        <div v-if="saveError" class="api-key-modal__error">
          <AlertCircle :size="14" :stroke-width="2" />
          <span>{{ saveError }}</span>
        </div>

        <div class="api-key-modal__nav">
          <button type="button" class="api-key-modal__btn api-key-modal__btn--ghost" @click="step = 3">
            <ChevronRight :size="16" :stroke-width="2" />
            <span>قبلی</span>
          </button>
          <button
            type="button"
            class="api-key-modal__btn api-key-modal__btn--finish"
            :disabled="isSaving"
            @click="handleFinish"
          >
            <Loader2 v-if="isSaving" :size="16" :stroke-width="2" class="api-key-modal__spinner" />
            <Check v-else :size="16" :stroke-width="2" />
            <span>{{ isSaving ? 'در حال ذخیره…' : 'شروع کن' }}</span>
          </button>
        </div>
      </template>

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
  padding: 28px 28px 24px;
  width: min(420px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

/* ── Progress dots ── */
.api-key-modal__steps {
  display: flex;
  gap: 7px;
  margin-bottom: 4px;
}

.api-key-modal__step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  transition: background 0.2s, transform 0.2s;
}

.api-key-modal__step-dot--active {
  background: var(--dtm-accent, #7c6af7);
  transform: scale(1.25);
}

.api-key-modal__step-dot--done {
  background: rgba(80, 200, 121, 0.55);
}

/* ── Icon ── */
.api-key-modal__icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}

.api-key-modal__icon {
  color: var(--dtm-accent, #7c6af7);
}

.api-key-modal__title {
  font-size: 16px;
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
  line-height: 1.65;
  width: 100%;
}

.api-key-modal__hint-note {
  font-size: 11.5px;
  color: var(--dtm-text-muted, rgba(255,255,255,0.35));
}

.api-key-modal__link {
  color: var(--dtm-accent, #7c6af7);
  text-decoration: none;
}

.api-key-modal__link:hover {
  text-decoration: underline;
}

/* ── Fields ── */
.api-key-modal__field {
  width: 100%;
}

.api-key-modal__field--model {
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
  width: 100%;
}

.api-key-modal__input:focus {
  border-color: var(--dtm-accent, #7c6af7);
}

.api-key-modal__input:disabled {
  opacity: 0.5;
}

.api-key-modal__textarea {
  width: 100%;
  padding: 10px 14px;
  background: var(--dtm-bg-input, rgba(255,255,255,0.06));
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  color: var(--dtm-text-primary, #fff);
  font-size: 12.5px;
  line-height: 1.6;
  outline: none;
  box-sizing: border-box;
  resize: vertical;
  transition: border-color 0.15s;
  font-family: inherit;
  min-height: 110px;
}

.api-key-modal__textarea:focus {
  border-color: var(--dtm-accent, #7c6af7);
}

/* ── Model select ── */
.api-key-modal__select-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
}

.api-key-modal__select {
  flex: 1;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.1));
  background: var(--dtm-bg-input, rgba(255,255,255,0.06));
  color: var(--dtm-text-primary, #fff);
  font-size: 13px;
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.45)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: left 10px center;
  padding-left: 28px;
  transition: border-color 0.15s;
}

.api-key-modal__select:focus {
  border-color: var(--dtm-accent, #7c6af7);
}

.api-key-modal__refresh-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.1));
  background: rgba(255,255,255,0.05);
  color: var(--dtm-text-muted, rgba(255,255,255,0.4));
  transition: opacity 0.15s;
}

.api-key-modal__refresh-btn:hover:not(:disabled) {
  opacity: 0.8;
}

.api-key-modal__refresh-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ── Permissions ── */
.api-key-modal__permissions {
  width: 100%;
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.08));
  border-radius: 10px;
  overflow: hidden;
}

.api-key-modal__perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  transition: background 0.1s;
}

.api-key-modal__perm-row + .api-key-modal__perm-row {
  border-top: 1px solid var(--dtm-border, rgba(255,255,255,0.06));
}

.api-key-modal__perm-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.api-key-modal__perm-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dtm-text-primary, #fff);
}

.api-key-modal__perm-hint {
  font-size: 11px;
  color: var(--dtm-text-muted, rgba(255,255,255,0.35));
  line-height: 1.4;
}

/* Toggle switch */
.api-key-modal__switch {
  position: relative;
  flex-shrink: 0;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.2s;
}

.api-key-modal__switch--on {
  background: rgba(80, 200, 121, 0.55);
}

.api-key-modal__switch-thumb {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.api-key-modal__switch--on .api-key-modal__switch-thumb {
  transform: translateX(-16px);
}

/* ── Error / warning ── */
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

.api-key-modal__error--warn {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
}

/* ── Buttons ── */
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
  gap: 7px;
  transition: opacity 0.15s;
}

.api-key-modal__btn:hover:not(:disabled) {
  opacity: 0.88;
}

.api-key-modal__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.api-key-modal__btn--ghost {
  background: transparent;
  border: 1px solid var(--dtm-border, rgba(255,255,255,0.12));
  color: var(--dtm-text-secondary, rgba(255,255,255,0.6));
  width: auto;
  flex: 1;
  font-size: 13px;
}

.api-key-modal__btn--finish {
  flex: 2;
  background: rgba(80, 200, 121, 0.75);
  color: #04140a;
  font-weight: 600;
}

.api-key-modal__btn--finish:hover:not(:disabled) {
  background: rgba(80, 200, 121, 0.9);
  opacity: 1;
}

/* ── Nav row (prev + next) ── */
.api-key-modal__nav {
  display: flex;
  gap: 8px;
  width: 100%;
}

/* ── Spinner ── */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.api-key-modal__spinner {
  animation: spin 0.8s linear infinite;
}
</style>
