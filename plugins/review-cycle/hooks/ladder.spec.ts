import { describe, expect, test } from 'vitest';

import {
  asks,
  configured,
  effective,
  stopBeforeOf,
  where,
  withMandate,
  type StopBefore,
} from './ladder';

const ladder = (stopBefore: StopBefore) => ({ stopBefore, source: 'user' }) as const;

const entry = (stopBefore: unknown, name = 'review-cycle@oakoss') => ({
  [name]: { options: { stopBefore } },
});

describe('the configured rung', () => {
  test('reads a bare or marketplace-qualified name', () => {
    expect(configured(entry('merge'))).toBe('merge');
    expect(configured(entry('open PR', 'review-cycle'))).toBe('open PR');
    expect(configured(entry('merge', 'review-cycle@inline'))).toBe('merge');
  });
  test('another plugin, a missing option and a missing table are unset', () => {
    expect(configured(entry('merge', 'review-cycle-extra'))).toBeNull();
    expect(configured(null)).toBeNull();
    expect(configured({ 'review-cycle': { options: null } })).toBeNull();
    expect(configured({ 'review-cycle': { options: { enabled: true } } })).toBeNull();
    expect(stopBeforeOf(true)).toBeNull();
  });
  test('a value outside the options stops before every step', () => {
    expect(configured(entry('Push'))).toBe('commit');
    expect(configured({ ...entry('never stop', 'review-cycle'), ...entry('later') })).toBe(
      'commit',
    );
    expect(effective('commit', null, configured(entry('Push')))).toEqual({
      stopBefore: 'commit',
      source: 'local',
    });
  });
  test('of two entries, the earlier rung wins', () => {
    expect(configured({ ...entry('merge', 'review-cycle'), ...entry('open PR') })).toBe('open PR');
    expect(configured({ ...entry('open PR', 'review-cycle'), ...entry('merge') })).toBe('open PR');
  });
});

describe('the rung in force', () => {
  test('defaults to stopping before a push', () => {
    expect(effective(null, null, null)).toEqual({ stopBefore: 'push', source: 'default' });
  });
  // The option arrives default-filled, so `push` from the user is the default.
  test('a user value equal to the default is reported as the default', () => {
    expect(effective('push', null, null)).toEqual({ stopBefore: 'push', source: 'default' });
  });
  test('an equal project rung leaves the user as the source', () => {
    expect(effective('open PR', 'open PR', null).source).toBe('user');
  });
  test('the project file only stops earlier than the user', () => {
    expect(effective('merge', 'open PR', null)).toEqual({
      stopBefore: 'open PR',
      source: 'project',
    });
    expect(effective('open PR', 'never stop', null)).toEqual({
      stopBefore: 'open PR',
      source: 'user',
    });
    expect(effective(null, 'merge', null)).toEqual({ stopBefore: 'push', source: 'default' });
  });
  test('the local file sets any rung', () => {
    expect(effective('push', 'push', 'never stop')).toEqual({
      stopBefore: 'never stop',
      source: 'local',
    });
  });
});

describe('which steps ask', () => {
  test('a step at or above the rung asks', () => {
    expect(asks(ladder('push'), 'push')).toBe(true);
    expect(asks(ladder('push'), 'pr')).toBe(true);
    expect(asks(ladder('open PR'), 'push')).toBe(false);
    expect(asks(ladder('open PR'), 'pr')).toBe(true);
    expect(asks(ladder('merge'), 'pr')).toBe(false);
    expect(asks(ladder('never stop'), 'pr')).toBe(false);
  });
  test('stopping before a commit asks at every step; the default lets a commit run', () => {
    expect(asks(ladder('commit'), 'commit')).toBe(true);
    expect(asks(ladder('commit'), 'push')).toBe(true);
    expect(asks(ladder('push'), 'commit')).toBe(false);
  });
});

describe('an epic mandate', () => {
  test('raises a lower rung to merge, so commits, pushes and pull requests run', () => {
    const raised = withMandate(ladder('commit'), 'cpl-czgp');
    expect(raised).toEqual({ stopBefore: 'merge', source: 'mandate' });
    expect(asks(raised, 'push')).toBe(false);
    expect(asks(raised, 'pr')).toBe(false);
    expect(asks(raised, 'merge')).toBe(true);
    expect(asks(raised, 'approve')).toBe(true);
    expect(asks(raised, 'release')).toBe(true);
  });
  test('leaves a rung at or past merge, and none without a job', () => {
    expect(withMandate(ladder('merge'), 'cpl-czgp')).toEqual(ladder('merge'));
    expect(withMandate(ladder('never stop'), 'cpl-czgp')).toEqual(ladder('never stop'));
    expect(withMandate(ladder('commit'), null)).toEqual(ladder('commit'));
  });
  test('names where it came from', () => {
    expect(where('mandate')).toBe('raised by the user\'s "do epic" request');
  });
});
