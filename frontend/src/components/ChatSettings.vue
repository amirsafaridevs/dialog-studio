<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Check, Loader2, RefreshCw } from 'lucide-vue-next';
import {
  LLM_PROVIDERS,
  PROVIDER_IDS,
  getDefaultModelForProvider,
  getProviderModels,
  isDynamicModelProvider,
  normalizeModelForProvider,
} from '../utils/llmProviders.js';
import { fetchOpenRouterModels, fetchSettings, saveSettings } from '../utils/settingsApi.js';

const emit = defineEmits(['saved']);

const isLoading = ref(true);
const isSaving = ref(false);
const saveMessage = ref('');
const saveError = ref('');
const hasStoredApiKey = ref(false);
const apiKeyMasked = ref('');
const openRouterModels = ref([]);
const isLoadingModels = ref(false);
const modelsError = ref('');
const modelSearch = ref('');

const form = reactive({
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: '',
  useCustomEndpoint: false,
  customEndpoint: '',
  customModel: '',
  readFiles: true,
  writeFiles: true,
  debugger: false,
  managePages: false,
});

const providerOptions = computed(() =>
  PROVIDER_IDS.map((id) => ({
    id,
    label: LLM_PROVIDERS[id].label,
  })),
);

const isOpenRouter = computed(() => form.provider === 'openrouter');

const modelOptions = computed(() => {
  const models = getProviderModels(form.provider, openRouterModels.value);
  const query = modelSearch.value.trim().toLowerCase();

  if (!query) {
    return models;
  }

  return models.filter((item) => {
    const haystack = `${item.label} ${item.id}`.toLowerCase();
    return haystack.includes(query);
  });
});

const canLoadOpenRouterModels = computed(
  () => isOpenRouter.value && (Boolean(form.apiKey) || hasStoredApiKey.value),
);

const apiKeyPlaceholder = computed(() =>
  hasStoredApiKey.value ? apiKeyMasked.value || '••••••••••••' : 'sk-...',
);

function ensureSelectedModelVisible(models) {
  if (!form.model || models.some((item) => item.id === form.model)) {
    return models;
  }

  return [{ id: form.model, label: form.model }, ...models];
}

async function loadOpenRouterModels() {
  if (!canLoadOpenRouterModels.value) {
    modelsError.value = 'برای بارگذاری مدل‌ها ابتدا API Key مربوط به OpenRouter را وارد کنید.';
    return;
  }

  isLoadingModels.value = true;
  modelsError.value = '';

  try {
    const data = await fetchOpenRouterModels(form.apiKey);
    const models = Array.isArray(data?.models) ? data.models : [];
    openRouterModels.value = ensureSelectedModelVisible(models);

    if (models.length === 0) {
      modelsError.value = 'مدلی از OpenRouter دریافت نشد.';
      return;
    }

    form.model = normalizeModelForProvider(form.provider, form.model, openRouterModels.value);
  } catch (error) {
    modelsError.value = error.message || 'بارگذاری مدل‌های OpenRouter ناموفق بود.';
  } finally {
    isLoadingModels.value = false;
  }
}

function applyServerSettings(data) {
  const llm = data?.llm ?? {};
  const permissions = data?.permissions ?? {};

  form.provider = llm.provider ?? 'deepseek';
  form.model = normalizeModelForProvider(form.provider, llm.model ?? '', openRouterModels.value);
  form.useCustomEndpoint = Boolean(llm.use_custom_endpoint);
  form.customEndpoint = llm.custom_endpoint ?? '';
  form.customModel = llm.custom_model ?? '';
  form.readFiles = permissions.read_files !== false;
  form.writeFiles = permissions.write_files !== false;
  form.debugger = Boolean(permissions.debugger);
  form.managePages = Boolean(permissions.manage_pages);

  hasStoredApiKey.value = Boolean(llm.has_api_key);
  apiKeyMasked.value = llm.api_key_masked ?? '';
  form.apiKey = '';
}

watch(
  () => form.provider,
  async (provider, previous) => {
    if (provider === previous) {
      return;
    }

    modelSearch.value = '';

    if (isDynamicModelProvider(provider)) {
      if (provider === 'openrouter') {
        await loadOpenRouterModels();
      }
      return;
    }

    const models = getProviderModels(provider);
    const stillValid = models.some((item) => item.id === form.model);
    if (!stillValid) {
      form.model = getDefaultModelForProvider(provider);
    }
  },
);

onMounted(async () => {
  isLoading.value = true;
  saveError.value = '';

  try {
    const data = await fetchSettings();
    applyServerSettings(data);

    if (isOpenRouter.value) {
      await loadOpenRouterModels();
    }
  } catch (error) {
    saveError.value = error.message || 'بارگذاری تنظیمات ناموفق بود.';
  } finally {
    isLoading.value = false;
  }
});

