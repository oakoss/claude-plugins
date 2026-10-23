import { describe, expect, test } from 'vitest';

import {
  declinedSince,
  holdAfter,
  holds,
  lowerHold,
  type HoldReason,
  type HoldState,
  type HoldStep,
} from './hold';

const mentioned = (step: HoldStep): HoldReason => ({ step, how: 'mentioned' });
const declined = (step: HoldStep): HoldReason => ({ step, how: 'declined' });

describe('holds', () => {
  const STEPS = ['commit', 'push', 'pr', 'merge', 'approve', 'release', 'comment'] as const;
  // The steps each hold holds; approval shares merge's rung.
  const HELD: Record<HoldStep, readonly string[]> = {
    push: ['push', 'pr', 'merge', 'approve', 'release', 'comment'],
    pr: ['pr', 'merge', 'approve', 'release', 'comment'],
    merge: ['merge', 'approve', 'release', 'comment'],
    approve: ['merge', 'approve', 'release', 'comment'],
    release: ['release', 'comment'],
    comment: ['comment'],
  };
  test.each(Object.entries(HELD))('a hold of %s holds %j', (step, held) => {
    for (const how of ['mentioned', 'declined'] as const) {
      const hold = { step: step as HoldStep, how };
      expect(STEPS.filter((s) => holds(hold, s))).toEqual(held);
    }
  });

  test('nothing held holds nothing', () => {
    expect(STEPS.filter((s) => holds(null, s))).toEqual([]);
  });

  test.each([
    ['push', 'merge', 'push'],
    ['merge', 'push', 'push'],
    ['comment', 'release', 'release'],
    ['release', 'comment', 'release'],
    ['merge', 'approve', 'merge'],
  ] as const)('after a hold of %s, a hold of %s keeps %s', (first, then, kept) => {
    const a = mentioned(first);
    const b = declined(then);
    expect(lowerHold(a, b)?.step).toBe(kept);
    expect(lowerHold(null, b)).toBe(b);
    expect(lowerHold(a, null)).toBe(a);
  });
});

// Each message is whether it asks for a step, and the hold it raises.
type Message = readonly [lifts: boolean, hold: HoldReason | null];

describe('holdAfter', () => {
  const after = (messages: readonly Message[]): HoldState => {
    let state: HoldState = null;
    for (const [lifts, hold] of messages) state = holdAfter(state, lifts, hold);
    return state;
  };

  test.each<[string, readonly Message[], HoldState]>([
    ['nothing held stays so', [[false, null]], null],
    ['a hold holds', [[false, mentioned('merge')]], { floor: mentioned('merge'), declined: false }],
    [
      'a later, higher hold keeps the earlier floor',
      [
        [false, mentioned('push')],
        [false, mentioned('merge')],
      ],
      { floor: mentioned('push'), declined: false },
    ],
    [
      'a later, lower hold lowers the floor',
      [
        [false, mentioned('merge')],
        [false, declined('push')],
      ],
      { floor: declined('push'), declined: true },
    ],
    [
      'a decline of the same step keeps the earlier mention and is still a decline',
      [
        [false, mentioned('push')],
        [false, declined('push')],
      ],
      { floor: mentioned('push'), declined: true },
    ],
    [
      'a decline under a lower mention keeps the mention and is still a decline',
      [
        [false, mentioned('push')],
        [false, declined('merge')],
      ],
      { floor: mentioned('push'), declined: true },
    ],
    [
      'a decline outlasts a later mention',
      [
        [false, declined('push')],
        [false, mentioned('merge')],
      ],
      { floor: declined('push'), declined: true },
    ],
    [
      'a request lifts the hold, decline included',
      [
        [false, declined('push')],
        [true, null],
      ],
      null,
    ],
    [
      'a request lifts the hold before its own applies',
      [
        [false, mentioned('push')],
        [true, mentioned('pr')],
      ],
      { floor: mentioned('pr'), declined: false },
    ],
    [
      'a message that neither asks nor holds keeps the hold',
      [
        [false, declined('merge')],
        [false, null],
      ],
      { floor: declined('merge'), declined: true },
    ],
  ])('%s', (_name, messages, expected) => {
    expect(after(messages)).toEqual(expected);
  });

  test('a declined floor not flagged stays declined under a later, lower hold', () => {
    const unflagged = { floor: declined('merge'), declined: false };
    expect(holdAfter(unflagged, false, mentioned('push'))).toEqual({
      floor: mentioned('push'),
      declined: true,
    });
  });
});

describe('declinedSince', () => {
  test.each<[string, HoldState, boolean]>([
    ['nothing held', null, false],
    ['a mention alone', { floor: mentioned('push'), declined: false }, false],
    ['a decline under a mention', { floor: mentioned('push'), declined: true }, true],
    ['a declined floor, flagged or not', { floor: declined('push'), declined: false }, true],
  ])('%s', (_name, state, expected) => {
    expect(declinedSince(state)).toBe(expected);
  });
});
