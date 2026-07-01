/**
 * Node: quick_analyze — the front door.
 *
 * One cheap, tool-free `invoke` call looks at the user's latest message and
 * returns a single JSON object with three fields:
 *   - needs_action : boolean — is any real work on the theme/site needed?
 *   - final_answer : string  — the direct reply (only when needs_action = false)
 *   - analysis     : string  — what the user wants done (only when needs_action = true)
 *
 * The node decides which field to use based on needs_action, never on which
 * field the model happened to fill.
 */

import { SystemMessage } from '@langchain/core/messages';

const QUICK_ANALYZE_PROMPT = `You are the front door of a WordPress theme-building agent. Look at the user's LATEST message and decide whether any real work (inspecting or changing their theme/site) is needed.

Reply with a SINGLE-LINE JSON object containing EXACTLY these three fields, and nothing else:

{"needs_action": <true|false>, "final_answer": "<string>", "analysis": "<string>"}

Rules:
- Set "needs_action" to false for a greeting, small talk, or a general question you can answer directly. In that case put your complete reply (in the user's language) in "final_answer" and leave "analysis" as an empty string "".
- Set "needs_action" to true when the user wants you to build, change, fix, or inspect their site. In that case put a clear restatement of what they want done in "analysis" and leave "final_answer" as an empty string "".
- Fill exactly ONE of "final_answer" / "analysis"; the other MUST be "".
- When in doubt, choose needs_action: true.
- Output only the JSON object — no markdown, no commentary.`;

export function createQuickAnalyzeNode({ llmProvider, signal }) {
  return async function quickAnalyzeNode(state) {
    const input = [new SystemMessage(QUICK_ANALYZE_PROMPT), ...state.messages];

    const response = await llmProvider.invoke(input, signal ? { signal } : undefined);
    const raw = typeof response?.content === 'string' ? response.content : '';
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    console.log('[quick_analyze] parsed:', parsed);
    return { needs_action: parsed.needs_action, final_answer: parsed.final_answer, analysis: parsed.analysis };
  };
}
