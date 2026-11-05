// A bounded log in the plugin's store: each entry under its own key, ordered by
// when it was recorded, so no write reads and rewrites another's and one that
// stalls or lands late loses nothing. Pure; register.ts binds the store.

import type { Store } from './ledger-store';

const atOf = (key: string, base: string) => Number(key.slice(base.length).split('-')[0]);

async function keysOf(store: Store, base: string): Promise<string[]> {
  const keys = await store.keys();
  return keys
    .filter((k) => k.startsWith(base) && Number.isSafeInteger(atOf(k, base)))
    .toSorted((a, b) => atOf(a, base) - atOf(b, base));
}

// The newest `kept` under `base`, oldest first; an entry it cannot read is left out.
export async function readJournal<T>(
  store: Store,
  base: string,
  isEntry: (x: unknown) => x is T,
  kept: number,
): Promise<T[]> {
  const keys = await keysOf(store, base);
  const values = await Promise.all(keys.slice(-kept).map((k) => store.get(k)));
  return values.filter((v) => isEntry(v));
}

// An entry's name under its base: `at` orders it among the others, and `tag`
// keeps two sessions that record at the same `at` apart. Writing the same name
// again replaces the entry.
export const entryName = (at: number, tag: string) => `${at}-${tag}`;

export async function writeEntry(
  store: Store,
  base: string,
  name: string,
  entry: unknown,
): Promise<void> {
  await store.set(`${base}${name}`, entry);
}

export async function prune(store: Store, base: string, kept: number): Promise<void> {
  const keys = await keysOf(store, base);
  await Promise.all(keys.slice(0, -kept).map((k) => store.delete(k)));
}
