/**
 * Keeps LLM context within safe limits by compacting tool output and trimming history.
 */

import { AIMessage } from '@langchain/core/messages';

const MAX_TOOL_RESULT_CHARS = 10_000;
const MAX_CONTEXT_CHARS = 180_000;
const MAX_RECENT_MESSAGES = 32;

function getMessageText(message) {
  const content = message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.text || item?.content || '';
      })
      .join('');
  }

  return content == null ? '' : String(content);
}

function getMessageType(message) {
  return message?.getType?.() || message?._getType?.() || message?.role || 'unknown';
}

function truncateText(text, maxChars, suffix = '\n…[truncated]') {
  if (!text || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function compactRegistry(registry = {}, maxSymbols = 120) {
  const entries = Object.entries(registry).slice(0, maxSymbols);

  return Object.fromEntries(
    entries.map(([name, symbol]) => {
      const compact = {
        type: symbol.type,
        file: symbol.file,
      };

      if (Array.isArray(symbol.methods) && symbol.methods.length > 0) {
        compact.methods = symbol.methods.slice(0, 12);
        if (symbol.methods.length > 12) {
          compact.methods_truncated = symbol.methods.length - 12;
        }
      }

      return [name, compact];
    })
  );
}

function compactGraph(graph = {}, maxNodes = 150, maxEdges = 250) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice(0, maxNodes) : [];
  const edges = Array.isArray(graph.edges) ? graph.edges.slice(0, maxEdges) : [];

  return {
    nodes,
    edges,
    nodes_truncated: Array.isArray(graph.nodes) && graph.nodes.length > maxNodes
      ? graph.nodes.length - maxNodes
      : 0,
    edges_truncated: Array.isArray(graph.edges) && graph.edges.length > maxEdges
      ? graph.edges.length - maxEdges
      : 0,
  };
}

function compactSearchResults(results = [], maxItems = 15) {
  return results.slice(0, maxItems).map((item) => {
    const compact = {
      path: item.path,
      name: item.name,
    };

    if (Array.isArray(item.matches)) {
      const maxMatchesShown = 8;
      compact.matches = item.matches.slice(0, maxMatchesShown).map((match) => {
        if (match.line_number != null) {
          return {
            line_number: match.line_number,
            line_content: truncateText(match.line_content || '', 200),
          };
        }

        return match;
      });

      const totalMatches = item.match_count ?? item.matches.length;
      if (totalMatches > compact.matches.length) {
        compact.matches_truncated = totalMatches - compact.matches.length;
        compact.next_step = 'Use read_file with start_line/end_line around these line numbers — do not search again for the same keywords.';
      }
    }

    if (item.match_count != null) {
      compact.match_count = item.match_count;
    }

    return compact;
  });
}

/**
 * Shrink tool payloads before they enter conversation history.
 */
export function compactToolPayload(toolName, payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const compact = { ...payload };

  if (compact.data && typeof compact.data === 'object') {
    const data = { ...compact.data };

    if (toolName === 'read_file' && typeof data.content === 'string') {
      const originalLength = data.content.length;
      data.content = truncateText(data.content, 6_000);
      data.content_truncated = originalLength > data.content.length;
      if (data.content_truncated && data.line_count) {
        data.hint = 'File was truncated. Re-read with start_line/end_line in ~100-line chunks (increment start_line until you find the section). Do not use search_content — the index already named this file.';
      }
    }

    if (toolName === 'read_debug_log' && typeof data.content === 'string') {
      data.content = truncateText(data.content, 4_000);
    }

    if (toolName === 'code_graph') {
      if (data.registry && typeof data.registry === 'object') {
        const originalCount = Object.keys(data.registry).length;
        data.registry = compactRegistry(data.registry, 120);
        data.symbol_count = data.symbol_count ?? originalCount;
        if (originalCount > Object.keys(data.registry).length) {
          data.registry_truncated = originalCount - Object.keys(data.registry).length;
        }
      }

      if (data.graph && typeof data.graph === 'object') {
        data.graph = compactGraph(data.graph, 150, 250);
      }
    }

    if (toolName === 'validate_code' && Array.isArray(data.issues)) {
      const originalCount = data.issues.length;
      data.issues = data.issues.slice(0, 50);
      if (originalCount > data.issues.length) {
        data.issues_truncated = originalCount - data.issues.length;
      }
    }

    if ((toolName === 'edit_file' || toolName === 'write_file') && data.code_validation) {
      const validation = { ...data.code_validation };
      if (Array.isArray(validation.issues)) {
        const originalCount = validation.issues.length;
        validation.issues = validation.issues.slice(0, 20);
        if (originalCount > validation.issues.length) {
          validation.issues_truncated = originalCount - validation.issues.length;
        }
      }
      data.code_validation = validation;

      if (validation.valid === false) {
        data.hint = 'Syntax errors were found after save. Fix them with another edit_file call before continuing or finishing the task.';
      } else if (validation.valid === true && !validation.skipped) {
        data.hint = 'Post-save syntax check passed for this file.';
      }
    }

    if (toolName === 'search_files' && Array.isArray(data.results)) {
      data.results = compactSearchResults(data.results, 20);
      data.count = compact.data.count ?? data.results.length;
      if (compact.data.truncated) {
        data.truncated = true;
      }
    }

    if (toolName === 'search_content' && Array.isArray(data.results)) {
      data.results = compactSearchResults(data.results, 12);
      data.count = compact.data.count ?? data.results.length;
      if (compact.data.truncated) {
        data.truncated = true;
      }
    }

    if (toolName === 'preview_get_html' && typeof data.html === 'string') {
      const originalLength = data.html.length;
      data.html = truncateText(data.html, 4_500);
      data.content_truncated = originalLength > data.html.length || Boolean(data.truncated);
    }

    if (
      (toolName === 'preview_navigate' || toolName === 'preview_reload' || toolName === 'preview_get_html')
      && compact.success === false
    ) {
      if (Array.isArray(data.hints) && data.hints.length) {
        data.hint = data.hints.join(' ');
      }

      if (Array.isArray(data.consoleErrors) && data.consoleErrors.length) {
        data.console_errors = data.consoleErrors.slice(0, 5);
      }

      if (Array.isArray(data.networkFailures) && data.networkFailures.length) {
        data.network_failures = data.networkFailures.slice(0, 5);
      }

      if (data.diagnostics && typeof data.diagnostics === 'object') {
        data.page = {
          url: data.diagnostics.url,
          title: data.diagnostics.title,
          readyState: data.diagnostics.readyState,
          previewParamPresent: data.diagnostics.previewParamPresent,
          bridgeScriptPresent: data.diagnostics.bridgeScriptPresent,
        };

        if (typeof data.diagnostics.bodySnippet === 'string' && data.diagnostics.bodySnippet) {
          data.page_snippet = truncateText(data.diagnostics.bodySnippet, 300);
        }
      }

      delete data.hints;
      delete data.consoleErrors;
      delete data.networkFailures;
      delete data.diagnostics;
    }

    compact.data = data;
  }

  const serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) {
    return compact;
  }

  return {
    success: compact.success,
    error: compact.error,
    data: {
      note: 'Tool output was too large and has been summarized for context safety.',
      preview: truncateText(serialized, MAX_TOOL_RESULT_CHARS - 200),
    },
  };
}

