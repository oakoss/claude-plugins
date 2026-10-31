import { describe, expect, test } from 'vitest';

import {
  defaultOf,
  lastSetOf,
  prunedOf,
  shortNameOf,
  TITLES_KEPT,
  titleFor,
  trunksOf,
} from './title';

describe('shortNameOf', () => {
  test.each([
    ['fix/force-choice-gaps', 'force-choice-gaps'],
    ['feat/a/b', 'a/b'],
    ['spike', 'spike'],
  ])('%s is %s', (branch, name) => {
    expect(shortNameOf(branch)).toBe(name);
  });
});

describe('defaultOf', () => {
  test.each([
    ['refs/remotes/origin/main\n', 'main'],
    ['refs/remotes/origin/release/x', 'release/x'],
    ['refs/remotes/upstream/main', null],
    ['remotes/origin/main', null],
    ['origin/main', null],
    ['refs/remotes/origin/', null],
    ['', null],
  ])('%j is %j', (stdout, name) => {
    expect(defaultOf(stdout)).toBe(name);
  });
});

describe('trunksOf', () => {
  test('a recorded default is the only trunk', () => {
    expect(trunksOf('develop', 'main')).toEqual(['develop']);
  });
  test('without one, the configured default, main and master', () => {
    expect(trunksOf(null, 'trunk\n')).toEqual(['trunk', 'main', 'master']);
    expect(trunksOf(null, 'main')).toEqual(['main', 'master']);
    expect(trunksOf(null, null)).toEqual(['main', 'master']);
  });
});

const ON = {
  branch: 'feat/session-title',
  trunks: ['main'],
  current: undefined,
  lastSet: undefined,
};

describe('titleFor', () => {
  test('a work branch titles an untitled session', () => {
    expect(titleFor(ON)).toBe('session-title');
  });
  test('a branch change retitles a session this plugin titled', () => {
    expect(titleFor({ ...ON, current: 'force-choice-gaps', lastSet: 'force-choice-gaps' })).toBe(
      'session-title',
    );
  });
  test("the person's title stays", () => {
    expect(titleFor({ ...ON, current: 'ship-session-note' })).toBeNull();
    expect(
      titleFor({ ...ON, current: 'ship-session-note', lastSet: 'force-choice-gaps' }),
    ).toBeNull();
  });
  test('the title already set is not set again', () => {
    expect(titleFor({ ...ON, current: 'session-title', lastSet: 'session-title' })).toBeNull();
  });
  test('a trunk leaves the title', () => {
    expect(titleFor({ ...ON, branch: 'main' })).toBeNull();
    expect(titleFor({ ...ON, branch: 'trunk', trunks: ['trunk', 'main', 'master'] })).toBeNull();
  });
  test('a branch named like a default elsewhere titles when it is no trunk here', () => {
    expect(titleFor({ ...ON, branch: 'master', trunks: ['main'] })).toBe('master');
  });
  test('a detached HEAD leaves the title', () => {
    expect(titleFor({ ...ON, branch: '' })).toBeNull();
    expect(titleFor({ ...ON, branch: '\n' })).toBeNull();
  });
});

describe('the stored titles', () => {
  test('lastSetOf reads only a string title', () => {
    expect(lastSetOf({ at: 1, title: 'x' })).toBe('x');
    expect(lastSetOf({ at: 1, title: 3 })).toBeUndefined();
    expect(lastSetOf(null)).toBeUndefined();
  });
  test('prunedOf drops the oldest past the cap, timeless ones first', () => {
    expect(TITLES_KEPT).toBe(200);
    const entries = Array.from(
      { length: 202 },
      (_, i) => [`title:${i}`, { at: i + 10, title: 't' }] as const,
    );
    expect(prunedOf(entries)).toEqual(['title:0', 'title:1']);
    expect(prunedOf(entries.slice(0, 200))).toEqual([]);
    expect(prunedOf([...entries.slice(1), ['title:none', 'junk']])).toEqual([
      'title:none',
      'title:1',
    ]);
  });
});
