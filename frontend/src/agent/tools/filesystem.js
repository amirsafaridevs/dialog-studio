/**
 * File System Tools - WordPress API Integration
 */

import { isAbortError } from '../../utils/abortSignal.js';

export const fileSystemTools = [
  {
    name: 'read_file',
    description: 'Read workspace (child theme) files, plugins, or core. Use workspace-relative paths for child theme files.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative or WordPress-relative file path' },
        start_line: { type: 'integer', description: 'Optional first line (1-indexed)' },
        end_line: { type: 'integer', description: 'Optional last line (1-indexed, inclusive)' },
      },
      required: ['path']
    }
  },
  {
    name: 'edit_file',
    description: 'Replace a line range in an existing workspace (child theme) file.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        start_line: { type: 'integer', description: 'First line to replace (1-indexed)' },
        end_line: { type: 'integer', description: 'Last line to replace (1-indexed)' },
        content: { type: 'string', description: 'Replacement text (empty to delete range)' },
      },
      required: ['path', 'start_line', 'end_line', 'content'],
    },
  },
  {
    name: 'write_file', 
    description: 'Create or overwrite a file in the workspace (child theme).',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'File content' },
        mode: { type: 'string', enum: ['create', 'overwrite'], default: 'create' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'search_files',
    description: 'Search files by name. Omit directory to search workspace (child theme).',
    schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
        directory: { type: 'string', description: 'Directory to search. Omit for workspace.' },
        operator: { type: 'string', enum: ['AND', 'OR'], default: 'AND' }
      },
      required: ['keywords']
    }
  },
  {
    name: 'search_content',
    description: 'Search text content in files. Omit path to search workspace (child theme).',
    schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
        path: { type: 'string' },
        context_lines: { type: 'number', default: 2 },
        max_results: { type: 'number', default: 100 }
      },
      required: ['keywords']
    }
  }
];

export class FileSystemToolExecutor {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  supports(toolName) {
    return ['read_file', 'edit_file', 'write_file', 'search_files', 'search_content', 'grep_content', 'grep'].includes(toolName);
  }

  async execute(toolName, args, options = {}) {
    try {
      switch (toolName) {
        case 'read_file':
          return await this.apiClient.post('/file/read', {
            path: args.path,
            start_line: args.start_line,
            end_line: args.end_line,
          }, options);
          
        case 'edit_file':
          return await this.apiClient.post('/file/edit', {
            path: args.path,
            start_line: args.start_line,
            end_line: args.end_line,
            content: args.content ?? '',
          }, options);

        case 'write_file':
          return await this.apiClient.post('/file/write', {
            path: args.path,
            content: args.content,
            mode: args.mode || 'create'
          }, options);
          
        case 'search_files':
          return await this.apiClient.post('/search/files', {
            keywords: args.keywords,
            directory: args.directory,
            operator: args.operator || 'AND'
          }, options);
          
        case 'search_content':
        case 'grep_content':
        case 'grep':
          return await this.apiClient.post('/search/content', {
            keywords: args.keywords,
            path: args.path,
            operator: args.operator || 'OR',
            context_lines: args.context_lines || 2,
            max_results: args.max_results || 20
          }, options);
          
        default:
          throw new Error(`Unknown file system tool: ${toolName}`);
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default FileSystemToolExecutor;