export function formatToolResultForLLM(toolName, payload) {
  const compact = compactToolPayload(toolName, payload);
  return truncateText(JSON.stringify(compact), MAX_TOOL_RESULT_CHARS);
}

function omitToolCallsFromKwargs(kwargs = {}) {
  if (!kwargs || typeof kwargs !== 'object') {
    return kwargs;
  }

  const { tool_calls: _toolCalls, ...rest } = kwargs;
  return rest;
}

function countFollowingToolMessages(messages, startIndex) {
  let count = 0;

  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (getMessageType(messages[index]) === 'tool') {
      count += 1;
      continue;
    }
    break;
  }

  return count;
}

function findActiveToolChain(repaired) {
  if (!repaired.length) {
    return null;
  }

  let index = repaired.length - 1;
  while (index >= 0 && getMessageType(repaired[index]) === 'tool') {
    index -= 1;
  }

  const aiMessage = index >= 0 ? repaired[index] : null;
  if (!aiMessage || !messageHasToolCalls(aiMessage)) {
    return null;
  }

  return {
    expected: aiMessage.tool_calls.length,
    toolsReceived: repaired.length - 1 - index,
  };
}

function canAcceptToolMessage(repaired) {
  const previous = repaired[repaired.length - 1];
  if (!previous) {
    return false;
  }

  const previousType = getMessageType(previous);

  if (
    (previousType === 'ai' || previousType === 'assistant')
    && messageHasToolCalls(previous)
  ) {
    return true;
  }

  if (previousType === 'tool') {
    const chain = findActiveToolChain(repaired);
    return Boolean(chain && chain.toolsReceived < chain.expected);
  }

  return false;
}

