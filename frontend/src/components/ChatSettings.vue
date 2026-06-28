<script setup>
import { onMounted, reactive, ref } from 'vue';
import { AlertCircle, Check, ExternalLink, KeyRound, Loader2, Pencil, RefreshCw, X } from 'lucide-vue-next';
import { ALL_MODELS } from '../utils/llmProviders.js';
import { activateApiKey, fetchAgentSettings, fetchSettings, fetchWpagentifyKeyInfo, fetchWpagentifyModels, saveSettings } from '../utils/settingsApi.js';

const emit = defineEmits(['saved']);

const isLoading = ref(true);
const isSaving = ref(false);
const saveMessage = ref('');
const saveError = ref('');
const hasStoredApiKey = ref(false);
const apiKeyMasked = ref('');

const apiKeyInput = ref('');
const isActivating = ref(false);
const activationError = ref('');
const activationSuccess = ref('');
const showReplaceKey = ref(false);

const availableModels = ref(ALL_MODELS);
const isFetchingModels = ref(false);

const keyInfo = ref(null);
const keyInfoError = ref('');
const isFetchingKeyInfo = ref(false);

async function loadModels(apiKey) {
  isFetchingModels.value = true;
  try {
    const models = await fetchWpagentifyModels(apiKey);
    if (models && models.length > 0) {
      availableModels.value = models;
    } else {
      availableModels.value = ALL_MODELS;
    }
  } catch {
    availableModels.value = ALL_MODELS;
  } finally {
    isFetchingModels.value = false;
  }
}

async function loadKeyInfo(apiKey) {
  isFetchingKeyInfo.value = true;
  keyInfoError.value = '';
  keyInfo.value = null;
  try {
    keyInfo.value = await fetchWpagentifyKeyInfo(apiKey);
  } catch (err) {
    keyInfoError.value = err.message || 'دریافت اطلاعات اکانت ناموفق بود.';
  } finally {
    isFetchingKeyInfo.value = false;
  }
}

function budgetPercent(info) {
  const spend = Number(info?.spend ?? 0);
  const max = Number(info?.max_budget ?? 0);
  if (!max) return null;
  return Math.min(100, Math.round((spend / max) * 100));
}

function remainingPercent(info) {
  const pct = budgetPercent(info);
  return pct === null ? null : 100 - pct;
}

function formatLimit(val) {
  if (val === null || val === undefined || val === '') return '∞';
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(4);
}

const form = reactive({
  model: 'deepseek-v4-flash',
  readFiles: true,
  writeFiles: true,
  debugger: false,
  managePages: false,
});

function applyServerSettings(data) {
  const llm = data?.llm ?? {};
  const permissions = data?.permissions ?? {};

  if (llm.model) form.model = llm.model;
  form.readFiles = permissions.read_files !== false;
  form.writeFiles = permissions.write_files !== false;
  form.debugger = Boolean(permissions.debugger);
  form.managePages = Boolean(permissions.manage_pages);

  hasStoredApiKey.value = Boolean(llm.has_api_key);
  apiKeyMasked.value = llm.api_key_masked ?? '';
  apiKeyInput.value = '';
}

onMounted(async () => {
  isLoading.value = true;
  saveError.value = '';

  try {
    const data = await fetchSettings();
    applyServerSettings(data);

    if (data?.llm?.has_api_key) {
      const agentData = await fetchAgentSettings().catch(() => null);
      const key = agentData?.llm?.api_key;
      if (key) {
        await Promise.all([loadModels(key), loadKeyInfo(key)]);
      }
    }
  } catch (error) {
    saveError.value = error.message || 'بارگذاری تنظیمات ناموفق بود.';
  } finally {
    isLoading.value = false;
  }
});

