import { describe, expect, test } from 'vitest';

import type { Kept } from '../types';
import { NO_GRANT, UNGRANTED } from './consent';
import { isKept, keptOf, offKept, restoredOf, type KeptSource } from './kept';

const SHA = 'a'.repeat(40);

const leg = (done: boolean, capped = false) => ({
  type: 'review-cycle:code-reviewer',
  counts: true,
  spawnTree: 't1',
  done,
  capped,
  counted: false,
  spawnedAt: 1000,
});

function source(): KeptSource & { message: { unread: null; said: string } } {
  return {
    reviews: [{ type: 'codex', trees: ['t0', 't1'], reviewedPaths: ['a.ts'] }],
    legs: new Map([
      ['running', { ...leg(false), timer: { cancel: () => null } }],
      ['finished', { ...leg(true), timer: null }],
    ]),
    message: {
      tree: 't1',
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT, commit: true, pushNamed: ['main'] },
      pointed: { named: ['12'], answer: [], unplaced: false },
      unread: null,
      said: 'push it',
    },
    messages: 3,
    lastAnswer: 'Pushed.',
    misses: [{ message: 'ship', offer: 'Ship?', steps: ['push', 'pr'], refusal: 'no' }],
    dropped: [{ agentId: 'x', text: 'no receipt', old: false }],
    capped: ['y'],
    scratch: ['/tmp/s'],
    reviewerChanges: ['git add'],
    hold: { floor: { step: 'push', how: 'mentioned' }, declined: true },
    mandate: { epic: 'cpl-7ktn' },
    roundsFrom: 1,
    pushed: [['/repo/.git\torigin/main', SHA]],
    reviewing: '# Review cycle',
  };
}

// What a reload reads back: a copy, sharing nothing with the state it came from.
const roundTrip = (k: Kept): unknown => structuredClone(k);

describe('keptOf', () => {
  test('drops each leg timer and the message fields a reload starts over', () => {
    const k = keptOf(source());
    expect(k.legs).toEqual([
      ['running', leg(false)],
      ['finished', leg(true)],
    ]);
    expect(Object.keys(k.message).toSorted()).toEqual(
      ['grant', 'nudged', 'pointed', 'prWindow', 'tree'].toSorted(),
    );
  });

  test('copies each field from its own source field', () => {
    const s = source();
    expect(keptOf(s)).toMatchObject({
      reviews: s.reviews,
      misses: s.misses,
      dropped: s.dropped,
      capped: ['y'],
      scratch: ['/tmp/s'],
      reviewerChanges: ['git add'],
      messages: 3,
      lastAnswer: 'Pushed.',
      hold: s.hold,
      mandate: s.mandate,
      roundsFrom: 1,
      pushed: s.pushed,
      reviewing: '# Review cycle',
    });
  });

  test('keeps only the fields a kept leg declares', () => {
    const s = source();
    s.legs = new Map([['l', { ...leg(false), timer: null, abort: 'not kept' } as never]]);
    expect(keptOf(s).legs).toEqual([['l', leg(false)]]);
  });

  test('writes a record isKept takes back', () => {
    expect(isKept(roundTrip(keptOf(source())))).toBe(true);
  });
});

describe('restoredOf', () => {
  test('takes back every kept field, legs without a timer and the message without its text', () => {
    const s = source();
    const r = restoredOf(keptOf(s));
    expect(r).toEqual({
      ...s,
      legs: new Map([
        ['running', { ...leg(false), timer: null }],
        ['finished', { ...leg(true), timer: null }],
      ]),
      message: { ...s.message, said: null },
    });
  });

  test('takes back no key a record carries beyond the kept fields', () => {
    const k = { ...keptOf(source()), gateOn: false, stopBefore: 'never stop' };
    expect(isKept(k)).toBe(true);
    expect(Object.keys(restoredOf(k)).toSorted()).toEqual(Object.keys(keptOf(source())).toSorted());
  });

  test('keeps again what it took back', () => {
    const k = keptOf(source());
    expect(keptOf(restoredOf(k))).toEqual(k);
  });
});

