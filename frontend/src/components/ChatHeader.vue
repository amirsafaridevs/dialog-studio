<script setup>
import { ArrowRight, FileText, History, Plus, Settings } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';

function cleanTitle(title) {
  if (!title) return title;
  return title.replace(/<Dialog:element\b[\s\S]*?<\/Dialog:element>/g, '').trim();
}

const props = defineProps({
  history: {
    type: Array,
    default: () => [],
  },
  activeChatId: {
    type: [String, null],
    default: null,
  },
  settingsOpen: {
    type: Boolean,
    default: false,
  },
  promptOpen: {
    type: Boolean,
    default: false,
  },
  isRunning: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'new-chat',
  'select-chat',
  'toggle-settings',
  'close-settings',
  'toggle-prompt',
  'close-prompt',
]);

const isHistoryOpen = ref(false);
const historyRef = ref(null);

const panelOpen = computed(() => props.settingsOpen || props.promptOpen);

function toggleHistory() {
  isHistoryOpen.value = !isHistoryOpen.value;
}

function selectChat(id) {
  emit('select-chat', id);
  isHistoryOpen.value = false;
}

function handleNewChatClick() {
  emit('new-chat');
}

function handleClosePanel() {
  if (props.settingsOpen) {
    emit('close-settings');
  }
  if (props.promptOpen) {
    emit('close-prompt');
  }
}

function onDocumentClick(event) {
  if (!historyRef.value?.contains(event.target)) {
    isHistoryOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<template>
  <header class="chat-header" :class="{ 'chat-header--settings': panelOpen }">
    <button
      v-if="panelOpen"
      type="button"
      class="chat-header__btn chat-header__back"
      title="بازگشت به چت"
      @click="handleClosePanel"
    >
      <ArrowRight :size="15" :stroke-width="1.75" />
    </button>

    <div class="chat-header__actions">
      <div ref="historyRef" class="chat-header__history">
        <button
          type="button"
          class="chat-header__btn"
          :class="{ 'chat-header__btn--active': isHistoryOpen }"
          :disabled="isRunning"
          title="تاریخچه گفتگوها"
          @click.stop="toggleHistory"
        >
          <History :size="15" :stroke-width="1.75" />
        </button>

        <Transition name="chat-header-dropdown">
          <div v-if="isHistoryOpen" class="chat-header__dropdown">
            <ul v-if="history.length" class="chat-header__dropdown-list">
              <li v-for="item in history" :key="item.id">
                <button
                  type="button"
                  class="chat-header__dropdown-item"
                  :class="{ 'chat-header__dropdown-item--active': item.id === activeChatId }"
                  @click="selectChat(item.id)"
                >
                  <span
                    class="chat-header__dropdown-indicator"
                    :class="{ 'chat-header__dropdown-indicator--active': item.id === activeChatId }"
                    aria-hidden="true"
                  />
                  <span class="chat-header__dropdown-item-title">{{ cleanTitle(item.title) }}</span>
                  <span class="chat-header__dropdown-item-time">{{ item.updatedAt }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="chat-header__dropdown-empty">گفتگویی ثبت نشده است.</p>
          </div>
        </Transition>
      </div>

      <button
        type="button"
        class="chat-header__btn"
        :disabled="isRunning"
        title="گفتگوی جدید"
        @click="handleNewChatClick"
      >
        <Plus :size="15" :stroke-width="1.75" />
      </button>
      <button
        v-if="!panelOpen"
        type="button"
        class="chat-header__btn"
        :disabled="isRunning"
        title="پرامپت اختصاصی"
        @click="emit('toggle-prompt')"
      >
        <FileText :size="15" :stroke-width="1.75" />
      </button>
      <button
        v-if="!panelOpen"
        type="button"
        class="chat-header__btn"
        :disabled="isRunning"
        title="تنظیمات"
        @click="emit('toggle-settings')"
      >
        <Settings :size="15" :stroke-width="1.75" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex-shrink: 0;
  padding: var(--dtm-space-2) var(--dtm-space-3);
  min-height: 36px;
}

.chat-header--settings {
  justify-content: space-between;
}

.chat-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-header__back {
  margin-inline-end: auto;
}

.chat-header__history {
  position: relative;
}

.chat-header__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--dtm-radius-sm);
  color: var(--dtm-text-muted);
  transition: background var(--dtm-transition), color var(--dtm-transition);
}

.chat-header__btn:hover:not(:disabled),
.chat-header__btn--active {
  background: var(--dtm-hover-bg);
  color: var(--dtm-text-primary);
}

.chat-header__btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.chat-header__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: 248px;
  padding: 5px;
  border-radius: var(--dtm-radius-lg);
  border: 1px solid var(--dtm-border-default);
  background: rgba(18, 18, 18, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.18),
    0 16px 40px rgba(0, 0, 0, 0.42);
  transform-origin: top right;
}

.chat-header-dropdown-enter-active,
.chat-header-dropdown-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-header-dropdown-enter-from,
.chat-header-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}

.chat-header__dropdown-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}

.chat-header__dropdown-list::-webkit-scrollbar {
  width: 4px;
}

.chat-header__dropdown-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
}

.chat-header__dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dtm-radius-sm);
  text-align: right;
  color: var(--dtm-text-secondary);
  transition:
    background var(--dtm-transition),
    color var(--dtm-transition);
}

.chat-header__dropdown-item:hover {
  background: var(--dtm-hover-bg);
  color: var(--dtm-text-primary);
}

.chat-header__dropdown-item--active {
  background: rgba(80, 200, 121, 0.08);
  color: var(--dtm-text-primary);
}

.chat-header__dropdown-indicator {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
  transition: background var(--dtm-transition), box-shadow var(--dtm-transition);
}

.chat-header__dropdown-indicator--active {
  background: var(--dtm-accent);
  box-shadow: 0 0 6px rgba(80, 200, 121, 0.45);
}

.chat-header__dropdown-item-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-header__dropdown-item-time {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.01em;
  color: var(--dtm-text-disabled);
  transition: color var(--dtm-transition);
}

.chat-header__dropdown-item:hover .chat-header__dropdown-item-time,
.chat-header__dropdown-item--active .chat-header__dropdown-item-time {
  color: var(--dtm-text-muted);
}

.chat-header__dropdown-empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dtm-text-muted);
  text-align: center;
}
</style>
