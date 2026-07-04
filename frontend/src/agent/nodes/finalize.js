/**
 * Node: finalize — terminal node for every path through the graph
 * (quick_analyze → finalize, planner → finalize, and
 * executor → validator → finalize). Turns whatever the upstream node
 * produced into the single AIMessage the chat UI renders, then the graph ends.
 *
 * The core rule: we NEVER hand-write the user-facing reply ourselves. Except
 * for the two cases where the text was already produced elsewhere — a
 * structured clarifying question (state.question) or a direct answer another
 * node already wrote as user-facing prose (state.final_answer) — finalize
 * hands the raw record of what happened (what tasks ran and their outcomes,
 * plus the validator's verdict) to the model and asks it to write ONE cohesive
 * reply for the user.
 *
 * That reply is explicitly NOT a technical report: the reader is a non-technical
 * site owner, not a developer, so the model is told to leave out file names,
 * selectors, tool names and other low-level detail and simply tell the person,
 * in their own language, what happened and where things stand.
 *
 * Priority: state.question (planner asked for clarification — passed through
 * untouched) > state.final_answer (quick_analyze answered directly, or planner
 * said the request isn't doable — already user-facing, passed through) >
 * state.taskResults + state.validationResults (executor ran tasks and the
 * validator checked them — handed to the model, which writes the reply). If
 * there is genuinely nothing to report and the model call cannot run or fails,
 * a single fixed fallback line is used.
 */

import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { Timeline } from '../timeline.js';

const FALLBACK_ANSWER = 'متاسفانه نتوانستم پاسخ مشخصی برای این درخواست تولید کنم. لطفاً دوباره تلاش کنید یا درخواست را واضح‌تر بیان کنید.';

const FINALIZE_PROMPT = `You are the voice of Dialog Studio, an AI assistant that works on the user's WordPress site for them. Work has just finished for this request, and your only job now is to tell the user what happened, in ONE short, friendly message.

You will be given, as context:
- WHAT WAS ATTEMPTED: the list of tasks that ran and, for each, whether it succeeded and a short note about it.
- VALIDATION RESULT: the outcome of checking the real site afterwards — whether the user's goal is now actually met, and if not, what is still missing or wrong.
Any of these may be missing or empty.

Write a reply for the user that:
- Is in the SAME LANGUAGE the user has been writing in (look at the conversation).
- Is NON-TECHNICAL. The reader is a site owner, NOT a programmer. Do NOT mention file names, paths, code, CSS selectors, function or tool names, debug logs, or any other low-level detail. Speak in terms of what they can see and understand about their site.
- Simply makes the user AWARE of what happened: what was done and the current state of their request.
- If everything succeeded and validation confirms the goal is met, say so warmly and briefly.
- If something failed, or validation says the goal is not fully met, tell the user plainly and honestly what is not done yet or what went wrong — in plain words, without blaming them — so they know where things stand. Do not pretend it succeeded.
- Is short and to the point: a couple of sentences, at most a short paragraph. No lists of technical steps, no headings, no code blocks.

Output ONLY the message text for the user — no JSON, no markdown fences, no labels, no preamble.`;

const ROLE_BY_TYPE = { human: 'user', ai: 'assistant', system: 'system' };

/** Convert a LangChain message into a plain { role, content } item for the prompt. */
function toPlainItem(message) {
  const type = message?._getType?.() ?? message?.type;
  const role = ROLE_BY_TYPE[type] ?? 'user';
  const content = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
      : String(message?.content ?? '');
  return { role, content };
}

/** Human-readable status labels handed to the model (kept language-neutral). */
const STATUS_LABELS = {
  done: 'succeeded',
  failed: 'failed',
  no_changes_made: 'no changes were made',
};

/** Render the executor's per-task outcomes as a neutral, factual block for the model. */
function formatWhatWasAttempted(taskResults) {
  if (!Array.isArray(taskResults) || taskResults.length === 0) return '(no tasks were run)';
  return taskResults
    .map((entry, i) => {
      const status = STATUS_LABELS[entry.status] ?? entry.status ?? 'unknown';
      const note = (typeof entry.summary === 'string' && entry.summary.trim()) || '(no detail)';
      return `${i + 1}. "${entry.title}" — ${status}. Note: ${note}`;
    })
    .join('\n');
}