async function handleActivate() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    activationError.value = 'لطفاً کلید API را وارد کنید.';
    return;
  }

  isActivating.value = true;
  activationError.value = '';
  activationSuccess.value = '';

  try {
    const data = await activateApiKey(key);
    activationSuccess.value = data?.message || 'کلید API با موفقیت فعال و ذخیره شد.';
    hasStoredApiKey.value = true;
    apiKeyMasked.value = key.slice(0, 4) + '••••••••' + key.slice(-4);
    apiKeyInput.value = '';
    showReplaceKey.value = false;
    await Promise.all([loadModels(key), loadKeyInfo(key)]);
    emit('saved', { server: data, client: { llm: { api_key: key } } });
  } catch (error) {
    activationError.value = error.message || 'فعال‌سازی کلید API ناموفق بود.';
  } finally {
    isActivating.value = false;
  }
}

async function handleRefreshModels() {
  const plainKey = apiKeyInput.value.trim();
  if (plainKey) {
    await Promise.all([loadModels(plainKey), loadKeyInfo(plainKey)]);
    return;
  }
  const agentData = await fetchAgentSettings().catch(() => null);
  const key = agentData?.llm?.api_key;
  if (key) await Promise.all([loadModels(key), loadKeyInfo(key)]);
}

function handleRetryActivation() {
  activationError.value = '';
  activationSuccess.value = '';
  showReplaceKey.value = false;
}

