import { describe, expect, test } from 'claude-code/testing';

import { blobOf, fakeStore, fakeWorld, NOW } from '../fixtures';

async function ledger($: any, input: object = {}): Promise<any> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__ledger', ...input });
  return (r as { result: string }).result;
}

async function record($: any, input: object): Promise<string> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__ledger_record', ...input });
  return (r as { result: string }).result;
}

const DEFERRED = {
  path: 'a.ts',
  line: 3,
  kind: 'deferred',
  finding: 'retry has no cap',
  reason: 'needs a new dependency',
  source: 'silent-failure-hunter',
};
const KEY = 'ledger:/repo/.git';

describe('the findings ledger', () => {
  test('both tools are registered at session start', async ($, on) => {
    const w = fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    expect(w.registered).toEqual(expect.arrayContaining(['status', 'ledger', 'ledger_record']));
  });
  test('a ledger tool that cannot register leaves the gate set up', async ($, on) => {
    const w = fakeWorld(on, { registerFails: 'ledger' });
    await ($ as any).session.start({ source: 'startup' });
    expect(w.registered).toContain('status');
  });
  test('an entry recorded is read back unchanged until the file is, then with ids to diff', async ($, on) => {
    const w = fakeWorld(on);
    const store = fakeStore(on);
    expect(JSON.parse(await record($, { entries: [DEFERRED] }))).toEqual({
      added: 1,
      updated: 0,
      resolved: 0,
      kept: 0,
      moved: 0,
      gone: 0,
      unknown: [],
      evicted: 0,
      total: 1,
    });
    expect([...store.keys()]).toEqual([KEY]);
    expect((store.get(KEY) as { updated: number }).updated).toBe(NOW);
    const read = JSON.parse(await ledger($, { paths: ['a.ts'] }));
    const blob = blobOf('one');
    expect(read).toEqual({
      total: 1,
      matched: 1,
      reopened: 0,
      unreadable: 0,
      entries: [
        {
          ...DEFERRED,
          id: expect.stringMatching(/^[0-9a-f]{8}$/),
          date: '2026-09-26',
          changed: false,
          stale: false,
        },
      ],
    });
    w.work['a.ts'] = 'two';
    const after = JSON.parse(await ledger($)).entries[0];
    expect(after).toMatchObject({
      blob: blob.slice(0, 12),
      current: blobOf('two').slice(0, 12),
      changed: true,
    });
    delete w.work['a.ts'];
    expect(JSON.parse(await ledger($)).entries[0]).toMatchObject({ current: null, changed: true });
    expect(JSON.parse(await ledger($, { paths: ['b.ts'] }))).toEqual({
      total: 1,
      matched: 0,
      reopened: 0,
      unreadable: 0,
      entries: [],
    });
    expect(JSON.parse(await ledger($, { query: 'parser' })).matched).toBe(0);
    expect(await ledger($, { query: 3 })).toBe('review-cycle ledger: `query` must be a string.');
    expect(await ledger($, { offset: -1 })).toBe(
      'review-cycle ledger: `offset` must be a whole number, 0 or more.',
    );
    expect(await ledger($, { offset: 1.5 })).toBe(
      'review-cycle ledger: `offset` must be a whole number, 0 or more.',
    );
    expect(JSON.parse(await ledger($, { offset: 0 })).total).toBe(1);
  });
  test('an entry moved to the file its code moved to is read back there, with its date', async ($, on) => {
    const w = fakeWorld(on);
    fakeStore(on);
    await record($, { entries: [DEFERRED] });
    const { id } = JSON.parse(await ledger($, { paths: ['a.ts'] })).entries[0];
    w.work['b.ts'] = 'moved';
    const moved = JSON.parse(await record($, { move: [{ id, path: 'b.ts', line: 4 }] }));
    expect(moved).toMatchObject({ moved: 1, unknown: [], total: 1 });
    expect(JSON.parse(await ledger($, { paths: ['a.ts'] })).entries).toEqual([]);
    expect(JSON.parse(await ledger($, { paths: ['b.ts'] })).entries).toEqual([
      expect.objectContaining({ path: 'b.ts', line: 4, date: '2026-09-26', changed: false }),
    ]);
  });
  test('a long ledger is read a page at a time, as one line of JSON', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    const reason = 'r'.repeat(300);
    const entries = Array.from({ length: 40 }, (_, i) => ({
      ...DEFERRED,
      finding: `retry ${i}`,
      reason,
    }));
    await record($, { entries });
    const raw = await ledger($, { query: 'retry' });
    expect(raw).not.toContain('\n');
    const first = JSON.parse(raw);
    expect(raw.length).toBeLessThanOrEqual(8000);
    expect(first.matched).toBe(40);
    expect(first.next).toBe(first.entries.length);
    const seen: string[] = first.entries.map((e: { id: string }) => e.id);
    for (let next = first.next; next !== undefined;) {
      const page = JSON.parse(await ledger($, { query: 'retry', offset: next }));
      seen.push(...page.entries.map((e: { id: string }) => e.id));
      next = page.next;
    }
    expect(new Set(seen).size).toBe(40);
    expect(seen).toHaveLength(40);
  });
  test('a working tree git cannot list is said on read, and records nothing', async ($, on) => {
    const w = fakeWorld(on);
    fakeStore(on);
    await record($, { entries: [DEFERRED] });
    w.fail = (a) => a.includes('ls-tree');
    expect(JSON.parse(await ledger($)).note).toMatch(/git ls-tree failed: fatal: injected\)$/);
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'x' }] })).toBe(
      'review-cycle ledger: nothing recorded: git ls-tree failed: fatal: injected',
    );
  });
  test('resolve removes an entry', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    await record($, { entries: [DEFERRED] });
    const [entry] = JSON.parse(await ledger($)).entries;
    expect(JSON.parse(await record($, { resolve: [entry.id] }))).toMatchObject({
      resolved: 1,
      total: 0,
    });
  });
  test('two records at once both land', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    await Promise.all([
      record($, { entries: [DEFERRED] }),
      record($, { entries: [{ ...DEFERRED, finding: 'another' }] }),
    ]);
    expect(JSON.parse(await ledger($)).total).toBe(2);
  });
  test('a record stuck on the store makes the next one refuse, not race it', async ($, on) => {
    fakeWorld(on);
    const store = fakeStore(on, { hangFirstGet: true });
    void record($, { entries: [DEFERRED] });
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'next' }] })).toBe(
      'review-cycle ledger: nothing recorded: an earlier record has not finished after 5 seconds',
    );
    // Still stuck, so a third waits on it too rather than on the refused second.
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'third' }] })).toMatch(
      /has not finished after 5 seconds$/,
    );
    expect(store.size).toBe(0);
  });
  test('an invalid batch records nothing and says why', async ($, on) => {
    fakeWorld(on);
    const store = fakeStore(on);
    const r = await record($, { entries: [DEFERRED, { ...DEFERRED, path: './' }] });
    expect(r).toBe('review-cycle ledger: nothing recorded: entries[1]: path is empty');
    expect(store.size).toBe(0);
  });
  test('a store that refuses the write is reported, not swallowed', async ($, on) => {
    fakeWorld(on);
    fakeStore(on, { refuse: 'store over 4 MiB' });
    expect(await record($, { entries: [DEFERRED] })).toMatch(
      /^review-cycle ledger: nothing recorded: .*4 MiB/,
    );
  });
  test('a store that cannot be read is reported, not read as empty', async ($, on) => {
    fakeWorld(on);
    fakeStore(on, { readFails: 'EIO' });
    expect(await ledger($)).toMatch(/^review-cycle ledger: could not be read: .*EIO/);
    expect(await record($, { entries: [DEFERRED] })).toMatch(/nothing recorded: .*EIO/);
  });
  test('outside a repository, both tools say so', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
    });
    fakeStore(on);
    expect(await ledger($)).toBe('review-cycle ledger: not in a git repository.');
    expect(await record($, { entries: [DEFERRED] })).toBe(
      'review-cycle ledger: not in a git repository; nothing recorded.',
    );
  });
  test('paths that are not a list of strings are refused', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    for (const paths of ['a.ts', [1]]) {
      expect(await ledger($, { paths })).toContain('`paths` must be an array');
    }
  });
});
