import { describe, expect, test } from 'vitest';

import {
  blobsOf,
  entryId,
  EXPIRY_DAYS,
  isStale,
  MAX_ENTRIES,
  MAX_PATH,
  MAX_REPOS,
  MAX_TEXT,
  merge,
  parseRecord,
  select,
  staleKeys,
  storedOf,
  updatedOf,
  type Entry,
  type NewEntry,
} from './ledger';

const DATE = '2026-09-26';
const BLOB = 'b'.repeat(40);

function finding(over: Partial<NewEntry> = {}): NewEntry {
  return {
    path: 'a.ts',
    line: 3,
    kind: 'deferred',
    finding: 'retry has no cap',
    reason: 'needs a new dependency',
    source: 'silent-failure-hunter',
    ...over,
  };
}

function recorded(n: NewEntry, blob = BLOB): Entry {
  return { id: entryId(n.path, n.finding), ...n, blob, date: DATE };
}

function blobs(...paths: string[]): Map<string, string> {
  return new Map(paths.map((p) => [p, BLOB]));
}

function refusal(input: unknown): string {
  const r = parseRecord(input);
  if (!('error' in r)) throw new Error(`accepted: ${JSON.stringify(r)}`);
  return r.error;
}

describe('parseRecord', () => {
  test('accepts a well-formed batch', () => {
    const r = parseRecord({ entries: [finding()], resolve: ['0000beef'], keep: ['0000cafe'] });
    expect(r).toEqual({ add: [finding()], resolve: ['0000beef'], keep: ['0000cafe'] });
  });
  test('refuses a fixed finding and points at resolve', () => {
    expect(refusal({ entries: [finding({ kind: 'fixed' as never })] })).toContain('`resolve`');
  });
  test('refuses an unknown kind', () => {
    expect(refusal({ entries: [finding({ kind: 'wontfix' as never })] })).toContain(
      'entries[0]: kind must be one of',
    );
  });
  test.each(['finding', 'reason', 'source'] as const)('refuses a blank %s', (field) => {
    expect(refusal({ entries: [finding(), finding({ [field]: '  ' })] })).toBe(
      'entries[1]: finding, reason and source are all required',
    );
  });
  test.each([
    ['./', 'path is empty'],
    [' ././ ', 'path is empty'],
    ['/etc/passwd', 'must be repository-relative'],
    ['C:/x.ts', 'must be repository-relative'],
    ['../x.ts', 'must be repository-relative'],
    ['src/../../x.ts', 'must be repository-relative'],
    [String.raw`src\..\..\x.ts`, 'must be repository-relative'],
    ['a/./b.ts', 'must be repository-relative'],
    ['a//b.ts', 'must be repository-relative'],
    ['src/', 'must be repository-relative'],
    ['.', 'must be repository-relative'],
    ['a\nb.ts', 'control character'],
    ['a.ts\n', 'control character'],
    ['a\u007Fb.ts', 'control character'],
    ['./ foo.ts', 'starts or ends with whitespace'],
    ['x'.repeat(MAX_PATH + 1), `over ${MAX_PATH} characters`],
  ])('refuses the path %j', (path, why) => {
    expect(refusal({ entries: [finding({ path })] })).toContain(why);
  });
  test('accepts a path of exactly MAX_PATH characters', () => {
    expect(parseRecord({ entries: [finding({ path: 'x'.repeat(MAX_PATH) })] })).not.toHaveProperty(
      'error',
    );
  });
  test('a missing path is refused', () => {
    const { path: _, ...noPath } = finding();
    expect(refusal({ entries: [noPath] })).toContain('path is required');
  });
  test('refuses a line that is not a positive safe integer', () => {
    for (const line of [0, -1, 2.5, '3', 1e300]) {
      expect(refusal({ entries: [finding({ line: line as never })] })).toContain(
        'line must be a positive integer',
      );
    }
  });
  test('an absent line is null', () => {
    const { line: _, ...noLine } = finding();
    expect(parseRecord({ entries: [noLine] })).toEqual({
      add: [finding({ line: null })],
      resolve: [],
      keep: [],
    });
  });
  test('refuses an empty call', () => {
    expect(refusal({})).toContain('nothing to record');
  });
  test('refuses entries that are not a list', () => {
    expect(refusal({ entries: 'x' })).toContain('`entries` must be an array');
  });
  test.each([['abc'], [[1]], [['']], [['0000BEEF']], [['beef']], [['0000beef0']]])(
    'refuses resolve or keep %j',
    (ids) => {
      expect(refusal({ resolve: ids })).toContain('`resolve`');
      expect(refusal({ keep: ids })).toContain('`keep`');
    },
  );
  test('accepts keep alone', () => {
    expect(parseRecord({ keep: ['0000cafe'] })).toEqual({
      add: [],
      resolve: [],
      keep: ['0000cafe'],
    });
  });
  test('normalizes the path and text, and clips every text field at MAX_TEXT', () => {
    const long = 'x'.repeat(MAX_TEXT + 1);
    const r = parseRecord({
      entries: [
        finding({ path: './src/a.ts', finding: long, reason: long, source: 'a \n\t b' }),
        finding({ finding: 'y'.repeat(MAX_TEXT), reason: long }),
      ],
    });
    if ('error' in r) throw new Error(r.error);
    const [first, second] = r.add;
    expect(first?.path).toBe('src/a.ts');
    expect(first?.finding).toBe(`${'x'.repeat(MAX_TEXT - 1)}…`);
    expect(first?.reason).toBe(`${'x'.repeat(MAX_TEXT - 1)}…`);
    expect(first?.source).toBe('a b');
    expect(second?.finding).toBe('y'.repeat(MAX_TEXT));
  });
  test('clipping never leaves half a surrogate pair', () => {
    const r = parseRecord({ entries: [finding({ finding: `${'x'.repeat(MAX_TEXT - 2)}😀tail` })] });
    if ('error' in r) throw new Error(r.error);
    expect(r.add[0]?.finding).toBe(`${'x'.repeat(MAX_TEXT - 2)}…`);
  });
});

