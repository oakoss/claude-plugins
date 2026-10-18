// How many review rounds each commit took, kept per repository so a change to
// the review loop can be measured by rounds to converge. Pure; register.ts
// binds the store.

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

// Each entry under its own key, ordered by when it was recorded, so no write
// reads and rewrites another's: one that stalls or lands late loses nothing.
const baseOf = (common: string) => `rounds:${hashOf(common)}@`;
const atOf = (key: string, base: string) => Number(key.slice(base.length).split('-')[0]);

async function keysOf(store: Store, common: string): Promise<string[]> {
  const base = baseOf(common);
  const keys = await store.keys();
  return keys
    .filter((k) => k.startsWith(base) && Number.isSafeInteger(atOf(k, base)))
    .toSorted((a, b) => atOf(a, base) - atOf(b, base));
}

// The newest KEPT, oldest first; an entry it cannot read is left out.
export async function readRounds(store: Store, common: string): Promise<Rounds[]> {
  const keys = await keysOf(store, common);
  const values = await Promise.all(keys.slice(-KEPT).map((k) => store.get(k)));
  return values.filter((v) => isRounds(v));
}

// `at` orders the entry among the others, and `tag` keeps two sessions that
// record at the same `at` apart; once more than KEPT are kept, the oldest are
// deleted.
export async function recordRounds(
  store: Store,
  common: string,
  entry: Rounds,
  at: number,
  tag: string,
): Promise<void> {
  await store.set(`${baseOf(common)}${at}-${tag}`, entry);
  const keys = await keysOf(store, common);
  await Promise.all(keys.slice(0, -KEPT).map((k) => store.delete(k)));
}
