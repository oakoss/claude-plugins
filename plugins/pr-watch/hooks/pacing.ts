// Which watches a tick keeps, and which it reads now. Pure.
import type { Watch } from '../types';
import type { Quota } from './github';
import { idOf } from './saving';
import {
  delayOf,
  isGone,
  isQuotaLow,
  LOW_QUOTA_MS,
  OFFLINE_TELL_MS,
  offlineDelayOf,
  retryDelayOf,
  verdictOf,
  type Pause,
  type Verdict,
} from './watch';

// A host gh could not reach: one read probes it until it answers.
export type Down = { count: number; until: number; since: number; isTold: boolean; why: string };

// What register.tsx keeps between reads that decides when each line is read.
export type Pacing = {
  paused: ReadonlyMap<string, Pause>;
  unreachable: ReadonlyMap<string, Down>;
  quota: ReadonlyMap<string, Quota>;
  busy: ReadonlySet<string>;
  tried: ReadonlyMap<string, number>;
  restack: ReadonlySet<string>;
  pushedAt: number;
  burstUntil: number;
};

const BURST_MS = 5000;

// Lines that fail in the same round count once, so the wait doubles per probe.
export function downAfter(was: Down | undefined, at: number, why: string): Down {
  const isSameRound = was !== undefined && at < was.until;
  const count = isSameRound ? was.count : (was?.count ?? 0) + 1;
  return {
    count,
    since: was?.since ?? at,
    isTold: was?.isTold ?? false,
    until: isSameRound ? was.until : at + offlineDelayOf(count),
    why,
  };
}

// The lines a tick keeps, as saved, and whether any was held or dropped.
export function keptOf(
  all: readonly Watch[],
  now: number,
  known: Record<string, number>,
  { paused, unreachable }: Pick<Pacing, 'paused' | 'unreachable'>,
): { list: Watch[]; isChanged: boolean } {
  // A watch added while its host is paused waits it out like the rest, and
  // says so; a push not yet read stays while it waits.
  let isChanged = false;
  const list = all.flatMap((w) => {
    const until = paused.get(w.host)?.until ?? 0;
    const held = now < until && w.limitedUntil === undefined ? { ...w, limitedUntil: until } : w;
    if (held !== w) isChanged = true;
    // A line GitHub could not be asked about waits, as a paused unread push does,
    // until its host has been out of reach long enough to be told.
    const down = unreachable.get(held.host);
    const isLongDown = down !== undefined && now - down.since >= OFFLINE_TELL_MS;
    const isUnreached = down !== undefined && !isLongDown;
    // An unread push waits for a read of its own: while its host is out of
    // reach, 15 minutes from the later of the outage and the push; after, until read.
    const waitedFrom = Math.max(down?.since ?? 0, held.push?.pushedAt ?? 0);
    const isUnread =
      !held.pull &&
      (down === undefined
        ? held.offline !== undefined || held.limitedUntil !== undefined
        : now - waitedFrom < OFFLINE_TELL_MS);
    const isWaiting = isUnreached || isUnread;
    const isKept = !isGone(held, known, now) || isWaiting;
    if (!isKept) isChanged = true;
    return isKept ? [held] : [];
  });
  return { list, isChanged };
}

// Settling and closing are judged at the last read, so a run that started
// after it is not missed.
const verdictAt = (w: Watch, known: Record<string, number>) =>
  w.pull ? verdictOf(w.pull, known, w.host, w.checkedAt) : null;

export function isMovingOf(list: readonly Watch[], known: Record<string, number>): boolean {
  return list.some((w) => {
    const kind = verdictAt(w, known)?.kind;
    return kind === 'running' || kind === 'merged-running';
  });
}

// A failing watch retries on its own schedule; low on quota, a watch waits
// its slow delay. Neither bursts.
export function delayFor(
  w: Watch,
  verdict: Verdict | null,
  { isLow, isBurst }: { isLow: boolean; isBurst: boolean },
): number | null {
  const usual = verdict && w.pull ? delayOf(verdict, w.pull, w.checkedAt, w.shownAt) : 10_000;
  if (usual === null) return null;
  const low = isLow ? LOW_QUOTA_MS : 0;
  if (w.failures) return Math.max(retryDelayOf(w.failures), low);
  if (isLow) return Math.max(usual, low);
  return isBurst ? Math.min(usual, BURST_MS) : usual;
}

// The lines a tick reads now. Ids are unique in the list, as every route that
// adds a watch keeps them.
export function dueOf(
  list: readonly Watch[],
  now: number,
  known: Record<string, number>,
  pacing: Pacing,
): Watch[] {
  const { paused, unreachable, quota, busy, tried, restack, pushedAt, burstUntil } = pacing;
  const due: Watch[] = [];
  const probed = new Set<string>();
  for (const w of list) {
    if (now < (paused.get(w.host)?.until ?? 0)) continue;
    // One read at a time tries a host gh could not reach, not every line on it.
    const down = unreachable.get(w.host);
    if (down) {
      // A probe still in flight counts, so a slow one is not joined by another.
      const isProbing = list.some((x) => x.host === w.host && busy.has(idOf(x)));
      if (now < down.until || probed.has(w.host) || isProbing) continue;
      probed.add(w.host);
      due.push(w);
      continue;
    }
    const isLow = isQuotaLow(quota.get(w.host));
    const delay = delayFor(w, verdictAt(w, known), { isLow, isBurst: now < burstUntil });
    if (delay === null || busy.has(idOf(w))) continue;
    const isSlowed = isLow || Boolean(w.failures);
    const last = Math.max(w.checkedAt, tried.get(idOf(w)) ?? 0);
    // A line says the pause until a read of its own, so the end of one reads it at once.
    const isDue =
      w.limitedUntil !== undefined ||
      (last <= pushedAt && !isSlowed) ||
      now - last >= delay ||
      (restack.has(idOf(w)) && !isSlowed);
    if (isDue) due.push(w);
  }
  return due;
}
