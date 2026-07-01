/**
 * Agent loop — powered by LangGraph StateGraph.
 *
 * Topology (step 2):
 *   START → quick_analyze → [needs_action?]
 *                             ├─ false → END
 *                             └─ true  → planner → END
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { createQuickAnalyzeNode } from './nodes/quickAnalyze.js';
import { createPlannerNode } from './nodes/planner.js';

/** After quick_analyze: only plan when real work is needed. */
function routeAfterQuickAnalyze(state) {
  return state.needs_action ? 'planner' : 'end';
}

export async function runAgentLoop({ messages, llmProvider, themeContext = null, signal = null }) {
  const graph = new StateGraph({
    channels: {
      messages: { value: (current, update) => update ?? current ?? [], default: () => [] },
      needs_action: { value: (current, update) => (update === undefined ? current : update), default: () => null },
      analysis: { value: (current, update) => update ?? current ?? '', default: () => '' },
      final_answer: { value: (current, update) => update ?? current ?? '', default: () => '' },
      tasks: { value: (current, update) => update ?? current ?? [], default: () => [] },
    },
  })
    .addNode('quick_analyze', createQuickAnalyzeNode({ llmProvider, signal }))
    .addNode('planner', createPlannerNode({ llmProvider, themeContext, signal }))
    .addEdge(START, 'quick_analyze')
    .addConditionalEdges('quick_analyze', routeAfterQuickAnalyze, {
      planner: 'planner',
      end: END,
    })
    .addEdge('planner', END)
    .compile();

  return graph.invoke({ messages });
}

export default runAgentLoop;
