/**
 * OpenAI-compatible tool schemas for the agent loop.
 */

const FILE_READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read any file in the WordPress install. For workspace (child theme) files use relative paths like assets/front/css/main.css. For plugins use wp-content/plugins/my-plugin/main.php. For WordPress core use wp-includes/formatting.php.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'WordPress-relative path or workspace-relative path (e.g. assets/front/css/main.css, wp-content/plugins/woocommerce/woocommerce.php)',
          },
          start_line: {
            type: 'integer',
            description: 'Optional first line to read (1-indexed). Use with end_line for CSS/PHP sections.',
          },
          end_line: {
            type: 'integer',
            description: 'Optional last line to read (1-indexed, inclusive).',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search files by name inside a directory. Omit directory to search the workspace (child theme). For plugins use wp-content/plugins. For WordPress root use wp-content.',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          directory: { type: 'string', description: 'Directory to search. Omit to search workspace. Examples: wp-content/plugins, wp-content/plugins/woocommerce' },
          operator: { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description:
        'LAST RESORT ONLY — blocked when the Dialog Code Index already maps the keyword or file. Omit path to search the workspace (child theme).',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'All search terms in one array — include every name, class, hook, or string you might need (hypotheses welcome). Example: ["site-footer", "footer__brand", "get_footer", "wp_footer"]',
          },
          path: {
            type: 'string',
            description:
              'Directory or file scope (WordPress-relative). Omit to search workspace. Set only when searching outside the workspace (e.g. wp-content/plugins/woocommerce).',
          },
          operator: {
            type: 'string',
            enum: ['AND', 'OR'],
            default: 'OR',
            description:
              'OR (default): match any keyword — use when batching hypotheses. AND: every keyword must appear on the same line.',
          },
          context_lines: { type: 'number', default: 2 },
          max_results: { type: 'number', default: 15 },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_code',
      description:
        'Validate PHP/CSS/JS syntax. Omit directory to validate the workspace (child theme).',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description:
              'Directory to validate (WordPress-relative). Omit for workspace. Examples: wp-content/plugins/my-plugin',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_graph',
      description:
        'Build a PHP code graph for a directory. Omit directory to analyze the workspace (child theme).',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description:
              'Directory to analyze (WordPress-relative). Omit for workspace. Examples: wp-content/plugins/my-plugin',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'graph_query',
      description:
        'Query the project knowledge graph (parent + child theme) that is already summarized in your context. Returns a small scoped subgraph — far cheaper than reading files or grepping for call sites. mode:"explain" returns everything touching one symbol or file (callers + callees, extends/implements, hook callbacks). mode:"path" returns the shortest relationship chain between two symbols/files. Prefer this over search_content for "what uses X" / "how does A reach B" questions.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['explain', 'path'],
            default: 'explain',
            description: 'explain: relationships of one target. path: chain between from→to.',
          },
          target: {
            type: 'string',
            description: 'For mode:"explain" — a symbol (function/class/Class::method) or a file path (e.g. functions.php, inc/shop.php).',
          },
          from: {
            type: 'string',
            description: 'For mode:"path" — the start symbol or file.',
          },
          to: {
            type: 'string',
            description: 'For mode:"path" — the end symbol or file.',
          },
          max_hops: { type: 'integer', default: 6, description: 'For mode:"path" — max relationship hops to search.' },
        },
      },
    },
  },
];

const FILE_WRITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit a specific line range in an existing workspace (child theme) file. Replaces lines start_line through end_line (1-indexed, inclusive) with new content. Path is relative to workspace root (e.g. assets/front/css/main.css, inc/shop.php).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path inside workspace (e.g. assets/front/css/main.css, inc/helpers.php, style.css)',
          },
          start_line: {
            type: 'integer',
            description: 'First line to replace (1-indexed, inclusive)',
          },
          end_line: {
            type: 'integer',
            description: 'Last line to replace (1-indexed, inclusive)',
          },
          content: {
            type: 'string',
            description: 'New text to insert in place of the range. Empty string deletes the range.',
          },
        },
        required: ['path', 'start_line', 'end_line', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file inside the workspace (child theme). Path is relative to workspace root (e.g. assets/front/css/main.css, inc/helpers.php, style.css).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path inside workspace (e.g. assets/front/css/main.css, inc/helpers.php, style.css)',
          },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['create', 'overwrite'], default: 'create' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

