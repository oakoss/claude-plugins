import { describe, expect, test } from 'vitest';

import { entryId, EXPIRY_DAYS, MAX_REPOS, type Recording } from './ledger';
import { readLedger, recordInto, type Blobs, type Store } from './ledger-store';

const COMMON = '/repo/.git';
const KEY = `ledger:${COMMON}`;
const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const DEFERRED = {
  path: 'a.ts',
  line: 3,
  kind: 'deferred' as const,
  finding: 'retry has no cap',
  reason: 'needs a new dependency',
  source: 'silent-failure-hunter',
};

function fakeStore(
  seed: Record<string, unknown> = {},
  opts: { fullAbove?: number; keysFail?: string } = {},
): { store: Store; map: Map<string, unknown> } {
  const map = new Map(Object.entries(seed));
  const store: Store = {
    get: (key) => Promise.resolve(structuredClone(map.get(key))),
    set: (key, value) => {
      const keys = map.size + (map.has(key) ? 0 : 1);
      if (opts.fullAbove !== undefined && keys > opts.fullAbove) {
        return Promise.reject(new Error('store over 4 MiB'));
      }
      map.set(key, structuredClone(value));
      return Promise.resolve();
    },
    keys: () =>
      opts.keysFail ? Promise.reject(new Error(opts.keysFail)) : Promise.resolve([...map.keys()]),
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
  return { store, map };
}

// The working tree as path to blob id.
function tree(files: Record<string, string>): Blobs {
  return (paths) =>
    Promise.resolve(
      new Map(paths.filter((p) => files[p] !== undefined).map((p) => [p, files[p] ?? ''])),
    );
}

const failing: Blobs = () => Promise.reject(new Error('git ls-tree failed: fatal: injected'));

function rec(over: Partial<Recording> = {}): Recording {
  return { add: [], resolve: [], keep: [], ...over };
}

async function record(store: Store, blobs: Blobs, r: Recording, now = NOW) {
  return JSON.parse(await recordInto(store, blobs, COMMON, r, now));
}

async function read(store: Store, blobs: Blobs, now = NOW) {
  return readLedger(store, blobs, COMMON, undefined, now);
}

describe('recordInto', () => {
  test('stamps an added entry with its blob and today, and stamps the ledger', async () => {
    const { store, map } = fakeStore();
    expect(await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }))).toEqual({
      added: 1,
      updated: 0,
      resolved: 0,
      kept: 0,
      gone: 0,
      unknown: [],
      evicted: 0,
      total: 1,
    });
    expect(map.get(KEY)).toEqual({
      entries: [
        { id: entryId('a.ts', DEFERRED.finding), ...DEFERRED, blob: A, date: '2026-09-26' },
      ],
      updated: NOW,
    });
  });
  test('refuses an added path that is not a file in the working tree', async () => {
    const { store, map } = fakeStore();
    const r = rec({ add: [DEFERRED, { ...DEFERRED, path: 'nope.ts' }] });
    expect(await recordInto(store, tree({ 'a.ts': A }), COMMON, r, NOW)).toBe(
      'review-cycle ledger: nothing recorded: not a file in the working tree: nope.ts',
    );
    expect(map.size).toBe(0);
  });
  test('keep restamps the blob, keeps the date, and drops an entry whose file is gone', async () => {
    const { store, map } = fakeStore();
    const other = { ...DEFERRED, path: 'b.ts' };
    await record(store, tree({ 'a.ts': A, 'b.ts': B }), rec({ add: [DEFERRED, other] }));
    const later = NOW + 10 * DAY;
    const ids = [entryId('a.ts', DEFERRED.finding), entryId('b.ts', DEFERRED.finding)];
    const r = await record(store, tree({ 'a.ts': 'c'.repeat(40) }), rec({ keep: ids }), later);
    expect(r).toMatchObject({ kept: 1, gone: 1, total: 1, unknown: [] });
    expect((map.get(KEY) as { entries: unknown[] }).entries).toEqual([
      expect.objectContaining({ path: 'a.ts', blob: 'c'.repeat(40), date: '2026-09-26' }),
    ]);
  });
  test('keep names an id it did not find', async () => {
    const { store } = fakeStore();
    expect(await record(store, tree({}), rec({ keep: ['ffffffff'] }))).toMatchObject({
      unknown: ['ffffffff'],
    });
  });
  test('drops what it cannot read, and says how many', async () => {
    const { store, map } = fakeStore({
      [KEY]: { entries: [{ ...DEFERRED, kind: 'wontfix' }], updated: 1 },
    });
    expect(await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }))).toMatchObject({
      total: 1,
      dropped: 1,
    });
    expect((map.get(KEY) as { entries: unknown[] }).entries).toHaveLength(1);
  });
  test('reports no dropped count when everything was readable', async () => {
    const { store } = fakeStore();
    expect(await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }))).not.toHaveProperty(
      'dropped',
    );
  });
  test('drops the least recently updated repositories past the cap', async () => {
    // Stamps run against insertion order, so dropping by insertion would fail.
    const seed = Object.fromEntries(
      Array.from({ length: MAX_REPOS }, (_, i) => [
        `ledger:/r${i}`,
        { entries: [], updated: MAX_REPOS - 1 - i },
      ]),
    );
    const newer = { schema: 3, updated: 99 };
    const { store, map } = fakeStore({ ...seed, 'ledger:/newer': newer, other: 1 });
    await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }));
    expect(map.has(`ledger:/r${MAX_REPOS - 1}`)).toBe(false);
    expect(map.has(`ledger:/r${MAX_REPOS - 2}`)).toBe(false);
    expect(map.has(`ledger:/r${MAX_REPOS - 3}`)).toBe(true);
    expect(map.get('ledger:/newer')).toEqual(newer);
    expect(map.has(KEY)).toBe(true);
    expect(map.has('other')).toBe(true);
  });
  test('prunes before the write, so a full store makes room', async () => {
    const seed = Object.fromEntries(
      Array.from({ length: MAX_REPOS }, (_, i) => [`ledger:/r${i}`, { entries: [], updated: i }]),
    );
    const { store, map } = fakeStore(seed, { fullAbove: MAX_REPOS });
    expect(await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }))).toMatchObject({
      added: 1,
    });
    expect(map.has(KEY)).toBe(true);
  });
  test('a prune that fails still records, and says so', async () => {
    const { store } = fakeStore({}, { keysFail: 'EIO' });
    const r = await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }));
    expect(r).toMatchObject({ added: 1, total: 1 });
    expect(r.note).toBe("older repositories' ledgers could not be pruned: EIO");
  });
  test('a store that refuses the write throws, so the caller reports nothing recorded', async () => {
    const { store } = fakeStore({}, { fullAbove: 0 });
    await expect(
      recordInto(store, tree({ 'a.ts': A }), COMMON, rec({ add: [DEFERRED] }), NOW),
    ).rejects.toThrow('store over 4 MiB');
  });
});

