import { describe, expect, test } from 'vitest';

import type { Watch } from '../types';
import { flow, job, pull, watched } from './fixtures';
import { delayFor, downAfter, dueOf, isMovingOf, keptOf, type Down, type Pacing } from './pacing';
import { LOW_QUOTA_MS, OFFLINE_TELL_MS, offlineDelayOf, retryDelayOf } from './watch';

const NOW = Date.parse('2026-10-03T22:01:10Z');
const running = () => flow(1, 'CI', [job('CI Summary', null, true)]);
const green = () => flow(1, 'CI', [job('CI Summary', 'SUCCESS', true)]);
const LOW = { remaining: 1, limit: 5000, resetAt: '2026-10-03T23:00:00Z' };

const pacing = (over: Partial<Pacing> = {}): Pacing => ({
  paused: new Map(),
  unreachable: new Map(),
  quota: new Map(),
  busy: new Set(),
  tried: new Map(),
  restack: new Set(),
  pushedAt: 0,
  burstUntil: 0,
  ...over,
});

const down = (over: Partial<Down> = {}): Down => ({
  count: 1,
  until: NOW + 15_000,
  since: NOW,
  isTold: false,
  why: 'no such host',
  ...over,
});

// A running line read `ago` ms before NOW, numbered so ids differ.
const line = (number: number, ago = 0, over: Partial<Watch> = {}) =>
  watched(pull([running()], { number }), { number, checkedAt: NOW - ago, ...over });

describe('downAfter', () => {
  test('a first failure waits the first delay', () => {
    expect(downAfter(undefined, NOW, 'why')).toEqual({
      count: 1,
      since: NOW,
      isTold: false,
      until: NOW + offlineDelayOf(1),
      why: 'why',
    });
  });

  test('lines failing in the same round count once; the next round doubles the wait', () => {
    const was = down({ isTold: true, since: NOW - 60_000 });
    expect(downAfter(was, NOW + 1000, 'again')).toEqual({ ...was, why: 'again' });
    expect(downAfter(was, was.until, 'x').count).toBe(2);
    const after = NOW + 20_000;
    expect(downAfter(was, after, 'later')).toEqual({
      count: 2,
      since: NOW - 60_000,
      isTold: true,
      until: after + offlineDelayOf(2),
      why: 'later',
    });
  });
});

describe('keptOf', () => {
  const none = { paused: new Map(), unreachable: new Map() };
  // Closed, so gone with time alone.
  const closed = watched(pull([green()], { state: 'CLOSED' }), { checkedAt: NOW });

  test('an unchanged list says so', () => {
    const all = [line(1), line(2)];
    expect(keptOf(all, NOW, {}, none)).toEqual({ list: all, isChanged: false });
  });

  test('a line on a paused host says the pause until a read of its own', () => {
    const paused = new Map([['github.com', { until: NOW + 60_000, backoff: 60_000 }]]);
    const { list, isChanged } = keptOf([line(1)], NOW, {}, { ...none, paused });
    expect(isChanged).toBe(true);
    expect(list[0]?.limitedUntil).toBe(NOW + 60_000);
    const said = line(1, 0, { limitedUntil: NOW + 5000 });
    expect(keptOf([said], NOW, {}, { ...none, paused }).isChanged).toBe(false);
  });

  test('a gone line leaves, unless its host has been out of reach for less than the tell time', () => {
    expect(keptOf([closed], NOW, {}, none)).toEqual({ list: [], isChanged: true });
    const short = new Map([['github.com', down({ since: NOW - 60_000 })]]);
    expect(keptOf([closed], NOW, {}, { ...none, unreachable: short }).list).toEqual([closed]);
    const long = new Map([['github.com', down({ since: NOW - OFFLINE_TELL_MS })]]);
    expect(keptOf([closed], NOW, {}, { ...none, unreachable: long }).list).toEqual([]);
  });

  test('an unread push past its grace waits while its note says why, and 15 minutes into an outage', () => {
    const push = { branch: 'b', pushedAt: NOW - 120_000 };
    const unread = watched(undefined, { number: 0, push, checkedAt: 0 });
    expect(keptOf([unread], NOW, {}, none).list).toEqual([]);
    expect(keptOf([{ ...unread, offline: 1 }], NOW, {}, none).list).toHaveLength(1);
    expect(keptOf([{ ...unread, limitedUntil: NOW }], NOW, {}, none).list).toHaveLength(1);
    const long = new Map([['github.com', down({ since: NOW - OFFLINE_TELL_MS })]]);
    expect(keptOf([unread], NOW, {}, { ...none, unreachable: long }).list).toHaveLength(1);
    const old = { ...unread, push: { branch: 'b', pushedAt: NOW - OFFLINE_TELL_MS } };
    expect(keptOf([old], NOW, {}, { ...none, unreachable: long }).list).toEqual([]);
  });
});

describe('isMovingOf', () => {
  test('a running or merged-running line moves the clock; a finished one does not', () => {
    expect(isMovingOf([line(1)], {})).toBe(true);
    const mergedRunning = watched(
      pull([green()], {
        state: 'MERGED',
        mergedAt: '2026-10-03T22:00:00Z',
        mergeRuns: { workflows: [running()], isTruncated: false },
      }),
      { checkedAt: NOW },
    );
    expect(isMovingOf([mergedRunning], {})).toBe(true);
    expect(isMovingOf([watched(pull([green()]), { checkedAt: NOW })], {})).toBe(false);
    expect(isMovingOf([watched()], {})).toBe(false);
  });
});

