import {
  Bug,
  Code,
  Eraser,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderSearch,
  Globe,
  ListTodo,
  Package,
  Palette,
  PencilLine,
  RotateCw,
  ScrollText,
  Search,
  Network,
  ShieldCheck,
  LayoutTemplate,
  List,
  Trash2,
} from 'lucide-vue-next';

export const TOOL_ICONS = {
  read_file: FileText,
  edit_file: PencilLine,
  write_file: FilePenLine,
  search_files: FolderSearch,
  search_content: Search,
  code_graph: Network,
  validate_code: ShieldCheck,
  toggle_debug: Bug,
  read_debug_log: ScrollText,
  clear_debug_log: Eraser,
  check_theme: Palette,
  create_template: LayoutTemplate,
  update_template: FilePenLine,
  list_templates: List,
  delete_template: Trash2,
  create_theme: FolderPlus,
  list_plugins: Package,
  create_page: FilePlus2,
  update_page: FilePenLine,
  update_todos: ListTodo,
  preview_navigate: Globe,
  preview_reload: RotateCw,
  preview_get_html: Code,
};

export const TOOL_ACTIVE_LABELS = {
  read_file: 'در حال خواندن فایل',
  edit_file: 'در حال ویرایش فایل',
  write_file: 'در حال نوشتن فایل',
  search_files: 'در حال جستجوی فایل',
  search_content: 'در حال جستجو در محتوا',
  code_graph: 'در حال ساخت گراف کد',
  validate_code: 'در حال اعتبارسنجی کد',
  toggle_debug: 'در حال تغییر حالت دیباگ',
  read_debug_log: 'در حال خواندن لاگ',
  clear_debug_log: 'در حال پاک کردن لاگ',
  check_theme: 'در حال بررسی تم',
  create_template: 'در حال ایجاد قالب',
  update_template: 'در حال ویرایش قالب',
  list_templates: 'در حال دریافت لیست قالب‌ها',
  delete_template: 'در حال حذف قالب',
  create_theme: 'در حال ایجاد تم',
  list_plugins: 'در حال دریافت لیست پلاگین‌ها',
  create_page: 'در حال ایجاد برگه',
  update_page: 'در حال ویرایش برگه',
  update_todos: 'در حال برنامه‌ریزی',
  preview_navigate: 'در حال رفتن به صفحه پیش‌نمایش',
  preview_reload: 'در حال بارگذاری مجدد پیش‌نمایش',
  preview_get_html: 'در حال خواندن HTML پیش‌نمایش',
};

export const TOOL_DONE_LABELS = {
  read_file: 'خواندن فایل',
  edit_file: 'ویرایش فایل',
  write_file: 'نوشتن فایل',
  search_files: 'جستجوی فایل',
  search_content: 'جستجو در محتوا',
  code_graph: 'گراف کد PHP',
  validate_code: 'اعتبارسنجی کد',
  toggle_debug: 'تغییر حالت دیباگ',
  read_debug_log: 'خواندن لاگ',
  clear_debug_log: 'پاک کردن لاگ',
  check_theme: 'بررسی تم',
  create_template: 'ایجاد قالب',
  update_template: 'ویرایش قالب',
  list_templates: 'لیست قالب‌ها',
  delete_template: 'حذف قالب',
  create_theme: 'ایجاد تم',
  list_plugins: 'لیست پلاگین‌ها',
  create_page: 'ایجاد برگه',
  update_page: 'ویرایش برگه',
  update_todos: 'برنامه‌ریزی',
  preview_navigate: 'رفتن به صفحه پیش‌نمایش',
  preview_reload: 'بارگذاری مجدد پیش‌نمایش',
  preview_get_html: 'خواندن HTML پیش‌نمایش',
};

export function getToolIcon(toolName) {
  return TOOL_ICONS[toolName] || FileText;
}

function formatKeywords(keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return '';
  }

  return keywords
    .map((keyword) => String(keyword).trim())
    .filter(Boolean)
    .join('، ');
}

function basename(path) {
  if (!path) {
    return '';
  }

  return String(path).replace(/\\/g, '/').split('/').pop();
}

function formatFilePathContext(path, extras = '') {
  const filePath = path ? String(path) : '';
  if (!filePath) {
    return '';
  }

  return extras ? `${filePath} (${extras})` : filePath;
}

function formatDebugContext(args) {
  if (args.debug === false) {
    return 'غیرفعال';
  }

  if (args.debug === true) {
    const parts = [];
    if (args.debug_log) {
      parts.push('لاگ');
    }
    if (args.debug_display) {
      parts.push('نمایش');
    }

    return parts.length ? `فعال (${parts.join('، ')})` : 'فعال';
  }

  return '';
}

