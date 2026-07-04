/**
 * BM25 keyword search over skill datasets (see registry.js loadSkillDataset).
 *
 * This is the JS port of the "search script" pattern used by Claude Code
 * skills like ui-ux-pro-max (which ships a Python BM25 CLI): the dataset —
 * hundreds of curated rows about styles/palettes/fonts/UX rules — never
 * enters the prompt; the model queries it through the search_skill_data tool
 * and only the top-ranked rows do. No dependencies, index cached per dataset.
 */

import { loadSkillDataset } from './registry.js';

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function tokenize(text) {
  return (String(text ?? '').toLowerCase().match(TOKEN_PATTERN)) ?? [];
}

/** Flatten one dataset row into the text used for matching. */
function rowText(row) {
  return Object.values(row ?? {})
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ');
}

const indexCache = new Map();

/** Build (or reuse) the BM25 index for an array of rows. */
function buildIndex(cacheKey, rows) {
  if (indexCache.has(cacheKey)) return indexCache.get(cacheKey);

  const documents = rows.map((row) => {
    const tokens = tokenize(rowText(row));
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { frequencies, length: tokens.length };
  });

  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of document.frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / (documents.length || 1);
  const index = { documents, documentFrequency, averageLength };
  indexCache.set(cacheKey, index);
  return index;
}

const K1 = 1.5;
const B = 0.75;

/**
 * Search one dataset of a skill and return the top-ranked rows.
 * @param {string} skillId
 * @param {string} dataset name from listSkillDatasets() (e.g. "styles")
 * @param {string} query free-text keywords
 * @param {number} maxResults
 * @returns {Promise<Array<Record<string, unknown>>|null>} null when the dataset doesn't exist
 */
export async function searchSkillData(skillId, dataset, query, maxResults = 3) {
  const rows = await loadSkillDataset(skillId, dataset);
  if (!rows) return null;
  if (rows.length === 0) return [];

  const { documents, documentFrequency, averageLength } = buildIndex(`${skillId}::${dataset}`, rows);
  const queryTokens = [...new Set(tokenize(query))];
  const totalDocuments = documents.length;

  const scored = documents.map((document, rowIndex) => {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = document.frequencies.get(token);
      if (!frequency) continue;
      const matching = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (totalDocuments - matching + 0.5) / (matching + 0.5));
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * (document.length / (averageLength || 1)))));
    }
    return { rowIndex, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxResults))
    .map((entry) => rows[entry.rowIndex]);
}

export default searchSkillData;
