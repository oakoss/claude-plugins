// What a hold holds, how two holds combine, and how a message moves the one
// in force. Pure, and imports only the ladder, so the grammar and the gate
// read one order.

import { atOrAbove, type Step } from './ladder';

// Lowest first: a hold of one holds those after it, so the first of these an
// offer names is the one a decline holds.
export const HOLD_STEPS = ['push', 'pr', 'merge', 'approve', 'release', 'comment'] as const;
export type HoldStep = (typeof HOLD_STEPS)[number];
export type HoldReason = Readonly<{ step: HoldStep; how: 'mentioned' | 'declined' }>;
export type Hold = HoldReason | null;
// `declined` outlives the floor's own reason: an earlier, lower mention keeps
// the floor when a later message declines. Read it through `declinedSince`.
export type HoldState = Readonly<{ floor: HoldReason; declined: boolean }> | null;

export function declinedSince(state: HoldState): boolean {
  return state !== null && (state.declined || state.floor.how === 'declined');
}

// A reply on GitHub sits above every rung: any hold holds one, and a hold of
// one holds only another.
export function holds(held: Hold, step: Step | 'comment'): boolean {
  if (held === null || step === 'commit') return false;
  if (step === 'comment') return true;
  return held.step !== 'comment' && atOrAbove(step, held.step);
}

// The hold that holds more, the first on a tie.
export function lowerHold(a: Hold, b: HoldReason): HoldReason;
export function lowerHold(a: Hold, b: Hold): Hold;
export function lowerHold(a: Hold, b: Hold): Hold {
  if (a === null || b === null) return a ?? b;
  return holds(a, b.step) ? a : b;
}

// A request lifts the hold before it; what the same message holds still holds.
export function holdAfter(prev: HoldState, lifts: boolean, hold: Hold): HoldState {
  const before = lifts ? null : prev;
  if (hold === null) return before;
  return {
    floor: lowerHold(before?.floor ?? null, hold),
    declined: declinedSince(before) || hold.how === 'declined',
  };
}
