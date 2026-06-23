/**
 * Unified LLM Provider with Streaming Support
 * 
 * Supports multiple LLM providers through LangChain.js
 */

import { ChatOpenAI } from '@langchain/openai';

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

export function extractReasoningFromRawResponse(raw) {
  const choice = raw?.choices?.[0];
  if (!choice) {
    return null;
  }

  return choice.delta?.reasoning_content
    || choice.message?.reasoning_content
    || null;
}

/**
 * Surface a reasoning model's chain-of-thought on a dedicated `reasoning_content`
 * field WITHOUT overwriting `content`.
 *
 * Why: DeepSeek (and other reasoning models) emit their CoT separately from the
 * real answer. If we copy CoT into `content`, that thinking gets persisted as the
 * assistant message and replayed into every later request — which DeepSeek
 * explicitly warns against and which makes the model loop and "go crazy".
 * The UI reads thinking from `__raw_response`, so display is unaffected.
 */
function attachReasoning(message) {
  if (!message) {
    return message;
  }

  const reasoning = extractReasoningFromRawResponse(message.additional_kwargs?.__raw_response);
  if (reasoning && message.additional_kwargs) {
    message.additional_kwargs.reasoning_content = reasoning;
  }

  return message;
}

function normalizeReasoningResponse(response) {
  return attachReasoning(response);
}

function normalizeReasoningChunk(chunk) {
  return attachReasoning(chunk);
}

