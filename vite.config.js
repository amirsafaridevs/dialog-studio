import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

const tiktokenStub = resolve(__dirname, 'frontend/src/polyfills/tiktoken.js');

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // LangGraph uses node:async_hooks for tracing. Browser doesn't have it,
      // so we polyfill with a no-op implementation.
      { find: 'node:async_hooks', replacement: resolve(__dirname, 'frontend/src/polyfills/async_hooks.js') },
      // js-tiktoken fetches rank files from tiktoken.pages.dev which is blocked in Iran.
      // LLMProvider already approximates token counts with char/4, so stubs are safe.
      { find: 'js-tiktoken/lite', replacement: tiktokenStub },
      { find: 'js-tiktoken', replacement: tiktokenStub },
    ],
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
