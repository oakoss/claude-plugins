import type { HookFor } from 'claude-code';

import {
  coverageOf,
  headOf,
  messageOf,
  reviewablePaths,
  worktreeTree,
  type Coverage,
} from '../gate/git';
import { gitOf, type $, type Input } from '../state/engine';
import { explain, state } from '../state/gate-state';
import { asksUser, nudgeOf, nudgeOn } from './nudge';
import { uncoveredOf } from './witness';

// What changed between two trees that no reviewer has seen, or null when
// nothing did. Throws when git cannot say, so a failure never reads as clean.
async function unreviewedSince(
  $: $,
  top: string,
  since: string,
  tree: string,
): Promise<Coverage | null> {
  const paths = await reviewablePaths(gitOf($), top, since, tree);
  if (paths === null) throw new Error('git could not list what changed');
  const c = await coverageOf(gitOf($), top, await headOf(gitOf($), top), tree, state.reviews);
  if (c === null) throw new Error('git could not compare the tree with the reviewed ones');
  const touched = new Set(paths);
  const rows = c.rows.filter((row) => touched.has(row.path));
  return uncoveredOf(rows).length === 0 ? null : { ...c, rows };
}

// Built when the prompt is sent, so a review, an edit or the nudge turned off
// since the turn ended counts. When git cannot check, the reminder says so.
export async function reminderFor(
  $: $,
  since: string,
  tree: string | null,
): Promise<string | null> {
  if (!(await nudgeWanted($))) return null;
  try {
    const root = state.root;
    if (!root || tree === null) throw new Error('the working tree could not be read');
    const c = await unreviewedSince($, root.top, since, tree);
    if (c === null) return null;
    return `review-cycle: your last turn left changes no reviewer has seen (${explain(c)}). Invoke /review-cycle:review via the Skill tool before anything else, then carry on with this message. Skip it only if this message says not to review, or answers a question you asked that must come first.`;
  } catch (error) {
    return `review-cycle: could not check whether your last turn's changes were reviewed (${messageOf(error)}). Invoke /review-cycle:review via the Skill tool before anything else, unless this message says not to review.`;
  }
}

// The nudge as the settings set it. A file that cannot be read sets nothing,
// so the others decide: the nudge only prompts a review.
export async function nudgeWanted($: $): Promise<boolean> {
  const set: Partial<Record<'project' | 'local', boolean | null>> = {};
  for (const source of ['project', 'local'] as const) {
    let settings: { pluginConfigs?: unknown } | null;
    try {
      settings = await $.settings.read({ source });
    } catch {
      continue;
    }
    set[source] = nudgeOf(settings?.pluginConfigs);
  }
  return nudgeOn(state.nudge, set.project ?? null, set.local ?? null);
}

// The agent reviews on the user's next prompt rather than asking whether to.
// Once per user message, and not while a review is under way.
export async function nudgeReview($: $, e: Input<HookFor<'turn.complete'>>): Promise<void> {
  const message = state.message;
  if (message.nudged || e.reason !== 'answer' || asksUser(e.answer)) return;
  const root = state.root;
  const since = message.tree;
  if (!root || since === null) return;
  const pending = [...state.legs].filter(([, leg]) => leg.counts && !leg.done);
  if (pending.length > 0) {
    // A leg that ended without a turn.complete would otherwise hold this off for good.
    const agents = await $.agent.list();
    const live = new Set(agents.filter((a) => a.status === 'running').map((a) => a.id));
    for (const [id, leg] of pending) if (!live.has(id)) leg.done = true;
    if (pending.some(([, leg]) => !leg.done)) return;
  }
  // Checked from where the reminder will measure, an older one's tree if owed.
  const owedAtStart = state.owed;
  const from = owedAtStart?.since ?? since;
  try {
    const tree = await worktreeTree(gitOf($), root.top);
    if (tree === since) return;
    if ((await unreviewedSince($, root.top, from, tree)) === null) return;
  } catch {
    // A turn git cannot check still owes a reminder, which the next prompt
    // rebuilds or reports as unchecked.
  }
  if (!(await nudgeWanted($))) return;
  // A prompt that arrived meanwhile started from a tree holding these changes,
  // so the reminder is still owed and the next prompt carries it, unless that
  // prompt reviewed them or settled what was owed when this check began.
  if (state.message !== message && (state.message.nudged || state.owed !== owedAtStart)) return;
  if (state.message === message) message.nudged = true;
  // An older reminder still owed measures from further back, so it stays.
  state.owed ??= { since };
}
