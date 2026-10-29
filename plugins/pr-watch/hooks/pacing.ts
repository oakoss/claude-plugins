// Which watches a tick keeps, and which it reads now. Pure.
import type { Watch } from '../types';
import { idOf } from './saving';
import {
  delayOf,
  isGone,
  isQuotaLow,
  LOW_QUOTA_MS,
  OFFLINE_TELL_MS,
  retryDelayOf,
  verdictOf,
  type Pause,
} from './watch';

// A host gh could not reach: one read probes it until it answers.
export type Down = { count: number; until: number; since: number; isTold: boolean; why: string };

// What register.tsx keeps between reads that decides when each line is read.
export type Pacing = {
  paused: ReadonlyMap<string, Pause>;
  unreachable: ReadonlyMap<string, Down>;
  quota: ReadonlyMap<string, { remaining: number; limit: number }>;
  busy: ReadonlySet<string>;
  tried: ReadonlyMap<string, number>;
  restack: ReadonlySet<string>;
  pushedAt: number;
  burstUntil: number;
};

const BURST_MS = 5000;

// The lines a tick keeps, as saved; `all` itself when none changed, so the
// caller writes nothing.
export function keptOf(
  all: readonly Watch[],
  now: number,
  known: Record<string, number>,
  { paused, unreachable }: Pick<Pacing, 'paused' | 'unreachable'>,
): readonly Watch[] {
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
  return isChanged ? list : all;
}

// The lines a tick reads now, and whether any has a run moving.
export function dueOf(
  list: readonly Watch[],
  now: number,
  known: Record<string, number>,
  pacing: Pacing,
): { due: Watch[]; isMoving: boolean } {
  const { paused, unreachable, quota, busy, tried, restack, pushedAt, burstUntil } = pacing;
  let isMoving = false;
  const due: Watch[] = [];
  const probed = new Set<string>();
  for (const w of list) {
    // Settling and closing are judged at the last read, so a run that started
    // after it is not missed.
    const verdict = w.pull ? verdictOf(w.pull, known, w.host, w.checkedAt) : null;
    if (verdict?.kind === 'running' || verdict?.kind === 'merged-running') isMoving = true;
    const pauseEnd = paused.get(w.host)?.until ?? 0;
    if (now < pauseEnd) continue;
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
    const usual = verdict && w.pull ? delayOf(verdict, w.pull, w.checkedAt, w.shownAt) : 10_000;
    // A failing watch retries on its own schedule; low on quota, a watch waits
    // its slow delay. Neither bursts.
    const low = isQuotaLow(quota.get(w.host)) ? LOW_QUOTA_MS : 0;
    const isSlowed = low > 0 || Boolean(w.failures);
    const delay =
      usual === null
        ? null
        : w.failures
          ? Math.max(retryDelayOf(w.failures), low)
          : low > 0
            ? Math.max(usual, low)
            : now < burstUntil
              ? Math.min(usual, BURST_MS)
              : usual;
    if (delay === null || busy.has(idOf(w))) continue;
    const last = Math.max(w.checkedAt, tried.get(idOf(w)) ?? 0);
    // A line says the pause until a read of its own, so the end of one reads it at once.
    const isDue =
      w.limitedUntil !== undefined ||
      (last <= pushedAt && !isSlowed) ||
      now - last >= delay ||
      (restack.has(idOf(w)) && !isSlowed);
    if (isDue) due.push(w);
  }
  return { due, isMoving };
}
