import { createAgentAbortError } from './abortSignal.js';

export const PREVIEW_BRIDGE_CHANNEL = 'dtm-preview-bridge';
export const PREVIEW_QUERY_PARAM = 'dtm_preview';

const SELECT_MODE_RETRY_MS = 120;
const SELECT_MODE_MAX_RETRIES = 25;

export function appendPreviewParam(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set(PREVIEW_QUERY_PARAM, '1');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function stripPreviewParam(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete(PREVIEW_QUERY_PARAM);
    const query = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * Parent-side postMessage bridge to the preview iframe.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export function createPreviewBridge(iframeRef, handlers) {
  const origin = window.location.origin;
  let messageListenerAttached = false;
  let bridgeReady = false;
  let pendingSelectMode = false;
  let selectRetryTimer = null;
  let selectRetryCount = 0;
  let requestCounter = 0;
  const pendingRequests = new Map();

  function getFrameWindow() {
    return iframeRef.value?.contentWindow ?? null;
  }

  function send(type, payload = {}) {
    getFrameWindow()?.postMessage(
      {
        channel: PREVIEW_BRIDGE_CHANNEL,
        type,
        payload,
      },
      origin,
    );
  }

  function settleRequest(requestId, success, result, error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    pendingRequests.delete(requestId);

    if (success) {
      pending.resolve(result);
      return;
    }

    pending.reject(new Error(error || 'Preview bridge request failed'));
  }

  function request(type, payload = {}, options = {}) {
    const timeoutMs = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const signal = options.signal;
    const requestId = `req-${Date.now()}-${requestCounter += 1}`;

    if (signal?.aborted) {
      return Promise.reject(createAgentAbortError());
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        window.clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const finish = (handler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        handler(value);
      };

      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        finish(reject, new Error(`Preview bridge request timed out (${type})`));
      }, timeoutMs);

      const onAbort = () => {
        pendingRequests.delete(requestId);
        finish(reject, createAgentAbortError());
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingRequests.set(requestId, {
        resolve: (result) => finish(resolve, result),
        reject: (error) => finish(reject, error),
      });

      send(type, { ...payload, requestId });
    });
  }

  function clearSelectRetry() {
    if (selectRetryTimer !== null) {
      window.clearInterval(selectRetryTimer);
      selectRetryTimer = null;
    }
    selectRetryCount = 0;
  }

  function scheduleSelectRetry() {
    clearSelectRetry();

    selectRetryTimer = window.setInterval(() => {
      if (bridgeReady || selectRetryCount >= SELECT_MODE_MAX_RETRIES) {
        clearSelectRetry();
        return;
      }

      send('set-select-mode', { active: pendingSelectMode });
      selectRetryCount += 1;
    }, SELECT_MODE_RETRY_MS);
  }

  function setSelectMode(active) {
    pendingSelectMode = !!active;
    send('set-select-mode', { active: pendingSelectMode });

    if (!bridgeReady) {
      scheduleSelectRetry();
    }
  }

  function onMessage(event) {
    if (event.origin !== origin) {
      return;
    }

    const data = event.data;
    if (!data || data.channel !== PREVIEW_BRIDGE_CHANNEL) {
      return;
    }

    if (data.type === 'bridge-ready') {
      bridgeReady = true;
      clearSelectRetry();
      send('set-select-mode', { active: pendingSelectMode });
      handlers.onBridgeReady?.();
    }

    if (data.type === 'element-picked') {
      handlers.onElementPicked?.(data.payload);
    }

    if (data.type === 'console-entry') {
      handlers.onConsoleEntry?.(data.payload);
    }

    if (data.type === 'network-entry') {
      handlers.onNetworkEntry?.(data.payload);
    }

    if (data.type === 'navigation') {
      handlers.onNavigation?.(data.payload);
    }

    if (data.type === 'navigation-start') {
      handlers.onNavigationStart?.(data.payload);
    }

    if (data.type === 'response') {
      const payload = data.payload || {};
      settleRequest(
        payload.requestId,
        !!payload.success,
        payload.result,
        payload.error,
      );
    }
  }

  function attach() {
    if (messageListenerAttached) {
      return;
    }

    messageListenerAttached = true;
    window.addEventListener('message', onMessage);
  }

  function detach() {
    if (!messageListenerAttached) {
      return;
    }

    messageListenerAttached = false;
    window.removeEventListener('message', onMessage);
    clearSelectRetry();
    setSelectMode(false);
    bridgeReady = false;

    pendingRequests.forEach((pending) => {
      pending.reject(new Error('Preview bridge detached'));
    });
    pendingRequests.clear();
  }

  function resetBridgeState() {
    bridgeReady = false;
    clearSelectRetry();
  }

  function isBridgeReady() {
    return bridgeReady;
  }

  return {
    attach,
    detach,
    send,
    request,
    setSelectMode,
    resetBridgeState,
    isBridgeReady,
  };
}
