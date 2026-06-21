/** Shared abort helpers for agent stop/cancel. */

export const AGENT_ABORT_MESSAGE = 'Agent stopped by user';

export function createAgentAbortError() {
  return new DOMException(AGENT_ABORT_MESSAGE, 'AbortError');
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAgentAbortError();
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 20;
}
