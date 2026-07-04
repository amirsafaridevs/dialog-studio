/**
 * Skill registry — file-based, model-invoked expertise (Claude Code style).
 *
 * Skills are discovered at BUILD TIME via import.meta.glob (Vite) — no runtime
 * fetch, no generated JSON, no code change to add a skill. Two layouts are
 * supported side by side:
 *
 * 1. FOLDER skills (the standard Claude Code / Agent Skills format — drop in
 *    any third-party skill repo folder as-is):
 *      skills/{category}/{skill-name}/
 *        SKILL.md            ← frontmatter (name/id, description, …) + body
 *        references/*.md     ← deep-dive docs, loaded on demand
 *        data/*.csv|json     ← searchable datasets, loaded + parsed on demand
 *        (any other bundled file is exposed as a readable resource too)
 *    The frontmatter follows the Claude convention: `name:` + `description:`
 *    (`id:`, `title:`, `category:`, `keywords:` also honored). Missing name
 *    falls back to the folder name; missing category falls back to the first
 *    path segment under skills/.
 *
 * 2. LEGACY flat skills — a single .md file with id/category/title/description/
 *    keywords frontmatter (the original dialog-studio format). Still fully
 *    supported; they simply have no resources/datasets.
 *
 * Progressive disclosure, three levels (mirrors Claude Code):
 *   L1 getSkillManifest()        — id/title/description/keywords only. Baked
 *                                  into planner/executor instructions so the
 *                                  model always knows what expertise exists.
 *   L2 getSkillBodies(ids)       — full SKILL.md body, returned by the
 *                                  use_skill tool at the moment of need.
 *   L3 readSkillResource(id, p)  — bundled reference files, lazy-loaded (Vite
 *      loadSkillDataset(id, n)     splits them into separate chunks), so big
 *                                  data never enters the main bundle nor the
 *                                  prompt — only search hits do.
 *
 * Resources and datasets are lazy: nothing under a skill folder other than
 * SKILL.md itself is downloaded until a tool actually asks for it.
 */

// Eager: every .md — cheap (bodies are small text) and needed at startup to
// build the manifest. Reference .md files inside folder skills are filtered
// out of the skill list below (they're resources, not skills).
const mdModules = import.meta.glob('./**/*.md', { query: '?raw', import: 'default', eager: true });

// Lazy: every bundleable skill asset (references, datasets, templates …).
// Each entry is a () => Promise<string> loader; Vite emits separate chunks.
const resourceLoaders = import.meta.glob('./**/*.{md,csv,json,txt}', { query: '?raw', import: 'default' });

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse the flat `key: value` frontmatter block. Unknown/malformed lines are ignored. */
function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return { meta: {}, body: raw.trim() };

  const [, frontmatter, body] = match;
  const meta = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    let value = line.slice(colonIndex + 1).trim();
    // Tolerate YAML-style quoting used by third-party SKILL.md files.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }

  return { meta, body: body.trim() };
}

/** './uiux/pro-max/SKILL.md' → { root: './uiux/pro-max', folderName: 'pro-max', category: 'uiux' } */
function describeSkillFolder(path) {
  const root = path.slice(0, -'/SKILL.md'.length);
  const segments = root.replace(/^\.\//, '').split('/');
  return {
    root,
    folderName: segments[segments.length - 1] || 'skill',
    category: segments.length > 1 ? segments[0] : 'general',
  };
}

/** First path segment of a legacy flat skill ('./uiux/x.md' → 'uiux'). */
function categoryFromPath(path) {
  const segments = path.replace(/^\.\//, '').split('/');
  return segments.length > 1 ? segments[0] : 'general';
}

/** Build the full skill list once at module load — file set is static per build. */
function loadSkills() {
  const skills = [];

  // Pass 1: folder skills (SKILL.md convention).
  const folderRoots = [];
  for (const [path, raw] of Object.entries(mdModules)) {
    if (!path.endsWith('/SKILL.md')) continue;

    const { root, folderName, category } = describeSkillFolder(path);
    const { meta, body } = parseFrontmatter(raw);

    if (!body) {
      console.warn('[skills] skipping folder skill', path, '— empty SKILL.md body');
      continue;
    }

    folderRoots.push(root);
    skills.push({
      id: meta.id || meta.name || folderName,
      category: meta.category || category,
      title: meta.title || meta.name || folderName,
      description: meta.description || '',
      keywords: meta.keywords || '',
      body,
      path,
      root,
    });
  }

  // Pass 2: legacy flat skills — any other .md NOT inside a folder-skill root.
  for (const [path, raw] of Object.entries(mdModules)) {
    if (path.endsWith('/SKILL.md')) continue;
    if (folderRoots.some((root) => path.startsWith(`${root}/`))) continue; // a folder skill's resource

    const { meta, body } = parseFrontmatter(raw);

    if (!meta.id && !meta.name) {
      console.warn('[skills] skipping', path, '— missing required "id"/"name" in frontmatter');
      continue;
    }
    if (!body) {
      console.warn('[skills] skipping', meta.id || meta.name, '— empty body');
      continue;
    }

    skills.push({
      id: meta.id || meta.name,
      category: meta.category || categoryFromPath(path),
      title: meta.title || meta.id || meta.name,
      description: meta.description || '',
      keywords: meta.keywords || '',
      body,
      path,
      root: null,
    });
  }

  const seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.id)) {
      console.warn('[skills] duplicate skill id, later file wins:', skill.id, skill.path);
    }
    seen.add(skill.id);
  }

  return skills;
}

