import { describe, expect, test } from 'vitest';

import { entryName } from '../hooks/journal';
import type { Store } from '../hooks/ledger-store';
import {
  countsOf,
  KEPT,
  pruneMisses,
  readMisses,
  saveMiss,
  type RecordedMiss,
} from '../hooks/misses';
import { readRounds, recordRounds } from '../hooks/rounds';

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

const miss = (
  message: string,
  kind: RecordedMiss['kind'] = 'refused',
  date = '2026-11-04',
): RecordedMiss => ({
  message,
  offer: '',
  steps: ['push'],
  refusal: 'stop and ask',
  kind,
  date,
  repo: '/r',
});

describe('recording misses', () => {
  test('every repository shares one list, in the order recorded', async () => {
    const s = memory();
    await saveMiss(s, entryName(20, 't'), miss('second'));
    await saveMiss(s, entryName(10, 't'), { ...miss('first'), repo: '/o' });
    await saveMiss(s, entryName(30, 't'), { ...miss('outside'), repo: null });
    const kept = await readMisses(s);
    expect(kept.map((m) => m.message)).toEqual(['first', 'second', 'outside']);
  });
  test('saving under the same name again replaces the entry', async () => {
    const s = memory();
    await saveMiss(s, entryName(1, 't'), miss('m'));
    await saveMiss(s, entryName(1, 't'), miss('m'));
    expect(await readMisses(s)).toEqual([miss('m')]);
  });
  test(`pruning keeps the newest ${KEPT}`, async () => {
    const s = memory();
    for (let i = 0; i <= KEPT; i++) await saveMiss(s, entryName(i, 't'), miss(`m${i}`));
    await pruneMisses(s);
    const kept = await readMisses(s);
    expect(kept).toHaveLength(KEPT);
    expect(kept[0]?.message).toBe('m1');
    expect(s.data.size).toBe(KEPT);
  });
  test('stays apart from the review rounds', async () => {
    const s = memory();
    await recordRounds(s, '/r/.git', { commit: 'c1', rounds: 1, date: '2026-11-04' }, 1, 't');
    await saveMiss(s, entryName(1, 't'), miss('m'));
    await pruneMisses(s);
    expect(await readMisses(s)).toEqual([miss('m')]);
    expect(await readRounds(s, '/r/.git')).toHaveLength(1);
  });
  test('reads past an entry it cannot read', async () => {
    const s = memory();
    await saveMiss(s, entryName(1, 't'), miss('m1'));
    await saveMiss(s, entryName(2, 't'), miss('m2'));
    const [, second] = [...s.data.keys()];
    s.data.set(second ?? '', { ...miss('m2'), steps: [3] });
    expect(await readMisses(s)).toEqual([miss('m1')]);
  });
  test.each([
    ['an unknown step', { steps: ['deploy'] }],
    ['an unknown kind', { kind: 'other' }],
    ['a repository that is a number', { repo: 5 }],
  ])('leaves out an entry with %s', async (_, bad) => {
    const s = memory();
    await saveMiss(s, entryName(1, 't'), miss('m1'));
    s.data.set('misses@2-t', { ...miss('m2'), ...bad });
    expect(await readMisses(s)).toEqual([miss('m1')]);
  });
});

describe('countsOf', () => {
  test('splits the refused from the records of kind model, from the oldest date', () => {
    const list = [
      miss('a', 'refused', '2026-11-01'),
      miss('b', 'model', '2026-11-02'),
      miss('c', 'model', '2026-11-03'),
    ];
    expect(countsOf(list)).toEqual({ kept: 3, refused: 1, byModel: 2, since: '2026-11-01' });
    expect(countsOf([])).toEqual({ kept: 0, refused: 0, byModel: 0, since: null });
  });
});