function getToolChainLength(messages, startIndex) {
  const message = messages[startIndex];
  const type = getMessageType(message);

  if (type === 'tool') {
    let start = startIndex;
    while (start > 0 && getMessageType(messages[start - 1]) === 'tool') {
      start -= 1;
    }

    if (start > 0) {
      const maybeAI = messages[start - 1];
      const maybeType = getMessageType(maybeAI);
      if ((maybeType === 'ai' || maybeType === 'assistant') && messageHasToolCalls(maybeAI)) {
        start -= 1;
      }
    }

    let length = 0;
    for (let index = start; index < messages.length; index += 1) {
      const msgType = getMessageType(messages[index]);
      if (
        index === start
        && (msgType === 'ai' || msgType === 'assistant')
        && messageHasToolCalls(messages[index])
      ) {
        length += 1;
        continue;
      }

      if (msgType === 'tool') {
        length += 1;
        continue;
      }

      break;
    }

    return length || 1;
  }

  if ((type !== 'ai' && type !== 'assistant') || !message?.tool_calls?.length) {
    return 1;
  }

  let length = 1;
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (getMessageType(messages[index]) === 'tool') {
      length += 1;
      continue;
    }
    break;
  }

  return length;
}

function messageHasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

/**
 * Convert AI turns with missing tool results into plain assistant text.
 */
export function sanitizeIncompleteToolChains(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const sanitized = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (messageHasToolCalls(message)) {
      const expected = message.tool_calls.length;
      const actual = countFollowingToolMessages(messages, index);

      if (actual < expected) {
        sanitized.push(new AIMessage({
          content: getMessageText(message) || '',
          additional_kwargs: omitToolCallsFromKwargs(message.additional_kwargs),
          response_metadata: message.response_metadata,
        }));
        index += actual;
        continue;
      }
    }

    sanitized.push(message);
  }

  return sanitized;
}

/**
 * Drop orphan tool messages while preserving full multi-tool response chains.
 */
export function repairMessageSequence(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const repaired = [];

  for (const message of messages) {
    const type = getMessageType(message);

    if (type === 'tool' && !canAcceptToolMessage(repaired)) {
      continue;
    }

    repaired.push(message);
  }

  return repaired;
}

/**
 * Trim message history while preserving the opening user turn and recent turns.
 * AI messages with tool_calls are always removed together with their tool results.
 */
export function trimMessagesForLLM(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const selected = [];
  const seen = new Set();
  let totalChars = 0;

  const firstUserIndex = messages.findIndex((message) => {
    const type = getMessageType(message);
    return type === 'human' || type === 'user';
  });

  const pushMessage = (message) => {
    if (seen.has(message)) {
      return;
    }

    seen.add(message);
    const size = getMessageText(message).length;
    selected.push(message);
    totalChars += size;
  };

  if (firstUserIndex >= 0) {
    pushMessage(messages[firstUserIndex]);
  }

  const recent = messages.slice(-MAX_RECENT_MESSAGES);
  for (const message of recent) {
    if (firstUserIndex >= 0 && message === messages[firstUserIndex]) {
      continue;
    }
    pushMessage(message);
  }

  while (totalChars > MAX_CONTEXT_CHARS && selected.length > 2) {
    const removableIndex = selected.findIndex((message, index) => {
      if (index === 0) return false;
      const type = getMessageType(message);
      return type === 'tool' || type === 'ai' || type === 'assistant';
    });

    if (removableIndex < 0) {
      break;
    }

    const removeCount = getToolChainLength(selected, removableIndex);
    for (let index = 0; index < removeCount; index += 1) {
      totalChars -= getMessageText(selected[removableIndex]).length;
      seen.delete(selected[removableIndex]);
      selected.splice(removableIndex, 1);
    }
  }

  return repairMessageSequence(sanitizeIncompleteToolChains(selected));
}


function isStylesheetPath(filePath = '') {
  return /\.(css|scss)$/i.test(filePath);
}

