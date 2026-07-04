/**
 * Skill tools — the model-invoked side of the skill system (see registry.js).
 *
 * buildSkillTools() returns three SDK tools shared by planner and executor:
 *
 *   use_skill(id)                          — L2: loads a skill's full SKILL.md
 *                                            body into the run as a tool result,
 *                                            and records the id in loadedRef so
 *                                            downstream runs re-inject it (see
 *                                            buildLoadedSkillsBlock in prompt.js).
 *   read_skill_resource(skill_id, path)    — L3: reads a bundled reference file
 *                                            of a loaded skill.
 *   search_skill_data(skill_id, dataset,   — L3: BM25 search over a bundled
 *                     query, max_results)    dataset; only the top rows enter
 *                                            the context, never the whole file.
 *
 * `loadedRef` is a `{ current: Set<string> }` captured by reference — the node
 * repoints/reseeds `.current` per invocation from state.loaded_skills, same
 * pattern as the timelineRef the nodes already use. `logger` is the node's
 * `{ toolCall, toolResult }` timeline logger so skill activity shows up in the
 * UI like every other tool call.
 */

import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  getSkillBodies,
  hasSkill,
  listSkillDatasets,
  listSkillResources,
  readSkillResource,
} from './registry.js';
import { searchSkillData } from './search.js';

/** Cap a single dataset row's rendered size so one verbose row can't flood the context. */
const MAX_ROW_CHARS = 2400;

function formatRow(row, index) {
  const lines = Object.entries(row)
    .filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  let text = lines.join('\n');
  if (text.length > MAX_ROW_CHARS) text = `${text.slice(0, MAX_ROW_CHARS)}… (truncated)`;
  return `--- result ${index + 1} ---\n${text}`;
}

export function buildSkillTools({ node, logger, loadedRef }) {
  const withLogging = (name, execute) => async (args) => {
    logger.toolCall(name, args, { node });
    let result;
    try {
      result = await execute(args);
    } catch (error) {
      result = `Error: ${error.message}`;
    }
    logger.toolResult(name, result, { node, success: !String(result).startsWith('Error:') });
    return result;
  };

  return [
    tool({
      name: 'use_skill',
      description: 'Load the full instructions of a skill from the skill catalog. Call it as soon as the work matches a skill\'s description — before planning or implementing that part. The returned document is expert guidance you must follow; it may also list bundled resources/datasets to access via read_skill_resource / search_skill_data.',
      parameters: z.object({
        id: z.string().describe('A skill id copied exactly from the skill catalog'),
      }),
      execute: withLogging('use_skill', ({ id }) => {
        if (!hasSkill(id)) {
          return `Error: unknown skill id "${id}". Use an id exactly as it appears in the skill catalog.`;
        }
        if (loadedRef.current.has(id)) {
          return `Skill "${id}" is already loaded — its guidance is in your context (see the LOADED SKILLS block or an earlier use_skill result). Do not load it again.`;
        }

        loadedRef.current.add(id);
        const [skill] = getSkillBodies([id]);
        const resources = listSkillResources(id);
        const datasets = listSkillDatasets(id);
        const extras = [
          datasets.length ? `Datasets available via search_skill_data (skill_id "${id}"): ${datasets.join(', ')}` : null,
          resources.length ? `Bundled resources available via read_skill_resource: ${resources.join(', ')}` : null,
        ].filter(Boolean).join('\n');

        return `# Skill loaded: ${skill.title} (id: ${id})\n\n${skill.body}${extras ? `\n\n---\n${extras}` : ''}`;
      }),
    }),

    tool({
      name: 'read_skill_resource',
      description: 'Read a reference file bundled inside a skill (paths are listed by use_skill and inside the skill\'s own instructions). Use for deep-dive docs the skill points you to.',
      parameters: z.object({
        skill_id: z.string().describe('The skill id the resource belongs to'),
        path: z.string().describe('Skill-relative resource path, e.g. "references/checklist.md"'),
      }),
      execute: withLogging('read_skill_resource', async ({ skill_id, path }) => {
        const content = await readSkillResource(skill_id, path);
        if (content == null) {
          const available = listSkillResources(skill_id);
          return `Error: resource "${path}" not found in skill "${skill_id}".${available.length ? ` Available: ${available.join(', ')}` : ' This skill bundles no resources.'}`;
        }
        return content;
      }),
    }),

    tool({
      name: 'search_skill_data',
      description: 'Keyword-search a dataset bundled inside a skill (dataset names are listed by use_skill). Returns only the top-ranked rows — use this instead of guessing design values (styles, palettes, font pairings, UX rules) from memory.',
      parameters: z.object({
        skill_id: z.string().describe('The skill id the dataset belongs to'),
        dataset: z.string().describe('Dataset name, e.g. "styles" or "stacks/html-tailwind"'),
        query: z.string().describe('Free-text keywords describing what you need, e.g. "beauty spa elegant landing"'),
        max_results: z.number().int().nullable().describe('How many top rows to return (default 3, max 10)'),
      }),
      execute: withLogging('search_skill_data', async ({ skill_id, dataset, query, max_results }) => {
        const limit = Math.min(Math.max(max_results ?? 3, 1), 10);
        const rows = await searchSkillData(skill_id, dataset, query, limit);
        if (rows == null) {
          const available = listSkillDatasets(skill_id);
          return `Error: dataset "${dataset}" not found in skill "${skill_id}".${available.length ? ` Available: ${available.join(', ')}` : ' This skill bundles no datasets.'}`;
        }
        const result = !rows.length
          ? `No rows matched "${query}" in ${skill_id}/${dataset}. Try broader or different keywords.`
          : rows.map(formatRow).join('\n\n');
        console.log('[ToolExecutor] search_skill_data', { args: { skill_id, dataset, query, max_results }, result });
        return result;
      }),
    }),
  ];
}

export default buildSkillTools;
