import uiPromptMd from './ui.md?raw';

/** Default design instructions when the user has not set a custom prompt. */
export const DEFAULT_CUSTOM_PROMPT = uiPromptMd.trim();

/**
 * Return the user's custom prompt, or the default from ui.md when empty.
 *
 * @param {string} [customPrompt]
 * @returns {string}
 */
export function resolveCustomPrompt(customPrompt) {
  const text = (customPrompt || '').trim();
  return text || DEFAULT_CUSTOM_PROMPT;
}