describe('merge', () => {
  test('adds new entries stamped with the blob of their path', () => {
    const m = merge([], { add: [finding()], resolve: [], keep: [] }, blobs('a.ts'), DATE);
    expect(m.entries).toEqual([recorded(finding())]);
    expect(m).toMatchObject({ added: 1, updated: 0, resolved: 0, evicted: 0, unknown: [] });
  });
  test('refuses an added path it has no blob for', () => {
    expect(() => merge([], { add: [finding()], resolve: [], keep: [] }, blobs(), DATE)).toThrow(
      'no blob for a.ts',
    );
  });
  test('the same finding at the same path replaces its entry and moves to the newest end', () => {
    const first = recorded(finding());
    const other = recorded(finding({ path: 'b.ts' }));
    const again = finding({ kind: 'rebutted', reason: 'measured: the cap exists' });
    const fresh = new Map([['a.ts', 'c'.repeat(40)]]);
    const m = merge([first, other], { add: [again], resolve: [], keep: [] }, fresh, 'later');
    expect(m.entries.map((e) => [e.path, e.kind, e.blob, e.date])).toEqual([
      ['b.ts', 'deferred', BLOB, DATE],
      ['a.ts', 'rebutted', 'c'.repeat(40), 'later'],
    ]);
    expect(m).toMatchObject({ added: 0, updated: 1 });
  });
  test('resolve removes an entry and names ids it did not find', () => {
    const e = recorded(finding());
    const m = merge([e], { add: [], resolve: [e.id, 'ffffffff'], keep: [] }, blobs(), DATE);
    expect(m.entries).toEqual([]);
    expect(m).toMatchObject({ resolved: 1, unknown: ['ffffffff'] });
  });
  test('resolving an entry and recording it again in one batch keeps the new one', () => {
    const e = recorded(finding());
    const again = finding({ reason: 'still deferred' });
    const m = merge([e], { add: [again], resolve: [e.id], keep: [] }, blobs('a.ts'), 'later');
    expect(m.entries).toEqual([{ ...recorded(again), date: 'later' }]);
    expect(m).toMatchObject({ resolved: 1, added: 1 });
  });
  test('evicts the oldest entries past the cap', () => {
    const existing = Array.from({ length: MAX_ENTRIES }, (_, i) =>
      recorded(finding({ finding: `f${i}` })),
    );
    const add = [finding({ finding: 'new' })];
    const m = merge(existing, { add, resolve: [], keep: [] }, blobs('a.ts'), DATE);
    expect(m.entries).toHaveLength(MAX_ENTRIES);
    expect(m.evicted).toBe(1);
    expect(m.entries[0]?.finding).toBe('f1');
    expect(m.entries.at(-1)?.finding).toBe('new');
  });
});

