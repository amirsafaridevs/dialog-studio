/**
 * Timeline — ordered, append-only log of everything that happens during one
 * agent loop run: node enter/exit, tool calls + their results, user
 * messages, and the final answer. Lives in graph state as `state.timeline`
 * so every node can append to it and the full ordered history survives to
 * the end of the run (and can be rendered/inspected by the UI later).
 *
 * Usage inside a node:
 *   const timeline = Timeline.from(state.timeline);
 *   timeline.nodeEnter('executor', { taskCount: tasks.length });
 *   timeline.toolCall('replace_in_file', { path }, { node: 'executor' });
 *   timeline.toolResult('replace_in_file', result, { node: 'executor' });
 *   timeline.nodeExit('executor', { status: 'done' });
 *   return { ...other, timeline: timeline.entries };
 *
 * Each entry: { seq, type, node, timestamp, ...typeSpecificFields }.
 * `seq` is a monotonically increasing counter (independent of Date.now()
 * resolution) so ordering is always unambiguous even for entries recorded
 * in the same millisecond.
 */

let globalSeq = 0;

export class Timeline {
  /** @param {Array<object>} entries existing entries to continue from (kept immutable — never mutated). */
  constructor(entries = []) {
    this.entries = Array.isArray(entries) ? entries.slice() : [];
  }

  /** Build a Timeline continuing from state.timeline (or empty if none yet). */
  static from(entries) {
    return new Timeline(entries);
  }

  _push(type, node, fields = {}) {
    const entry = {
      seq: ++globalSeq,
      type,
      node: node ?? null,
      timestamp: Date.now(),
      ...fields,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Record entering a node. */
  nodeEnter(node, meta = {}) {
    return this._push('node_enter', node, { meta });
  }

  /** Record leaving a node. */
  nodeExit(node, meta = {}) {
    return this._push('node_exit', node, { meta });
  }

  /**
   * Record a short, user-facing summary line for a node's work, shown in the
   * timeline as a sub-item under that node's step (see timelineStream.js).
   * Skipped silently when `text` is empty so nodes can call it unconditionally.
   */
  nodeSummary(node, text) {
    const summary = typeof text === 'string' ? text.trim() : '';
    if (!summary) return null;
    return this._push('node_summary', node, { summary });
  }

  /**
   * Record (or re-record) the current task plan — the ordered list of tasks
   * with their live state (queued | in_progress | done | failed). Call it once
   * when the plan is first known (planner) and again after every task-state
   * transition (executor); the streamer folds every plan entry into one live
   * step so the UI patches the same list in place instead of stacking copies.
   * Each task is snapshotted to { id, title, state } so later mutations to the
   * caller's task objects don't retroactively change already-logged entries.
   */
  plan(tasks, node = null) {
    const snapshot = (Array.isArray(tasks) ? tasks : []).map((task, index) => ({
      id: String(task?.id ?? task?.title ?? index),
      title: typeof task?.title === 'string' ? task.title : String(task?.title ?? ''),
      state: task?.state ?? 'queued',
    }));
    return this._push('plan', node, { tasks: snapshot });
  }

  /** Record a user message reaching the loop. */
  userMessage(content, node = null) {
    return this._push('user_message', node, { content });
  }

  /** Record the assistant's final answer/question being produced. */
  assistantMessage(content, node = null, meta = {}) {
    return this._push('assistant_message', node, { content, meta });
  }

  /** Record a tool being called. */
  toolCall(toolName, args, { node = null, callId = null } = {}) {
    return this._push('tool_call', node, { tool: toolName, args, callId });
  }

  /** Record a tool call's result (pair it with toolCall via callId when available). */
  toolResult(toolName, result, { node = null, callId = null, success = null } = {}) {
    return this._push('tool_result', node, {
      tool: toolName,
      result,
      callId,
      success,
    });
  }

  /** Record an arbitrary custom event, for anything the fixed helpers don't cover. */
  event(label, node = null, data = {}) {
    return this._push(label, node, { data });
  }

  /** Plain array of entries, ready to store back into graph state. */
  toArray() {
    return this.entries;
  }
}

export default Timeline;