function formatIndexedFile(file) {
  const parts = [];

  if (file.classes?.length) {
    const label = isStylesheetPath(file.path) ? 'css_classes' : 'php_classes';
    const preview = file.classes.slice(0, 20).join(', ');
    const suffix = file.classes.length > 20 ? ` (+${file.classes.length - 20} more)` : '';
    parts.push(`${label}: ${preview}${suffix}`);
  }

  if (file.methods?.length) {
    parts.push(`methods: ${file.methods.slice(0, 12).join(', ')}`);
  }

  if (file.functions?.length) {
    parts.push(`functions: ${file.functions.slice(0, 12).join(', ')}`);
  }

  if (!parts.length) {
    return null;
  }

  return `- ${file.path}: ${parts.join('; ')}`;
}

function normalizeIndexedPath(path = '') {
  if (!path || typeof path !== 'string') {
    return null;
  }

  let normalized = path.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  // Strip both old wp-content/dialog/ prefix and new wp-content/themes/{slug}/ prefix
  normalized = normalized.replace(/^wp-content\/dialog\/?/i, '');
  normalized = normalized.replace(/^wp-content\/themes\/[^/]+\/?/i, '');
  normalized = normalized.replace(/^dialog\/?/i, '');
  return normalized || null;
}

function normalizeSearchKeyword(keyword = '') {
  return String(keyword)
    .trim()
    .replace(/^\.+/, '')
    .replace(/^#+/, '')
    .toLowerCase();
}

function buildSymbolToFilesMap(files = []) {
  const map = new Map();

  for (const file of files) {
    const symbols = [
      ...(file.classes || []),
      ...(file.functions || []),
      ...(file.methods || []),
    ];

    for (const symbol of symbols) {
      const key = normalizeSearchKeyword(symbol);
      if (!key) {
        continue;
      }
      if (!map.has(key)) {
        map.set(key, new Set());
      }
      map.get(key).add(file.path);
    }
  }

  return map;
}

function resolveIndexedFilePath(path, indexedPaths) {
  const normalized = normalizeIndexedPath(path);
  if (!normalized) {
    return null;
  }

  if (indexedPaths.has(normalized)) {
    return normalized;
  }

  const basename = normalized.split('/').pop();
  if (basename && indexedPaths.has(basename)) {
    return basename;
  }

  return null;
}

function isDialogThemeScope(path) {
  if (!path) {
    return true;
  }

  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('plugins/') || normalized.includes('wp-includes') || normalized.includes('wp-admin')) {
    return false;
  }

  return (
    normalized.startsWith('assets/')
    || normalized.startsWith('inc/')
    || normalized.startsWith('template-parts/')
    || normalized === 'style.css'
    || normalized === 'functions.php'
    || normalized === 'index.php'
    || normalized === 'header.php'
    || normalized === 'footer.php'
    || (!normalized.includes('wp-content/') && !normalized.includes('wp-includes') && !normalized.includes('wp-admin'))
  );
}

/**
 * Block search_content when the Dialog Code Index already resolves the target.
 * Returns an error payload, or null when the search may proceed.
 */
export function guardSearchContent(codeIndex, args = {}) {
  const files = codeIndex?.files;
  if (!Array.isArray(files) || !files.length) {
    return null;
  }

  const indexedPaths = new Set(files.map((file) => file.path));
  const symbolMap = buildSymbolToFilesMap(files);
  const searchPath = args.path ? String(args.path) : '';

  if (!isDialogThemeScope(searchPath)) {
    return null;
  }

  const indexedFile = resolveIndexedFilePath(searchPath, indexedPaths);
  if (indexedFile) {
    return {
      success: false,
      error: 'SEARCH_BLOCKED_INDEXED_FILE',
      message: `Dialog Code Index already lists \`${indexedFile}\`. Do not search inside it — call read_file("${indexedFile}") directly. For large files, read in chunks with start_line/end_line; file size is never a reason to search.`,
    };
  }

  const keywords = Array.isArray(args.keywords) ? args.keywords : [];
  const matched = new Map();

  for (const keyword of keywords) {
    const normalized = normalizeSearchKeyword(keyword);
    const paths = symbolMap.get(normalized);
    if (!paths) {
      continue;
    }
    matched.set(normalized, paths);
  }

  if (!matched.size) {
    return null;
  }

  const allPaths = new Set();
  for (const paths of matched.values()) {
    paths.forEach((filePath) => allPaths.add(filePath));
  }

  if (allPaths.size === 1) {
    const file = [...allPaths][0];
    const symbols = [...matched.keys()].join(', ');
    return {
      success: false,
      error: 'SEARCH_BLOCKED_INDEXED_SYMBOL',
      message: `Dialog Code Index maps ${symbols} → \`${file}\`. Do not search — call read_file("${file}") directly (use start_line/end_line for large files).`,
    };
  }

  return null;
}

