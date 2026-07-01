/**
 * OpenAI Agents SDK runtime — configures @openai/agents to run in the browser
 * against the wpagentify LiteLLM proxy (OpenAI-compatible, Chat Completions API).
 *
 * The SDK is normally server-side. To make it work in the browser we:
 *   - build an `openai` client with `dangerouslyAllowBrowser: true`, pointed at
 *     the wpagentify proxy (same baseURL/apiKey the LLMProvider already uses);
 *   - register it as the SDK's default client via setDefaultOpenAIClient();
 *   - force the Chat Completions API (the proxy is chat-completions compatible,
 *     not the OpenAI Responses API);
 *   - disable tracing (it is off by default in browsers, but we make it explicit
 *     so nothing tries to phone home to api.openai.com).
 *
 * Configuration is process-wide, so we run it once per (baseURL, apiKey) pair.
 */

import { OpenAI } from 'openai';
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from '@openai/agents';

// Same proxy the LLMProvider routes through.
const WPAGENTIFY_BASE_URL = 'https://www.api.wpagentify.ir';

let configuredKey = null;

/**
 * Configure the Agents SDK to use the wpagentify proxy. Idempotent: only
 * re-runs when the api key changes (e.g. the user updated their settings).
 *
 * @param {{ apiKey: string }} config
 */
export function configureAgentsRuntime({ apiKey }) {
  if (!apiKey) {
    throw new Error('کلید API وارد نشده است. لطفاً از تنظیمات کلید API خود را وارد کنید.');
  }

  if (configuredKey === apiKey) {
    return;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: WPAGENTIFY_BASE_URL,
    dangerouslyAllowBrowser: true,
  });

  setDefaultOpenAIClient(client);
  setOpenAIAPI('chat_completions');
  setTracingDisabled(true);

  configuredKey = apiKey;
  console.log('[agentsRuntime] Configured @openai/agents via wpagentify proxy');
}

export { WPAGENTIFY_BASE_URL };
