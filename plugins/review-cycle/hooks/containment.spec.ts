import { describe, expect, test } from 'vitest';

import {
  containmentReport,
  insideRepo,
  ownConfig,
  repoChanges,
  UNREAD,
  type RepoState,
} from './containment';

const STATE: RepoState = { head: 'c main', index: 'i', work: 'w', config: 'local\0a\n1' };

describe('ownConfig', () => {
  test('keeps local and worktree entries whole, and drops the rest', () => {
    const z = 'global\0user.name\nme\0local\0x.multi\none\ntwo\0worktree\0core.hooksPath\n/x\0';
    expect(ownConfig(z)).toBe('local\0x.multi\none\ntwo\0worktree\0core.hooksPath\n/x');
  });
  test('an empty listing is empty, not unreadable', () => {
    expect(ownConfig('')).toBe('');
  });
});

describe('repoChanges', () => {
  test('names each changed part', () => {
    expect(repoChanges(STATE, { ...STATE, index: 'j', config: 'local\0a\n2' })).toEqual({
      changed: ['the staged content', 'the local git config'],
      unreadable: [],
    });
  });
  test('an unreadable part does not hide the readable ones', () => {
    expect(repoChanges({ ...STATE, head: null }, { ...STATE, work: 'x' })).toEqual({
      changed: ['the working tree'],
      unreadable: ['HEAD'],
    });
  });
  test('an unreadable capture names every part', () => {
    expect(repoChanges(STATE, UNREAD).unreadable).toHaveLength(4);
  });
});

describe('insideRepo', () => {
  test.each([
    ['/repo', true],
    ['/repo/a.ts', true],
    ['/repo/.git/config', true],
    ['/repository/a.ts', false],
    ['/tmp/copy/a.ts', false],
  ])('%s → %s', (path, inside) => expect(insideRepo(path, '/repo')).toBe(inside));
});

function report(after: RepoState, extra: Partial<Parameters<typeof containmentReport>[0]> = {}) {
  return containmentReport({
    type: 'review-cycle:code-reviewer',
    command: 'sed -i x a.ts\nsecond line',
    before: { state: STATE, why: null },
    after: { state: after, why: null },
    background: false,
    ...extra,
  });
}

describe('containmentReport', () => {
  test('nothing moved: nothing to say', () => {
    expect(report(STATE)).toEqual({ notes: [], records: [] });
  });
  test('a change is put to the reviewer without blaming it, and recorded', () => {
    const r = report({ ...STATE, work: 'x' });
    expect(r.records).toEqual([
      'review-cycle:code-reviewer: the working tree changed while `sed -i x a.ts` ran',
    ]);
    expect(r.notes[0]).toContain('by it or by another agent');
  });
  test('each distinct reason is named once', () => {
    const r = report(UNREAD, {
      before: { state: UNREAD, why: 'lookup failed' },
      after: { state: UNREAD, why: 'lookup failed' },
    });
    expect(r.records[0]).toContain('(lookup failed) while');
  });
  test('a background command is said to be checked only until it returns', () => {
    expect(report(STATE, { background: true }).notes).toEqual([
      expect.stringContaining('runs in the background'),
    ]);
  });
  test('the command shown is its first line, cut at 80 characters', () => {
    const r = report({ ...STATE, work: 'x' }, { command: 'y'.repeat(100) });
    expect(r.records[0]).toContain(`\`${'y'.repeat(80)}\``);
  });
});
