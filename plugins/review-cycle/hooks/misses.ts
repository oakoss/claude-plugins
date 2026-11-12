// The gate's consent misses, kept across sessions and repositories so their
// rate shows which requests fall outside what the reader reads. One
// list per user: the plugin's store is one file, and the reader is one for
// every repository. Pure; register.ts binds the store.

import { HOLD_STEPS, type HoldStep } from './hold';
import { prune, readJournal, writeEntry } from './journal';
import type { Store } from './ledger-store';

// 'refused': the gate refused the step. 'model' is read from records kept by
// earlier versions, where a model check granted the step; nothing writes it.
export type MissKind = 'refused' | 'model';

export type RecordedMiss = Readonly<{
  message: string;
  offer: string;
  steps: readonly HoldStep[];
  refusal: string;
  kind: MissKind;
  date: string;
  // The repository's top directory, or null outside one.
  repo: string | null;
}>;

// About a kilobyte each, so a small share of the store's 4 MiB.
export const KEPT = 200;

const BASE = 'misses@';

const isText = (x: unknown) => typeof x === 'string';
const isStep = (x: unknown) => HOLD_STEPS.some((s) => s === x);

const isRecorded = (x: unknown): x is RecordedMiss => {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as RecordedMiss;
  return (
    isText(m.message) &&
    isText(m.offer) &&
    Array.isArray(m.steps) &&
    m.steps.every(isStep) &&
    isText(m.refusal) &&
    (m.kind === 'refused' || m.kind === 'model') &&
    isText(m.date) &&
    (m.repo === null || isText(m.repo))
  );
};

export function readMisses(store: Store): Promise<RecordedMiss[]> {
  return readJournal(store, BASE, isRecorded, KEPT);
}

// `name` is the miss's own (journal.ts's entryName), so saving it again replaces it.
export function saveMiss(store: Store, name: string, miss: RecordedMiss): Promise<void> {
  return writeEntry(store, BASE, name, miss);
}

export function pruneMisses(store: Store): Promise<void> {
  return prune(store, BASE, KEPT);
}

export type MissCounts = Readonly<{
  kept: number;
  refused: number;
  byModel: number;
  since: string | null;
}>;

export function countsOf(misses: readonly RecordedMiss[]): MissCounts {
  const model = misses.filter((m) => m.kind === 'model').length;
  return {
    kept: misses.length,
    refused: misses.length - model,
    byModel: model,
    // Oldest first, as readMisses returns them.
    since: misses[0]?.date ?? null,
  };
}
