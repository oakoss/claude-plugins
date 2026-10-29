// What a read of a watch saves into the list, and what it tells. Pure.
import type { Activity, Pull, Watch } from '../types';
import {
  GIVE_UP_AFTER,
  isChecking,
  isRefused,
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

export const nameOf = (w: Pick<Watch, 'repo' | 'number' | 'push'>) =>
  w.push ? `the push to ${w.push.branch} on ${w.repo}` : `${w.repo}#${w.number}`;

// GitHub answered, so no line on the host waits on it any more.
// A push not yet read keeps its note until a read of its own.
export const reachedOn = (w: Watch, host: string): Watch =>
  w.host === host && w.pull && w.offline !== undefined ? { ...w, offline: undefined } : w;

// What a read came back with, its error sorted by register.tsx.
export type Outcome =
  | { kind: 'gone' }
  | { kind: 'handoff'; to: Watch }
  | { kind: 'pull'; pull: Pull; limitedUntil: number | undefined }
  | { kind: 'limited'; until: number }
  | { kind: 'offline'; count: number; limitedUntil: number | undefined }
  | { kind: 'error'; why: string; limitedUntil: number | undefined };

type Pulled = Watch & { pull: Pull };

export type ReadEnd =
  | { kind: 'gone' }
  | { kind: 'handoff'; to: Watch }
  | { kind: 'read'; next: Pulled }
  | { kind: 'limited'; next: Watch & { limitedUntil: number } }
  | { kind: 'offline'; next: Watch & { offline: number } }
  | { kind: 'failed' | 'given-up'; next: Watch & { error: string; failures: number } };

// checkedAt stays the last good read's after a failure: settling is judged by
// it, and `tried` already spaces the retries.
export function endOf(target: Watch, o: Outcome, now: number): ReadEnd {
  switch (o.kind) {
    case 'gone':
    case 'handoff': {
      return o;
    }
    case 'pull': {
      const { pull, limitedUntil } = o;
      const next = { ...target, pull, limitedUntil, checkedAt: now };
      return {
        kind: 'read',
        next: {
          ...next,
          error: undefined,
          failures: undefined,
          refused: undefined,
          offline: undefined,
        },
      };
    }
    // A rate limit is GitHub's to lift, so it does not count toward giving up.
    case 'limited': {
      return { kind: 'limited', next: { ...target, offline: undefined, limitedUntil: o.until } };
    }
    // Neither counted toward giving up nor shown in red: the line stays as last read.
    case 'offline': {
      const { count: offline, limitedUntil } = o;
      return { kind: 'offline', next: { ...target, offline, limitedUntil } };
    }
    case 'error': {
      const failures = (target.failures ?? 0) + 1;
      const refused = isRefused(o.why, target.host) ? true : target.refused;
      const { limitedUntil } = o;
      const error = `gh failed: ${o.why}`;
      const next = { ...target, error, failures, refused, offline: undefined, limitedUntil };
      return { kind: failures >= GIVE_UP_AFTER ? 'given-up' : 'failed', next };
    }
  }
}

// What a fresh read of an open line says, judged before it is saved.
export type Judged = {
  verdict: Verdict;
  isEarly: boolean;
  isOwnMerge: boolean;
  isWakeAsked: boolean;
  // Null while the line says what it said; only a line that moved toasts.
  moved: { toast: { text: string; isUrgent: boolean } | null } | null;
};

export function judgedOf(
  target: Watch,
  next: Pulled,
  verdict: Verdict,
  now: number,
  { merged, asked }: { merged: readonly string[]; asked: readonly string[] },
): { next: Pulled; judged: Judged } {
  const { pull } = next;
  // A passed merge is said only once no later run can start: until then
  // it is not yet what the line has said.
  const isEarly = verdict.kind === 'merged-passed' && !isSettled(verdict, pull, now);
  const { shown } = target;
  const isWakeAsked = asked.includes(idOf(next));
  // A merge Claude made is news once it asked to hear its checks pass.
  const isOwnMerge = merged.includes(idOf(next)) && !isWakeAsked;
  const judged = { verdict, isEarly, isOwnMerge, isWakeAsked };
  // A ready pull request read as checking is not ready again afterwards.
  if (isEarly || isChecking(verdict)) return { next, judged: { ...judged, moved: null } };
  const after = next.push ? '' : ' merged';
  const text = toastOf(labelOf(next), verdict, shown, after, stillRunning(pull));
  // What someone away from the terminal comes back for; a passed merge is not.
  const isUrgent = ['ready', 'failing', 'merged-failing'].includes(verdict.kind);
  const nowShown = shownOf(verdict);
  const shownAt = nowShown !== shown || next.shownAt === undefined ? now : next.shownAt;
  return {
    next: { ...next, shown: nowShown, shownAt },
    judged: {
      ...judged,
      moved: nowShown === shown ? null : { toast: text === null ? null : { text, isUrgent } },
    },
  };
}

// A read ready to save: a fresh one judged, or found closed.
export type Saving =
  | Exclude<ReadEnd, { kind: 'read' }>
  | { kind: 'closed' }
  | { kind: 'judged'; next: Pulled; judged: Judged };

export type Saved = { list: Watch[]; isSaved: boolean; woke: Wake | null; restack: string[] };

// The watch list once a read is saved into it, and what the read tells:
// judged against `all` as saved now, inside the write.
export function savedAfter(
  all: readonly Watch[],
  target: Watch,
  s: Saving,
  { isAwake, tells }: { isAwake: boolean; tells: (a: Activity) => boolean },
): Saved {
  const isSaved = all.some((w) => isSame(w, target));
  const quiet = (list: Watch[]) => ({ list, isSaved, woke: null, restack: [] });
  const others = () => all.filter((w) => !isSame(w, target)).map((w) => reachedOn(w, target.host));
  if (s.kind === 'gone') return quiet(others());
  if (s.kind === 'handoff') {
    if (!isSaved) return quiet([...all]);
    // The PR's runs are the push's, so what Claude was told of carries over.
    const told = target.told ?? [];
    const to = { ...s.to, told };
    const rest = others();
    if (!rest.some((w) => idOf(w) === idOf(to))) return quiet([...rest, to]);
    return quiet(
      rest.map((w) =>
        idOf(w) === idOf(to) ? { ...w, told: [...new Set([...(w.told ?? []), ...told])] } : w,
      ),
    );
  }
  // The host's other lines wait on this read's probe, so they say so too.
  if (s.kind === 'offline') {
    const { next } = s;
    const { offline } = next;
    return quiet(
      all.map((w) => (isSame(w, target) ? next : w.host === next.host ? { ...w, offline } : w)),
    );
  }
  // Any answer, a refusal or a limit included, shows GitHub is reachable.
  const reached = all.map((w) => reachedOn(w, target.host));
  if (s.kind === 'closed' || s.kind === 'given-up') {
    return quiet(reached.filter((w) => !isSame(w, target)));
  }
  // Every watch on the host waits out the pause, so each line says so.
  if (s.kind === 'limited') {
    const { next } = s;
    const { limitedUntil } = next;
    return quiet(
      reached.map((w) =>
        isSame(w, target) ? next : w.host === next.host ? { ...w, limitedUntil } : w,
      ),
    );
  }
  let saved: Watch = s.next;
  let woke: Wake | null = null;
  let restack: string[] = [];
  if (s.kind === 'judged') {
    const { next, judged } = s;
    // Judged against every watch on the host as saved now: a push and its
    // pull request read the same runs, and either may be read first.
    const known = all.filter((w) => w.host === next.host).flatMap((w) => w.told ?? []);
    const told = [...new Set([...(target.told ?? []), ...known])];
    const { verdict, isEarly, isOwnMerge } = judged;
    const last = { told, heard: target.heard };
    woke = wakeOf(next, next.pull, verdict, last, { isEarly, isOwnMerge, tells });
    // With waking off, comments are still heard, so turning it on reports no
    // history of them.
    saved = { ...next, told: toldAfter(woke.told, target.told, isAwake), heard: woke.heard };
    // A layer above one whose line changed is read at once, since it may
    // wait on this one.
    const layer = judged.moved ? layerOf(saved) : null;
    const above = layer ? (next.pull.stack?.layers.slice(layer.at) ?? []) : [];
    restack = above.map((number) => idOf({ host: next.host, repo: next.repo, number }));
  }
  const list = takeOverPush(
    reached.map((w) => (isSame(w, target) ? saved : w)),
    saved,
  );
  return { list, isSaved, woke, restack };
}

// What Claude is told when a line stops after GIVE_UP_AFTER failed reads.
export function givenUpOf(next: Watch): string {
  return [
    `pr-watch: ${GIVE_UP_AFTER} reads of ${nameOf(next)} in a row failed, so pr-watch stopped watching it. The last: ${next.error}`,
    next.push
      ? `pr-watch follows the branch again on its next push once gh can read it. ${next.url}`
      : `Watch it again with pr-watch's watch tool once gh can read it. ${next.url}`,
  ].join('\n');
}
