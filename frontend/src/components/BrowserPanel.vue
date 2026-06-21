<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Lock,
  ExternalLink,
  Globe,
  SquareMousePointer,
  PanelBottom,
} from 'lucide-vue-next';
import PanelLoading from './PanelLoading.vue';
import BrowserDevTools from './BrowserDevTools.vue';
import { useElementPicker } from '../composables/useElementPicker.js';
import { usePreviewDevTools } from '../composables/usePreviewDevTools.js';
import { appendPreviewParam, createPreviewBridge, PREVIEW_QUERY_PARAM, stripPreviewParam } from '../utils/previewBridge.js';
import { createAgentAbortError } from '../utils/abortSignal.js';
import { PreviewLoadError } from '../utils/previewLoadError.js';
import { registerPreviewController, unregisterPreviewController } from '../utils/previewController.js';

function getSiteHomeUrl() {
  const { origin, pathname } = window.location;
  const basePath = pathname.replace(/\/DialogStudio\/.*$/i, '');
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return appendPreviewParam(`${origin}${normalizedBase}`);
}

const previewUrl = ref(getSiteHomeUrl());
const iframeSrc = ref(getSiteHomeUrl());
const iframeKey = ref(0);
const isLoading = ref(true);
const iframeRef = ref(null);
const lastPreviewUrl = ref('');

const { isSelectMode, toggleSelectMode, addPickedElement } = useElementPicker();
const {
  consoleEntries,
  networkEntries,
  devtoolsOpen,
  activeTab,
  consoleErrorCount,
  networkErrorCount,
  issueCount,
  addConsoleEntry,
  handleNetworkEvent,
  clearConsole,
  clearNetwork,
  reset: resetDevTools,
  toggleDevtools,
} = usePreviewDevTools();

const isRefreshing = computed(() => isLoading.value && iframeKey.value > 0);

let loadWaiters = [];
let iframeLoadedAt = 0;
let bridgeGraceTimer = null;

const PREVIEW_LOAD_TIMEOUT_MS = 60_000;
const BRIDGE_READY_GRACE_MS = 15_000;

function clearBridgeGraceTimer() {
  if (bridgeGraceTimer !== null) {
    window.clearTimeout(bridgeGraceTimer);
    bridgeGraceTimer = null;
  }
}

function probeIframeDiagnostics() {
  try {
    const frame = iframeRef.value;
    const doc = frame?.contentDocument;
    const href = frame?.contentWindow?.location?.href || previewUrl.value;

    if (!doc) {
      return {
        url: href,
        crossOrigin: true,
      };
    }

    return {
      url: href,
      title: doc.title || '',
      readyState: doc.readyState,
      previewParamPresent: href.includes(`${PREVIEW_QUERY_PARAM}=1`),
      bridgeScriptPresent: Boolean(doc.getElementById('dtm-preview-bridge-js')),
      bodySnippet: (doc.body?.innerText || '').trim().slice(0, 300),
    };
  } catch {
    return {
      url: previewUrl.value,
      crossOrigin: true,
    };
  }
}

function getRecentConsoleErrors(limit = 5) {
  return consoleEntries.value
    .filter((entry) => entry.level === 'error')
    .slice(-limit)
    .map((entry) => entry.message);
}

function getRecentNetworkFailures(limit = 5) {
  return networkEntries.value
    .filter(
      (entry) =>
        entry.status === 0 ||
        (typeof entry.status === 'number' && entry.status >= 400),
    )
    .slice(-limit)
    .map((entry) => ({
      url: entry.url,
      status: entry.status,
      method: entry.method,
    }));
}

function buildPreviewFailureReason(reason) {
  const diagnostics = probeIframeDiagnostics();
  const consoleErrors = getRecentConsoleErrors();
  const networkFailures = getRecentNetworkFailures();
  const hints = [];

  if (diagnostics.crossOrigin) {
    hints.push('Preview iframe is cross-origin; the bridge cannot attach.');
  } else if (!diagnostics.previewParamPresent) {
    hints.push('Missing dtm_preview=1 query param — preview bridge script was not requested.');
  } else if (!diagnostics.bridgeScriptPresent) {
    hints.push('Page loaded but dtm-preview-bridge.js is missing (PHP fatal error, incomplete HTML, or plugin hook did not run).');
  } else if (consoleErrors.length) {
    hints.push('JavaScript errors on the page may have prevented the preview bridge from initializing.');
  } else {
    hints.push('Page rendered but bridge-ready was never received (slow/hanging assets or a broken theme bootstrap).');
  }

  return new PreviewLoadError(reason, {
    url: diagnostics.url || previewUrl.value,
    bridgeReady: previewBridge.isBridgeReady(),
    diagnostics,
    consoleErrors,
    networkFailures,
    hints,
  });
}