/** Render the validator's latest verdict (and any unmet reasons) for the model. */
function formatValidation(validationResults) {
  if (!Array.isArray(validationResults) || validationResults.length === 0) return '(the result was not validated)';

  const latest = validationResults[validationResults.length - 1];
  const verdict = latest.satisfied ? 'The goal is confirmed to be met.' : 'The goal is NOT fully met yet.';
  const summary = (typeof latest.summary === 'string' && latest.summary.trim()) ? `\nOverall: ${latest.summary}` : '';
  const reasons = !latest.satisfied && Array.isArray(latest.reasons) && latest.reasons.length
    ? '\nStill missing / wrong:\n' + latest.reasons.map((r) => `- ${r}`).join('\n')
    : '';
  return `${verdict}${summary}${reasons}`;
}

/**
 * Ask the model to write the user-facing wrap-up from the raw record of what
 * happened. Returns the generated text, or '' if the call cannot run / fails /
 * comes back empty (the caller decides the fallback).
 */
async function generateFinalAnswer({ llmProvider, signal, messages, taskResults, validationResults }) {
  if (!llmProvider || typeof llmProvider.invoke !== 'function') return '';

  const context = [
    'WHAT WAS ATTEMPTED:',
    formatWhatWasAttempted(taskResults),
    '',
    'VALIDATION RESULT:',
    formatValidation(validationResults),
  ].join('\n');

  const input = [
    new SystemMessage(FINALIZE_PROMPT),
    ...(Array.isArray(messages) ? messages.map(toPlainItem) : []),
    new SystemMessage(context),
  ];

  try {
    const response = await llmProvider.invoke(input, signal ? { signal } : undefined);
    const text = typeof response?.content === 'string' ? response.content.trim() : '';
    return text;
  } catch (error) {
    console.warn('[finalize] failed to generate final answer:', error?.message);
    return '';
  }
}

export function createFinalizeNode({ llmProvider = null, signal = null } = {}) {
  return async function finalizeNode(state) {
    const timeline = Timeline.from(state.timeline);
    timeline.nodeEnter('finalize');

    // 1. Clarifying question — structured, already produced; passed through as-is.
    if (state.question) {
      timeline.assistantMessage('', 'finalize', { question: state.question });
      timeline.nodeExit('finalize', { kind: 'question' });
      return {
        messages: [...state.messages, new AIMessage({
          content: '',
          additional_kwargs: { question: state.question },
        })],
        timeline: timeline.toArray(),
      };
    }

    // 2. A direct answer another node already wrote as user-facing prose
    //    (quick_analyze direct reply, or planner "not doable") — pass through.
    if (state.final_answer) {
      timeline.assistantMessage(state.final_answer, 'finalize');
      timeline.nodeExit('finalize', { kind: 'final_answer' });
      return {
        final_answer: state.final_answer,
        messages: [...state.messages, new AIMessage({ content: state.final_answer })],
        timeline: timeline.toArray(),
      };
    }

    // 3. Executor ran tasks / validator checked them — hand the raw record to
    //    the model and let it write the user-facing, non-technical wrap-up.
    const hasResults = (Array.isArray(state.taskResults) && state.taskResults.length > 0)
      || (Array.isArray(state.validationResults) && state.validationResults.length > 0);

    if (hasResults) {
      const generated = await generateFinalAnswer({
        llmProvider,
        signal,
        messages: state.messages,
        taskResults: state.taskResults,
        validationResults: state.validationResults,
      });

      if (generated) {
        console.log('[finalize] generated final_answer:', generated);
        timeline.assistantMessage(generated, 'finalize');
        timeline.nodeExit('finalize', { kind: 'generated' });
        return {
          final_answer: generated,
          messages: [...state.messages, new AIMessage({ content: generated })],
          timeline: timeline.toArray(),
        };
      }
    }

    // 4. Nothing to report, or generation could not run / failed — fixed fallback.
    timeline.assistantMessage(FALLBACK_ANSWER, 'finalize', { kind: 'empty' });
    timeline.nodeExit('finalize', { kind: 'empty' });
    return {
      final_answer: FALLBACK_ANSWER,
      messages: [...state.messages, new AIMessage({ content: FALLBACK_ANSWER })],
      timeline: timeline.toArray(),
    };
  };
}

export default createFinalizeNode;