describe('delayFor', () => {
  const quiet = { isLow: false, isBurst: false };
  const ready = watched(pull([green()]), { checkedAt: NOW, shownAt: NOW });

  test('a running line every 10 s, a burst no slower than 5 s, an unread one every 10 s', () => {
    expect(delayFor(line(1), { kind: 'running', gate: running() }, quiet)).toBe(10_000);
    expect(delayFor(ready, { kind: 'ready' }, { ...quiet, isBurst: true })).toBe(5000);
    expect(delayFor(watched(), null, quiet)).toBe(10_000);
  });

  test('low on quota, at least the slow delay; a failing line on its retry schedule, never bursting', () => {
    expect(delayFor(ready, { kind: 'ready' }, { isLow: true, isBurst: true })).toBe(LOW_QUOTA_MS);
    const failing = { ...ready, failures: 1 };
    expect(delayFor(failing, { kind: 'ready' }, { ...quiet, isBurst: true })).toBe(retryDelayOf(1));
    expect(delayFor(failing, { kind: 'ready' }, { isLow: true, isBurst: false })).toBe(
      Math.max(retryDelayOf(1), LOW_QUOTA_MS),
    );
  });

  test('a closed line is not read again', () => {
    expect(delayFor(ready, { kind: 'closed' }, quiet)).toBeNull();
  });
});

describe('dueOf', () => {
  test('a line is due once its delay has passed since its last read or try', () => {
    expect(dueOf([line(1, 9000)], NOW, {}, pacing())).toEqual([]);
    expect(dueOf([line(1, 10_000)], NOW, {}, pacing())).toHaveLength(1);
    const tried = new Map([['github.com/o/r#1', NOW - 1000]]);
    expect(dueOf([line(1, 10_000)], NOW, {}, pacing({ tried }))).toEqual([]);
  });

  test('a line read now, on a paused host, or settled is not due', () => {
    expect(
      dueOf([line(1, 60_000)], NOW, {}, pacing({ busy: new Set(['github.com/o/r#1']) })),
    ).toEqual([]);
    const paused = new Map([['github.com', { until: NOW + 1, backoff: 60_000 }]]);
    expect(dueOf([line(1, 60_000)], NOW, {}, pacing({ paused }))).toEqual([]);
    const settled = watched(pull([green()], { state: 'CLOSED' }), { checkedAt: 0 });
    expect(dueOf([settled], NOW, {}, pacing())).toEqual([]);
  });

  test('a push, a stack layer below, or a pause it says reads it at once, unless it is slowed', () => {
    const fresh = line(1, 1000);
    expect(dueOf([fresh], NOW, {}, pacing({ pushedAt: NOW - 500 }))).toEqual([fresh]);
    expect(dueOf([fresh], NOW, {}, pacing({ pushedAt: fresh.checkedAt }))).toEqual([fresh]);
    expect(dueOf([fresh], NOW, {}, pacing({ restack: new Set(['github.com/o/r#1']) }))).toEqual([
      fresh,
    ]);
    expect(dueOf([{ ...fresh, limitedUntil: NOW }], NOW, {}, pacing())).toHaveLength(1);
    const failing = { ...fresh, failures: 1 };
    expect(dueOf([failing], NOW, {}, pacing({ pushedAt: NOW - 500 }))).toEqual([]);
    const quota = new Map([['github.com', LOW]]);
    expect(dueOf([fresh], NOW, {}, pacing({ pushedAt: NOW - 500, quota }))).toEqual([]);
    expect(
      dueOf([fresh], NOW, {}, pacing({ restack: new Set(['github.com/o/r#1']), quota })),
    ).toEqual([]);
  });

  test('a burst reads every 5 s', () => {
    const ready = watched(pull([green()], { number: 1 }), {
      number: 1,
      checkedAt: NOW - 5000,
      shownAt: NOW,
    });
    expect(dueOf([ready], NOW, {}, pacing())).toEqual([]);
    expect(dueOf([ready], NOW, {}, pacing({ burstUntil: NOW + 1 }))).toEqual([ready]);
  });

  test('one read at a time probes a host gh could not reach, once its wait is over', () => {
    const lines = [line(1, 60_000), line(2, 60_000), line(3, 60_000, { host: 'ghe.example.com' })];
    const waiting = new Map([['github.com', down({ until: NOW + 1 })]]);
    expect(dueOf(lines, NOW, {}, pacing({ unreachable: waiting }))).toEqual([lines[2]]);
    const over = new Map([['github.com', down({ until: NOW })]]);
    expect(dueOf(lines, NOW, {}, pacing({ unreachable: over }))).toEqual([lines[0], lines[2]]);
    const probing = pacing({ unreachable: over, busy: new Set(['github.com/o/r#2']) });
    expect(dueOf(lines, NOW, {}, probing)).toEqual([lines[2]]);
    const ghe = new Map([['ghe.example.com', down({ until: NOW })]]);
    const busyElsewhere = pacing({ unreachable: ghe, busy: new Set(['github.com/o/r#1']) });
    expect(dueOf(lines, NOW, {}, busyElsewhere)).toEqual([lines[1], lines[2]]);
  });
});