function scheduleBridgeGraceCheck() {
  clearBridgeGraceTimer();

  if (previewBridge.isBridgeReady()) {
    return;
  }

  bridgeGraceTimer = window.setTimeout(() => {
    bridgeGraceTimer = null;

    if (previewBridge.isBridgeReady() || !iframeLoadedAt) {
      return;
    }

    isLoading.value = false;
    rejectLoadWaiters(buildPreviewFailureReason('Preview bridge did not become ready after the page loaded'));
  }, BRIDGE_READY_GRACE_MS);
}

function resolveLoadWaiters() {
  clearBridgeGraceTimer();
  const waiters = loadWaiters;
  loadWaiters = [];
  waiters.forEach((waiter) => waiter.resolve());
}

function rejectLoadWaiters(error) {
  clearBridgeGraceTimer();
  const waiters = loadWaiters;
  loadWaiters = [];
  waiters.forEach((waiter) => waiter.reject(error));
}

function waitForPreviewLoad(timeoutMs = PREVIEW_LOAD_TIMEOUT_MS, signal = null) {
  if (signal?.aborted) {
    return Promise.reject(createAgentAbortError());
  }

  if (!isLoading.value && previewBridge.isBridgeReady()) {
    return Promise.resolve();
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
      loadWaiters = loadWaiters.filter((waiter) => waiter !== entry);
      finish(reject, buildPreviewFailureReason('Preview load timed out'));
    }, timeoutMs);

    const onAbort = () => {
      loadWaiters = loadWaiters.filter((waiter) => waiter !== entry);
      finish(reject, createAgentAbortError());
    };

    const entry = {
      resolve: () => finish(resolve),
      reject: (error) => finish(reject, error),
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    loadWaiters.push(entry);
  });
}

function resolvePreviewUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    throw new Error('URL is required');
  }

  if (/^https?:\/\//i.test(raw)) {
    return appendPreviewParam(raw);
  }

  const { origin, pathname } = window.location;
  const basePath = pathname.replace(/\/DialogStudio\/.*$/i, '');
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const path = raw.startsWith('/') ? raw.slice(1) : raw;
  return appendPreviewParam(`${origin}${normalizedBase}${path}`);
}

function navigatePreview(url) {
  const target = resolvePreviewUrl(url);
  previewBridge.setSelectMode(false);
  lastPreviewUrl.value = '';
  iframeLoadedAt = 0;
  clearBridgeGraceTimer();
  isLoading.value = true;
  previewUrl.value = stripPreviewParam(target);
  iframeKey.value += 1;
  iframeSrc.value = target;
}

async function navigatePreviewAndWait(url, options = {}) {
  navigatePreview(url);
  await waitForPreviewLoad(options.timeout, options.signal);
  return {
    success: true,
    data: {
      url: previewUrl.value,
    },
  };
}

async function reloadPreview(options = {}) {
  refresh();
  await waitForPreviewLoad(options.timeout, options.signal);
  return {
    success: true,
    data: {
      url: previewUrl.value,
    },
  };
}

async function getPreviewHtml(args = {}, options = {}) {
  const timeoutMs = options.timeout ?? PREVIEW_LOAD_TIMEOUT_MS;

  await waitForPreviewLoad(timeoutMs, options.signal);

  if (!previewBridge.isBridgeReady()) {
    throw buildPreviewFailureReason('Preview bridge is not ready — iframe page may still be loading or failed to render');
  }

  const result = await previewBridge.request(
    'get-html',
    {
      selector: args.selector,
      dom_path: args.dom_path,
    },
    { timeout: timeoutMs, signal: options.signal },
  );

  return {
    success: true,
    data: result,
  };
}