export class LLMProvider {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this._initializeProvider();
  }

  _initializeProvider() {
    const { provider, model, apiKey, customEndpoint, customModel } = this.config;

    switch (provider) {
      case 'openai':
        this.provider = new ChatOpenAI({
          modelName: model || 'gpt-4-turbo-preview',
          openAIApiKey: apiKey,
          temperature: 0.1,
          streaming: true,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: LLM_MAX_RETRIES,
          __includeRawResponse: true,
        });
        break;

      case 'claude':
      case 'anthropic':
        // Claude via OpenAI-compatible endpoint (no @langchain/anthropic needed)
        this.provider = new ChatOpenAI({
          modelName: model || 'claude-sonnet-4-5',
          openAIApiKey: apiKey,
          configuration: { apiKey: apiKey, baseURL: 'https://api.anthropic.com/v1' },
          temperature: 0.1,
          streaming: true,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: LLM_MAX_RETRIES,
        });
        this._useApproximateTokenCount();
        break;

      case 'deepseek':
        // Use OpenAI-compatible API for DeepSeek
        this.provider = new ChatOpenAI({
          modelName: model || 'deepseek-coder',
          openAIApiKey: apiKey,
          configuration: {
            apiKey: apiKey,
            baseURL: 'https://api.deepseek.com/v1',
          },
          temperature: 0.1,
          streaming: true,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: LLM_MAX_RETRIES,
          __includeRawResponse: true,
        });
        this._useApproximateTokenCount();
        break;

      case 'openrouter': {
        const referer = typeof window !== 'undefined' ? window.location.origin : '';
        this.provider = new ChatOpenAI({
          modelName: model || 'openai/gpt-4o-mini',
          apiKey: apiKey,
          configuration: {
            apiKey: apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': referer,
              'X-OpenRouter-Title': 'Dialog Theme Maker',
            },
          },
          temperature: 0.1,
          streaming: true,
          timeout: LLM_TIMEOUT_MS,
          maxRetries: LLM_MAX_RETRIES,
          __includeRawResponse: true,
        });
        this._useApproximateTokenCount();
        break;
      }

      case 'custom':
        if (customEndpoint && customModel) {
          this.provider = new ChatOpenAI({
            modelName: customModel,
            openAIApiKey: apiKey,
            configuration: {
              apiKey: apiKey,
              baseURL: customEndpoint,
            },
            temperature: 0.1,
            streaming: true,
            timeout: LLM_TIMEOUT_MS,
            maxRetries: LLM_MAX_RETRIES,
            __includeRawResponse: true,
          });
          this._useApproximateTokenCount();
        }
        break;

      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }

    if (!this.provider) {
      throw new Error(`Failed to initialize LLM provider: ${provider}`);
    }

    console.log(`[LLMProvider] Initialized ${provider} with model ${model}`);
  }

  _useApproximateTokenCount() {
    if (!this.provider) {
      return;
    }

    this.provider.getNumTokens = async (content) => {
      const text = typeof content === 'string'
        ? content
        : (Array.isArray(content)
          ? content.map((item) => {
            if (typeof item === 'string') return item;
            if (item?.type === 'text' && 'text' in item) return item.text;
            return '';
          }).join('')
          : String(content ?? ''));

      return Math.ceil(text.length / 4);
    };
  }

  /**
   * Invoke LLM with messages (non-streaming).
   * Reasoning models may return JSON in reasoning_content instead of content.
   */
  async invoke(messages, options = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES + 1; attempt += 1) {
      try {
        const response = await this.provider.invoke(messages, options);
        return normalizeReasoningResponse(response);
      } catch (error) {
        lastError = error;

        if (isRetryableNetworkError(error) && attempt <= LLM_MAX_RETRIES) {
          console.warn(`[LLMProvider] Invoke retry ${attempt}/${LLM_MAX_RETRIES}:`, error.message);
          await sleep(1000 * attempt);
          continue;
        }

        console.error('[LLMProvider] Invoke error:', error);
        throw new Error(`LLM invoke failed: ${error.message}`);
      }
    }

    throw new Error(`LLM invoke failed: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Bind OpenAI-format tools for function calling.
   */
  bindTools(tools = []) {
    if (typeof this.provider.bindTools !== 'function') {
      throw new Error('Current LLM provider does not support tool calling');
    }

    return this.provider.bindTools(tools);
  }

  /**
   * Stream LLM response
   */
  async *stream(messages, options = {}) {
    try {
      const stream = await this.provider.stream(messages, options);

      for await (const chunk of stream) {
        yield normalizeReasoningChunk(chunk);
      }
    } catch (error) {
      console.error('[LLMProvider] Stream error:', error);
      throw new Error(`LLM stream failed: ${error.message}`);
    }
  }

  /**
   * Check if provider supports streaming
   */
  get supportsStreaming() {
    return this.provider && typeof this.provider.stream === 'function';
  }

  /**
   * Get provider info
   */
  getProviderInfo() {
    return {
      provider: this.config.provider,
      model: this.config.model,
      supports_streaming: this.supportsStreaming,
      initialized: !!this.provider
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this._initializeProvider();
  }

  /**
   * Test connection
   */
  async testConnection() {
    try {
      const testMessage = [{ role: 'user', content: 'Hi' }];
      const response = await this.invoke(testMessage);

      return {
        success: Boolean(response?.content),
        response: response.content,
        provider: this.config.provider
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: this.config.provider
      };
    }
  }
}

/**
 * Stream Handler for UI Integration
 */
export class StreamHandler {
  constructor(callbacks = {}) {
    this.onToken = callbacks.onToken || (() => {});
    this.onToolCall = callbacks.onToolCall || (() => {});
    this.onError = callbacks.onError || (() => {});
    this.onComplete = callbacks.onComplete || (() => {});
    this.onStart = callbacks.onStart || (() => {});
  }

  async handleStream(stream) {
    let fullContent = '';
    
    try {
      this.onStart();
      
      for await (const chunk of stream) {
        if (chunk.content) {
          const token = chunk.content;
          fullContent += token;
          this.onToken(token, fullContent);
        }

        // Handle tool calls if present
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          for (const toolCall of chunk.tool_calls) {
            this.onToolCall(toolCall.name, toolCall.args);
          }
        }
      }

      this.onComplete(fullContent);
      return fullContent;

    } catch (error) {
      this.onError(error);
      throw error;
    }
  }
}

/**
 * Factory function to create LLM provider from settings
 */
export function createLLMProvider(settings) {
  if (!settings?.llm) {
    throw new Error('LLM settings not provided');
  }

  const llmConfig = settings.llm;

  if (!llmConfig.api_key) {
    throw new Error('API key required for LLM provider');
  }

  const useCustomEndpoint = Boolean(llmConfig.use_custom_endpoint);

  const config = {
    provider: useCustomEndpoint ? 'custom' : llmConfig.provider,
    model: llmConfig.model,
    apiKey: llmConfig.api_key,
    customEndpoint: llmConfig.custom_endpoint,
    customModel: llmConfig.custom_model
  };

  return new LLMProvider(config);
}

/**
 * Get available LLM providers
 */
export function getAvailableProviders() {
  return [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        'gpt-4-turbo-preview',
        'gpt-4',
        'gpt-3.5-turbo'
      ],
      supports_streaming: true
    },
    {
      id: 'claude',
      name: 'Anthropic Claude',
      models: [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
      ],
      supports_streaming: true
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        'deepseek-coder',
        'deepseek-chat'
      ],
      supports_streaming: true
    },
    {
      id: 'custom',
      name: 'Custom OpenAI-Compatible',
      models: [],
      supports_streaming: true,
      requires_endpoint: true
    }
  ];
}

export default LLMProvider;