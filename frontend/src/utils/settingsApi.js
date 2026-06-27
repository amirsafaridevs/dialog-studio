import { getDtmConfig } from './dtmConfig.js';

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload.data;
}

export async function fetchSettings() {
  const { apiBase } = getDtmConfig();

  const response = await fetch(`${apiBase}/settings`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  return parseResponse(response);
}

export async function fetchAgentSettings() {
  const { apiBase, settingsNonce } = getDtmConfig();

  const response = await fetch(`${apiBase}/settings/agent`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-DTM-Nonce': settingsNonce,
    },
  });

  return parseResponse(response);
}

export async function fetchOpenRouterModels(apiKey = '') {
  const isMasked = apiKey.includes('•') || apiKey === '';
  if (!isMasked) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
          'X-OpenRouter-Title': 'Dialog Studio',
          'Accept': 'application/json',
        },
      });
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload?.data)) {
          const models = payload.data.map(model => ({
            id: model.id,
            label: model.name || model.id
          }));
          return { models };
        }
      }
    } catch (e) {
      console.error('Failed to fetch directly from OpenRouter, falling back to backend proxy:', e);
    }
  }

  const { apiBase, settingsNonce } = getDtmConfig();

  const response = await fetch(`${apiBase}/settings/openrouter-models`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-DTM-Nonce': settingsNonce,
    },
    body: JSON.stringify({
      api_key: apiKey,
    }),
  });

  return parseResponse(response);
}

export async function fetchWpagentifyKeyInfo(apiKey = '') {
  const isMasked = !apiKey || apiKey.includes('•');
  if (isMasked) return null;

  const response = await fetch('https://www.api.wpagentify.ir/key/info', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 401) {
    throw new Error('auth_error');
  }

  if (response.status === 429) {
    throw new Error('budget_exceeded');
  }

  if (!response.ok) {
    throw new Error(`request_failed_${response.status}`);
  }

  const payload = await response.json();
  return payload?.info ?? payload ?? null;
}

export async function fetchWpagentifyModels(apiKey = '') {
  const isMasked = !apiKey || apiKey.includes('•');
  if (isMasked) return null;

  try {
    const response = await fetch('https://www.api.wpagentify.ir/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];

    return data.map((m) => ({
      id: m.id,
      label: m.id,
      group: deriveGroup(m.id),
    }));
  } catch {
    return null;
  }
}

function deriveGroup(modelId = '') {
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt') || id.includes('openai')) return 'OpenAI';
  if (id.startsWith('claude') || id.includes('anthropic')) return 'Claude';
  if (id.startsWith('gemini') || id.includes('google')) return 'Gemini';
  if (id.startsWith('deepseek')) return 'DeepSeek';
  if (id.startsWith('qwen')) return 'Qwen';
  if (id.startsWith('grok') || id.includes('xai')) return 'xAI';
  if (id.startsWith('llama') || id.includes('meta')) return 'Meta';
  if (id.startsWith('mistral')) return 'Mistral';
  return 'Other';
}

export async function activateApiKey(apiKey) {
  const { apiBase, settingsNonce } = getDtmConfig();

  const response = await fetch(`${apiBase}/settings/activate-key`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-DTM-Nonce': settingsNonce,
    },
    body: JSON.stringify({ api_key: apiKey }),
  });

  return parseResponse(response);
}

export async function saveSettings(settings) {
  const { apiBase, settingsNonce } = getDtmConfig();

  const response = await fetch(`${apiBase}/settings`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-DTM-Nonce': settingsNonce,
    },
    body: JSON.stringify(settings),
  });

  return parseResponse(response);
}
