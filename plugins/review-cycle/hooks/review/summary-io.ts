import { headOf, messageOf } from '../gate/git';
import { ensureRoot, gitOf, STORE_TAG, storeOf, within, type $ } from '../state/engine';
import { state } from '../state/gate-state';
import { keep } from '../state/keep';
import { cycleOf, isSummary, measuredOf, recordCycle } from './cycles';
import { summaryText } from './summary';
import { EMPTY_TREE } from './witness';

export async function registerSummary($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'summary',
      description:
        "Shows a review cycle's summary block in the transcript, folded to its first lines, and answers with it. Pass the whole block as `text`.",
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The summary block, as written.' } },
        required: ['text'],
      },
    });
  } catch {
    // Without it, the skill prints the block in its reply.
  }
}

// Answers with the block, and keeps what it says for the status tool's rollup;
// when it kept nothing, the reason follows the block. What it could not read
// shows in the rollup's `incomplete`.
export async function onSummary($: $, e: unknown): Promise<{ result: string }> {
  const text = summaryText(e);
  if (text === '') return { result: 'review-cycle summary: `text` is empty.' };
  let note: string | null;
  try {
    note = await within($, recordSummary($, text), 'recording the review cycle');
  } catch (error) {
    note = `review-cycle may not have kept this cycle for its rollup (${messageOf(error)}).`;
  }
  return { result: note === null ? text : `${text}\n\n${note}` };
}

// Orders this session's cycles as `roundsAt` orders its rounds.
let cyclesAt = 0;

async function recordSummary($: $, text: string): Promise<string | null> {
  if (!isSummary(text)) {
    return 'review-cycle did not keep this cycle for its rollup: the block has no `Iterations:` line.';
  }
  const root = await ensureRoot($);
  if (!root) return 'review-cycle did not keep this cycle for its rollup: not in a git repository.';
  const now = await $.clock.now();
  const at = (cyclesAt = Math.max(now, cyclesAt + 1));
  // HEAD names the commit Phase 10 made, or the one before when it made none;
  // unread, the cycle is kept without one.
  const head = await headOf(gitOf($), root.top).then(
    (h) => (h === EMPTY_TREE ? null : h.slice(0, 12)),
    () => null,
  );
  const cycle = cycleOf(text, new Date(now).toISOString().slice(0, 10), head);
  // Taken with no await between, so a summary running beside this one cannot
  // count the same legs, and put back if the cycle is not kept.
  const finished = [...state.legs].filter(([, l]) => l.counts && l.done);
  const codex = [...state.codexRead];
  for (const [id] of finished) state.legs.delete(id);
  state.codexRead.clear();
  const measured = measuredOf(
    finished.map(([, l]) => l.spend ?? null),
    codex.map(([, n]) => n),
  );
  try {
    await recordCycle(storeOf($), root.common, { ...cycle, ...measured }, at, STORE_TAG);
  } catch (error) {
    for (const [id, leg] of finished) state.legs.set(id, leg);
    for (const [path, n] of codex) state.codexRead.set(path, n);
    throw error;
  }
  void keep($);
  return null;
}