describe('merge keep', () => {
  test('restamps a kept entry, keeps its date, and moves it to the newest end', () => {
    const e = recorded(finding());
    const other = recorded(finding({ path: 'b.ts' }));
    const fresh = new Map([['a.ts', 'c'.repeat(40)]]);
    const m = merge([e, other], { add: [], resolve: [], keep: [e.id] }, fresh, 'later');
    expect(m.entries).toEqual([other, { ...e, blob: 'c'.repeat(40) }]);
    expect(m).toMatchObject({ kept: 1, gone: 0, unknown: [] });
  });
  test('drops a kept entry whose path has no blob, and names unknown ids', () => {
    const e = recorded(finding());
    const m = merge([e], { add: [], resolve: [], keep: [e.id, 'ffffffff'] }, blobs(), DATE);
    expect(m.entries).toEqual([]);
    expect(m).toMatchObject({ kept: 0, gone: 1, unknown: ['ffffffff'] });
  });
  test('resolving and keeping the same id resolves it', () => {
    const e = recorded(finding());
    const m = merge([e], { add: [], resolve: [e.id], keep: [e.id] }, blobs('a.ts'), DATE);
    expect(m).toMatchObject({ entries: [], resolved: 1, unknown: [e.id] });
  });
});

describe('isStale', () => {
  const day = 86_400_000;
  const settled = Date.UTC(2026, 0, 1);
  test('is stale only past EXPIRY_DAYS', () => {
    expect(isStale('2026-01-01', settled + EXPIRY_DAYS * day)).toBe(false);
    expect(isStale('2026-01-01', settled + EXPIRY_DAYS * day + 1)).toBe(true);
  });
});

describe('select', () => {
  const a = recorded(finding());
  const b = recorded(finding({ path: 'src/b.ts' }));
  test('returns only the entries for the given paths', () => {
    expect(select([a, b], ['./src/b.ts'])).toEqual([b]);
  });
  test('returns everything when no paths are given', () => {
    expect(select([a, b])).toEqual([a, b]);
  });
});

