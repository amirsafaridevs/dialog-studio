// Stub for js-tiktoken — prevents fetch to tiktoken.pages.dev which is blocked in Iran.
// LLMProvider already overrides getNumTokens with char/4 approximation, so these
// stubs are never actually called in practice.

export class Tiktoken {
  encode(text) { return new Uint32Array(Math.ceil((text || '').length / 4)); }
  decode() { return new Uint8Array(); }
  free() {}
}

export function getEncodingNameForModel() { return 'gpt2'; }

export function getEncoding() { return Promise.resolve(new Tiktoken()); }

export function encodingForModel() { return Promise.resolve(new Tiktoken()); }

export default { getEncoding, encodingForModel, Tiktoken, getEncodingNameForModel };