describe('readLedger', () => {
  test('marks each entry changed or not against the working tree, and stale by age', async () => {
    const { store } = fakeStore();
    await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }));
    const same = await read(store, tree({ 'a.ts': A }));
    expect((same.entries as object[])[0]).toMatchObject({
      blob: A,
      current: A,
      changed: false,
      stale: false,
    });
    const edited = await read(store, tree({ 'a.ts': B }));
    expect((edited.entries as object[])[0]).toMatchObject({ current: B, changed: true });
    const gone = await read(store, tree({}));
    expect((gone.entries as object[])[0]).toMatchObject({ current: null, changed: true });
    const old = await read(store, tree({ 'a.ts': A }), NOW + (EXPIRY_DAYS + 1) * DAY);
    expect((old.entries as object[])[0]).toMatchObject({ changed: false, stale: true });
  });
  test('a working tree it cannot read leaves changed null, with a note', async () => {
    const { store } = fakeStore();
    await record(store, tree({ 'a.ts': A }), rec({ add: [DEFERRED] }));
    const r = await read(store, failing);
    expect(r.note).toBe(
      'changed is null: the working tree could not be read (git ls-tree failed: fatal: injected)',
    );
    expect((r.entries as object[])[0]).toMatchObject({ current: null, changed: null });
  });
  test('counts what it cannot read', async () => {
    const { store } = fakeStore({ [KEY]: 'garbage' });
    expect(await read(store, tree({}))).toEqual({ total: 0, unreadable: 1, entries: [] });
  });
});
