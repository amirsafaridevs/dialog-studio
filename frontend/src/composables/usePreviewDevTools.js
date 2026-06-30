import { computed, ref } from 'vue';

const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 300;

export function usePreviewDevTools() {
  const consoleEntries = ref([]);
  const networkMap = ref(new Map());
  const devtoolsOpen = ref(false);
  const activeTab = ref('console');

  const networkEntries = computed(() =>
    [...networkMap.value.values()].sort((a, b) => a.timestamp - b.timestamp),
  );

  const consoleErrorCount = computed(
    () => consoleEntries.value.filter((entry) => entry.level === 'error').length,
  );

  const networkErrorCount = computed(
    () =>
      networkEntries.value.filter(
        (entry) =>
          entry.status === 0 ||
          (typeof entry.status === 'number' && entry.status >= 400),
      ).length,
  );

  const issueCount = computed(() => consoleErrorCount.value + networkErrorCount.value);

  function addConsoleEntry(payload) {
    if (!payload) {
      return;
    }

    const message = payload.message?.trim()
      ? payload.message
      : payload.stack?.trim() || '(console output)';

    consoleEntries.value.push({
      id: payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level: payload.level || 'log',
      message,
      stack: payload.stack || null,
      pageUrl: payload.pageUrl || null,
      timestamp: payload.timestamp || Date.now(),
    });

    if (consoleEntries.value.length > MAX_CONSOLE_ENTRIES) {
      consoleEntries.value.splice(0, consoleEntries.value.length - MAX_CONSOLE_ENTRIES);
    }

    if (payload.level === 'error' && !devtoolsOpen.value) {
      devtoolsOpen.value = true;
      activeTab.value = 'console';
    }
  }

  function handleNetworkEvent(payload) {
    if (!payload?.id) {
      return;
    }

    const existing = networkMap.value.get(payload.id) || {};
    const merged = {
      id: payload.id,
      url: payload.url || existing.url || '',
      method: payload.method || existing.method || 'GET',
      type: payload.type || existing.type || 'fetch',
      status: payload.status ?? existing.status ?? null,
      statusText: payload.statusText ?? existing.statusText ?? '',
      duration: payload.duration ?? existing.duration ?? null,
      timestamp: existing.timestamp || payload.timestamp || Date.now(),
      pending: payload.phase === 'start',
    };

    if (payload.phase === 'complete' || payload.phase === 'error') {
      merged.pending = false;
    }

    networkMap.value.set(payload.id, merged);

    if (networkMap.value.size > MAX_NETWORK_ENTRIES) {
      const oldest = [...networkMap.value.keys()].slice(0, networkMap.value.size - MAX_NETWORK_ENTRIES);
      oldest.forEach((key) => networkMap.value.delete(key));
    }

    if (
      !devtoolsOpen.value &&
      (payload.phase === 'error' || (payload.status && payload.status >= 400))
    ) {
      devtoolsOpen.value = true;
      activeTab.value = 'network';
    }
  }

  function clearConsole() {
    consoleEntries.value = [];
  }

  function clearNetwork() {
    networkMap.value = new Map();
  }

  function reset() {
    clearConsole();
    clearNetwork();
  }

  function toggleDevtools() {
    devtoolsOpen.value = !devtoolsOpen.value;
  }

  return {
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
    reset,
    toggleDevtools,
  };
}