function formatTodosContext(args) {
  if (!Array.isArray(args.todos) || args.todos.length === 0) {
    return '';
  }

  const active = args.todos.find((todo) => todo.status === 'in_progress');
  if (active?.description) {
    return String(active.description);
  }

  if (args.todos.length === 1 && args.todos[0]?.description) {
    return String(args.todos[0].description);
  }

  return `${args.todos.length} کار`;
}

function formatThemeContext(args) {
  if (args.theme_name) {
    return String(args.theme_name);
  }

  if (args.theme) {
    return String(args.theme);
  }

  if (args.ready === true) {
    return 'آماده';
  }

  if (args.ready === false) {
    return 'نیاز به تنظیم';
  }

  return '';
}

export function formatToolContext(toolName, args = null) {
  if (!args || typeof args !== 'object') {
    return '';
  }

  if (toolName === 'read_file' && args.path) {
    if (args.start_line != null) {
      const endLine = args.end_line ?? args.start_line;
      return formatFilePathContext(args.path, `خطوط ${args.start_line}-${endLine}`);
    }
    if (args.line_count != null) {
      return formatFilePathContext(args.path, `خطوط 1-${args.line_count}`);
    }
    return String(args.path);
  }

  if (toolName === 'write_file' && args.path) {
    const mode = args.mode ? String(args.mode) : '';
    let context = '';
    if (mode === 'overwrite') {
      context = formatFilePathContext(args.path, 'بازنویسی');
    } else if (mode === 'create') {
      context = formatFilePathContext(args.path, 'ایجاد');
    } else {
      context = String(args.path);
    }
    if (args.validation) {
      return `${context} — ${args.validation === 'ok' ? 'بدون خطا' : args.validation}`;
    }
    return context;
  }

  if (toolName === 'edit_file' && args.path) {
    if (args.start_line != null) {
      const endLine = args.end_line ?? args.start_line;
      const range = formatFilePathContext(args.path, `خطوط ${args.start_line}-${endLine}`);
      if (args.validation) {
        return `${range} — ${args.validation === 'ok' ? 'بدون خطا' : args.validation}`;
      }
      return range;
    }
    return String(args.path);
  }

  if (toolName === 'search_files') {
    const keywords = formatKeywords(args.keywords);
    if (!keywords) {
      return '';
    }

    const directory = args.directory ? String(args.directory).trim() : '';
    if (directory) {
      return `«${keywords}» در ${directory}`;
    }

    return keywords;
  }

  if (toolName === 'search_content') {
    const keywords = formatKeywords(args.keywords);
    if (!keywords) {
      return '';
    }

    const path = args.path ? String(args.path).trim() : '';
    if (path) {
      return `«${keywords}» در ${path}`;
    }

    return keywords;
  }

  if (toolName === 'code_graph' && args.directory) {
    return String(args.directory);
  }

  if (toolName === 'validate_code' && args.directory) {
    return String(args.directory);
  }

  if (toolName === 'toggle_debug') {
    return formatDebugContext(args);
  }

  if (toolName === 'read_debug_log' || toolName === 'clear_debug_log') {
    return args.file ? String(args.file) : 'debug.log';
  }

  if (toolName === 'check_theme') {
    return formatThemeContext(args) || 'wp-content/dialog';
  }

  if (toolName === 'create_template' && args.title) {
    return `${args.title}${args.type ? ` (${args.type})` : ''}`;
  }

  if (toolName === 'update_template') {
    if (args.title) return String(args.title);
    if (args.slug) return String(args.slug);
    if (args.id) return `#${args.id}`;
  }

  if (toolName === 'list_templates') {
    if (args.total != null) {
      return `${args.total} قالب`;
    }
    return 'همه قالب‌ها';
  }

  if (toolName === 'delete_template') {
    if (args.slug) return String(args.slug);
    if (args.id) return `#${args.id}`;
  }

  if (toolName === 'create_theme') {
    return formatThemeContext(args) || 'dialog';
  }

  if (toolName === 'list_plugins') {
    return args.total != null ? `${args.total} پلاگین` : '';
  }

  if (toolName === 'create_page' && args.title) {
    return String(args.title);
  }

  if (toolName === 'update_page') {
    if (args.title) {
      return String(args.title);
    }
    if (args.id) {
      return `#${args.id}`;
    }
    if (args.slug) {
      return String(args.slug);
    }
  }

  if (toolName === 'update_todos') {
    return formatTodosContext(args);
  }

  if (toolName === 'preview_navigate' && args.url) {
    return String(args.url);
  }

  if (toolName === 'preview_get_html') {
    if (args.selector) {
      return String(args.selector);
    }
    if (args.dom_path) {
      return String(args.dom_path);
    }
    return 'کل صفحه';
  }

  return '';
}

