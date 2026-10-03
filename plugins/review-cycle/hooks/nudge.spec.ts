import { describe, expect, test } from 'vitest';

import { asksUser, nudgeOf, nudgeOn } from './nudge';

describe('the nudge setting a settings file gives', () => {
  test.each([
    [undefined, null],
    [{}, null],
    [{ 'review-cycle': { options: {} } }, null],
    [{ 'review-cycle': { options: { nudge: false } } }, false],
    [{ 'review-cycle@oakoss': { options: { nudge: true } } }, true],
    [{ 'review-cycle': { options: { nudge: 'no' } } }, null],
    [
      {
        'review-cycle': { options: { nudge: 'no' } },
        'review-cycle@x': { options: { nudge: false } },
      },
      false,
    ],
    [
      {
        'review-cycle': { options: { nudge: false } },
        'review-cycle@x': { options: { nudge: 'no' } },
      },
      false,
    ],
    [{ other: { options: { nudge: false } } }, null],
    [{ 'review-cycle-extras': { options: { nudge: false } } }, null],
    [{ 'review-cycle': null }, null],
    [{ 'review-cycle': { options: null } }, null],
    [
      {
        'review-cycle': { options: { nudge: true } },
        'review-cycle@oakoss': { options: { nudge: false } },
      },
      false,
    ],
    [
      {
        'review-cycle@oakoss': { options: { nudge: false } },
        'review-cycle': { options: { nudge: true } },
      },
      false,
    ],
  ])('%j gives %j', (configs, expected) => {
    expect(nudgeOf(configs)).toBe(expected);
  });
});

describe('whether the nudge is on', () => {
  test.each([
    [true, null, null, true],
    [false, null, null, false],
    [true, false, null, false],
    [true, true, null, true],
    [false, true, null, false],
    [true, false, true, true],
    [false, null, true, true],
    [true, null, false, false],
  ])('user %j, project %j, local %j: %j', (user, project, local, expected) => {
    expect(nudgeOn(user, project, local)).toBe(expected);
  });
});

describe('a turn that ends by asking the user', () => {
  test.each([
    ['Should I commit the changes to `fix/x`?', true],
    ['Push it?\n\n', true],
    ['**Commit the changes to `fix/x`?**', true],
    ['_Push it?_', true],
    ['Proceed? (y/n)', false],
    ['Done. The glob I used is `file?`', false],
    ['Done:\n```\nwhat?\n```', false],
    ['Done. Committed as abc123.', false],
    ['Is it right? I checked it.', false],
    ['', false],
  ])('%j: %j', (answer, expected) => {
    expect(asksUser(answer)).toBe(expected);
  });
});
