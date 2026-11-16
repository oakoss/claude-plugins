import type { HookFor } from 'claude-code';

import { headOf, reviewablePaths, worktreeTree } from '../gate/git';
import { ensureRoot, gitOf, type $, type Input, type NextOf, type Output } from '../state/engine';
import { drop, LEG_BUDGET_MS, state, type Leg } from '../state/gate-state';
import { nudgeReview } from './nudge-io';
import { hasReceipt, isReviewerType } from './witness';

// The orchestrator waits on notifications, and a leg that keeps working sends
// none, so the gate keeps the clock and asks the session to stop the leg.
export function overBudget($: $, agentId: string, leg: Leg): void {
  if (leg.done || leg.capped) return;
  leg.capped = true;
  const minutes = LEG_BUDGET_MS / 60_000;
  state.capped.push(`${leg.type} (agent ${agentId}): still running after ${minutes} minutes`);
  // The user sees the prompt whole; what to do with it is in both review skills.
  const text = `review-cycle: reviewer leg ${leg.type} (agent ${agentId}) has run past its ${minutes}-minute budget.`;
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .then(
      (r) => {
        if (r.drop !== undefined)
          state.capped.push(
            `${leg.type} (agent ${agentId}): the request to stop it was refused (${r.drop})`,
          );
      },
      (error: unknown) => {
        state.capped.push(
          `${leg.type} (agent ${agentId}): the request to stop it failed (${error instanceof Error ? error.message : String(error)})`,
        );
      },
    );
}

export async function onAgentSpawn(
  $: $,
  e: Input<HookFor<'agent.spawn'>>,
  next: NextOf<HookFor<'agent.spawn'>>,
): Promise<Output<HookFor<'agent.spawn'>>> {
  let isLeg = false;
  let spawnTree: string | null = null;
  let why = 'the working tree could not be read when it started';
  try {
    const root = await ensureRoot($);
    const inRoot =
      !e.cwd || (root !== null && (e.cwd === root.top || e.cwd.startsWith(`${root.top}/`)));
    isLeg = root !== null && !e.parentAgentId && isReviewerType(e.subagentType) && inRoot;
    // Captured before the leg starts, so it is the tree the leg is given.
    if (isLeg && root !== null) spawnTree = await worktreeTree(gitOf($), root.top);
  } catch (error) {
    isLeg = isReviewerType(e.subagentType) && !e.parentAgentId;
    why = `${why} (${error instanceof Error ? error.message : String(error)})`;
  }
  const r = await next(e);
  if (isLeg && 'agentId' in r && r.agentId) {
    if (spawnTree === null) drop(r.agentId, `${e.subagentType}: ${why}`);
    const counts = !state.message.prWindow;
    const leg: Leg = {
      type: e.subagentType,
      counts,
      spawnTree,
      done: false,
      timer: null,
      capped: false,
      counted: false,
      spawnedAt: await $.clock.now(),
    };
    state.legs.set(r.agentId, leg);
    const id = r.agentId;
    leg.timer = $.clock.after(LEG_BUDGET_MS, () => overBudget($, id, leg));
  }
  return r;
}

// A leg's completion is the review event: the tree it saw is the working tree
// now. Nothing edited after this moment is reviewed until a leg sees it.
export async function onTurnComplete(
  $: $,
  e: Input<HookFor<'turn.complete'>>,
  next: NextOf<HookFor<'turn.complete'>>,
): Promise<Output<HookFor<'turn.complete'>>> {
  if (!e.agentId) {
    state.lastAnswer = e.answer;
    const r = await next(e);
    try {
      await nudgeReview($, e);
    } catch {
      // A missed nudge leaves the commit gate to refuse the unreviewed commit.
    }
    return r;
  }
  const leg = state.legs.get(e.agentId);
  if (leg) {
    leg.done = true;
    leg.timer?.cancel();
  }
  const root = state.root;
  if (!leg?.counts || leg.spawnTree === null || !root) return next(e);
  // A capped leg is already reported as capped, not as a dropped review.
  if (leg.capped && (e.isAborted || e.reason !== 'answer')) return next(e);
  const reported = !e.isAborted && e.reason === 'answer' && hasReceipt(e.answer);
  if (leg.counted && !reported) return next(e);
  if (e.isAborted || e.reason !== 'answer') {
    drop(e.agentId, `${leg.type}: it did not finish (${e.isAborted ? 'aborted' : e.reason})`);
    return next(e);
  }
  if (!hasReceipt(e.answer)) {
    drop(e.agentId, `${leg.type}: its report did not open with the execution receipt`);
    return next(e);
  }
  try {
    const tree = await worktreeTree(gitOf($), root.top);
    const head = await headOf(gitOf($), root.top);
    const reviewedPaths = await reviewablePaths(gitOf($), root.top, head, tree);
    if (reviewedPaths === null) throw new Error('the paths it reviewed could not be listed');
    state.reviews.push({ type: leg.type, trees: [leg.spawnTree, tree], reviewedPaths });
    leg.counted = true;
    // Refusals explain the current state; other legs' older failures stay in
    // the status tool, and this leg's own are superseded.
    const agentId = e.agentId;
    state.dropped = state.dropped
      .filter((d) => d.agentId !== agentId)
      .map((d) => ({ ...d, old: true }));
  } catch (error) {
    drop(e.agentId, `${leg.type}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return next(e);
}
