/**
 * Node: quick_analyze — the front door of Dialog Studio (WordPress AI agent, child-theme scoped).
 *
 * One cheap, tool-free `invoke` call looks at the user's latest message and
 * returns a single JSON object with four fields:
 *   - needs_action : boolean      — is any real work on the theme/site needed?
 *   - final_answer : string       — the direct reply (only when answering directly)
 *   - analysis     : string       — what the user wants done (only when needs_action = true)
 *   - question     : object|null — a clarifying question to ask first (only when the
 *                                  request is ambiguous)
 *
 * The node decides which field to use based on needs_action/question, never on
 * which field the model happened to fill.
 */

import { SystemMessage } from '@langchain/core/messages';
import { Timeline } from '../timeline.js';

const QUICK_ANALYZE_PROMPT = `You are the front door of Dialog Studio, an AI WordPress agent embedded as an admin chat panel. Dialog Studio's job is to carry out whatever the admin asks — inspecting, building, or changing the site — by working directly inside the active child theme (its "workspace"). It never edits the parent theme or other plugins directly; it reads them for context and makes real changes only inside the child theme.

Once real work starts, later nodes in this pipeline can call tools such as: reading/searching files and the project's code knowledge graph, editing or writing child-theme files (CSS/PHP/JS), validating PHP/CSS/JS syntax, listing installed plugins, creating/updating WordPress pages, toggling WP debug mode and reading the debug log, and inspecting or navigating a live preview of the site (loaded assets, computed CSS on an element, rendered HTML, reload/navigate). You are only the triage step — you never call tools yourself, you just decide if any of that work is needed.

Look at the user's LATEST message and decide whether any real work (inspecting or changing their theme/site) is needed.

Reply with a SINGLE-LINE JSON object containing EXACTLY these four fields, and nothing else:

{"needs_action": <true|false>, "final_answer": "<string>", "analysis": "<string>", "question": <object-or-null>}

Exactly ONE of the following three outcomes applies per reply:
1. Direct answer: "needs_action" is false, "final_answer" contains your complete reply (in the user's language), "analysis" is "", "question" is null. Use this for a greeting, small talk, or a general question you can answer directly.
2. Real work needed: "needs_action" is true, "analysis" contains a clear restatement of what they want done, "final_answer" is "", "question" is null.
3. Ambiguous — need to ask first: "needs_action" is false, "final_answer" is "", "analysis" is "", "question" is a single object:
   {"text": "<the question, in the user's language>", "type": "single"|"multiple", "options": ["<option 1>", "<option 2>", ...]}
   - Use this ONLY when the user's latest message is a real request but has multiple reasonable interpretations or is missing information you cannot reasonably guess (e.g. "which page", "which of these two menus", "what color").
   - Use "type": "single" when only one option can apply (radio-button choice), "type": "multiple" when more than one can be selected at once (checkbox choice).
   - "options" must have at least 2 concrete, mutually distinguishable choices in the user's language.
   - Do not ask a question for things you could reasonably infer or that don't materially change the work — prefer proceeding with needs_action: true over asking.

Rules:
- When in doubt between outcomes 2 and 3, prefer outcome 2 (needs_action: true) — only ask when truly necessary.
- Output only the JSON object — no markdown, no commentary.`;

/** Forgivingly pull the {needs_action, final_answer, analysis, question} object out of a reply. */
function parseQuickAnalyzeOutput(text) {
  const empty = { needs_action: true, final_answer: '', analysis: '', question: null };
  const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
  if (!match) return empty;

  try {
    const parsed = JSON.parse(match[0]);
    return {
      needs_action: Boolean(parsed.needs_action),
      final_answer: typeof parsed.final_answer === 'string' ? parsed.final_answer : '',
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
      question: parsed.question && typeof parsed.question === 'object' ? parsed.question : null,
    };
  } catch (error) {
    console.warn('[quick_analyze] failed to parse JSON:', error.message);
    return empty;
  }
}

/** Condense the model's own analysis into one timeline line. */
function summarizeAnalysis(parsed) {
  if (parsed.question) return 'نیاز به پرسیدن یک سؤال از کاربر';
  if (!parsed.needs_action) return 'پاسخ مستقیم بدون نیاز به اقدام روی سایت';
  return normalizeSummary(parsed.analysis) || 'درخواست بررسی شد و نیازمند اقدام است';
}

/**
 * Collapse the model's analysis into a single line for the timeline, keeping
 * the full text (no clamp) so the summary under each node is shown complete.
 */
function normalizeSummary(text) {
  return (typeof text === 'string' ? text : '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

export function createQuickAnalyzeNode({ llmProvider, signal }) {
  return async function quickAnalyzeNode(state) {
    const timeline = Timeline.from(state.timeline);
    timeline.nodeEnter('quick_analyze');

    const input = [new SystemMessage(QUICK_ANALYZE_PROMPT), ...state.messages];

    const response = await llmProvider.invoke(input, signal ? { signal } : undefined);
    const raw = typeof response?.content === 'string' ? response.content : '';
    const parsed = parseQuickAnalyzeOutput(raw);
    console.log('[quick_analyze] parsed:', parsed);

    const needs_action = parsed.question ? false : parsed.needs_action;
    timeline.nodeSummary('quick_analyze', summarizeAnalysis(parsed));
    timeline.nodeExit('quick_analyze', { needs_action, hasQuestion: Boolean(parsed.question) });

    return {
      needs_action,
      final_answer: parsed.final_answer,
      analysis: parsed.analysis,
      question: parsed.question,
      timeline: timeline.toArray(),
    };
  };
}
