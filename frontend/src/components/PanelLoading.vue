<script setup>
defineProps({
  variant: {
    type: String,
    default: 'overlay',
    validator: (value) => ['overlay', 'browser'].includes(value),
  },
});
</script>

<template>
  <div
    class="panel-loading"
    :class="`panel-loading--${variant}`"
    role="status"
    aria-live="polite"
    aria-label="در حال بارگذاری"
  >
    <div class="panel-loading__spinner" />
  </div>
</template>

<style scoped>
.panel-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-loading--overlay {
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.panel-loading--browser {
  background: rgba(255, 255, 255, 0.96);
}

.panel-loading--overlay .panel-loading__spinner {
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.72);
}

.panel-loading--browser .panel-loading__spinner {
  border: 2px solid rgba(37, 99, 235, 0.15);
  border-top-color: #2563eb;
}

.panel-loading__spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  animation: panel-loading-spin 0.7s linear infinite;
}

@keyframes panel-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