const previewBridge = createPreviewBridge(iframeRef, {
  onBridgeReady() {
    isLoading.value = false;
    if (isSelectMode.value) {
      previewBridge.setSelectMode(true);
    }
    resolveLoadWaiters();
  },
  onElementPicked(payload) {
    if (!payload?.domPath) {
      return;
    }

    addPickedElement({
      tagName: payload.tagName,
      label: payload.label,
      domPath: payload.domPath,
    });
  },
  onConsoleEntry(payload) {
    addConsoleEntry(payload);
  },
  onNetworkEntry(payload) {
    handleNetworkEvent(payload);
  },
  onNavigation(payload) {
    if (payload?.url) {
      handlePreviewNavigation(payload.url);
    }
  },
  onNavigationStart() {
    startNavigationLoading();
  },
});

function readIframeLocation() {
  try {
    const href = iframeRef.value?.contentWindow?.location?.href;
    if (href && href !== 'about:blank') {
      return href;
    }
  } catch {
    // Cross-origin navigation — cannot read location.
  }
  return null;
}

function handlePreviewNavigation(url) {
  const normalized = url.split('#')[0];

  if (normalized && normalized === lastPreviewUrl.value) {
    return;
  }

  lastPreviewUrl.value = normalized;
  previewUrl.value = stripPreviewParam(url);
}

function startNavigationLoading() {
  iframeLoadedAt = 0;
  clearBridgeGraceTimer();
  isLoading.value = true;
}

function ensurePreviewParamInIframe() {
  const href = readIframeLocation();
  if (!href || href.includes(`${PREVIEW_QUERY_PARAM}=1`)) {
    return href;
  }

  try {
    startNavigationLoading();
    iframeRef.value?.contentWindow?.location.replace(appendPreviewParam(href));
  } catch {
    // Ignore replace failures.
  }

  return null;
}

function syncSelectMode() {
  previewBridge.setSelectMode(isSelectMode.value);
}

function onIframeLoad() {
  iframeLoadedAt = Date.now();
  const href = ensurePreviewParamInIframe() ?? readIframeLocation();
  if (href) {
    handlePreviewNavigation(href);
  }

  if (!previewBridge.isBridgeReady()) {
    isLoading.value = true;
    scheduleBridgeGraceCheck();
  }

  nextTick(syncSelectMode);
}

function onIframeError() {
  isLoading.value = false;
  rejectLoadWaiters(new Error('Preview iframe failed to load'));
}

function refresh() {
  previewBridge.setSelectMode(false);
  resetDevTools();
  lastPreviewUrl.value = '';
  iframeLoadedAt = 0;
  clearBridgeGraceTimer();
  isLoading.value = true;
  iframeKey.value += 1;
  iframeSrc.value = appendPreviewParam(previewUrl.value);
}

function openExternal() {
  const target = lastPreviewUrl.value || appendPreviewParam(previewUrl.value);
  window.open(target, '_blank', 'noopener,noreferrer');
}

watch(isSelectMode, () => {
  syncSelectMode();
});

watch(iframeKey, () => {
  previewBridge.resetBridgeState();
});

onMounted(() => {
  previewBridge.attach();
  registerPreviewController({
    navigate: navigatePreviewAndWait,
    reload: reloadPreview,
    getHtml: getPreviewHtml,
    getCurrentUrl: () => previewUrl.value,
    isBridgeReady: () => previewBridge.isBridgeReady(),
  });
});

onUnmounted(() => {
  previewBridge.detach();
  unregisterPreviewController();
  clearBridgeGraceTimer();
  rejectLoadWaiters(new Error('Preview browser unmounted'));
});
</script>

