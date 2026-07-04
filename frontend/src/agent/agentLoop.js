/**
 * Agent loop — powered by LangGraph StateGraph.
 *
 * Topology:
 *   START → quick_analyze → [needs_action?]
 *                             ├─ false → finalize → END
 *                             └─ true  → planner → [has tasks?]
 *                                                     ├─ false → finalize → END
 *                                                     └─ true  → executor → validator → [satisfied?]
 *                                                                                          ├─ true                → finalize → END
 *                                                                                          └─ false (under limit)  → planner (loop)
 *                                                                                          └─ false (limit hit)    → finalize → END
 *
 * Skills are NOT selected by a dedicated node (the old skill_selector was
 * removed). Instead — Claude Code style — the lightweight skill catalog
 * (skills/registry.js manifest) is baked into planner/executor instructions,
 * and the model itself loads a skill's full body at the moment of need via
 * the use_skill tool (skills/tools.js). Loaded ids accumulate in
 * state.loaded_skills (append-only, union) so later runs in the same turn —
 * subsequent executor tasks, replan passes, validation — re-inject those
 * bodies via buildLoadedSkillsBlock (skills/prompt.js) and stay consistent.
 *
 * validator checks the executor's work against the user's actual goal (using
 * live-preview/browser + read-only tools) and appends one entry to
 * state.validationResults per pass. When it finds the goal unmet,
 * needs_more_action routes back to planner with full context (tasks +
 * taskResults + validation history) so it can plan a fix; MAX_VALIDATION_PASSES
 * bounds that loop so a persistently-failing goal still terminates.
 *
 * finalize is the single terminal node for every path: it turns whatever
 * the upstream node produced — state.question (planner asked for clarification),
 * state.final_answer (quick_analyze answered directly, or planner said the
 * request isn't doable), or state.taskResults + state.validationResults
 * (executor ran tasks and validator checked them) — into an AIMessage appended
 * to state.messages, so the chat UI can render it like any other assistant
 * reply. question renders as a structured single/multiple-choice prompt
 * (additional_kwargs.question); final_answer is passed through as-is (already
 * user-facing prose). For the task/validation path finalize does NOT hand-write
 * the text: it hands the raw record of what ran and how validation went to the
 * model and asks it for one short, NON-technical, user-facing wrap-up in the
 * user's language — hence finalize also receives llmProvider.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { createQuickAnalyzeNode } from './nodes/quickAnalyze.js';
import { createPlannerNode } from './nodes/planner.js';
import { createExecutorNode } from './nodes/executor.js';
import { createValidatorNode } from './nodes/validator.js';
import { createFinalizeNode } from './nodes/finalize.js';
import { Timeline } from './timeline.js';
import { TimelineStreamer } from './timelineStream.js';

/** Hard cap on planner↔executor↔validator loops so an unmeetable goal still terminates. */
const MAX_VALIDATION_PASSES = 3;

/** After quick_analyze: only plan when real work is needed. */
function routeAfterQuickAnalyze(state) {
  return state.needs_action ? 'planner' : 'finalize';
}

/** After planner: only execute when it actually produced tasks. */
function routeAfterPlanner(state) {
  return Array.isArray(state.tasks) && state.tasks.length > 0 ? 'executor' : 'finalize';
}

/** After validator: loop back to planner when unsatisfied, unless the pass limit is hit. */
function routeAfterValidator(state) {
  const passes = Array.isArray(state.validationResults) ? state.validationResults.length : 0;
  if (state.needs_more_action && passes < MAX_VALIDATION_PASSES) return 'planner';
  return 'finalize';
}

export async function runAgentLoop({ messages, llmProvider, themeContext = null, toolExecutor = null, designPrefs = null, signal = null, onTimelineUpdate = null }) {
  const streamer = new TimelineStreamer({ onChange: onTimelineUpdate });

  const graph = new StateGraph({
    channels: {
      messages: { value: (current, update) => update ?? current ?? [], default: () => [] },
      needs_action: { value: (current, update) => (update === undefined ? current : update), default: () => null },
      analysis: { value: (current, update) => update ?? current ?? '', default: () => '' },
      final_answer: { value: (current, update) => update ?? current ?? '', default: () => '' },
      question: { value: (current, update) => (update === undefined ? current : update), default: () => null },
      tasks: { value: (current, update) => update ?? current ?? [], default: () => [] },
      taskResults: { value: (current, update) => update ?? current ?? [], default: () => [] },
      // Skill ids the model loaded via the use_skill tool (see skills/tools.js)
      // anywhere in this turn — planner or executor, first pass or replan.
      // Append-only union: once loaded, a skill stays loaded for the rest of
      // the turn so every later run re-injects its body and stays consistent.
      loaded_skills: {
        value: (current, update) => (update ? [...new Set([...(current ?? []), ...update])] : current ?? []),
        default: () => [],
      },
      // Append-only log of every validator pass (see nodes/validator.js): one
      // { satisfied, summary, reasons, checkedAt } entry per pass, oldest first.
      validationResults: { value: (current, update) => update ?? current ?? [], default: () => [] },
      // Set by validator after each pass; drives routeAfterValidator. true
      // sends the graph back to planner, false (or limit reached) to finalize.
      needs_more_action: { value: (current, update) => (update === undefined ? current : update), default: () => false },
      // Append-only, order-preserving log of everything that happened during
      // the run (node enter/exit, tool calls/results, messages). Nodes never
      // replace this channel wholesale — they extend it via Timeline.from(state.timeline)
      // — so entries from earlier nodes are always kept, in order.
      timeline: { value: (current, update) => update ?? current ?? [], default: () => [] },
    },
  })
    .addNode('quick_analyze', createQuickAnalyzeNode({ llmProvider, signal }))
    .addNode('planner', createPlannerNode({ llmProvider, themeContext, toolExecutor, designPrefs, signal, onProgress: (t) => streamer.consume(t) }))
    .addNode('executor', createExecutorNode({ llmProvider, toolExecutor, designPrefs, signal, onProgress: (t) => streamer.consume(t) }))
    .addNode('validator', createValidatorNode({ llmProvider, toolExecutor, designPrefs, signal, onProgress: (t) => streamer.consume(t) }))
    .addNode('finalize', createFinalizeNode({ llmProvider, signal }))
    .addEdge(START, 'quick_analyze')
    .addConditionalEdges('quick_analyze', routeAfterQuickAnalyze, {
      planner: 'planner',
      finalize: 'finalize',
    })
    .addConditionalEdges('planner', routeAfterPlanner, {
      executor: 'executor',
      finalize: 'finalize',
    })
    .addEdge('executor', 'validator')
    .addConditionalEdges('validator', routeAfterValidator, {
      planner: 'planner',
      finalize: 'finalize',
    })
    .addEdge('finalize', END)
    .compile();

  const timeline = new Timeline();
  const lastMessage = messages[messages.length - 1];
  if (lastMessage) {
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : lastMessage.content ?? '';
    timeline.userMessage(content);
  }

  let result = null;
  for await (const chunk of await graph.stream({ messages, timeline: timeline.toArray() }, { streamMode: 'values' })) {
    streamer.consume(chunk.timeline);
    result = chunk;
  }
  streamer.finish();

  console.log('[agent_loop] timeline:', result?.timeline);

  // messages is the caller's live array (e.g. a Vue ref's value) — splice it in
  // place so the UI, which reads that same reference, sees the final messages.
  if (Array.isArray(result?.messages)) {
    messages.splice(0, messages.length, ...result.messages);
  }

  return result;
}

export default runAgentLoop;
