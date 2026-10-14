import { describe, expect, test } from 'vitest';

import {
  blobsOf,
  entryId,
  EXPIRY_DAYS,
  isStale,
  keyOf,
  MAX_KEY,
  MAX_LEDGER_BYTES,
  MAX_PATH,
  MAX_READ,
  MAX_REPOS,
  MAX_TEXT,
  merge,
  paged,
  parseRecord,
  PREFIX,
  ranked,
  select,
  staleKeys,
  storedOf,
  updatedOf,
  utf8Bytes,
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

// Findings of one fixed length, so their entries are the same size.
const numbered = (i: number) => finding({ finding: `f${String(i).padStart(6, '0')}` });

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
  test('keeps several hundred entries of a typical size', () => {
    const existing = Array.from({ length: 500 }, (_, i) =>
      recorded(finding({ finding: `f${i} ${'x'.repeat(200)}`, reason: 'y'.repeat(150) })),
    );
    const m = merge(existing, { add: [], resolve: [], keep: [] }, blobs('a.ts'), DATE);
    expect(m.evicted).toBe(0);
  });
  test('evicts the oldest entries past the byte budget, counting UTF-8 bytes', () => {
    // Each entry is about 1.4 KiB of JSON, 3 bytes for each ✓.
    const big = (i: number) => finding({ finding: `f${i} ${'✓'.repeat(MAX_TEXT - 6)}` });
    const existing = Array.from({ length: 300 }, (_, i) => recorded(big(i)));
    const add = [finding({ finding: 'new' })];
    const m = merge(existing, { add, resolve: [], keep: [] }, blobs('a.ts'), DATE);
    expect(m.evicted).toBeGreaterThan(0);
    expect(m.entries[0]?.finding.startsWith(`f${m.evicted} `)).toBe(true);
    expect(m.entries.at(-1)?.finding).toBe('new');
    const bytes = m.entries.reduce((n, e) => n + utf8Bytes(JSON.stringify(e)) + 1, 0);
    expect(bytes).toBeLessThanOrEqual(MAX_LEDGER_BYTES);
    const withOneMore = bytes + utf8Bytes(JSON.stringify(existing[m.evicted - 1])) + 1;
    expect(withOneMore).toBeGreaterThan(MAX_LEDGER_BYTES);
  });
  test('counts the comma between entries', () => {
    // Equal entries small enough that counting it keeps fewer of them.
    const size = utf8Bytes(JSON.stringify(recorded(numbered(0))));
    const existing = Array.from({ length: Math.ceil(MAX_LEDGER_BYTES / size) + 5 }, (_, i) =>
      recorded(numbered(i)),
    );
    const m = merge(existing, { add: [], resolve: [], keep: [] }, blobs('a.ts'), DATE);
    expect(m.entries).toHaveLength(Math.floor(MAX_LEDGER_BYTES / (size + 1)));
  });
  test('the store holds MAX_REPOS full ledgers, each several hundred typical entries', () => {
    expect(MAX_LEDGER_BYTES * MAX_REPOS).toBeLessThan(4 * 1024 * 1024);
    expect(MAX_LEDGER_BYTES).toBeGreaterThanOrEqual(800 * 471);
  });
  test('counts UTF-8 bytes of every width', () => {
    for (const s of ['', 'a', 'é', '✓', '😀', 'aé✓😀']) {
      expect(utf8Bytes(s)).toBe(new TextEncoder().encode(s).length);
    }
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

const settledOn = (date: string, over: Partial<NewEntry>): Entry => ({
  ...recorded(finding(over)),
  date,
});
const order = (entries: Entry[], query?: string) => ranked(entries, query).entries;
const old = (e: Entry) => e.date < '2026-06-01';

describe('ranked', () => {
  const retry = settledOn(DATE, {});
  const comma = settledOn(DATE, { finding: 'a comma lets the offer grant', reason: 'fixed later' });
  const codex = settledOn(DATE, { finding: 'probe', reason: 'same on main', source: 'codex' });
  test('keeps the entries whose finding or reason holds any word, not the source', () => {
    expect(order([retry, comma, codex], 'COMMA dependency')).toEqual([comma, retry]);
    expect(order([retry, comma, codex], 'codex')).toEqual([]);
  });
  test('reads only words of three characters or more, without edge punctuation', () => {
    // "of" would match only "offer"; "fix" matches "fixed" only.
    expect(order([retry, comma], 'of')).toEqual([comma, retry]);
    expect(order([retry, comma], 'fix')).toEqual([comma]);
    expect(order([retry, comma], 'comma.')).toEqual([comma]);
    expect(order([retry, comma], '.comma')).toEqual([comma]);
    expect(order([retry, comma], '--comma')).toEqual([comma]);
    // ".of" trims to "of", too short, so the query has no words and keeps every entry.
    expect(order([retry, comma], '.of')).toEqual([comma, retry]);
    expect(order([retry, comma])).toEqual([comma, retry]);
  });
  test('puts the most words first, then the newest, then the last recorded', () => {
    const one = settledOn('2026-10-01', { finding: 'merge withheld' });
    const two = settledOn('2026-09-01', { finding: 'merge withheld on a condition' });
    const newer = settledOn('2026-10-02', { finding: 'merge withheld again' });
    const later = settledOn('2026-10-02', { finding: 'merge withheld once more' });
    // A kept entry moves to the end of the store with its old date, so store
    // order alone does not put the newest first.
    expect(order([newer, later, one, two], 'merge condition')).toEqual([two, later, newer, one]);
  });
  test('puts every reopened entry first, query or not, counted apart from the matches', () => {
    const staleMatch = settledOn('2026-01-01', { finding: 'merge withheld' });
    const staleMiss = settledOn('2026-03-01', { finding: 'parser drops a field' });
    const freshMatch = settledOn('2026-10-01', { finding: 'merge again' });
    const freshMiss = settledOn('2026-10-02', { finding: 'parser again' });
    const all = [freshMatch, freshMiss, staleMatch, staleMiss];
    expect(ranked(all, 'merge', old)).toEqual({
      entries: [staleMatch, staleMiss, freshMatch],
      matched: 1,
      reopened: 2,
    });
    expect(ranked(all, 'nomatch', old)).toEqual({
      entries: [staleMiss, staleMatch],
      matched: 0,
      reopened: 2,
    });
    // With no query the newer fresh entries would otherwise sort first.
    expect(ranked(all, '', old)).toEqual({
      entries: [staleMiss, staleMatch, freshMiss, freshMatch],
      matched: 2,
      reopened: 2,
    });
  });
});

describe('paged', () => {
  const rows = [{ t: 'x'.repeat(40) }, { t: 'y'.repeat(40) }, { t: 'z'.repeat(40) }];
  const two = JSON.stringify(rows.slice(0, 2)).length;
  test('returns the rows whose array fits and where the next read starts', () => {
    expect(paged(rows, 0, two)).toEqual({ rows: rows.slice(0, 2), next: 2 });
    expect(paged(rows, 0, two - 1)).toEqual({ rows: rows.slice(0, 1), next: 1 });
    expect(paged(rows, 2, two)).toEqual({ rows: rows.slice(2), next: null });
  });
  test('returns one row even when it alone is over the limit', () => {
    expect(paged(rows, 1, 1)).toEqual({ rows: [rows[1]], next: 2 });
  });
  test('holds the default read under MAX_READ', () => {
    const many = Array.from({ length: 200 }, (_, i) => recorded(numbered(i)));
    const page = paged(many, 0);
    expect(JSON.stringify(page.rows).length).toBeLessThanOrEqual(MAX_READ);
    expect(page.next).toBe(page.rows.length);
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

  test('keeps the ids earlier versions recorded', () => {
    expect(entryId('a.ts', 'x')).toBe('39bc6b0f');
    expect(entryId('src/é.ts', '😀 finding')).toBe('686fbe05');
  });
});

describe('keyOf', () => {
  // 256 is the store's limit, measured on Claude Code 2.1.289.
  const fits = `/${'a'.repeat(248)}`;

  test('keys a path that fits the store by the path itself', () => {
    expect(MAX_KEY).toBe(256);
    expect(keyOf('/r/.git')).toBe('ledger:/r/.git');
    expect(keyOf(fits)).toBe(`${PREFIX}${fits}`);
    expect(keyOf(fits)).toHaveLength(256);
  });

  test('keys a longer path by its hash, one per path', () => {
    const key = keyOf(`${fits}b`);
    expect(key).toMatch(/^ledger:#[0-9a-f]{16}$/);
    expect(keyOf(`${fits}b`)).toBe(key);
    expect(keyOf(`${fits}c`)).not.toBe(key);
  });

  test('keeps a hashed key stable, since a ledger is stored under it', () => {
    expect(keyOf(`/${'a'.repeat(300)}`)).toBe('ledger:#e759f9f285186444');
  });
});
