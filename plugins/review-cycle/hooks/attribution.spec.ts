import { describe, expect, test } from 'vitest';

import { added, madeBy, parseReflog, recordsCommit, type Entry } from './attribution';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

// An entry as parseReflog would read it; `at` stands in for the date field.
function entry(id: string, message: string, at = 1): Entry {
  return { id, line: `${id}\0HEAD@{${at} +0000}\0t <t@t>\0${message}`, message };
}

describe('parseReflog', () => {
  test('reads id and message; an identity holding a tab does not shift them', () => {
    const line = `${A}\0HEAD@{1 +0000}\0a\tcheckout: moving <x@x>\0commit: evil`;
    expect(parseReflog(`${line}\nnot a line\n${'e'.repeat(41)}\0x\0y\0z`)).toEqual([
      { id: A, line, message: 'commit: evil' },
    ]);
  });
});

describe('added', () => {
  const start = [entry(B, 'commit: b', 2), entry(A, 'commit: a', 1)];
  test('returns the counted entries above the recorded start', () => {
    const c = entry(C, 'commit: c', 3);
    expect(added([c, ...start], start, 1)).toEqual([c]);
    expect(added(start, start, 0)).toEqual([]);
  });
  test('the count places the start, even where its lines repeat above it', () => {
    const after = [
      entry(B, 'commit: b', 2),
      entry(A, 'commit: a', 1),
      entry(C, 'commit: c', 3),
      ...start,
    ];
    expect(added(after, start, 3)).toEqual(after.slice(0, 3));
    expect(added(after, start, 2)).toBeNull();
  });
  test('a log with nothing recorded before is all new', () => {
    const c = entry(C, 'commit: c');
    expect(added([c], [], 1)).toEqual([c]);
    expect(added([c], [], 2)).toBeNull();
    expect(added([c], [], -1)).toBeNull();
  });
  test('a log that does not show the start, or a count out of range, is unknown', () => {
    expect(added([entry(D, 'commit: d', 9)], start, 0)).toBeNull();
    expect(added(start, start, -1)).toBeNull();
    expect(added(start, start, 3)).toBeNull();
  });
});

describe('recordsCommit', () => {
  for (const message of [
    'checkout: moving from main to side',
    `reset: moving to ${C}`,
    'clone: from /tmp/remote.git',
    'branch: Reset to main',
    'Branch: renamed refs/heads/a to refs/heads/b',
    'merge side: Fast-forward',
    'merge side: Fast-forward (no commit created; -m option ignored)',
    'pull -q --ff-only: Fast-forward',
    'fetch --update-head-ok origin: fast-forward',
    `pull --rebase (start): checkout ${C}`,
    'rebase (finish): returning to refs/heads/main',
    'rebase -i (abort): returning to refs/heads/main',
    "rebase (reset): 'onto'",
    'rebase: fast-forward',
    'am --abort',
    'fetch -q --update-head-ok origin +main:main: forced-update',
    'initial pull',
    'rebase: checkout feat',
  ]) {
    test(`"${message}" only moves HEAD`, () => {
      expect(recordsCommit(message)).toBe(false);
    });
  }
  for (const message of [
    'commit: x',
    'commit (initial): x',
    'commit (amend): x',
    'commit: Fast-forward',
    'commit: feat(start): add',
    'commit: fix(abort): y',
    'commit: wip (finish)',
    'commit: fix checkout: flow',
    'commit: initial pull',
    'rebase (pick): feat(abort)',
    "merge side: Merge made by the 'ort' strategy.",
    "pull: Merge made by the 'ort' strategy.",
    'pull --rebase (pick): x',
    'cherry-pick: x',
    'cherry-pick: fast-forward',
    'revert: Revert "x"',
    'am: x',
    'custom message',
    '',
  ]) {
    test(`"${message}" records a commit`, () => {
      expect(recordsCommit(message)).toBe(true);
    });
  }
});

describe('madeBy', () => {
  test('nothing recorded, no lineage', () => {
    expect(madeBy([entry(C, 'checkout: moving from main to side')], A)).toEqual([]);
  });
  test('a run of commits is one lineage from where HEAD stood before it', () => {
    const entries = [
      entry(D, 'rebase (finish): returning to refs/heads/main'),
      entry(D, 'rebase (pick): two'),
      entry(C, 'rebase (pick): one'),
      entry(B, `rebase (start): checkout ${B}`),
    ];
    expect(madeBy(entries, A)).toEqual([{ base: B, tip: D }]);
  });
  test('a move between commits starts a new lineage', () => {
    const entries = [
      entry(D, 'commit: main'),
      entry(A, 'checkout: moving from side to main'),
      entry(B, 'commit: side'),
      entry(A, 'checkout: moving from main to side'),
    ];
    expect(madeBy(entries, A)).toEqual([
      { base: A, tip: B },
      { base: A, tip: D },
    ]);
  });
  test('the first entry recorded is based on HEAD before the command', () => {
    expect(madeBy([entry(C, 'commit: c')], A)).toEqual([{ base: A, tip: C }]);
  });
});
