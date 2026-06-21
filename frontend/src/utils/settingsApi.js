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
