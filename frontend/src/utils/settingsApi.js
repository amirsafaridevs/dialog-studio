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
          'X-OpenRouter-Title': 'Dialog Theme Maker',
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
