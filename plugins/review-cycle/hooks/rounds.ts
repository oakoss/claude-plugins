// How many review rounds each commit took, kept per repository so a change to
// the review loop can be measured by rounds to converge. Pure; register.ts
// binds the store.

import { entryName, prune, readJournal, writeEntry } from './journal';
import { hashOf } from './ledger';
import type { Store } from './ledger-store';

// A round is one tree reviewers were given: a fan-out and its confirmation
// passes each count once, however many legs ran on it.
export function roundsOf(reviews: readonly { trees: readonly [string, string] }[]): number {
  return new Set(reviews.map((r) => r.trees[0])).size;
}

export type Rounds = Readonly<{ commit: string; rounds: number; date: string }>;

// Enough to compare before and after a change, small enough to read whole.
export const KEPT = 50;

const isRounds = (x: unknown): x is Rounds =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Rounds).commit === 'string' &&
  Number.isInteger((x as Rounds).rounds) &&
  typeof (x as Rounds).date === 'string';

const baseOf = (common: string) => `rounds:${hashOf(common)}@`;

export function readRounds(store: Store, common: string): Promise<Rounds[]> {
  return readJournal(store, baseOf(common), isRounds, KEPT);
}

export async function recordRounds(
  store: Store,
  common: string,
  entry: Rounds,
  at: number,
  tag: string,
): Promise<void> {
  await writeEntry(store, baseOf(common), entryName(at, tag), entry);
  await prune(store, baseOf(common), KEPT);
}