<template>
  <section class="browser" dir="ltr">
    <header class="browser__toolbar">
      <div class="browser__nav">
        <button type="button" class="browser__icon-btn" title="عقب" disabled>
          <ArrowLeft :size="15" :stroke-width="1.75" />
        </button>
        <button type="button" class="browser__icon-btn" title="جلو" disabled>
          <ArrowRight :size="15" :stroke-width="1.75" />
        </button>
        <button
          type="button"
          class="browser__icon-btn"
          title="بارگذاری مجدد"
          :class="{ 'browser__icon-btn--spin': isRefreshing }"
          @click="refresh"
        >
          <RotateCw :size="15" :stroke-width="1.75" />
        </button>
      </div>

      <div class="browser__address">
        <Lock :size="13" :stroke-width="1.75" class="browser__address-lock" />
        <Globe :size="13" :stroke-width="1.75" class="browser__address-icon" />
        <input
          v-model="previewUrl"
          type="text"
          class="browser__address-input"
          readonly
          dir="ltr"
          aria-label="آدرس پیش‌نمایش"
        />
        <button
          type="button"
          class="browser__icon-btn browser__icon-btn--ghost"
          title="باز کردن در تب جدید"
          @click="openExternal"
        >
          <ExternalLink :size="14" :stroke-width="1.75" />
        </button>
      </div>

      <button
        type="button"
        class="browser__icon-btn browser__icon-btn--devtools"
        :class="{ 'browser__icon-btn--devtools-active': devtoolsOpen }"
        title="Console & Network"
        :aria-pressed="devtoolsOpen"
        @click="toggleDevtools"
      >
        <PanelBottom :size="15" :stroke-width="1.75" />
        <span v-if="issueCount" class="browser__devtools-badge">{{ issueCount }}</span>
      </button>

      <button
        type="button"
        class="browser__icon-btn browser__icon-btn--select"
        :class="{ 'browser__icon-btn--select-active': isSelectMode }"
        :title="isSelectMode ? 'خروج از حالت انتخاب المنت' : 'انتخاب المنت'"
        :aria-pressed="isSelectMode"
        @click="toggleSelectMode"
      >
        <SquareMousePointer :size="15" :stroke-width="1.75" />
      </button>
    </header>

    <div class="browser__main">
      <div
        class="browser__viewport"
        :class="{ 'browser__viewport--select': isSelectMode }"
      >
        <PanelLoading v-if="isLoading" variant="browser" />
        <iframe
          ref="iframeRef"
          :key="iframeKey"
          :src="iframeSrc"
          class="browser__frame"
          title="پیش‌نمایش سایت"
          @load="onIframeLoad"
          @error="onIframeError"
        />
      </div>

      <BrowserDevTools
        v-if="devtoolsOpen"
        :console-entries="consoleEntries"
        :network-entries="networkEntries"
        :active-tab="activeTab"
        :console-error-count="consoleErrorCount"
        :network-error-count="networkErrorCount"
        @update:active-tab="activeTab = $event"
        @clear-console="clearConsole"
        @clear-network="clearNetwork"
        @close="devtoolsOpen = false"
      />
    </div>
  </section>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--dtm-bg-secondary);
  border-right: 1px solid var(--dtm-border-subtle);
}

.browser__toolbar {
  display: flex;
  align-items: center;
  gap: var(--dtm-space-3);
  padding: var(--dtm-space-3) var(--dtm-space-4);
  background: var(--dtm-bg-surface);
  border-bottom: 1px solid var(--dtm-border-subtle);
  min-height: 52px;
}

.browser__nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.browser__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--dtm-radius-sm);
  color: var(--dtm-text-secondary);
  transition: background var(--dtm-transition), color var(--dtm-transition);
  position: relative;
}

.browser__icon-btn:hover:not(:disabled) {
  background: var(--dtm-hover-bg);
  color: var(--dtm-text-primary);
}

.browser__icon-btn--spin :deep(svg) {
  animation: spin 0.6s linear;
}

.browser__icon-btn--ghost {
  opacity: 0.6;
}

.browser__icon-btn--devtools-active {
  background: var(--dtm-hover-bg);
  color: var(--dtm-text-primary);
}

.browser__devtools-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ef4444;
  color: #ffffff;
  font-size: 9px;
  line-height: 14px;
  font-weight: 600;
}

.browser__icon-btn--select {
  flex-shrink: 0;
  color: #ffffff;
}

.browser__icon-btn--select:hover {
  background: var(--dtm-hover-bg);
  color: #ffffff;
}

.browser__icon-btn--select-active {
  background: #2563eb;
  color: #ffffff;
}

.browser__icon-btn--select-active:hover {
  background: #1d4ed8;
  color: #ffffff;
}

.browser__address {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--dtm-space-2);
  min-width: 0;
  padding: 0 var(--dtm-space-3);
  height: 34px;
  background: var(--dtm-bg-elevated);
  border: 1px solid var(--dtm-border-subtle);
  border-radius: var(--dtm-radius-md);
}

.browser__address-lock,
.browser__address-icon {
  flex-shrink: 0;
  color: var(--dtm-text-muted);
}

.browser__address-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--dtm-text-secondary);
  font-size: 13px;
  outline: none;
  text-align: left;
}

.browser__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.browser__viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #080808;
  min-height: 0;
}

.browser__viewport--select {
  cursor: crosshair;
}

.browser__frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
