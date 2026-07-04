/**
 * TimelineStreamer — turns the append-only `state.timeline` log (see
 * timeline.js) into the live, ordered list of display "steps" the chat UI
 * renders (ChatMessages.vue: type 'plan' | 'node' | 'tool'), updated as
 * the graph runs instead of only once at the end.
 *
 * agentLoop.js streams graph state with graph.stream(...); each yielded
 * chunk carries the timeline as it stands so far (always the full array —
 * see timeline.js `value: (current, update) => update ?? current`). Feed
 * every chunk's timeline to `consume()`; it tracks how many entries it has
 * already turned into steps and only processes the new tail, so calling it
 * repeatedly with a growing array is safe and cheap. Nodes also call it
 * mid-run (see nodes/*.js `onProgress`) so tool calls inside a single node
 * (e.g. executor's SDK run()) become visible as they happen, not only once
 * the whole node returns.
 *
 * Every step carries `nodeStatus: 'active' | 'done'` — set from the same
 * node_enter/node_exit pair that already bounds it in the timeline, so the
 * UI can color a step's timeline dot by whether its node is still running
 * (gray) or has finished (accent/green), without tracking separate state.
 *
 * Usage inside agentLoop.js:
 *   const streamer = new TimelineStreamer({ onChange: onTimelineUpdate });
 *   for await (const chunk of graph.stream(...)) streamer.consume(chunk.timeline);
 */

import { getToolIcon, getToolTitle } from '../utils/toolDisplay.js';

// Task.state (agent side) → task status the UI's TaskPlan.vue understands.
const TASK_STATE_TO_STATUS = {
  queued: 'pending',
  in_progress: 'in-progress',
  done: 'done',
  failed: 'failed',
};

function taskStatus(state) {
  return TASK_STATE_TO_STATUS[state] || 'pending';
}

const NODE_LABELS = {
  quick_analyze: 'در حال بررسی درخواست',
  planner: 'در حال برنامه‌ریزی وظایف',
  executor: 'در حال اجرای وظیفه',
  validator: 'در حال اعتبارسنجی نتیجه',
  finalize: 'در حال بررسی های نهایی',
};

function nodeLabel(node) {
  return NODE_LABELS[node] || node || 'در حال پردازش';
}

export class TimelineStreamer {
  /** @param {{ onChange?: (steps: Array<object>) => void }} [options] */
  constructor({ onChange = null } = {}) {
    this.onChange = onChange;
    this.steps = [];
    this._seen = 0;
    this._stepIndexByToolCallId = new Map();
    this._lastToolStepIndex = null;
    this._currentNodeSteps = [];
    // One live task-plan step, patched in place across every 'plan' entry so
    // the list updates its markers instead of stacking a new copy per update.
    this._planStepIndex = null;
  }

  /** Mark every step belonging to the node span that just closed as done. */
  _closeCurrentNode() {
    for (const step of this._currentNodeSteps) {
      step.streaming = false;
      step.nodeStatus = 'done';
    }
    this._currentNodeSteps = [];
  }

  _pushStep(step) {
    const record = { streaming: true, nodeStatus: 'active', ...step };
    this.steps.push(record);
    this._currentNodeSteps.push(record);
    return this.steps.length - 1;
  }

  _applyEntry(entry) {
    switch (entry.type) {
      case 'node_enter': {
        this._closeCurrentNode();
        this._pushStep({
          id: `timeline-${entry.seq}`,
          role: 'assistant',
          type: 'node',
          title: nodeLabel(entry.node),
        });
        break;
      }

      case 'tool_call': {
        const index = this._pushStep({
          id: `timeline-${entry.seq}`,
          role: 'assistant',
          type: 'tool',
          toolName: entry.tool,
          args: entry.args,
          title: getToolTitle(entry.tool, { streaming: true, args: entry.args }),
          detail: '',
        });
        if (entry.callId) {
          this._stepIndexByToolCallId.set(entry.callId, index);
        } else {
          this._lastToolStepIndex = index;
        }
        break;
      }

      case 'tool_result': {
        const index = entry.callId != null && this._stepIndexByToolCallId.has(entry.callId)
          ? this._stepIndexByToolCallId.get(entry.callId)
          : this._lastToolStepIndex;
        const step = index != null ? this.steps[index] : null;
        if (step) {
          const failed = entry.success === false;
          step.failed = failed;
          step.title = getToolTitle(step.toolName, { failed, args: step.args });
          step.icon = getToolIcon(step.toolName);
          step.detail = resultPreview(entry.result);
        }
        break;
      }

      case 'plan': {
        const tasks = (Array.isArray(entry.tasks) ? entry.tasks : []).map((task, i) => ({
          id: String(task?.id ?? i),
          label: typeof task?.title === 'string' ? task.title : String(task?.title ?? ''),
          status: taskStatus(task?.state),
        }));

        if (this._planStepIndex != null && this.steps[this._planStepIndex]) {
          // Patch the existing plan step in place so its markers update.
          this.steps[this._planStepIndex].tasks = tasks;
        } else {
          // First plan: create the single, stable-keyed plan step. It is kept
          // OUT of _currentNodeSteps so node_exit never flips it to 'done' —
          // its own per-task statuses carry the live state instead.
          const record = { streaming: true, nodeStatus: 'active', id: 'run-plan', role: 'assistant', type: 'plan', tasks };
          this.steps.push(record);
          this._planStepIndex = this.steps.length - 1;
        }
        break;
      }

      case 'node_summary': {
        this._pushStep({
          id: `timeline-${entry.seq}`,
          role: 'assistant',
          type: 'summary',
          title: entry.summary,
        });
        break;
      }

      case 'node_exit': {
        this._closeCurrentNode();
        break;
      }

      default:
        break;
    }
  }

  /**
   * Process a (possibly grown) timeline array. Entries already seen are
   * skipped — only the new tail since the last call is applied.
   * @param {Array<object>} timeline
   */
  consume(timeline) {
    if (!Array.isArray(timeline) || timeline.length <= this._seen) {
      return this.steps;
    }

    for (let i = this._seen; i < timeline.length; i += 1) {
      this._applyEntry(timeline[i]);
    }
    this._seen = timeline.length;

    console.log('[TimelineStreamer] consume -> steps:', this.steps.map((s) => `${s.type}:${s.title}`));
    this.onChange?.(this.steps.slice());
    return this.steps;
  }

  /** Call once the run has fully finished, so no step is left mid-animation. */
  finish() {
    this._closeCurrentNode();
    for (const step of this.steps) {
      step.streaming = false;
      step.nodeStatus = 'done';
    }
    this.onChange?.(this.steps.slice());
    return this.steps;
  }
}

function resultPreview(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export default TimelineStreamer;
