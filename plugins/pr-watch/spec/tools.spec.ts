import { describe, expect, test } from 'vitest';

import { flow, job, pull, watched } from '../hooks/fixtures';
import { answerOf, matchesOf, named, textOf, toolInputOf } from '../hooks/tools';
import { untilText } from '../hooks/watch';
import type { Pull, Watch } from '../types';

const NOW = Date.parse('2026-10-03T22:02:00Z');
const KNOWN = {};
const green = () => flow(1, 'CI', [job('CI Summary', 'SUCCESS', true)]);
const HEAD = 'pr-watch is now watching o/r#128 on its line above the prompt.';
const TELLS =
  'It tells you when that changes, at once or with the next message, so there is no need to poll gh.';
const WAKES =
  'It wakes you when it turns ready to merge or its checks pass, and tells you the rest when it changes, so there is no need to poll gh.';
const AGAIN =
  'now. pr-watch wakes you if that happens again after new checks, and tells you the rest when it changes.';

// Merged at 22:00:00 with passing runs on the merge commit.
const merged = (): Pull =>
  pull([green()], {
    state: 'MERGED',
    mergedAt: '2026-10-03T22:00:00Z',
    mergeRuns: { workflows: [green()], isTruncated: false },
  });

const answer = (
  after: Watch,
  {
    isAwake = true,
    wake = false,
    now = NOW,
  }: { isAwake?: boolean; wake?: boolean; now?: number } = {},
) => answerOf({ head: HEAD, after, config: { isAwake }, input: { wake }, now, known: KNOWN });

describe('named', () => {
  test('is a string with something besides spaces', () => {
    expect(named('7')).toBe(true);
    expect(named('  ')).toBe(false);
    expect(named(7)).toBe(false);
    expect(named(null)).toBe(false);
  });
});

describe('toolInputOf', () => {
  test('trims the pull request and defaults the rest', () => {
    expect(toolInputOf({ pull: ' 12 ' })).toEqual({ pull: '12', repo: null, wake: false });
  });

  test('keeps a repo and wake', () => {
    expect(toolInputOf({ pull: '12', repo: 'o/r', wake: true })).toEqual({
      pull: '12',
      repo: 'o/r',
      wake: true,
    });
  });

  test('takes `pr` for `pull`, and over an empty `pull`', () => {
    expect(toolInputOf({ pr: '7' })).toEqual({ pull: '7', repo: null, wake: false });
    expect(toolInputOf({ pull: '', pr: '7' })).toEqual({ pull: '7', repo: null, wake: false });
    expect(toolInputOf({ pull: '8', pr: '7' })).toEqual({ pull: '8', repo: null, wake: false });
  });

  test('reads an empty repo and a null wake as unset', () => {
    expect(toolInputOf({ pull: '12', repo: '', wake: null })).toEqual({
      pull: '12',
      repo: null,
      wake: false,
    });
    expect(toolInputOf({ pull: '12', repo: null })).toEqual({
      pull: '12',
      repo: null,
      wake: false,
    });
  });

  test('refuses a missing or unnamed pull request', () => {
    const why = 'pr-watch: `pull` names a pull request: its number, URL or head branch.';
    expect(toolInputOf({})).toBe(why);
    expect(toolInputOf({ pull: '   ' })).toBe(why);
    expect(toolInputOf({ pull: 12 })).toBe(why);
  });

  test('refuses a repo or wake of the wrong type', () => {
    expect(toolInputOf({ pull: '12', repo: 5 })).toBe(
      'pr-watch: `repo` is the repository as owner/name.',
    );
    expect(toolInputOf({ pull: '12', wake: 'yes' })).toBe('pr-watch: `wake` is true or false.');
  });
});