export function buildCodeIndexBlock(codeIndex) {
  if (!codeIndex?.files?.length) {
    return '';
  }

  const lines = [
    'Dialog code index (preloaded every message — paths are workspace-relative; read_file directly using these paths):',
    'Layout: style.css, functions.php, assets/front|admin/{css,js,img}, inc/*.php, template-parts/',
  ];

  const templates = [];
  const others = [];

  for (const file of codeIndex.files) {
    const entry = formatIndexedFile(file);
    if (!entry) {
      continue;
    }

    const normalizedPath = String(file.path || '');
    if (
      normalizedPath.startsWith('templates/')
      || normalizedPath.includes('/templates/')
    ) {
      templates.push(entry);
    } else {
      others.push(entry);
    }
  }

  if (templates.length) {
    lines.push('Registered templates:');
    lines.push(...templates);
  }

  if (others.length) {
    lines.push('Other indexed files:');
    lines.push(...others.slice(0, 40));
    if (others.length > 40) {
      lines.push(`… ${others.length - 40} more files indexed (search only if you need a symbol not listed here).`);
    }
  }

  return lines.join('\n');
}

/**
 * Render the always-on project knowledge graph block: a high-level mental map of
 * BOTH the writable child theme and its read-only parent. god nodes show where
 * the codebase's gravity is, overrides show what the child has already replaced,
 * and communities give a coarse table of contents. For anything deeper the agent
 * calls graph_query (explain/path) instead of re-reading files.
 */
export function buildKnowledgeGraphBlock(knowledgeGraph) {
  if (!knowledgeGraph || typeof knowledgeGraph !== 'object') {
    return '';
  }

  const child = knowledgeGraph.child || {};
  const parent = knowledgeGraph.parent || null;
  const godNodes = Array.isArray(knowledgeGraph.god_nodes) ? knowledgeGraph.god_nodes : [];
  const overrides = Array.isArray(knowledgeGraph.overrides) ? knowledgeGraph.overrides : [];
  const communities = Array.isArray(knowledgeGraph.communities) ? knowledgeGraph.communities : [];

  const lines = [
    'Project knowledge graph (preloaded every message — your mental map of the WHOLE project):',
    parent
      ? `- Two themes: child \`${child.slug || '?'}\` (${child.file_count ?? 0} files, WRITABLE) is built on parent \`${parent.slug}\` (${parent.file_count ?? 0} files, READ-ONLY). To change parent behaviour you OVERRIDE it from the child — never edit the parent.`
      : `- Standalone theme \`${child.slug || '?'}\` (${child.file_count ?? 0} files, WRITABLE). No parent.`,
  ];

  if (godNodes.length) {
    lines.push('- Load-bearing symbols (most referenced — likely involved in most changes):');
    for (const node of godNodes.slice(0, 12)) {
      const where = node.file ? ` [${node.scope}:${node.file}]` : ` [${node.scope}]`;
      lines.push(`    • ${node.symbol} (${node.type}, ${node.in_degree}×)${where}`);
    }
  }

  if (overrides.length) {
    const list = overrides.slice(0, 15).map((o) => o.path).join(', ');
    const more = overrides.length > 15 ? ` (+${overrides.length - 15} more)` : '';
    lines.push(`- Child ALREADY overrides these parent files (edit the child copy): ${list}${more}`);
  }

  if (communities.length) {
    lines.push('- File communities (coarse map — read_file the relevant one, do not search blindly):');
    for (const community of communities) {
      if (!community.files?.length) continue;
      const preview = community.files.slice(0, 6).join(', ');
      const more = community.files.length > 6 ? ` …+${community.files.length - 6}` : '';
      lines.push(`    • ${community.scope}/${community.name}: ${preview}${more}`);
    }
  }

  lines.push('- Need relationships beyond this map? Call graph_query (mode:"explain" for what touches a symbol/file, mode:"path" between two). Do not grep for call sites the graph already knows.');

  return lines.join('\n');
}