async function handleSave() {
  isSaving.value = true;
  saveMessage.value = '';
  saveError.value = '';

  const payload = {
    llm: { model: form.model },
    permissions: {
      read_files: form.readFiles,
      write_files: form.writeFiles,
      debugger: form.debugger,
      manage_pages: form.managePages,
    },
  };

  try {
    const data = await saveSettings(payload);
    applyServerSettings(data);
    saveMessage.value = 'تنظیمات ذخیره شد.';
    emit('saved', { server: data, client: payload });
  } catch (error) {
    saveError.value = error.message || 'ذخیره تنظیمات ناموفق بود.';
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="chat-settings">
    <div v-if="isLoading" class="chat-settings__loading">
      <Loader2 class="chat-settings__spinner" :size="20" :stroke-width="1.75" />
      <span>در حال بارگذاری تنظیمات…</span>
    </div>

    <template v-else>
      <div class="chat-settings__scroll">

        <!-- ── Step 1: API Key ── -->
        <section class="chat-settings__section">
          <div class="chat-settings__section-header">
            <div>
              <h2 class="chat-settings__section-title">کلید API</h2>
              <p class="chat-settings__section-desc">برای شروع، کلید API خود را وارد و فعال کنید.</p>
            </div>
          </div>

          <!-- ── Has key: show status row ── -->
          <template v-if="(hasStoredApiKey || activationSuccess) && !activationError">

            <!-- Key status row -->
            <div v-if="!showReplaceKey" class="chat-settings__key-status-row">
              <KeyRound :size="13" :stroke-width="2" class="chat-settings__key-status-icon" />
              <span class="chat-settings__key-masked" dir="ltr">{{ apiKeyMasked }}</span>
              <button
                type="button"
                class="chat-settings__icon-btn"
                title="ویرایش کلید"
                @click="showReplaceKey = true"
              >
                <Pencil :size="13" :stroke-width="2" />
              </button>
            </div>

            <!-- Replace key input (shown on demand) -->
            <div v-else class="chat-settings__key-replace-row">
              <input
                v-model="apiKeyInput"
                type="password"
                class="chat-settings__input chat-settings__input--sm"
                placeholder="sk-..."
                autocomplete="off"
                spellcheck="false"
                dir="ltr"
                :disabled="isActivating"
                @keyup.enter="handleActivate"
              />
              <button
                type="button"
                class="chat-settings__icon-btn chat-settings__icon-btn--confirm"
                :disabled="isActivating || !apiKeyInput.trim()"
                title="تأیید"
                @click="handleActivate"
              >
                <Loader2 v-if="isActivating" :size="13" :stroke-width="2" class="chat-settings__spinner" />
                <Check v-else :size="13" :stroke-width="2.5" />
              </button>
              <button
                type="button"
                class="chat-settings__icon-btn"
                title="انصراف"
                @click="showReplaceKey = false; apiKeyInput = ''; activationError = ''"
              >
                <X :size="13" :stroke-width="2" />
              </button>
            </div>

            <!-- Budget strip -->
            <div class="chat-settings__budget-strip">
              <div v-if="isFetchingKeyInfo" class="chat-settings__usage-loading">
                <Loader2 :size="12" :stroke-width="2" class="chat-settings__spinner" />
                <span>دریافت اطلاعات…</span>
              </div>
              <div v-else-if="keyInfoError" class="chat-settings__info-error">
                <AlertCircle :size="12" :stroke-width="2" />
                <span>{{ keyInfoError }}</span>
              </div>
              <template v-else-if="keyInfo && remainingPercent(keyInfo) !== null">
                <div class="chat-settings__budget-meta">
                  <span v-if="keyInfo.expires" class="chat-settings__budget-expires">{{ new Date(keyInfo.expires).toLocaleDateString('fa-IR') }}</span>
                  <span
                    class="chat-settings__budget-pct"
                    :class="remainingPercent(keyInfo) < 20 ? 'chat-settings__budget-pct--warn' : ''"
                  >{{ remainingPercent(keyInfo) }}٪</span>
                </div>
                <div class="chat-settings__progress-track">
                  <div
                    class="chat-settings__progress-fill"
                    :class="remainingPercent(keyInfo) < 20 ? 'chat-settings__progress-fill--warn' : ''"
                    :style="{ width: remainingPercent(keyInfo) + '%' }"
                  />
                </div>
              </template>
            </div>

          </template>

          <!-- ── No key yet ── -->
          <template v-else>

            <!-- Activation error -->
            <div v-if="activationError" class="chat-settings__activation-result chat-settings__activation-result--error">
              <AlertCircle :size="14" :stroke-width="2" />
              <div class="chat-settings__activation-result-body">
                <span>{{ activationError }}</span>
                <button type="button" class="chat-settings__retry-btn" @click="handleRetryActivation">
                  <RefreshCw :size="12" :stroke-width="2" />
                  تلاش مجدد
                </button>
              </div>
            </div>

            <!-- Key input -->
            <label v-if="!activationError" class="chat-settings__field">
              <div class="chat-settings__key-row">
                <input
                  v-model="apiKeyInput"
                  type="password"
                  class="chat-settings__input"
                  placeholder="sk-..."
                  autocomplete="off"
                  spellcheck="false"
                  dir="ltr"
                  :disabled="isActivating"
                  @keyup.enter="handleActivate"
                />
                <button
                  type="button"
                  class="chat-settings__activate-btn"
                  :disabled="isActivating || !apiKeyInput.trim()"
                  @click="handleActivate"
                >
                  <Loader2 v-if="isActivating" class="chat-settings__spinner" :size="14" :stroke-width="2" />
                  <Check v-else :size="14" :stroke-width="2.5" />
                </button>
              </div>
            </label>

            <a
              href="https://www.wpagentify.ir/panel/"
              target="_blank"
              rel="noopener noreferrer"
              class="chat-settings__purchase-link"
            >
              <ExternalLink :size="12" :stroke-width="2" />
              <span>کلید API ندارید؟ از اینجا تهیه کنید</span>
            </a>
          </template>
        </section>

        <!-- ── Step 2: Model ── -->
        <section class="chat-settings__section" :class="{ 'chat-settings__section--locked': !hasStoredApiKey && !activationSuccess }">
          <div class="chat-settings__section-header">
            <div>
              <h2 class="chat-settings__section-title">مدل زبانی</h2>
              <p class="chat-settings__section-desc">مدل هوش مصنوعی برای پردازش پیام‌ها.</p>
            </div>
          </div>

          <div class="chat-settings__field chat-settings__field--no-gap">
            <div class="chat-settings__model-header">
              <select v-model="form.model" class="chat-settings__select" :disabled="isFetchingModels || (!hasStoredApiKey && !activationSuccess)">
                <option v-for="m in availableModels" :key="m.id" :value="m.id">
                  {{ m.group }} — {{ m.label }}
                </option>
              </select>
              <button
                v-if="hasStoredApiKey || activationSuccess"
                type="button"
                class="chat-settings__refresh-models"
                :disabled="isFetchingModels"
                @click="handleRefreshModels"
              >
                <Loader2 v-if="isFetchingModels" :size="12" :stroke-width="2" class="chat-settings__spinner" />
                <RefreshCw v-else :size="12" :stroke-width="2" />
              </button>
            </div>
          </div>
        </section>

        <section class="chat-settings__section">
          <div class="chat-settings__section-header">
            <div>
              <h2 class="chat-settings__section-title">دسترسی‌های Agent</h2>
              <p class="chat-settings__section-desc">تعیین کنید Agent چه اقداماتی می‌تواند انجام دهد.</p>
            </div>
          </div>

          <div class="chat-settings__toggle-row">
            <div class="chat-settings__toggle-copy">
              <span class="chat-settings__label">خواندن فایل‌ها</span>
              <span class="chat-settings__hint">اجازه خواندن هر فایل در وردپرس (پلاگین‌ها، قالب‌ها، core و ...)</span>
            </div>
            <button
              type="button"
              class="chat-settings__switch"
              :class="{ 'chat-settings__switch--on': form.readFiles }"
              role="switch"
              :aria-checked="form.readFiles"
              @click="form.readFiles = !form.readFiles"
            >
              <span class="chat-settings__switch-thumb" />
            </button>
          </div>

          <div class="chat-settings__toggle-row">
            <div class="chat-settings__toggle-copy">
              <span class="chat-settings__label">نوشتن فایل‌ها</span>
              <span class="chat-settings__hint">ایجاد و ویرایش فایل‌ها در wp-content/dialog (assets، modules، templates)</span>
            </div>
            <button
              type="button"
              class="chat-settings__switch"
              :class="{ 'chat-settings__switch--on': form.writeFiles }"
              role="switch"
              :aria-checked="form.writeFiles"
              @click="form.writeFiles = !form.writeFiles"
            >
              <span class="chat-settings__switch-thumb" />
            </button>
          </div>

          <div class="chat-settings__toggle-row">
            <div class="chat-settings__toggle-copy">
              <span class="chat-settings__label">دیباگر</span>
              <span class="chat-settings__hint">دسترسی به ابزارهای دیباگ پیش‌نمایش</span>
            </div>
            <button
              type="button"
              class="chat-settings__switch"
              :class="{ 'chat-settings__switch--on': form.debugger }"
              role="switch"
              :aria-checked="form.debugger"
              @click="form.debugger = !form.debugger"
            >
              <span class="chat-settings__switch-thumb" />
            </button>
          </div>

          <div class="chat-settings__toggle-row">
            <div class="chat-settings__toggle-copy">
              <span class="chat-settings__label">مدیریت برگه‌ها</span>
              <span class="chat-settings__hint">ایجاد و ویرایش برگه‌های وردپرس (محتوا، متادیتا، قالب و ...)</span>
            </div>
            <button
              type="button"
              class="chat-settings__switch"
              :class="{ 'chat-settings__switch--on': form.managePages }"
              role="switch"
              :aria-checked="form.managePages"
              @click="form.managePages = !form.managePages"
            >
              <span class="chat-settings__switch-thumb" />
            </button>
          </div>
        </section>
      </div>

      <footer class="chat-settings__footer">
        <p v-if="saveError" class="chat-settings__feedback chat-settings__feedback--error">
          {{ saveError }}
        </p>
        <p v-else-if="saveMessage" class="chat-settings__feedback chat-settings__feedback--success">
          <Check :size="14" :stroke-width="2" />
          {{ saveMessage }}
        </p>

        <button
          type="button"
          class="chat-settings__save"
          :disabled="isSaving"
          @click="handleSave"
        >
          <Loader2
            v-if="isSaving"
            class="chat-settings__save-spinner"
            :size="15"
            :stroke-width="2"
          />
          <span>{{ isSaving ? 'در حال ذخیره…' : 'ذخیره تنظیمات' }}</span>
        </button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.chat-settings {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-settings__loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dtm-space-3);
  color: var(--dtm-text-muted);
  font-size: 13px;
}

.chat-settings__spinner,
.chat-settings__save-spinner {
  animation: chat-settings-spin 0.8s linear infinite;
}

@keyframes chat-settings-spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-settings__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--dtm-space-4) var(--dtm-space-6) var(--dtm-space-2);
}

