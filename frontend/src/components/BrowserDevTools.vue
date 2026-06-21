<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { Trash2, X } from 'lucide-vue-next';

const props = defineProps({
  consoleEntries: {
    type: Array,
    default: () => [],
  },
  networkEntries: {
    type: Array,
    default: () => [],
  },
  activeTab: {
    type: String,
    default: 'console',
  },
  consoleErrorCount: {
    type: Number,
    default: 0,
  },
  networkErrorCount: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(['update:activeTab', 'clear-console', 'clear-network', 'close']);

const consoleListRef = ref(null);

const tabs = computed(() => [
  {
    id: 'console',
    label: 'Console',
    badge: props.consoleErrorCount || null,
    badgeVariant: 'error',
  },
  {
    id: 'network',
    label: 'Network',
    badge: props.networkErrorCount || null,
    badgeVariant: 'error',
  },
]);

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-GB', { hour12: false });
}

function formatDuration(duration) {
  if (duration === null || duration === undefined) {
    return '—';
  }
  if (duration < 1000) {
    return `${Math.round(duration)} ms`;
  }
  return `${(duration / 1000).toFixed(2)} s`;
}

function statusClass(status, pending) {
  if (pending) {
    return 'browser-devtools__status--pending';
  }
  if (status === 0 || status === null) {
    return 'browser-devtools__status--failed';
  }
  if (status >= 400) {
    return 'browser-devtools__status--failed';
  }
  if (status >= 300) {
    return 'browser-devtools__status--redirect';
  }
  return 'browser-devtools__status--ok';
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function formatConsoleText(entry) {
  const parts = [entry.message];

  if (entry.stack && entry.stack !== entry.message) {
    parts.push(entry.stack);
  }

  return parts.join('\n');
}

watch(
  () => props.consoleEntries.length,
  () => {
    nextTick(() => {
      const el = consoleListRef.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  },
);
</script>

<template>
  <section class="browser-devtools" dir="ltr">
    <header class="browser-devtools__header">
      <div class="browser-devtools__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="browser-devtools__tab"
          :class="{ 'browser-devtools__tab--active': activeTab === tab.id }"
          @click="emit('update:activeTab', tab.id)"
        >
          {{ tab.label }}
          <span
            v-if="tab.badge"
            class="browser-devtools__badge"
            :class="`browser-devtools__badge--${tab.badgeVariant}`"
          >
            {{ tab.badge }}
          </span>
        </button>
      </div>

      <div class="browser-devtools__actions">
        <button
          v-if="activeTab === 'console'"
          type="button"
          class="browser-devtools__action"
          title="Clear console"
          @click="emit('clear-console')"
        >
          <Trash2 :size="13" :stroke-width="1.75" />
        </button>
        <button
          v-else
          type="button"
          class="browser-devtools__action"
          title="Clear network"
          @click="emit('clear-network')"
        >
          <Trash2 :size="13" :stroke-width="1.75" />
        </button>
        <button
          type="button"
          class="browser-devtools__action"
          title="Close"
          @click="emit('close')"
        >
          <X :size="13" :stroke-width="1.75" />
        </button>
      </div>
    </header>

    <div v-if="activeTab === 'console'" ref="consoleListRef" class="browser-devtools__body">
      <p v-if="!consoleEntries.length" class="browser-devtools__empty">No console output yet.</p>
      <div
        v-for="entry in consoleEntries"
        :key="entry.id"
        class="browser-devtools__console-row"
        :class="`browser-devtools__console-row--${entry.level}`"
      >
        <span class="browser-devtools__time">{{ formatTime(entry.timestamp) }}</span>
        <span class="browser-devtools__level">{{ entry.level }}</span>
        <pre class="browser-devtools__message">{{ formatConsoleText(entry) }}</pre>
      </div>
    </div>

    <div v-else class="browser-devtools__body browser-devtools__body--network">
      <p v-if="!networkEntries.length" class="browser-devtools__empty">No network activity yet.</p>
      <div
        v-for="entry in networkEntries"
        :key="entry.id"
        class="browser-devtools__network-row"
        :title="entry.url"
      >
        <span
          class="browser-devtools__status"
          :class="statusClass(entry.status, entry.pending)"
        >
          {{ entry.pending ? '…' : entry.status ?? 'ERR' }}
        </span>
        <span class="browser-devtools__method">{{ entry.method }}</span>
        <span class="browser-devtools__url">{{ shortUrl(entry.url) }}</span>
        <span class="browser-devtools__type">{{ entry.type }}</span>
        <span class="browser-devtools__duration">{{ formatDuration(entry.duration) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.browser-devtools {
  display: flex;
  flex-direction: column;
  height: 220px;
  min-height: 160px;
  background: #0d0d0d;
  border-top: 1px solid var(--dtm-border-subtle);
}

.browser-devtools__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dtm-space-2);
  padding: 0 var(--dtm-space-3);
  min-height: 34px;
  background: var(--dtm-bg-surface);
  border-bottom: 1px solid var(--dtm-border-subtle);
}

.browser-devtools__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

.browser-devtools__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--dtm-radius-sm);
  color: var(--dtm-text-muted);
  font-size: 12px;
  transition: background var(--dtm-transition), color var(--dtm-transition);
}

.browser-devtools__tab:hover {
  color: var(--dtm-text-secondary);
  background: var(--dtm-hover-bg);
}

.browser-devtools__tab--active {
  color: var(--dtm-text-primary);
  background: var(--dtm-hover-bg);
}

.browser-devtools__badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.browser-devtools__badge--error {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.browser-devtools__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.browser-devtools__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--dtm-radius-sm);
  color: var(--dtm-text-muted);
  transition: background var(--dtm-transition), color var(--dtm-transition);
}

.browser-devtools__action:hover {
  background: var(--dtm-hover-bg);
  color: var(--dtm-text-secondary);
}

.browser-devtools__body {
  flex: 1;
  overflow: auto;
  padding: var(--dtm-space-2) 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.browser-devtools__empty {
  padding: var(--dtm-space-4);
  color: var(--dtm-text-muted);
  font-family: var(--dtm-font);
  font-size: 12px;
  text-align: center;
}

.browser-devtools__console-row {
  display: grid;
  grid-template-columns: 72px 52px 1fr;
  gap: var(--dtm-space-2);
  padding: 4px var(--dtm-space-3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.browser-devtools__console-row--error {
  background: rgba(239, 68, 68, 0.08);
}

.browser-devtools__console-row--warn {
  background: rgba(245, 158, 11, 0.08);
}

.browser-devtools__time,
.browser-devtools__level {
  color: var(--dtm-text-muted);
  text-transform: lowercase;
}

.browser-devtools__level {
  font-weight: 600;
}

.browser-devtools__console-row--error .browser-devtools__level {
  color: #fca5a5;
}

.browser-devtools__console-row--warn .browser-devtools__level {
  color: #fcd34d;
}

.browser-devtools__message {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dtm-text-secondary);
}

.browser-devtools__network-row {
  display: grid;
  grid-template-columns: 44px 52px 1fr 56px 64px;
  gap: var(--dtm-space-2);
  align-items: center;
  padding: 4px var(--dtm-space-3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.browser-devtools__status {
  font-weight: 600;
  text-align: center;
}

.browser-devtools__status--ok {
  color: #86efac;
}

.browser-devtools__status--redirect {
  color: #fcd34d;
}

.browser-devtools__status--failed {
  color: #fca5a5;
}

.browser-devtools__status--pending {
  color: var(--dtm-text-muted);
}

.browser-devtools__method,
.browser-devtools__type,
.browser-devtools__duration {
  color: var(--dtm-text-muted);
  text-transform: uppercase;
}

.browser-devtools__url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dtm-text-secondary);
}

.browser-devtools__duration {
  text-align: right;
  text-transform: none;
}
</style>
