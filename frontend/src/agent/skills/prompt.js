/**
 * Prompt blocks for the skill system (see registry.js for the skill model).
 *
 * buildSkillCatalogBlock()  — the always-on L1 manifest, baked into planner/
 *                             executor instructions: every skill's id + title +
 *                             description + keywords, grouped by category, plus
 *                             the rules for when to call use_skill. This is the
 *                             Claude Code pattern: the model itself selects
 *                             skills in-context at the moment of need — there
 *                             is no separate selector call.
 * buildLoadedSkillsBlock()  — full bodies of skills already loaded earlier in
 *                             the turn. Needed because each planner/executor/
 *                             validator run is a fresh SDK run: a skill loaded
 *                             as a tool result in one run isn't in the next
 *                             run's context, so state.loaded_skills carries the
 *                             ids forward and this block re-injects the bodies.
 * buildDesignBriefBlock()   — the site owner's design preferences from plugin
 *                             settings (style, colors, notes). Always-on
 *                             project context, above any skill: skills say HOW
 *                             to execute a style well, the brief says WHAT this
 *                             site's style/tokens are.
 */

import { getSkillManifest, getSkillBodies } from './registry.js';

/** The always-on skill catalog + usage rules, for node instructions. */
export function buildSkillCatalogBlock() {
  const manifest = getSkillManifest();
  if (!manifest.length) return '';

  const byCategory = new Map();
  for (const skill of manifest) {
    if (!byCategory.has(skill.category)) byCategory.set(skill.category, []);
    byCategory.get(skill.category).push(skill);
  }

  const lines = [];
  for (const [category, skills] of byCategory) {
    lines.push(`### ${category}`);
    for (const skill of skills) {
      const keywords = skill.keywords ? ` | keywords: ${skill.keywords}` : '';
      lines.push(`- id: "${skill.id}" — ${skill.title}: ${skill.description}${keywords}`);
    }
  }

  return `

## Skill catalog

Specialized skill documents are available — focused domain expertise (UI/UX design styles, WordPress technical areas) too specific to keep always-on, but that sharpens your work a lot when it applies. Only the catalog below is in your context; a skill's full instructions load when you call the use_skill tool with its id.

${lines.join('\n')}

Rules for using skills:
- Call use_skill(id) as soon as you can tell the work matches a skill's description — BEFORE planning or implementing that part. Load every skill that genuinely applies (several at once is fine); load none when nothing applies (simple copy tweaks, generic questions).
- MANDATORY for front-end design work: if the task involves designing, building, or redesigning any UI — a page, section, component, layout, theme, or how something looks — you MUST load at least one uiux skill. If the DESIGN PREFERENCES block names a style, load that skill; otherwise infer the closest style from the request's context (industry, tone, audience).
- A loaded skill may tell you to read bundled reference files (read_skill_resource) or search its datasets (search_skill_data). Follow those instructions — the skill's data is curated and beats guessing from memory.
- Skills loaded earlier in this turn appear in a LOADED SKILLS block in your input — they still apply; do not re-load them.`;
}

const DEFAULT_LOADED_SKILLS_INTRO = 'LOADED SKILLS — the following skills were loaded earlier in this turn and their guidance applies to all of your work now (do not load them again):';

/** Re-inject bodies of skills already loaded this turn (state.loaded_skills). */
export function buildLoadedSkillsBlock(loadedIds, intro = DEFAULT_LOADED_SKILLS_INTRO) {
  const skills = getSkillBodies(loadedIds);
  if (!skills.length) return null;

  const blocks = skills.map((skill) => `## Skill: ${skill.title} (id: ${skill.id})\n\n${skill.body}`).join('\n\n---\n\n');
  return `${intro}\n\n${blocks}`;
}

const DESIGN_FIELD_LABELS = [
  ['style', 'Design style (uiux skill id)'],
  ['primary_color', 'Primary/brand color'],
  ['accent_color', 'Accent color'],
  ['notes', 'Brand notes (fonts, tone, references)'],
];

/**
 * Render the site owner's design settings as an always-on prompt block.
 * Returns '' when nothing is configured, so callers can just concatenate.
 * @param {{style?: string, primary_color?: string, accent_color?: string, notes?: string}|null} design
 */
export function buildDesignBriefBlock(design) {
  if (!design || typeof design !== 'object') return '';

  const lines = DESIGN_FIELD_LABELS
    .filter(([key]) => typeof design[key] === 'string' && design[key].trim())
    .map(([key, label]) => `- ${label}: ${design[key].trim()}`);
  if (!lines.length) return '';

  return `

## DESIGN PREFERENCES

The site owner configured these design preferences in the plugin settings. They OVERRIDE skill defaults and your own taste — apply them to every visual decision (colors, typography, spacing, components):

${lines.join('\n')}

${design.style?.trim() ? `For any front-end design work, load the "${design.style.trim()}" skill via use_skill and execute in that style.` : ''}
If a preference is not listed, decide it from the loaded uiux skill and the site's existing look.`;
}

export default { buildSkillCatalogBlock, buildLoadedSkillsBlock, buildDesignBriefBlock };
