import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

const tiktokenStub = resolve(__dirname, 'frontend/src/polyfills/tiktoken.js');

// @langchain/core/dist/utils/tiktoken.js fetches rank files from tiktoken.pages.dev
// (blocked in Iran). We stub js-tiktoken so Tiktoken() is a no-op, and we also
// transform the tiktoken.js source to replace the live fetch with an immediate resolve.
// We must NOT replace the whole file because import_map.js re-exports it as a namespace.
function tiktokenBlockerPlugin() {
  const jsTiktokenStubCode = `
export class Tiktoken {
  encode(text) { return new Uint32Array(Math.ceil((text || '').length / 4)); }
  decode() { return new Uint8Array(); }
  free() {}
}
export function getEncodingNameForModel() { return 'gpt2'; }
export function getEncoding() { return Promise.resolve(new Tiktoken()); }
export function encodingForModel() { return Promise.resolve(new Tiktoken()); }
export default { getEncoding, encodingForModel, Tiktoken, getEncodingNameForModel };
`;
  return {
    name: 'tiktoken-blocker',
    resolveId(id) {
      if (id === 'js-tiktoken' || id === 'js-tiktoken/lite') {
        return '\0tiktoken-stub';
      }
    },
    load(id) {
      if (id === '\0tiktoken-stub') return jsTiktokenStubCode;
    },
    transform(code, id) {
      // Patch @langchain/core tiktoken.js: replace the live fetch with a no-op.
      // The original single-line expression is: caller.fetch(...).then(...).then(...).catch(...)
      // We replace the entire assignment RHS to avoid broken syntax.
      if (id.includes('@langchain/core') && id.includes('tiktoken') && code.includes('tiktoken.pages.dev')) {
        return code.replace(
          /cache\[encoding\] = caller\.fetch\([\s\S]*?\}\);/,
          'cache[encoding] = Promise.resolve(new Tiktoken());'
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), tiktokenBlockerPlugin()],
  resolve: {
    alias: [
      // LangGraph uses node:async_hooks for tracing. Browser doesn't have it,
      // so we polyfill with a no-op implementation.
      { find: 'node:async_hooks', replacement: resolve(__dirname, 'frontend/src/polyfills/async_hooks.js') },
      // js-tiktoken and @langchain/core/utils/tiktoken both fetch rank files from
      // tiktoken.pages.dev which is blocked in Iran. LLMProvider already approximates
      // token counts with char/4, so stubs are safe.
      { find: 'js-tiktoken/lite', replacement: tiktokenStub },
      { find: 'js-tiktoken', replacement: tiktokenStub },
      { find: /^@langchain\/core\/dist\/utils\/tiktoken(\.js)?$/, replacement: tiktokenStub },
      { find: '@langchain/core/utils/tiktoken', replacement: tiktokenStub },
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
