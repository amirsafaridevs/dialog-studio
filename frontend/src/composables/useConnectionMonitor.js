/**
 * Monitor browser network status and WordPress API reachability.
 * Informational only — never aborts agent runs.
 */

import { computed, onMounted, onUnmounted, ref, unref, watch } from 'vue';
import ApiClient from '../utils/apiClient.js';

const CHECK_INTERVAL_MS = 45_000;
const HEALTH_CHECK_TIMEOUT_MS = 8_000;
const API_FAILURE_THRESHOLD = 3;

export function useConnectionMonitor(options = {}) {
  const isBrowserOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const apiHealthy = ref(true);
  const consecutiveApiFailures = ref(0);
  let intervalId = null;
  let apiClient = null;

  const isPaused = computed(() => Boolean(unref(options.isBusy)));

  const status = computed(() => {
    if (!isBrowserOnline.value) {
      return 'offline';
    }

    if (!apiHealthy.value) {
      return 'api-down';
    }

    return 'ok';
  });

  const statusLabel = computed(() => {
    switch (status.value) {
      case 'offline':
        return 'اتصال اینترنت قطع است';
      case 'api-down':
        return 'ارتباط با سرور برقرار نیست';
      default:
        return '';
    }
  });

  const hasIssue = computed(() => status.value !== 'ok');

  async function checkApiHealth() {
    if (isPaused.value) {
      return apiHealthy.value;
    }

    if (!isBrowserOnline.value) {
      return false;
    }

    try {
      if (!apiClient) {
        apiClient = new ApiClient();
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const result = await apiClient.healthCheck({ signal: controller.signal });
        if (result.healthy === true) {
          consecutiveApiFailures.value = 0;
          apiHealthy.value = true;
          return true;
        }

        consecutiveApiFailures.value += 1;
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        // Slow server during heavy work — do not treat a single slow ping as outage.
        return apiHealthy.value;
      }

      consecutiveApiFailures.value += 1;
    }

    if (consecutiveApiFailures.value >= API_FAILURE_THRESHOLD) {
      apiHealthy.value = false;
      return false;
    }

    return apiHealthy.value;
  }

  function handleOnline() {
    isBrowserOnline.value = true;
    consecutiveApiFailures.value = 0;
    checkApiHealth();
  }

  function handleOffline() {
    isBrowserOnline.value = false;
    apiHealthy.value = false;
  }

  function startMonitoring() {
    checkApiHealth();
    intervalId = window.setInterval(checkApiHealth, CHECK_INTERVAL_MS);
  }

  function stopMonitoring() {
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  if (options.isBusy) {
    watch(
      () => unref(options.isBusy),
      (busy, wasBusy) => {
        if (wasBusy && !busy) {
          consecutiveApiFailures.value = 0;
          checkApiHealth();
        }
      },
    );
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    startMonitoring();
  });

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    stopMonitoring();
  });

  return {
    status,
    statusLabel,
    hasIssue,
    isBrowserOnline,
    apiHealthy,
    checkApiHealth,
  };
}

export default useConnectionMonitor;
