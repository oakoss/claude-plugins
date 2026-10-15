import { describe, expect, test } from 'vitest';

import { configured, loadedRung, mergesUnasked } from './ladder';

describe('configured', () => {
  test('reads review-cycle under its bare or qualified name, the earliest rung of two', () => {
    expect(configured({ 'review-cycle': { options: { stopBefore: 'release' } } })).toBe('release');
    expect(
      configured({
        'review-cycle@oakoss': { options: { stopBefore: 'release' } },
        'review-cycle': { options: { stopBefore: 'merge' } },
      }),
    ).toBe('merge');
  });

  test('takes a value outside the options as the earliest rung, and other plugins as none', () => {
    expect(configured({ 'review-cycle': { options: { stopBefore: 'releases' } } })).toBe('commit');
    expect(configured({ 'review-cycles': { options: { stopBefore: 'release' } } })).toBeNull();
    expect(configured({ 'review-cycle': { options: {} } })).toBeNull();
    expect(configured(null)).toBeNull();
  });
});

const rows = (enabled: unknown, stopBefore?: unknown) => [
  { key: 'pr-watch.wake', value: 'off' },
  { key: 'review-cycle.enabled', value: enabled },
  ...(stopBefore === undefined ? [] : [{ key: 'review-cycle.stopBefore', value: stopBefore }]),
];

describe('loadedRung', () => {
  test('reads the loaded review-cycle rung, its default when unset or unknown', () => {
    expect(loadedRung(rows(true, 'release'))).toBe('release');
    expect(loadedRung(rows(true))).toBe('push');
    expect(loadedRung(rows(true, 'releases'))).toBe('push');
  });

  test('is null when review-cycle is not loaded or its gate is off', () => {
    expect(loadedRung([{ key: 'pr-watch.wake', value: 'off' }])).toBeNull();
    expect(loadedRung(rows(false, 'release'))).toBeNull();
    expect(loadedRung(rows('true', 'release'))).toBeNull();
    expect(loadedRung(rows(undefined, 'release'))).toBeNull();
    expect(loadedRung([{ key: 'review-cycles.enabled', value: true }])).toBeNull();
  });
});

describe('mergesUnasked', () => {
  const none = { user: 'push', project: null, local: null } as const;

  test('only a rung past merge lets Claude merge unasked', () => {
    expect(mergesUnasked(none)).toBe(false);
    expect(mergesUnasked({ ...none, user: 'merge' })).toBe(false);
    expect(mergesUnasked({ ...none, user: 'release' })).toBe(true);
    expect(mergesUnasked({ ...none, user: 'never stop' })).toBe(true);
  });

  test('the project file only stops earlier; the local file decides alone', () => {
    expect(mergesUnasked({ ...none, user: 'release', project: 'merge' })).toBe(false);
    expect(mergesUnasked({ ...none, user: 'push', project: 'never stop' })).toBe(false);
    expect(mergesUnasked({ user: 'push', project: 'merge', local: 'release' })).toBe(true);
    expect(mergesUnasked({ ...none, user: 'release', local: 'push' })).toBe(false);
  });
});
