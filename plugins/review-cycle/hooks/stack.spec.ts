import { describe, expect, test } from 'vitest';

import { mergeSet } from './stack';

// Stack #4 as `GET repos/{o}/{r}/stacks/4` answered in the 2026-10-18 spike
// (oakoss/stack-spike-2), trimmed: #1 merged, then #2 and #3.
const pr = (number: number, merged = false) => ({
  number,
  state: merged ? 'closed' : 'open',
  merged_at: merged ? '2026-10-18T15:02:11Z' : null,
  draft: false,
  head: { ref: `spike/${number}`, sha: 'f5a524d' },
});
const STACK = { number: 4, open: true, pull_requests: [pr(1, true), pr(2), pr(3)] };
const byStack = { by: 'stack', out: JSON.stringify(STACK) } as const;
const byPr = (stacks: unknown[]) => ({ by: 'pr', out: JSON.stringify(stacks) }) as const;

describe('mergeSet', () => {
  test('a stack merges every unmerged layer', () => {
    expect(mergeSet(4, byStack)).toEqual({ prs: [2, 3] });
  });
  test('a pull request merges with every unmerged one below it', () => {
    expect(mergeSet(3, byPr([STACK]))).toEqual({ prs: [2, 3] });
    expect(mergeSet(2, byPr([STACK]))).toEqual({ prs: [2] });
  });
  test.each([
    ['a merged pull request', 1, byPr([STACK]), '#1 has already merged'],
    [
      'a stack that has merged',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(1, true)] }) },
      'stack #4 has merged every layer',
    ],
    [
      'an empty stack',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [] }) },
      'stack #4 has merged every layer',
    ],
    ['a number in no stack', 9, byPr([]), '#9 is neither a stack nor a pull request in one'],
    ['a pull request in two stacks', 3, byPr([STACK, STACK]), '#3 is in more than one stack'],
    ['a stack not holding it', 9, byPr([STACK]), 'a shape the gate does not read'],
    ['not JSON', 4, { by: 'stack', out: 'nope' }, 'a shape the gate does not read'],
    [
      'a layer with no number',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ merged_at: null }] }) },
      'a shape the gate does not read',
    ],
    [
      'a layer numbered 0',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(0)] }) },
      'a shape the gate does not read',
    ],
    [
      'a layer listed twice',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(2), pr(2)] }) },
      'a shape the gate does not read',
    ],
    [
      'an empty merged_at',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ number: 2, merged_at: '' }] }) },
      'a shape the gate does not read',
    ],
    [
      'a merged_at that is neither null nor a date',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ number: 2 }] }) },
      'a shape the gate does not read',
    ],
  ] as const)('%s asks', (_, n, read, asks) => {
    expect(mergeSet(n, read)).toMatchObject({
      asks: expect.stringContaining(asks),
      remedy: expect.any(String),
    });
  });
});