describe('isKept', () => {
  type Mutate = (k: Record<string, any>) => void;
  // One field wrong at a time; every other field stays valid.
  const broken: [string, Mutate][] = [
    ['a review with one tree', (k) => (k.reviews[0].trees = ['t0'])],
    ['a review path that is not a string', (k) => (k.reviews[0].reviewedPaths = [1])],
    ['a leg without its id', (k) => (k.legs[0] = [leg(false)])],
    ['a leg with a non-finite spawn time', (k) => (k.legs[0][1].spawnedAt = null)],
    ['a leg flag that is not boolean', (k) => (k.legs[0][1].counted = 'no')],
    ['a message tree that is a number', (k) => (k.message.tree = 1)],
    ['a message flag that is missing', (k) => delete k.message.prWindow],
    ['a grant missing a field', (k) => delete k.message.grant.commit],
    ['a grant with an unknown push', (k) => (k.message.grant.push = 'force')],
    ['pointed numbers that are not strings', (k) => (k.message.pointed.named = [12])],
    ['pointed without unplaced', (k) => delete k.message.pointed.unplaced],
    ['a message count that is a string', (k) => (k.messages = '3')],
    ['a miss naming an unknown step', (k) => (k.misses[0].steps = ['deploy'])],
    ['a dropped review without its text', (k) => delete k.dropped[0].text],
    ['a capped leg that is not a string', (k) => (k.capped = [1])],
    ['a hold of an unknown kind', (k) => (k.hold.floor = { step: 'push', how: 'asked' })],
    ['a decline that is not a flag', (k) => (k.hold.declined = 'yes')],
    ['a hold without its floor', (k) => delete k.hold.floor],
    ['a hold of an unknown step', (k) => (k.hold.floor = { step: 'deploy', how: 'mentioned' })],
    ['a hold of a prototype name', (k) => (k.hold.floor = { step: 'toString', how: 'mentioned' })],
    ['a miss naming a prototype name', (k) => (k.misses[0].steps = ['constructor'])],
    ['a mandate that is not an epic id', (k) => (k.mandate = { epic: 'not an id' })],
    ['rounds counted past the reviews', (k) => (k.roundsFrom = 2)],
    ['negative rounds', (k) => (k.roundsFrom = -1)],
    ['a push target without its tab', (k) => (k.pushed[0][0] = 'origin/main')],
    ['a pushed commit that is not an object id', (k) => (k.pushed[0][1] = 'abc')],
    ['a review skill text that is a number', (k) => (k.reviewing = 1)],
    ['no message', (k) => delete k.message],
    ['a message that is a list', (k) => (k.message = [])],
    ['a review type that is not a string', (k) => (k.reviews[0].type = 1)],
    ['a review tree that is not a string', (k) => (k.reviews[0].trees = ['t0', 1])],
    ['review trees that are not a list', (k) => (k.reviews[0].trees = { 0: 't0', 1: 't1' })],
    ['a leg that is not a pair', (k) => (k.legs[0] = { 0: 'running', 1: leg(false) })],
    ['a leg id that is not a string', (k) => (k.legs[0][0] = 1)],
    ['a leg that is null', (k) => (k.legs[0][1] = null)],
    ['a leg type that is not a string', (k) => (k.legs[0][1].type = 1)],
    ['a leg spawn tree that is a number', (k) => (k.legs[0][1].spawnTree = 1)],
    ...(['counts', 'done', 'capped', 'counted'] as const).map((flag): [string, Mutate] => [
      `a leg ${flag} flag that is a string`,
      (k) => (k.legs[0][1][flag] = 'no'),
    ]),
    ['a nudged flag that is a string', (k) => (k.message.nudged = 'no')],
    ['a last answer that is a number', (k) => (k.lastAnswer = 1)],
    ...(['message', 'offer', 'refusal'] as const).map((field): [string, Mutate] => [
      `a miss whose ${field} is a number`,
      (k) => (k.misses[0][field] = 1),
    ]),
    ['miss steps that are not a list', (k) => (k.misses[0].steps = 'push')],
    ['a dropped review whose agent is a number', (k) => (k.dropped[0].agentId = 1)],
    ['a dropped review whose age is a string', (k) => (k.dropped[0].old = 'no')],
    ['a scratch directory that is a number', (k) => (k.scratch = [1])],
    ['a reviewer change that is a number', (k) => (k.reviewerChanges = [1])],
    ['a mandate epic in a list', (k) => (k.mandate = { epic: ['cpl-7ktn'] })],
    ['fractional rounds', (k) => (k.roundsFrom = 0.5)],
    ['a push entry with one part', (k) => (k.pushed[0] = ['/repo/.git\torigin/main'])],
    ['a push target that is a number', (k) => (k.pushed[0][0] = 1)],
    ['a pushed commit in a list', (k) => (k.pushed[0][1] = [SHA])],
    ['a pushed commit with a prefix', (k) => (k.pushed[0][1] = `x${SHA}`)],
    ['a pushed commit with a suffix', (k) => (k.pushed[0][1] = `${SHA}x`)],
    ['a pushed commit in upper case', (k) => (k.pushed[0][1] = SHA.toUpperCase())],
    ['a push entry with three parts', (k) => k.pushed[0].push(SHA)],
    ['review trees that are null', (k) => (k.reviews[0].trees = null)],
    // A record whose lists are missing or hold null is refused, not thrown on.
    ...(['reviews', 'legs', 'misses', 'dropped', 'pushed'] as const).flatMap(
      (list): [string, Mutate][] => [
        [`a record without ${list}`, (k) => delete k[list]],
        [`${list} holding null`, (k) => (k[list] = [null])],
      ],
    ),
  ];

  test.each(broken)('refuses %s', (_, mutate) => {
    const k = roundTrip(keptOf(source())) as Record<string, any>;
    mutate(k);
    expect(isKept(k)).toBe(false);
  });

  test('takes a record with nothing held, no mandate and no review running', () => {
    const k = roundTrip(keptOf(source())) as Record<string, any>;
    Object.assign(k, { hold: null, mandate: null, reviewing: null, legs: [], roundsFrom: 0 });
    expect(isKept(k)).toBe(true);
  });

  const STEPS = ['push', 'pr', 'merge', 'approve', 'release', 'comment'] as const;
  test.each(STEPS)('takes a miss and a declined hold of %s', (step) => {
    const k = roundTrip(keptOf(source())) as Record<string, any>;
    k.misses[0].steps = [step];
    k.hold = { floor: { step, how: 'declined' }, declined: true };
    expect(isKept(k)).toBe(true);
  });

  test('takes a leg whose tree was unreadable and a SHA-256 push', () => {
    const k = roundTrip(keptOf(source())) as Record<string, any>;
    k.legs[0][1].spawnTree = null;
    k.pushed[0][1] = 'b'.repeat(64);
    expect(isKept(k)).toBe(true);
  });

  test('refuses what is not a record', () => {
    for (const x of [null, [], 'gate', 1]) expect(isKept(x)).toBe(false);
  });
});

describe('offKept', () => {
  test('keeps settled legs and reviews, and drops what an answer while off settles', () => {
    const off = offKept(keptOf(source()));
    expect(off.legs.map(([id]) => id)).toEqual(['finished']);
    expect(off.reviews).toHaveLength(1);
    expect(off.message).toEqual({ tree: null, nudged: false, prWindow: false, ...UNGRANTED });
    expect(off).toMatchObject({ lastAnswer: '', hold: null, mandate: null, reviewing: null });
    expect(isKept(roundTrip(off))).toBe(true);
  });

  test('keeps a capped leg that never finished', () => {
    const s = source();
    s.legs = new Map([['capped', { ...leg(false, true), timer: null }]]);
    expect(offKept(keptOf(s)).legs.map(([id]) => id)).toEqual(['capped']);
  });
});
