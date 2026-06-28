/**
 * LLM Provider — routes all requests through api.wpagentify.ir (LiteLLM proxy).
 *
 * The proxy exposes an OpenAI-compatible API, so ChatOpenAI works for every model
 * (DeepSeek, GPT, Claude, Gemini, Qwen …). The user's api_key is the LiteLLM key
 * issued by wpagentify.ir; the model name is passed verbatim to the proxy.
 */

import { ChatOpenAI } from '@langchain/openai';

const WPAGENTIFY_BASE_URL = 'https://www.api.wpagentify.ir';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const LLM_TIMEOUT_MS = 600_000;
const LLM_MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error) {
  const message = (error?.message || '').toLowerCase();
  return (
    message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('connection')
    || message.includes('econnreset')
    || message.includes('timeout')
    || message.includes('socket')
    || error?.name === 'TypeError'
  );
}

class WpagentifyApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WpagentifyApiError';
    this.status = status;
  }
}

let fetchPatched = false;

function ensureFetchPatched() {
  if (fetchPatched) return;
  fetchPatched = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (!url.includes('wpagentify')) {
      return originalFetch(...args);
    }
    const response = await originalFetch(...args);
    if (!response.ok) {
      const cloned = response.clone();
      let body = null;
      try { body = await cloned.json(); } catch {}
      const apiMessage = body?.error?.message || body?.message || null;
      const userMessage = translateBudgetMessage(apiMessage) || apiMessage || `خطای سرور (${response.status})`;
      console.error('[originalFetch] API error :', { status: response.status, body });
      throw new WpagentifyApiError(userMessage, response.status);
    }
    return response;
  };
}

function translateBudgetMessage(apiMessage) {
  if (!apiMessage) return null;
  const msg = apiMessage.toLowerCase();
  if (msg.includes('30d')) return 'به محدودیت حجم مصرف ماهانه رسیده‌اید.';
  if (msg.includes('7d')) return 'به محدودیت حجم مصرف هفتگی رسیده‌اید.';
  if (msg.includes('24h')) return 'به محدودیت حجم مصرف روزانه رسیده‌اید.';
  return apiMessage;
}

export function translateErrorMessage(error) {
  if (!error) return '';
  // agentError is always a string — return it as-is; budget messages are already translated by fetch override
  return String(error?.message || error);
}



export function extractReasoningFromRawResponse(raw) {
  const choice = raw?.choices?.[0];
  if (!choice) return null;
  return choice.delta?.reasoning_content || choice.message?.reasoning_content || null;
}

/**
 * Surface a reasoning model's chain-of-thought on a dedicated `reasoning_content`
 * field WITHOUT overwriting `content`.
 *
 * DeepSeek (and other reasoning models) emit their CoT separately from the real
 * answer. Copying CoT into `content` causes it to be replayed into every later
 * request — which makes the model loop. The UI reads thinking from `__raw_response`.
 */
function attachReasoning(message) {
  if (!message) return message;
  const reasoning = extractReasoningFromRawResponse(message.additional_kwargs?.__raw_response);
  if (reasoning && message.additional_kwargs) {
    message.additional_kwargs.reasoning_content = reasoning;
  }
  return message;
}

function normalizeReasoningResponse(response) { return attachReasoning(response); }
function normalizeReasoningChunk(chunk) { return attachReasoning(chunk); }

export class LLMProvider {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this._initializeProvider();
  }

  _initializeProvider() {
    const { model, apiKey } = this.config;

    if (!apiKey) {
      throw new Error('کلید API وارد نشده است. لطفاً از تنظیمات کلید API خود را وارد کنید.');
    }

    ensureFetchPatched();

    this.provider = new ChatOpenAI({
      modelName: model || DEFAULT_MODEL,
      openAIApiKey: apiKey,
      configuration: {
        apiKey,
        baseURL: WPAGENTIFY_BASE_URL,
      },
      temperature: 0.1,
      streaming: true,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: 0,
      __includeRawResponse: true,
    });

    // LiteLLM proxy does not expose a token-counting endpoint compatible with tiktoken,
    // so we approximate with char/4 — accurate enough for context-window management.
    this.provider.getNumTokens = async (content) => {
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((item) => (typeof item === 'string' ? item : (item?.text ?? ''))).join('')
          : String(content ?? '');
      return Math.ceil(text.length / 4);
    };

    console.log(`[LLMProvider] Initialized via wpagentify proxy with model ${model || DEFAULT_MODEL}`);
  }

  async invoke(messages, options = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES + 1; attempt += 1) {
      try {
        const response = await this.provider.invoke(messages, options);
        return normalizeReasoningResponse(response);
      } catch (error) {
        lastError = error;

       

        if (error instanceof WpagentifyApiError || error.name === 'WpagentifyApiError') {
          throw error;
        }
        if (error.cause instanceof WpagentifyApiError || error.cause?.name === 'WpagentifyApiError') {
          throw error.cause;
        }

        if (isRetryableNetworkError(error) && attempt <= LLM_MAX_RETRIES) {
          console.warn(`[LLMProvider] Invoke retry ${attempt}/${LLM_MAX_RETRIES}:`, error.message);
          await sleep(5000 * attempt);
          continue;
        }

        console.error('[LLMProvider] Invoke error:', error);
        throw new Error(`LLM invoke failed: ${error.message}`);
      }
    }

    throw new Error(`LLM invoke failed: ${lastError?.message || 'Unknown error'}`);
  }

  bindTools(tools = []) {
    if (typeof this.provider.bindTools !== 'function') {
      throw new Error('Current LLM provider does not support tool calling');
    }
    return this.provider.bindTools(tools);
  }

  async *stream(messages, options = {}) {
    try {
      const stream = await this.provider.stream(messages, options);
      for await (const chunk of stream) {
        yield normalizeReasoningChunk(chunk);
      }
    } catch (error) {
      if (error instanceof WpagentifyApiError || error.name === 'WpagentifyApiError') {
        console.error('[LLMProvider] Stream error:', error);
        throw error;
      }
      // LangChain may wrap our WpagentifyApiError — unwrap it before re-throwing
      if (error.cause instanceof WpagentifyApiError || error.cause?.name === 'WpagentifyApiError') {
        console.error('[LLMProvider] Stream error (unwrapped):', error.cause);
        throw error.cause;
      }
      console.error('[LLMProvider] Stream error:', error);
      throw new Error(`LLM stream failed: ${error.message}`);
    }
  }

  get supportsStreaming() {
    return this.provider && typeof this.provider.stream === 'function';
  }

  getProviderInfo() {
    return {
      provider: 'wpagentify',
      model: this.config.model || DEFAULT_MODEL,
      supports_streaming: this.supportsStreaming,
      initialized: !!this.provider,
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this._initializeProvider();
  }

  async testConnection() {
    try {
      const response = await this.invoke([{ role: 'user', content: 'Hi' }]);
      return { success: Boolean(response?.content), response: response.content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Factory — reads api_key and model from settings, wires them to the wpagentify proxy.
 */
export function createLLMProvider(settings) {
  if (!settings?.llm) {
    throw new Error('LLM settings not provided');
  }

  const llmConfig = settings.llm;

  if (!llmConfig.api_key) {
    throw new Error('کلید API وارد نشده است. لطفاً از بخش تنظیمات کلید API خود را وارد و فعال کنید.');
  }

  return new LLMProvider({
    model: llmConfig.model || DEFAULT_MODEL,
    apiKey: llmConfig.api_key,
  });
}

export default LLMProvider;