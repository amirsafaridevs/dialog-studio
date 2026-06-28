/**
 * Working memory (scratchpad) — cheap, in-session, survives history trimming.
 *
 * The message history gets trimmed for context safety, which means facts the
 * agent discovered 10 steps ago (where a class lives, how many lines a file has,
 * which template id the footer is) can fall out of view — causing it to re-read
 * and repeat work. The scratchpad keeps a compact, de-duplicated list of those
 * established facts and injects them into every turn. No persistence, no
 * learning across sessions: it lives and dies with one runAgentLoop call.
 */

const MAX_FACTS = 40;

export function createScratchpad() {
  // key → fact text. Keyed so re-discovering the same thing overwrites, not duplicates.
  const facts = new Map();

  function add(key, text) {
    if (!key || !text) return;
    facts.delete(key); // re-insert so most-recent stays at the end
    facts.set(key, text);
  }

  function render() {
    if (facts.size === 0) return '';
    const recent = [...facts.values()].slice(-MAX_FACTS);
    return [
      'WORKING MEMORY — facts already established this session. Trust these; do NOT re-read or re-search to rediscover them:',
      ...recent.map((fact) => `- ${fact}`),
    ].join('\n');
  }

  return { add, render };
}

function firstString(...candidates) {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Derive durable facts from a tool result and store them on the scratchpad.
 * Intentionally conservative — only records high-signal, reusable facts.
 */
export function recordToolFacts(scratchpad, toolName, toolArgs = {}, payload = {}) {
  if (!scratchpad) return;
  const data = (payload && typeof payload === 'object' && payload.data) || {};
  const ok = payload?.success !== false;
  if (!ok) return;

  switch (toolName) {
    case 'read_file': {
      const path = toolArgs.path;
      if (path && data.line_count != null) {
        scratchpad.add(`file:${path}`, `${path} → ${data.line_count} lines (already read)`);
      }
      break;
    }

    case 'edit_file':
    case 'write_file': {
      const path = toolArgs.path;
      if (path) scratchpad.add(`edited:${path}`, `Edited ${path}`);
      break;
    }

    case 'search_content':
    case 'search_files': {
      const results = Array.isArray(data.results) ? data.results : [];
      const keywords = Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(', ') : '';
      const paths = results.map((r) => r.path).filter(Boolean).slice(0, 4);
      if (keywords && paths.length) {
        scratchpad.add(`search:${keywords}`, `"${keywords}" found in: ${paths.join(', ')}`);
      }
      break;
    }

    case 'create_template':
    case 'update_template': {
      const label = firstString(data.slug, toolArgs.slug, data.title, toolArgs.title);
      const id = data.id ?? toolArgs.id;
      if (label) scratchpad.add(`template:${label}`, `Template "${label}"${id != null ? ` (id ${id})` : ''}`);
      break;
    }

    case 'create_page':
    case 'update_page': {
      const label = firstString(data.title, toolArgs.title, data.slug, toolArgs.slug);
      const id = data.id ?? data.page_id ?? toolArgs.id;
      if (label) scratchpad.add(`page:${label}`, `Page "${label}"${id != null ? ` (id ${id})` : ''}`);
      break;
    }

    default:
      break;
  }
}

export default createScratchpad;