async function handleSave() {
  isSaving.value = true;
  saveMessage.value = '';
  saveError.value = '';

  const payload = {
    llm: {
      provider: form.provider,
      model: form.model,
      api_key: form.apiKey,
      use_custom_endpoint: form.useCustomEndpoint,
      custom_endpoint: form.customEndpoint,
      custom_model: form.customModel,
    },
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
    emit('saved', {
      server: data,
      client: payload,
    });
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
        <section class="chat-settings__section">
          <h2 class="chat-settings__section-title">مدل زبانی (LLM)</h2>
          <p class="chat-settings__section-desc">ارائه‌دهنده، مدل و کلید API را انتخاب کنید.</p>

          <div class="chat-settings__toggle-row chat-settings__toggle-row--first">
            <div class="chat-settings__toggle-copy">
              <span class="chat-settings__label">Custom Endpoint</span>
              <span class="chat-settings__hint">آدرس و مدل سفارشی برای API</span>
            </div>
            <button
              type="button"
              class="chat-settings__switch"
              :class="{ 'chat-settings__switch--on': form.useCustomEndpoint }"
              role="switch"
              :aria-checked="form.useCustomEndpoint"
              @click="form.useCustomEndpoint = !form.useCustomEndpoint"
            >
              <span class="chat-settings__switch-thumb" />
            </button>
          </div>

          <template v-if="form.useCustomEndpoint">
            <label class="chat-settings__field">
              <span class="chat-settings__label">آدرس Endpoint</span>
              <input
                v-model="form.customEndpoint"
                type="url"
                class="chat-settings__input"
                placeholder="https://api.example.com/v1"
                dir="ltr"
              />
            </label>

            <label class="chat-settings__field">
              <span class="chat-settings__label">نام مدل سفارشی</span>
              <input
                v-model="form.customModel"
                type="text"
                class="chat-settings__input"
                placeholder="my-custom-model"
                dir="ltr"
              />
            </label>
          </template>

          <template v-else>
            <label class="chat-settings__field">
              <span class="chat-settings__label">ارائه‌دهنده</span>
              <select v-model="form.provider" class="chat-settings__select">
                <option v-for="item in providerOptions" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </select>
            </label>

            <label class="chat-settings__field">
              <span class="chat-settings__label">مدل</span>

              <div v-if="isOpenRouter" class="chat-settings__model-tools">
                <input
                  v-model="modelSearch"
                  type="search"
                  class="chat-settings__input"
                  placeholder="جستجوی مدل…"
                  dir="ltr"
                  :disabled="isLoadingModels"
                />
                <button
                  type="button"
                  class="chat-settings__refresh-models"
                  :disabled="isLoadingModels || !canLoadOpenRouterModels"
                  @click="loadOpenRouterModels"
                >
                  <Loader2
                    v-if="isLoadingModels"
                    class="chat-settings__spinner"
                    :size="14"
                    :stroke-width="2"
                  />
                  <RefreshCw v-else :size="14" :stroke-width="2" />
                  <span>{{ isLoadingModels ? 'در حال بارگذاری…' : 'بارگذاری مدل‌ها' }}</span>
                </button>
              </div>

              <select
                v-model="form.model"
                class="chat-settings__select"
                :disabled="isOpenRouter && (isLoadingModels || modelOptions.length === 0)"
              >
                <option v-for="item in modelOptions" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </select>

              <span v-if="isOpenRouter && modelsError" class="chat-settings__hint chat-settings__hint--error">
                {{ modelsError }}
              </span>
              <span v-else-if="isOpenRouter && !canLoadOpenRouterModels" class="chat-settings__hint">
                برای مشاهده لیست مدل‌ها، API Key مربوط به OpenRouter را وارد کنید.
              </span>
              <span v-else-if="isOpenRouter && isLoadingModels" class="chat-settings__hint">
                در حال دریافت مدل‌ها از OpenRouter…
              </span>
            </label>
          </template>

          <label class="chat-settings__field">
            <span class="chat-settings__label">API Key</span>
            <input
              v-model="form.apiKey"
              type="password"
              class="chat-settings__input"
              :placeholder="apiKeyPlaceholder"
              autocomplete="off"
              spellcheck="false"
            />
            <span v-if="hasStoredApiKey && !form.apiKey" class="chat-settings__hint">
              کلید ذخیره‌شده بدون تغییر باقی می‌ماند مگر مقدار جدید وارد کنید.
            </span>
          </label>
        </section>

        <section class="chat-settings__section">
          <h2 class="chat-settings__section-title">دسترسی Agent</h2>
          <p class="chat-settings__section-desc">محدودیت‌های ابزار و دسترسی مدل.</p>

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
  padding: var(--dtm-space-4) var(--dtm-space-4) var(--dtm-space-2);
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
</style>
