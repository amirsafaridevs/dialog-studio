import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // LangGraph uses node:async_hooks for tracing. Browser doesn't have it,
      // so we polyfill with a no-op implementation.
      'node:async_hooks': resolve(__dirname, 'frontend/src/polyfills/async_hooks.js'),
    },
  },
  build: {
    outDir: 'assets/chat',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'frontend/src/main.js'),
      output: {
        entryFileNames: 'chat.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'chat.css';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
