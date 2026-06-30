/**
 * Return the user's custom prompt text, or empty string when none is set.
 * Design expertise is injected automatically via skills (css-design, accessibility)
 * in registry.js — no static default is needed here.
 *
 * @param {string} [customPrompt]
 * @returns {string}
 */
export const DEFAULT_CUSTOM_PROMPT = '';

export function resolveCustomPrompt(customPrompt) {
  return (customPrompt || '').trim();
}

export default resolveCustomPrompt;
