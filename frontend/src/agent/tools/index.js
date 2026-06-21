/**
 * Tool Executor - WordPress REST API bridge + preview browser tools
 */

import { isAbortError } from '../../utils/abortSignal.js';
import { FileSystemToolExecutor } from './filesystem.js';
import { BrowserToolExecutor } from './browser.js';

export class ToolExecutor {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.fileSystem = new FileSystemToolExecutor(apiClient);
    this.browser = new BrowserToolExecutor();
  }

  async execute(toolName, args, options = {}) {
    console.log(`[ToolExecutor] ${toolName}`, args);

    try {
      if (this.fileSystem.supports(toolName)) {
        return await this.fileSystem.execute(toolName, args, options);
      }

      if (this.browser.supports(toolName)) {
        return await this.browser.execute(toolName, args, options);
      }

      return await this.executeApiTool(toolName, args, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      console.error(`[ToolExecutor] ${toolName} failed:`, error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  async executeApiTool(toolName, args, options = {}) {
    const routes = {
      toggle_debug: { method: 'post', path: '/debug/toggle' },
      read_debug_log: { method: 'get', path: '/debug/log' },
      clear_debug_log: { method: 'post', path: '/debug/clear' },
      check_theme: { method: 'post', path: '/theme/check' },
      create_template: { method: 'post', path: '/templates/create' },
      update_template: { method: 'post', path: '/templates/update' },
      list_templates: { method: 'get', path: '/templates/list' },
      delete_template: { method: 'post', path: '/templates/delete' },
      code_graph: { method: 'post', path: '/code/graph' },
      validate_code: { method: 'post', path: '/code/validate' },
      create_theme: { method: 'post', path: '/theme/create' },
      list_plugins: { method: 'get', path: '/plugins/list' },
      create_page: { method: 'post', path: '/pages/create' },
      update_page: { method: 'post', path: '/pages/update' },
    };

    const route = routes[toolName];
    if (!route) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return await this.apiClient[route.method](route.path, args, options);
  }
}

export default ToolExecutor;