describe('storedOf', () => {
  const good = recorded(finding());
  const other = recorded(finding({ path: 'b.ts' }));
  test('reads nothing stored as an empty ledger', () => {
    expect(storedOf()).toEqual({ entries: [], unreadable: 0, updated: 0 });
  });
  test('reads a ledger it wrote back exactly', () => {
    expect(storedOf({ entries: [good, other], updated: 5 })).toEqual({
      entries: [good, other],
      unreadable: 0,
      updated: 5,
    });
    const recordedLine = recorded(finding({ line: null }));
    expect(storedOf({ entries: [recordedLine], updated: 5 }).entries).toEqual([recordedLine]);
  });
  test('counts a value that is not a ledger as unreadable, keeping its stamp', () => {
    for (const junk of ['garbage', [good], { items: [good] }, { entries: 'x' }, null]) {
      expect(storedOf(junk)).toEqual({ entries: [], unreadable: 1, updated: 0 });
    }
    expect(storedOf({ entries: [], updated: 9, version: 2 })).toEqual({
      entries: [],
      unreadable: 1,
      updated: 9,
    });
  });
  test('counts every entry a ledger it cannot read holds', () => {
    expect(storedOf({ entries: [good, other, good], updated: 9, version: 2 })).toEqual({
      entries: [],
      unreadable: 3,
      updated: 9,
    });
    expect(storedOf({ entries: [good, other] })).toMatchObject({ unreadable: 2 });
  });
  test.each([
    ['kind', { kind: 'fixed' }],
    ['path', { path: '  ' }],
    ['path spelling', { path: './a.ts' }],
    ['finding', { finding: '' }],
    ['unclipped text', { finding: 'x'.repeat(MAX_TEXT + 1) }],
    ['reason', { reason: 1 }],
    ['unclipped reason', { reason: 'x'.repeat(MAX_TEXT + 1) }],
    ['uncollapsed source', { source: 'a  b' }],
    ['source', { source: ' ' }],
    ['line', { line: 'three' }],
    ['missing line', { line: undefined }],
    ['blob', { blob: 7 }],
    ['blob length', { blob: 'a'.repeat(41) }],
    ['blob prefix', { blob: `x${BLOB}` }],
    ['date', { date: '2026-09-26x' }],
    ['date prefix', { date: 'x2026-09-26' }],
    ['id', { id: 'deadbeef' }],
    ['extra field', { severity: 'high' }],
  ])('counts an entry with a bad %s as unreadable', (_, bad) => {
    const broken = structuredClone({ ...good, ...bad });
    expect(storedOf({ entries: [other, broken], updated: 5 })).toEqual({
      entries: [other],
      unreadable: 1,
      updated: 5,
    });
  });
  test('reads back a 64-hex blob, as a SHA-256 repository writes', () => {
    const sha256 = { ...good, blob: 'e'.repeat(64) };
    expect(storedOf({ entries: [sha256], updated: 1 }).entries).toEqual([sha256]);
  });
  test('a missing or non-numeric updated stamp is unreadable', () => {
    expect(storedOf({ entries: [good] })).toMatchObject({ entries: [], unreadable: 1 });
    expect(storedOf({ entries: [good], updated: 'x' })).toMatchObject({ unreadable: 1 });
  });
  test('a second entry with the same id is unreadable', () => {
    expect(storedOf({ entries: [good, good], updated: 1 })).toMatchObject({
      entries: [good],
      unreadable: 1,
    });
  });
});

describe('updatedOf', () => {
  test('reads the stamp of any value that has one', () => {
    expect(updatedOf({ updated: 7, anything: true })).toBe(7);
    expect(updatedOf('garbage')).toBe(0);
    expect(updatedOf(null)).toBe(0);
  });
});

describe('blobsOf', () => {
  test('maps each path to its blob, whitespace in names included', () => {
    const out = [
      `100644 blob ${BLOB}\ta b.ts`,
      `100755 blob ${'c'.repeat(40)}\tx\ty`,
      `100644 blob ${'d'.repeat(40)}\tline\nbreak`,
      '',
    ].join('\0');
    expect([...blobsOf(out)]).toEqual([
      ['a b.ts', BLOB],
      ['x\ty', 'c'.repeat(40)],
      ['line\nbreak', 'd'.repeat(40)],
    ]);
  });
  test('skips submodules and empty output', () => {
    expect(blobsOf(`160000 commit ${BLOB}\tsub\0`).size).toBe(0);
    expect(blobsOf('').size).toBe(0);
  });
});

describe('staleKeys', () => {
  const ledgers = Array.from({ length: MAX_REPOS + 2 }, (_, i) => ({
    key: `ledger:/r${i}`,
    updated: i,
  }));
  test('drops the least recently updated others down to MAX_REPOS with this one', () => {
    expect(staleKeys(ledgers, 'ledger:/r0')).toEqual(['ledger:/r1', 'ledger:/r2']);
  });
  test('drops nothing at or under the cap', () => {
    expect(staleKeys(ledgers.slice(0, MAX_REPOS), 'ledger:/new')).toEqual(['ledger:/r0']);
    expect(staleKeys(ledgers.slice(0, MAX_REPOS), 'ledger:/r3')).toEqual([]);
  });
});

describe('entryId', () => {
  test('is stable and separates path from finding', () => {
    expect(entryId('a.ts', 'x')).toBe(entryId('a.ts', 'x'));
    expect(entryId('a.ts', 'x')).toMatch(/^[0-9a-f]{8}$/);
    expect(entryId('a.ts', 'bx')).not.toBe(entryId('a.tsb', 'x'));
  });
});