.chat-settings__section + .chat-settings__section {
  margin-top: var(--dtm-space-6);
  padding-top: var(--dtm-space-6);
  border-top: 1px solid var(--dtm-border-subtle);
}

.chat-settings__section-title {
  margin: 0 0 var(--dtm-space-1);
  font-size: 13px;
  font-weight: 600;
  color: var(--dtm-text-primary);
}

.chat-settings__section-desc {
  margin: 0 0 var(--dtm-space-4);
  font-size: 12px;
  line-height: 1.6;
  color: var(--dtm-text-muted);
}

.chat-settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--dtm-space-4);
}

.chat-settings__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dtm-text-secondary);
}

.chat-settings__hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--dtm-text-muted);
}

.chat-settings__hint--error {
  color: #f87171;
}

.chat-settings__model-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-settings__model-header .chat-settings__select {
  flex: 1;
}

.chat-settings__field--no-gap {
  gap: 0;
  margin-bottom: var(--dtm-space-2);
}

.chat-settings__model-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.chat-settings__refresh-models {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid var(--dtm-border-default);
  background: var(--dtm-bg-surface);
  color: var(--dtm-text-secondary);
  font-size: 12px;
  transition: opacity var(--dtm-transition);
}

.chat-settings__refresh-models:hover:not(:disabled) {
  opacity: 0.9;
}