const ELEMENT_TAG_PATTERN =
  /<Dialog:element\s+tag="([^"]*)"\s+path="([^"]*)">([^<]*)<\/Dialog:element>/g;

const ELEMENT_TEMPLATE_HINTS = {
  footer: 'Dialog footer template (list_templates → update_template) or assets/front/css/',
  header: 'Dialog header template (list_templates → update_template) or assets/front/css/',
  nav: 'Dialog header template or assets/front/css/',
  main: 'Dialog page/canvas template (create_template) or assets/front/css/',
};

export function parseElementTags(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const tags = [];
  const pattern = new RegExp(ELEMENT_TAG_PATTERN.source, 'g');
  let match = pattern.exec(content);

  while (match) {
    tags.push({
      tag: match[1],
      path: match[2],
      label: match[3],
    });
    match = pattern.exec(content);
  }

  return tags;
}

export function buildSelectedElementBlock(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = message?.getType?.() || message?._getType?.() || message?.role;

    if (type !== 'human' && type !== 'user') {
      continue;
    }

    const content = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => part?.text || part?.content || '').join('')
        : String(message.content ?? '');

    const elements = parseElementTags(content);
    if (!elements.length) {
      return '';
    }

    const lines = [
      'User selected element(s) on the live preview (start here — do not search for template file names you already know):',
    ];

    for (const element of elements) {
      const tag = element.tag?.toLowerCase() || '';
      const hint = ELEMENT_TEMPLATE_HINTS[tag] || 'check index for matching template/CSS file';
      lines.push(`- <${element.tag}> at \`${element.path}\` → likely ${hint}`);
    }

    lines.push('- Call preview_get_html with the selector above, then list_templates/read_file the Dialog template or CSS, and update_template/edit_file the fix.');
    return lines.join('\n');
  }

  return '';
}

export function buildThemeContextBlock(themeContext) {
  if (!themeContext) {
    return '';
  }

  const activeSlug = themeContext.active_slug || themeContext.active_theme?.slug || '';
  const activeName = themeContext.active_name || themeContext.active_theme?.name || activeSlug || 'unknown';
  const workspaceRelative = activeSlug ? `wp-content/themes/${activeSlug}` : '';
  const codeIndexBlock = buildCodeIndexBlock(themeContext.code_index);
  const knowledgeGraphBlock = buildKnowledgeGraphBlock(themeContext.knowledge_graph);

  return [
    'Session workspace context (already loaded — do not call check_theme unless the user explicitly asks):',
    workspaceRelative
      ? `- Workspace (child theme): ${workspaceRelative}`
      : '- Workspace: child theme (call check_theme to find path)',
    `- Workspace ready: ${themeContext.ready ? 'yes' : 'no'}`,
    `- Active WordPress theme: ${activeName} (${activeSlug || 'n/a'})`,
    '',
    'Path rules (critical):',
    '- NEVER use absolute filesystem paths (no C:/ or /var/...).',
    '- read_file and search_* can access any file under the WordPress install.',
    '- search_content is for unknown locations only. If the index or user selection already names the file, read_file it directly (use start_line/end_line for large CSS). One search batch per topic — never repeat with similar keywords.',
    workspaceRelative
      ? `- Examples: plugins/my-plugin/main.php, ${workspaceRelative}/assets/front/css/main.css, wp-includes/formatting.php`
      : '- Examples: plugins/my-plugin/main.php, wp-content/themes/{slug}/style.css, wp-includes/formatting.php',
    workspaceRelative
      ? `- write_file/edit_file paths are relative to the workspace root (e.g. assets/front/css/main.css, inc/my-module.php).`
      : '- write_file/edit_file paths are relative to the workspace root.',
    '- Assets: assets/admin/{css,js,img} and assets/front/{css,js,img} (auto-enqueued on site).',
    '- PHP extensions: inc/*.php files (auto-loaded like mini-plugins).',
    '- read_file returns line_count (editor-style; trailing newline is not an extra line). Use it for edit_file ranges.',
    '- search_files with no directory defaults to the workspace root. For plugins use directory: wp-content/plugins.',
    knowledgeGraphBlock ? `\n${knowledgeGraphBlock}` : '',
    codeIndexBlock ? `\n${codeIndexBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export default {
  compactToolPayload,
  formatToolResultForLLM,
  trimMessagesForLLM,
  sanitizeIncompleteToolChains,
  repairMessageSequence,
  guardSearchContent,
  buildCodeIndexBlock,
  buildKnowledgeGraphBlock,
  buildThemeContextBlock,
  buildSelectedElementBlock,
  parseElementTags,
};
