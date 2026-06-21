/**
 * Preview browser tools — client-side only, via preview iframe bridge.
 */

import { isAbortError, throwIfAborted } from '../../utils/abortSignal.js';
import { getPreviewController } from '../../utils/previewController.js';
import { isPreviewLoadError } from '../../utils/previewLoadError.js';

export const browserTools = [
  'preview_navigate',
  'preview_reload',
  'preview_get_html',
];

export class BrowserToolExecutor {
  supports(toolName) {
    return browserTools.includes(toolName);
  }

  async execute(toolName, args = {}, options = {}) {
    throwIfAborted(options.signal);

    const controller = getPreviewController();
    if (!controller) {
      return {
        success: false,
        error: 'Preview browser is not available',
        data: null,
      };
    }

    try {
      switch (toolName) {
        case 'preview_navigate':
          return await controller.navigate(args.url, options);
        case 'preview_reload':
          return await controller.reload(options);
        case 'preview_get_html':
          return await controller.getHtml(args, options);
        default:
          throw new Error(`Unknown browser tool: ${toolName}`);
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      return {
        success: false,
        error: error.message,
        data: isPreviewLoadError(error) ? error.diagnostics : null,
      };
    }
  }
}

export default BrowserToolExecutor;