.chat-settings__refresh-models:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chat-settings__input,
.chat-settings__select {
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid var(--dtm-border-default);
  background: var(--dtm-bg-surface);
  color: var(--dtm-text-primary);
  transition:
    border-color var(--dtm-transition),
    box-shadow var(--dtm-transition);
}

.chat-settings__input:focus,
.chat-settings__select:focus {
  outline: none;
  border-color: rgba(80, 200, 121, 0.45);
  box-shadow: var(--dtm-focus-ring);
}

.chat-settings__select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.45)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: left 10px center;
  padding-left: 28px;
}

.chat-settings__toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dtm-space-3);
  padding: 10px 0;
}

.chat-settings__toggle-row--first {
  padding-top: 0;
}

.chat-settings__toggle-row + .chat-settings__toggle-row {
  border-top: 1px solid var(--dtm-border-subtle);
}

.chat-settings__toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.chat-settings__switch {
  position: relative;
  flex-shrink: 0;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  transition: background var(--dtm-transition);
}

.chat-settings__switch--on {
  background: rgba(80, 200, 121, 0.55);
}

.chat-settings__switch-thumb {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--dtm-transition);
}

.chat-settings__switch--on .chat-settings__switch-thumb {
  transform: translateX(-16px);
}

.chat-settings__footer {
  flex-shrink: 0;
  padding: var(--dtm-space-3) var(--dtm-space-4);
  border-top: 1px solid var(--dtm-border-subtle);
  background: var(--dtm-bg-primary);
}

.chat-settings__feedback {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 var(--dtm-space-2);
  font-size: 12px;
  line-height: 1.5;
}

.chat-settings__feedback--error {
  color: #f87171;
}

.chat-settings__feedback--success {
  color: var(--dtm-accent);
}

.chat-settings__save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  border-radius: var(--dtm-radius-sm);
  background: var(--dtm-accent);
  color: #04140a;
  font-size: 13px;
  font-weight: 600;
  transition: opacity var(--dtm-transition);
}

.chat-settings__save:hover:not(:disabled) {
  opacity: 0.92;
}

/* ── Section header with step badge ── */
.chat-settings__section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: var(--dtm-space-4);
}

.chat-settings__section-header .chat-settings__section-title {
  margin-bottom: 2px;
}

.chat-settings__section-header .chat-settings__section-desc {
  margin-bottom: 0;
}

.chat-settings__step-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: var(--dtm-text-muted);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.chat-settings__step-badge--done {
  background: rgba(80, 200, 121, 0.15);
  border-color: rgba(80, 200, 121, 0.4);
  color: var(--dtm-accent);
}