describe('matchesOf', () => {
  const a = watched(pull([green()]));
  const b = watched(pull([green()]), { repo: 'o/s', url: 'https://github.com/o/s/pull/128' });
  const pushed = watched(undefined, {
    number: 0,
    url: 'https://github.com/o/r/tree/feat',
    push: { branch: 'feat', pushedAt: 0 },
  });
  const list = [a, b, pushed];

  test('matches a number, with or without #, in every repo unless one is named', () => {
    expect(matchesOf(list, { pull: '128', repo: null })).toEqual([a, b]);
    expect(matchesOf(list, { pull: '#128', repo: null })).toEqual([a, b]);
    expect(matchesOf(list, { pull: '128', repo: 'o/s' })).toEqual([b]);
  });

  test('matches a URL whatever repo is named', () => {
    expect(matchesOf(list, { pull: b.url, repo: 'o/r' })).toEqual([b]);
  });

  test('matches a push by its branch, not by number', () => {
    expect(matchesOf(list, { pull: 'feat', repo: 'o/r' })).toEqual([pushed]);
    expect(matchesOf(list, { pull: 'feat', repo: 'o/s' })).toEqual([]);
    expect(matchesOf(list, { pull: '0', repo: null })).toEqual([]);
  });

  test('matches nothing it does not watch', () => {
    expect(matchesOf(list, { pull: '129', repo: null })).toEqual([]);
    expect(matchesOf(list, { pull: 'main', repo: null })).toEqual([]);
  });
});

describe('answerOf', () => {
  const ready = watched(pull([green()]));
  const running = watched(pull([flow(1, 'CI', [job('build', null)])]));

  test('with waking off, quotes the line and says no wait', () => {
    const limited = { ...ready, limitedUntil: NOW + 60_000 };
    expect(answer(limited, { isAwake: false, wake: true })).toBe(
      `${HEAD} Waking Claude is off in /config: it shows ${textOf(limited, NOW, KNOWN)}, and the watches tool reads it again.`,
    );
  });

  test('with waking off, quotes the line whether or not wake is passed', () => {
    expect(answer(ready, { isAwake: false })).toBe(
      `${HEAD} Waking Claude is off in /config: it shows #128 ✓ ready to merge, and the watches tool reads it again.`,
    );
  });

  test("says the rate limit's pause before being offline", () => {
    const until = NOW + 60_000;
    expect(answer({ ...ready, limitedUntil: until, offline: 1 })).toBe(
      `${HEAD} GitHub's rate limit pauses its reads until ${untilText(until)}. ${TELLS}`,
    );
  });

  test('says being offline before a failed read', () => {
    expect(answer({ ...ready, offline: 1, error: 'boom' })).toBe(
      `${HEAD} GitHub could not be reached; pr-watch keeps trying. ${TELLS}`,
    );
  });

  test('says a failed read', () => {
    expect(answer({ ...ready, error: 'boom' })).toBe(
      `${HEAD} Its last read failed (boom); pr-watch tries again. ${TELLS}`,
    );
  });

  test('without wake, says it tells of changes even when ready', () => {
    expect(answer(ready)).toBe(`${HEAD} ${TELLS}`);
  });

  test('with wake, says a ready pull request is ready', () => {
    expect(answer(ready, { wake: true })).toBe(`${HEAD} It is ready to merge ${AGAIN}`);
  });

  test("with wake, says a settled merge's checks passed", () => {
    expect(answer(watched(merged()), { wake: true })).toBe(
      `${HEAD} Its merge's checks have passed ${AGAIN}`,
    );
  });

  test("with wake, says a draft's checks passed", () => {
    const draft = watched(pull([green()], { isDraft: true, headOid: 'abc' }));
    expect(answer(draft, { wake: true })).toBe(`${HEAD} Its checks have passed ${AGAIN}`);
  });

  test('with wake, says it wakes later otherwise', () => {
    expect(answer(running, { wake: true })).toBe(`${HEAD} ${WAKES}`);
    expect(answer(watched(), { wake: true })).toBe(`${HEAD} ${WAKES}`);
    // Passed but not yet settled.
    expect(answer(watched(merged()), { wake: true, now: Date.parse('2026-10-03T22:01:00Z') })).toBe(
      `${HEAD} ${WAKES}`,
    );
  });
});