const DEBUG_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'toggle_debug',
      description: 'Enable or disable WordPress debug mode.',
      parameters: {
        type: 'object',
        properties: {
          debug: { type: 'boolean' },
          debug_log: { type: 'boolean' },
          debug_display: { type: 'boolean' },
        },
        required: ['debug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_debug_log',
      description: 'Read the WordPress debug.log file.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_debug_log',
      description: 'Clear the WordPress debug.log file.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const THEME_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_theme',
      description:
        'Check whether the workspace (child theme) is ready. Only use when the user explicitly asks about workspace status.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const TEMPLATE_WRITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_template',
      description:
        'Create a Dialog template: writes the PHP file under wp-content/dialog/templates/ AND registers it in the database with type, display conditions, and canvas options (includes_header/includes_footer). Required for any new template — never use write_file in templates/.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Human-readable template name' },
          slug: { type: 'string', description: 'Unique slug (e.g. main-header, shop-archive)' },
          type: {
            type: 'string',
            enum: ['header', 'footer', 'singular', 'archive', 'canvas', 'front_page', 'search', '404', 'woocommerce', 'section'],
            description: 'Template role — where and how it loads',
          },
          content: { type: 'string', description: 'PHP/HTML template body' },
          includes_header: { type: 'boolean', default: true, description: 'For page/canvas templates: show site header HTML? (assets always load)' },
          includes_footer: { type: 'boolean', default: true, description: 'For page/canvas templates: show site footer HTML? (assets always load)' },
          priority: { type: 'integer', default: 10, description: 'Lower number = higher priority when multiple templates match' },
          conditions: {
            type: 'object',
            description:
              'Display rules (must use "rules" wrapper): { "rules": [{"page":"front_page"}, {"page":"singular","post_type":"page"}, {"page":"singular","post_type":"product"}, {"page":"archive","post_type":"post"}, {"page":"archive","taxonomy":"category"}, {"page":"woocommerce","endpoint":"cart"}, {"page":"search"}, {"page":"404"}] }. See system prompt for full examples.',
          },
          status: { type: 'string', enum: ['active', 'draft', 'inactive'], default: 'active' },
          meta: { type: 'object', description: 'Optional extra metadata' },
        },
        required: ['title', 'type', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_template',
      description:
        'Update an existing Dialog template by id or slug. Edits database fields (title, type, conditions, status, priority, includes_header/footer, meta) and optionally the PHP file content. Only pass fields you want to change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Template database id' },
          slug: { type: 'string', description: 'Template slug when id is unknown' },
          title: { type: 'string' },
          type: {
            type: 'string',
            enum: ['header', 'footer', 'singular', 'archive', 'canvas', 'front_page', 'search', '404', 'woocommerce', 'section'],
          },
          content: { type: 'string', description: 'New PHP/HTML body for the template file' },
          includes_header: { type: 'boolean' },
          includes_footer: { type: 'boolean' },
          priority: { type: 'integer' },
          conditions: { type: 'object', description: 'Display rules with "rules" wrapper: {"rules": [...]}. See create_template description for examples.' },
          status: { type: 'string', enum: ['active', 'draft', 'inactive'] },
          meta: { type: 'object' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_template',
      description:
        'Permanently delete a Dialog template by id or slug. Removes both the PHP file under wp-content/dialog/templates/ and the database record.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Template database id' },
          slug: { type: 'string', description: 'Template slug when id is unknown' },
        },
      },
    },
  },
];

const PLUGIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_plugins',
      description:
        'List all installed WordPress plugins on this site with their name, version, description, author, and active/inactive status.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const PAGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_page',
      description:
        'Create a new WordPress page. Set title, content (HTML), slug, status, excerpt, parent page, menu order, page template, featured image, and custom meta fields as needed.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page title (required)' },
          content: { type: 'string', description: 'Page content (HTML allowed)' },
          slug: { type: 'string', description: 'URL slug (e.g. about-us)' },
          status: {
            type: 'string',
            enum: ['publish', 'draft', 'pending', 'private'],
            default: 'publish',
          },
          excerpt: { type: 'string', description: 'Short excerpt/summary' },
          parent_id: { type: 'integer', description: 'Parent page ID for hierarchy' },
          menu_order: { type: 'integer', description: 'Sort order among sibling pages' },
          template: {
            type: 'string',
            description: 'Page template filename (e.g. template-about.php) or "default"',
          },
          featured_image_id: { type: 'integer', description: 'Attachment ID for featured image' },
          meta: {
            type: 'object',
            description: 'Custom post meta key-value pairs',
            additionalProperties: true,
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_page',
      description:
        'Update an existing WordPress page. Identify the page by id or slug. Only include fields you want to change (title, content, new_slug, status, excerpt, parent_id, menu_order, template, featured_image_id, meta).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Page ID' },
          slug: { type: 'string', description: 'Current page slug (alternative to id)' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Page content (HTML allowed)' },
          new_slug: { type: 'string', description: 'New URL slug' },
          status: {
            type: 'string',
            enum: ['publish', 'draft', 'pending', 'private'],
          },
          excerpt: { type: 'string' },
          parent_id: { type: 'integer' },
          menu_order: { type: 'integer' },
          template: { type: 'string' },
          featured_image_id: { type: 'integer' },
          meta: {
            type: 'object',
            description: 'Custom post meta key-value pairs to set or update',
            additionalProperties: true,
          },
        },
      },
    },
  },
];

