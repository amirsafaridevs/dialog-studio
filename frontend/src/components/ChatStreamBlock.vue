<script setup>
import { computed, ref, watch } from 'vue';
import { Brain, ChevronDown, Sparkles } from 'lucide-vue-next';
import { getLastLines } from '../utils/toolDisplay.js';

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  detail: {
    type: String,
    default: '',
  },
  icon: {
    type: [Object, Function],
    default: null,
  },
  streaming: {
    type: Boolean,
    default: false,
  },
  previewLines: {
    type: Number,
    default: 3,
  },
  defaultCollapsed: {
    type: Boolean,
    default: false,
  },
});

const collapsed = ref(props.defaultCollapsed);
const resolvedIcon = computed(() => {
  if (props.streaming) {
    return Sparkles;
  }

  return props.icon || Brain;
});
const previewText = computed(() => getLastLines(props.detail, props.previewLines));
const hasPreview = computed(() => Boolean(previewText.value));

watch(
  () => props.streaming,
  (isStreaming) => {
    if (isStreaming) {
      collapsed.value = false;
    }
  },
);
</script>

<template>
  <div
    class="chat-stream-block"
    :class="{
      'chat-stream-block--streaming': streaming,
      'chat-stream-block--collapsed': collapsed,
    }"
  >
    <button
      v-if="hasPreview"
      type="button"
      class="chat-stream-block__header"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <component
        :is="resolvedIcon"
        :size="14"
        :stroke-width="1.75"
        class="chat-stream-block__icon"
        :class="{ 'chat-stream-block__icon--spin': streaming }"
      />
      <span
        class="chat-stream-block__title"
        :class="{ 'chat-stream-block__title--streaming': streaming }"
      >
        {{ title }}
      </span>
      <ChevronDown
        :size="14"
        :stroke-width="1.75"
        class="chat-stream-block__chevron"
      />
    </button>

    <div v-else class="chat-stream-block__header chat-stream-block__header--static">
      <component
        :is="resolvedIcon"
        :size="14"
        :stroke-width="1.75"
        class="chat-stream-block__icon"
        :class="{ 'chat-stream-block__icon--spin': streaming }"
      />
      <span
        class="chat-stream-block__title"
        :class="{ 'chat-stream-block__title--streaming': streaming }"
      >
        {{ title }}
      </span>
    </div>

    <div v-if="hasPreview && !collapsed" class="chat-stream-block__preview">
      <pre class="chat-stream-block__preview-text">{{ previewText }}</pre>
    </div>
  </div>
</template>

<style scoped>
.chat-stream-block {
  width: 100%;
}

.chat-stream-block__header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: right;
  color: var(--dtm-text-secondary);
}

.chat-stream-block__header--static {
  cursor: default;
}

.chat-stream-block__icon {
  flex-shrink: 0;
  color: var(--dtm-text-muted);
}

.chat-stream-block__icon--spin {
  color: var(--dtm-accent);
  animation: chat-stream-sparkle 1.4s ease-in-out infinite;
  transform-origin: center;
}

.chat-stream-block__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--dtm-text-secondary);
}

.chat-stream-block__title--streaming {
  background: linear-gradient(
    90deg,
    var(--dtm-text-muted) 0%,
    var(--dtm-text-primary) 45%,
    var(--dtm-text-muted) 90%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: chat-stream-wave 1.8s ease-in-out infinite;
}

.chat-stream-block__chevron {
  flex-shrink: 0;
  color: var(--dtm-text-muted);
  transition: transform 0.2s ease;
}

.chat-stream-block--collapsed .chat-stream-block__chevron {
  transform: rotate(-90deg);
}

.chat-stream-block__preview {
  margin-top: var(--dtm-space-2);
  padding: var(--dtm-space-2) var(--dtm-space-3);
  border-radius: var(--dtm-radius-md);
  background: rgba(255, 255, 255, 0.03);
  animation: chat-stream-preview-in 0.2s ease both;
}

.chat-stream-block__preview-text {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dtm-text-muted);
  max-height: calc(1.55em * 3);
  overflow: hidden;
}

@keyframes chat-stream-wave {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: -100% 50%;
  }
}

@keyframes chat-stream-preview-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes chat-stream-sparkle {
  0%,
  100% {
    transform: scale(0.85) rotate(0deg);
    opacity: 0.75;
  }

  50% {
    transform: scale(1.15) rotate(18deg);
    opacity: 1;
  }
}
</style>
