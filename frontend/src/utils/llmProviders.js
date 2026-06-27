/** Flat list of all models available through the wpagentify LiteLLM proxy. */
export const ALL_MODELS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (پیشنهادی)', group: 'DeepSeek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', group: 'DeepSeek' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', group: 'OpenAI' },
  { id: 'gpt-5.4', label: 'GPT-5.4', group: 'OpenAI' },
  { id: 'gpt-5.5', label: 'GPT-5.5', group: 'OpenAI' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', group: 'Claude' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', group: 'Claude' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', group: 'Claude' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'Gemini' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'Gemini' },
  { id: 'qwen3.5-flash', label: 'Qwen3.5 Flash', group: 'Qwen' },
  { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', group: 'Qwen' },
  { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', group: 'Qwen' },
];

export const LLM_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  openai: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    ],
  },
  claude: {
    label: 'Claude',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    ],
  },
  gemini: {
    label: 'Gemini',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro (Preview)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    ],
  },
  qwen: {
    label: 'Qwen',
    models: [
      { id: 'qwen3.7-max', label: 'Qwen3.7 Max' },
      { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus' },
      { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus' },
      { id: 'qwen3.6-flash', label: 'Qwen3.6 Flash' },
      { id: 'qwen3.6-max-preview', label: 'Qwen3.6 Max (Preview)' },
      { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus' },
      { id: 'qwen3.5-flash', label: 'Qwen3.5 Flash' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    dynamicModels: true,
    models: [],
  },
};

export const PROVIDER_IDS = Object.keys(LLM_PROVIDERS);

export function isDynamicModelProvider(providerId) {
  return Boolean(LLM_PROVIDERS[providerId]?.dynamicModels);
}

export function getProviderModels(providerId, dynamicModels = null) {
  if (providerId === 'openrouter' && Array.isArray(dynamicModels)) {
    return dynamicModels;
  }

  return LLM_PROVIDERS[providerId]?.models ?? [];
}

export function getDefaultModelForProvider(providerId) {
  return getProviderModels(providerId)[0]?.id ?? '';
}

export function normalizeModelForProvider(providerId, modelId, dynamicModels = null) {
  if (modelId && isDynamicModelProvider(providerId)) {
    const models = getProviderModels(providerId, dynamicModels);
    if (models.length === 0 || models.some((item) => item.id === modelId)) {
      return modelId;
    }
  }

  const models = getProviderModels(providerId, dynamicModels);
  if (models.some((item) => item.id === modelId)) {
    return modelId;
  }

  return getDefaultModelForProvider(providerId);
}
