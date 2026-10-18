import { describe, expect, test } from 'vitest';

import { keyOf } from './ledger';
import type { Store } from './ledger-store';
import { KEPT, readRounds, recordRounds, roundsOf } from './rounds';

function memory(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (k) => Promise.resolve(structuredClone(data.get(k))),
    set: (k, v) => {
      data.set(k, structuredClone(v));
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
    delete: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
}

const review = (spawn: string) => ({ trees: [spawn, `${spawn}-end`] as const });
const entry = (commit: string, rounds = 1) => ({ commit, rounds, date: '2026-10-17' });

describe('roundsOf', () => {
  test('counts each tree reviewers were given once', () => {
    expect(roundsOf([])).toBe(0);
    expect(roundsOf([review('a'), review('a'), review('b')])).toBe(2);
  });
});

describe('recording', () => {
  test('keeps each repository apart, in the order recorded', async () => {
    const s = memory();
    await recordRounds(s, '/r/.git', entry('c2'), 20, 't');
    await recordRounds(s, '/r/.git', entry('c1'), 10, 't');
    await recordRounds(s, '/o/.git', entry('c9'), 15, 't');
    const kept = await readRounds(s, '/r/.git');
    expect(kept.map((r) => r.commit)).toEqual(['c1', 'c2']);
    expect(await readRounds(s, '/o/.git')).toEqual([entry('c9')]);
  });
  test(`keeps the newest ${KEPT}, deleting the rest`, async () => {
    const s = memory();
    for (let i = 0; i <= KEPT; i++) await recordRounds(s, '/r/.git', entry(`c${i}`), i, 't');
    const kept = await readRounds(s, '/r/.git');
    expect(kept).toHaveLength(KEPT);
    expect(kept[0]?.commit).toBe('c1');
    expect(s.data.size).toBe(KEPT);
  });
  test('a write that lands late loses nothing another recorded', async () => {
    const s = memory();
    const held: (() => void)[] = [];
    const slow: Store = {
      ...s,
      set: (k, v) =>
        new Promise((resolve) => {
          held.push(() => void s.set(k, v).then(resolve));
        }),
    };
    const late = recordRounds(slow, '/r/.git', entry('c1'), 1, 't');
    await recordRounds(s, '/r/.git', entry('c2'), 2, 't');
    for (const go of held) go();
    await late;
    const kept = await readRounds(s, '/r/.git');
    expect(kept.map((r) => r.commit)).toEqual(['c1', 'c2']);
  });
  test('keeps two entries recorded at the same moment', async () => {
    const s = memory();
    await recordRounds(s, '/r/.git', entry('c1'), 5, 'a');
    await recordRounds(s, '/r/.git', entry('c2'), 5, 'b');
    expect(await readRounds(s, '/r/.git')).toHaveLength(2);
  });
  test('stays apart from the ledger', async () => {
    const s = memory();
    const ledger = { entries: [{ id: 'x' }], updated: 1 };
    s.data.set(keyOf('/r/.git'), ledger);
    await recordRounds(s, '/r/.git', entry('c1'), 1, 't');
    expect(s.data.get(keyOf('/r/.git'))).toEqual(ledger);
    expect(await readRounds(s, '/r/.git')).toEqual([entry('c1')]);
  });
  test('reads past an entry it cannot read', async () => {
    const s = memory();
    await recordRounds(s, '/r/.git', entry('c1', 2), 1, 't');
    await recordRounds(s, '/r/.git', entry('c2'), 2, 't');
    const [, second] = [...s.data.keys()];
    s.data.set(second ?? '', { commit: 3 });
    expect(await readRounds(s, '/r/.git')).toEqual([entry('c1', 2)]);
  });
});