const PREVIEW_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'preview_get_loaded_assets',
      description:
        'List all CSS stylesheets and JS scripts currently loaded in the live site preview iframe. Returns href/src, element id, and load attributes for each asset. Use to diagnose missing styles, plugin conflicts, or verify a stylesheet is enqueued.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_get_element_styles',
      description:
        'Inspect the CSS applied to a specific element in the live site preview iframe — exactly like Chrome DevTools Styles panel. Returns: (1) matchedRules: every CSS rule whose selector matches the element, with the source stylesheet and declarations; (2) inlineStyles: any style="" attributes; (3) computedStyles: the final computed value for every CSS property. Requires selector or dom_path to target the element.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the target element (e.g. ".site-header .welcome-user", "#primary-menu > li.current")',
          },
          dom_path: {
            type: 'string',
            description: 'DOM path from the element picker (e.g. "header#site-header > div.header-inner > span.welcome-user")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_navigate',
      description:
        'Navigate the live site preview iframe to a URL on this WordPress site (e.g. /, /about/, /portfolio/). Use during final validation to visit every required URL. The last preview_navigate before finishing a user-facing task must open the showcase page the user should see. Relative paths are resolved against the site home URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Site URL or path to open in the preview iframe (e.g. /, /contact/, https://example.com/blog/)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_reload',
      description:
        'Reload the current page in the live site preview iframe. Use after editing theme files when the user is already on the relevant page, or when a hard refresh is needed to pick up CSS/PHP changes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_get_html',
      description:
        'Read rendered HTML from the live site preview iframe. Use during final validation: inspect head (selector "head") to confirm CSS/JS assets are loaded; inspect each changed section via selector or dom_path to confirm markup. Omit selector and dom_path to get the full page HTML.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Optional CSS selector for a specific element',
          },
          dom_path: {
            type: 'string',
            description: 'Optional DOM path from element picker (e.g. div.hero > h1.title)',
          },
        },
      },
    },
  },
];

export const UPDATE_TODOS_TOOL = {
  type: 'function',
  function: {
    name: 'update_todos',
    description:
      'Your planning tool (shown to the user as "برنامه اجرا"). Plan in proportion to the work: skip it for a single obvious change, but for multi-step / multi-file / ambiguous / visual tasks call it FIRST. Each step should name a user-visible OUTCOME and how you will verify it — not mechanical steps like "read the file". Keep exactly one step in_progress; after finishing a step call this again to mark it completed and advance.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'failed'],
              },
            },
            required: ['id', 'description', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

/**
 * Build tool list from permission settings.
 */
export function buildToolDefinitions(permissions = {}) {
  const tools = [UPDATE_TODOS_TOOL];
  const readFiles = permissions.read_files !== false;
  const writeFiles = permissions.write_files !== false;

  if (readFiles) {
    tools.push(...FILE_READ_TOOLS);
  }
  if (writeFiles) {
    tools.push(...FILE_WRITE_TOOLS);
  }
  if (permissions.debugger) {
    tools.push(...DEBUG_TOOLS);
  }

  tools.push(...THEME_TOOLS);
  tools.push(...PLUGIN_TOOLS);
  if (permissions.manage_pages) {
    tools.push(...PAGE_TOOLS);
  }
  tools.push(...PREVIEW_TOOLS);
  return tools;
}

export const TOOL_LABELS = {
  read_file: 'خواندن فایل',
  edit_file: 'ویرایش فایل',
  write_file: 'نوشتن فایل',
  search_files: 'جستجوی فایل',
  search_content: 'جستجو در محتوا',
  code_graph: 'گراف کد PHP',
  graph_query: 'کاوش گراف دانش',
  validate_code: 'اعتبارسنجی کد',
  toggle_debug: 'تغییر حالت دیباگ',
  read_debug_log: 'خواندن لاگ',
  clear_debug_log: 'پاک کردن لاگ',
  check_theme: 'بررسی workspace',
  create_template: 'ایجاد قالب',
  update_template: 'ویرایش قالب',
  delete_template: 'حذف قالب',
  list_plugins: 'لیست پلاگین‌ها',
  create_page: 'ایجاد برگه',
  update_page: 'ویرایش برگه',
  update_todos: 'برنامه‌ریزی',
  preview_navigate: 'رفتن به صفحه پیش‌نمایش',
  preview_reload: 'بارگذاری مجدد پیش‌نمایش',
  preview_get_html: 'خواندن HTML پیش‌نمایش',
  preview_get_loaded_assets: 'لیست فایل‌های CSS/JS لود شده',
  preview_get_element_styles: 'بررسی CSS المان',
};

export default buildToolDefinitions;