const SKILLS = loadSkills();
const SKILLS_BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

const DATASET_EXTENSIONS = /\.(csv|json)$/i;

/** Resource paths bundled under a folder skill, keyed by skill-relative path. */
function resourceMapFor(skill) {
  if (!skill?.root) return new Map();

  const prefix = `${skill.root}/`;
  const map = new Map();
  for (const [path, loader] of Object.entries(resourceLoaders)) {
    if (!path.startsWith(prefix) || path === skill.path) continue;
    map.set(path.slice(prefix.length), loader);
  }
  return map;
}

/**
 * The lightweight manifest (L1): no bodies, just enough for the model to judge
 * relevance from id/title/description/keywords. Baked into node instructions.
 * @returns {Array<{id:string, category:string, title:string, description:string, keywords:string}>}
 */
export function getSkillManifest() {
  return SKILLS.map(({ id, category, title, description, keywords }) => ({
    id,
    category,
    title,
    description,
    keywords,
  }));
}

/**
 * Resolve skill ids to their full bodies (L2), in the order given.
 * Unknown ids are silently skipped (defensive against a model hallucinating an id).
 * @param {string[]} ids
 * @returns {Array<{id:string, title:string, category:string, body:string}>}
 */
export function getSkillBodies(ids) {
  if (!Array.isArray(ids)) return [];

  const bodies = [];
  for (const id of ids) {
    const skill = SKILLS_BY_ID.get(id);
    if (!skill) {
      console.warn('[skills] unknown skill id, skipping:', id);
      continue;
    }
    bodies.push({ id: skill.id, title: skill.title, category: skill.category, body: skill.body });
  }
  return bodies;
}

/** True if the id exists in the registry. */
export function hasSkill(id) {
  return SKILLS_BY_ID.has(id);
}

/**
 * Skill-relative paths of every bundled resource of a folder skill (L3) —
 * references/*.md, data/*.csv, … Legacy flat skills return [].
 * @param {string} id
 * @returns {string[]}
 */
export function listSkillResources(id) {
  return [...resourceMapFor(SKILLS_BY_ID.get(id)).keys()].sort();
}

/**
 * Read one bundled resource of a skill by its skill-relative path (L3).
 * Returns the raw file content, or null when the skill/resource doesn't exist.
 * @param {string} id
 * @param {string} relativePath e.g. "references/checklist.md" or "data/styles.csv"
 * @returns {Promise<string|null>}
 */
export async function readSkillResource(id, relativePath) {
  const normalized = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\.?\//, '');
  const loader = resourceMapFor(SKILLS_BY_ID.get(id)).get(normalized);
  if (!loader) return null;
  return await loader();
}

/**
 * Dataset names of a skill — every data/**\/*.csv|json resource, keyed by its
 * path relative to data/ without the extension (e.g. "styles",
 * "stacks/html-tailwind").
 * @param {string} id
 * @returns {string[]}
 */
export function listSkillDatasets(id) {
  const names = [];
  for (const path of resourceMapFor(SKILLS_BY_ID.get(id)).keys()) {
    if (path.startsWith('data/') && DATASET_EXTENSIONS.test(path)) {
      names.push(path.slice('data/'.length).replace(DATASET_EXTENSIONS, ''));
    }
  }
  return names.sort();
}

/** RFC-4180-ish CSV parser: quoted fields, "" escapes, newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);

  return rows;
}

/** CSV → array of {header: value} objects; JSON → its array (or single-object wrap). */
function parseDataset(relativePath, raw) {
  if (/\.json$/i.test(relativePath)) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const rows = parseCsv(raw);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? '';
    });
    return record;
  });
}

const datasetCache = new Map();

/**
 * Load + parse one dataset of a skill into an array of plain-object rows.
 * Cached after first load. Returns null when the skill/dataset doesn't exist.
 * @param {string} id
 * @param {string} dataset name from listSkillDatasets() (e.g. "styles")
 * @returns {Promise<Array<Record<string, unknown>>|null>}
 */
export async function loadSkillDataset(id, dataset) {
  const normalized = String(dataset ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(DATASET_EXTENSIONS, '');
  const cacheKey = `${id}::${normalized}`;
  if (datasetCache.has(cacheKey)) return datasetCache.get(cacheKey);

  const resources = resourceMapFor(SKILLS_BY_ID.get(id));
  const relativePath = ['csv', 'json']
    .map((extension) => `data/${normalized}.${extension}`)
    .find((candidate) => resources.has(candidate));
  if (!relativePath) return null;

  const raw = await resources.get(relativePath)();
  const rows = parseDataset(relativePath, raw);
  datasetCache.set(cacheKey, rows);
  return rows;
}

/** All distinct categories present in the manifest, in first-seen order. */
export function getSkillCategories() {
  return [...new Set(SKILLS.map((skill) => skill.category))];
}

export default {
  getSkillManifest,
  getSkillBodies,
  hasSkill,
  listSkillResources,
  readSkillResource,
  listSkillDatasets,
  loadSkillDataset,
  getSkillCategories,
};
