// What a read of a watch saves into the list, and what it tells. Pure.
import type { Activity, Pull, Watch } from '../types';
import {
  isChecking,
  isSettled,
  labelOf,
  layerOf,
  shownOf,
  stillRunning,
  takeOverPush,
  toastOf,
  toldAfter,
  wakeOf,
  type Verdict,
  type Wake,
} from './watch';

export const idOf = (w: Pick<Watch, 'host' | 'repo' | 'number' | 'push'>) =>
  `${w.host}/${w.repo}${w.push ? `@${w.push.branch}` : `#${w.number}`}`;

// The same watch, not a later push of the same branch that replaced it.
export const isSame = (a: Watch, b: Watch) =>
  idOf(a) === idOf(b) && a.push?.pushedAt === b.push?.pushedAt;

// GitHub answered, so no line on the host waits on it any more.
// A push not yet read keeps its note until a read of its own.
export const reachedOn = (w: Watch, host: string): Watch =>
  w.host === host && w.pull && w.offline !== undefined ? { ...w, offline: undefined } : w;

// What a fresh read of an open line says, judged before it is saved.
export type Judged = {
  verdict: Verdict;
  isEarly: boolean;
  isOwnMerge: boolean;
  isWakeAsked: boolean;
  toast: string | null;
  isUrgent: boolean;
  isMoved: boolean;
};

export function judgedOf(
  target: Watch,
  next: Watch & { pull: Pull },
  verdict: Verdict,
  now: number,
  { merged, asked }: { merged: readonly string[]; asked: readonly string[] },
): { next: Watch; judged: Judged } {
  const { pull } = next;
  // A passed merge is said only once no later run can start: until then
  // it is not yet what the line has said.
  const isEarly = verdict.kind === 'merged-passed' && !isSettled(verdict, pull, now);
  const { shown } = target;
  const isWakeAsked = asked.includes(idOf(next));
  // A merge Claude made is news once it asked to hear its checks pass.
  const isOwnMerge = merged.includes(idOf(next)) && !isWakeAsked;
  const judged = { verdict, isEarly, isOwnMerge, isWakeAsked, toast: null, isUrgent: false };
  // A ready pull request read as checking is not ready again afterwards.
  if (isEarly || isChecking(verdict)) return { next, judged: { ...judged, isMoved: false } };
  const after = next.push ? '' : ' merged';
  const toast = toastOf(labelOf(next), verdict, shown, after, stillRunning(pull));
  // What someone away from the terminal comes back for; a passed merge is not.
  const isUrgent = ['ready', 'failing', 'merged-failing'].includes(verdict.kind);
  const nowShown = shownOf(verdict);
  const shownAt = nowShown !== shown || next.shownAt === undefined ? now : next.shownAt;
  return {
    next: { ...next, shown: nowShown, shownAt },
    judged: { ...judged, toast, isUrgent, isMoved: nowShown !== shown },
  };
}

// How a read ended, beside what it read.
export type ReadEnd = {
  isOffline: boolean;
  isLimited: boolean;
  isClosed: boolean;
  isGivenUp: boolean;
};

// The watch list once a read is saved into it, and what the read tells:
// judged against `all` as saved now, inside the write.
export function savedAfter(
  all: readonly Watch[],
  target: Watch,
  next: Watch,
  end: ReadEnd,
  judged: Judged | null,
  { isAwake, tells }: { isAwake: boolean; tells: (a: Activity) => boolean },
): { list: readonly Watch[]; isSaved: boolean; next: Watch; woke: Wake | null; restack: string[] } {
  const isSaved = all.some((w) => isSame(w, target));
  const quiet = (list: readonly Watch[]) => ({ list, isSaved, next, woke: null, restack: [] });
  // The host's other lines wait on this read's probe, so they say so too.
  if (end.isOffline) {
    const { offline } = next;
    return quiet(
      all.map((w) => (isSame(w, target) ? next : w.host === next.host ? { ...w, offline } : w)),
    );
  }
  // Any answer, a refusal or a limit included, shows GitHub is reachable.
  const reached = all.map((w) => reachedOn(w, next.host));
  if (end.isClosed || end.isGivenUp) return quiet(reached.filter((w) => !isSame(w, target)));
  // Every watch on the host waits out the pause, so each line says so.
  if (end.isLimited) {
    const { limitedUntil } = next;
    return quiet(
      reached.map((w) =>
        isSame(w, target) ? next : w.host === next.host ? { ...w, limitedUntil } : w,
      ),
    );
  }
  let saved = next;
  let woke: Wake | null = null;
  if (judged && next.pull) {
    // Judged against every watch on the host as saved now: a push and its
    // pull request read the same runs, and either may be read first.
    const known = all.filter((w) => w.host === next.host).flatMap((w) => w.told ?? []);
    const told = [...new Set([...(target.told ?? []), ...known])];
    const { verdict, isEarly, isOwnMerge } = judged;
    woke = wakeOf(
      next,
      next.pull,
      verdict,
      { told, heard: target.heard },
      {
        isEarly,
        isOwnMerge,
        tells,
      },
    );
    // With waking off, comments are still heard, so turning it on reports no
    // history of them.
    saved = { ...next, told: toldAfter(woke.told, target.told, isAwake), heard: woke.heard };
  }
  // A layer above one whose line changed is read at once, since it may
  // wait on this one.
  const layer = judged?.isMoved ? layerOf(saved) : null;
  const above = layer ? (saved.pull?.stack?.layers.slice(layer.at) ?? []) : [];
  const restack = above.map((number) => idOf({ host: saved.host, repo: saved.repo, number }));
  const list = takeOverPush(
    reached.map((w) => (isSame(w, target) ? saved : w)),
    saved,
  );
  return { list, isSaved, next: saved, woke, restack };
}