export function extractToolArgsFromResult(toolName, parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (toolName === 'update_todos' && Array.isArray(parsed.todos)) {
    return { todos: parsed.todos };
  }

  const data = parsed.data;
  if (!data || typeof data !== 'object') {
    if (toolName === 'read_debug_log' || toolName === 'clear_debug_log') {
      return { file: 'debug.log' };
    }

    if (toolName === 'create_theme') {
      return { theme: 'dialog' };
    }

    return null;
  }

  if (toolName === 'read_file' && data.path) {
    return {
      path: data.path,
      start_line: data.start_line,
      end_line: data.end_line,
      line_count: data.line_count,
    };
  }

  if (toolName === 'edit_file' && data.path) {
    const args = {
      path: data.path,
      start_line: data.start_line,
      end_line: data.end_line,
    };
    const validation = data.code_validation;
    if (validation && validation.skipped !== true && validation.valid != null) {
      args.validation = validation.valid ? 'ok' : `${validation.issue_count ?? 0} خطا`;
    }
    return args;
  }

  if (toolName === 'write_file' && data.path) {
    const args = { path: data.path, mode: data.mode };
    const validation = data.code_validation;
    if (validation && validation.skipped !== true && validation.valid != null) {
      args.validation = validation.valid ? 'ok' : `${validation.issue_count ?? 0} خطا`;
    }
    return args;
  }

  if (toolName === 'search_files') {
    return {
      keywords: data.keywords,
      directory: data.directory,
    };
  }

  if (toolName === 'search_content') {
    return {
      keywords: data.keywords,
      path: data.path,
    };
  }

  if (toolName === 'code_graph') {
    return {
      directory: data.directory,
    };
  }

  if (toolName === 'validate_code') {
    return {
      directory: data.directory,
      valid: data.valid,
      file_count: data.file_count,
      issue_count: data.issue_count,
    };
  }

  if (toolName === 'toggle_debug') {
    return {
      debug: data.debug,
      debug_log: data.debug_log,
      debug_display: data.debug_display,
    };
  }

  if (toolName === 'read_debug_log') {
    return { file: basename(data.file_path) || 'debug.log' };
  }

  if (toolName === 'clear_debug_log') {
    return { file: basename(data.file_path) || 'debug.log' };
  }

  if (toolName === 'check_theme') {
    return {
      theme: data.required_theme,
      theme_name: data.active_theme?.name,
      ready: data.ready,
    };
  }

  if (toolName === 'create_template') {
    if (data.title) {
      return { title: data.title, type: data.type, slug: data.slug };
    }
  }

  if (toolName === 'update_template') {
    return {
      id: data.id,
      title: data.title,
      slug: data.slug,
    };
  }

  if (toolName === 'list_templates' && Array.isArray(data)) {
    return { total: data.length };
  }

  if (toolName === 'delete_template') {
    return {
      id: data.id,
      slug: data.slug,
    };
  }

  if (toolName === 'create_theme') {
    return { theme: data.required_theme || 'dialog' };
  }

  if (toolName === 'list_plugins' && data.total != null) {
    return { total: data.total };
  }

  if (toolName === 'create_page' && data.title) {
    return { title: data.title, slug: data.slug };
  }

  if (toolName === 'update_page') {
    return {
      id: data.id,
      title: data.title,
      slug: data.slug,
    };
  }

  if (toolName === 'preview_navigate' && data.url) {
    return { url: data.url };
  }

  if (toolName === 'preview_get_html') {
    return {
      selector: data.selector,
      dom_path: data.dom_path,
      url: data.url,
    };
  }

  return null;
}

function appendToolContext(base, context) {
  if (!context) {
    return base;
  }

  return `${base}: ${context}`;
}

export function getToolTitle(toolName, {
  streaming = false,
  failed = false,
  fallback = '',
  args = null,
} = {}) {
  const context = formatToolContext(toolName, args);

  if (failed) {
    const base = TOOL_DONE_LABELS[toolName] || fallback || toolName;
    return `خطا در ${appendToolContext(base, context).toLowerCase()}`;
  }

  if (streaming) {
    const base = TOOL_ACTIVE_LABELS[toolName] || fallback || toolName;
    return appendToolContext(base, context);
  }

  const base = TOOL_DONE_LABELS[toolName] || fallback || toolName;
  return appendToolContext(base, context);
}

export function getLastLines(text, lineCount = 3) {
  if (!text) {
    return '';
  }

  const lines = String(text).split('\n').filter((line, index, all) => {
    return line.length > 0 || index < all.length - 1;
  });

  if (lines.length <= lineCount) {
    return lines.join('\n');
  }

  return lines.slice(-lineCount).join('\n');
}
