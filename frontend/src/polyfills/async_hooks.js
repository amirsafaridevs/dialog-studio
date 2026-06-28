/**
 * Minimal browser polyfill for node:async_hooks.
 * LangGraph uses AsyncLocalStorage only for LangSmith tracing context propagation.
 * In a browser environment tracing is not used, so a no-op implementation is fine.
 */
export class AsyncLocalStorage {
  constructor() {
    this._store = undefined;
  }

  getStore() {
    return this._store;
  }

  run(store, fn, ...args) {
    const prev = this._store;
    this._store = store;
    try {
      return fn(...args);
    } finally {
      this._store = prev;
    }
  }

  exit(fn, ...args) {
    return this.run(undefined, fn, ...args);
  }

  enterWith(store) {
    this._store = store;
  }
}

export class AsyncResource {
  constructor() {}
  runInAsyncScope(fn, _thisArg, ...args) {
    return fn(...args);
  }
}
