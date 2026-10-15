import { describe, expect, test } from 'vitest';

import { configured, mergesUnasked } from './ladder';

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

describe('mergesUnasked', () => {
  const none = { user: null, project: null, local: null };

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