.chat-settings__step-badge--dim {
  opacity: 0.35;
}

/* ── Locked section ── */
.chat-settings__section--locked {
  opacity: 0.45;
  pointer-events: none;
}

/* ── Key status row (has key) ── */
.chat-settings__key-status-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: var(--dtm-space-3);
  font-size: 12px;
  color: var(--dtm-text-secondary);
}

.chat-settings__key-status-icon {
  flex-shrink: 0;
  color: var(--dtm-accent);
  opacity: 0.7;
}

.chat-settings__key-replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--dtm-space-3);
}

.chat-settings__key-replace-row .chat-settings__input--sm {
  flex: 1;
  min-width: 0;
}

/* ── Budget strip ── */
.chat-settings__budget-strip {
  margin-top: var(--dtm-space-8);
  margin-bottom: var(--dtm-space-5);

}

.chat-settings__budget-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.chat-settings__budget-expires {
  font-size: 10px;
  color: var(--dtm-text-muted);
  font-family: monospace;
  letter-spacing: 0.02em;
}

.chat-settings__budget-pct {
  font-size: 11px;
  font-weight: 600;
  color: var(--dtm-accent);
}

.chat-settings__budget-pct--warn {
  color: #f59e0b;
}

.chat-settings__info-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #f87171;
}

/* ── Icon-only buttons ── */
.chat-settings__icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid var(--dtm-border-default);
  background: transparent;
  color: var(--dtm-text-muted);
  transition: color var(--dtm-transition), border-color var(--dtm-transition), opacity var(--dtm-transition);
}

.chat-settings__icon-btn:hover:not(:disabled) {
  color: var(--dtm-text-secondary);
  border-color: rgba(255, 255, 255, 0.2);
}

.chat-settings__icon-btn--confirm {
  border-color: rgba(80, 200, 121, 0.35);
  color: var(--dtm-accent);
}

.chat-settings__icon-btn--confirm:hover:not(:disabled) {
  border-color: rgba(80, 200, 121, 0.6);
  color: var(--dtm-accent);
}

.chat-settings__icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ── Key row & inputs ── */
.chat-settings__key-masked {
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.6;
  flex: 1;
}

.chat-settings__key-row {
  display: flex;
  gap: 8px;
}

.chat-settings__key-row .chat-settings__input {
  flex: 1;
  min-width: 0;
}

.chat-settings__input--sm {
  font-size: 12px;
  min-height: 32px;
  padding: 6px 10px;
}

.chat-settings__activate-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--dtm-radius-sm);
  background: var(--dtm-accent);
  color: #04140a;
  transition: opacity var(--dtm-transition);
}

.chat-settings__activate-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.chat-settings__activate-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.chat-settings__activation-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: var(--dtm-space-4);
  padding: 10px 12px;
  border-radius: var(--dtm-radius-sm);
  font-size: 12px;
  line-height: 1.55;
}

.chat-settings__activation-result--success {
  background: rgba(80, 200, 121, 0.08);
  border: 1px solid rgba(80, 200, 121, 0.2);
  color: var(--dtm-accent);
}

.chat-settings__activation-result--error {
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.chat-settings__activation-result-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.chat-settings__retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--dtm-radius-sm);
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
  font-size: 11px;
  font-weight: 500;
  transition: opacity var(--dtm-transition);
}

.chat-settings__retry-btn:hover {
  opacity: 0.8;
}

/* ── Account usage (inline in key card) ── */
.chat-settings__usage-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dtm-text-muted);
  padding: 2px 0;
}

.chat-settings__progress-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.chat-settings__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dtm-accent);
  transition: width 0.4s ease;
}

.chat-settings__progress-fill--warn {
  background: #f59e0b;
}

.chat-settings__purchase-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--dtm-space-2);
  font-size: 12px;
  color: var(--dtm-accent);
  text-decoration: none;
  opacity: 0.85;
  transition: opacity var(--dtm-transition);
}

.chat-settings__purchase-link:hover {
  opacity: 1;
  text-decoration: underline;
}
</style>
