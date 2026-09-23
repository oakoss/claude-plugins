import { describe, expect, test } from 'vitest';

import { coverage, describeUncovered, hasReceipt, ignoresOf, isReviewerType } from './witness';

const T1 = '1'.repeat(40);
const T2 = '2'.repeat(40);

describe('coverage', () => {
  const reviews = [
    {
      type: 'review-cycle:code-reviewer',
      trees: [T1, T1] as const,
      reviewedPaths: ['a.ts', 'b.ts'],
    },
    {
      type: 'review-cycle:code-reviewer',
      trees: [T2, T2] as const,
      reviewedPaths: ['a.ts', 'b.ts'],
    },
  ];
  test('a path matching any reviewed tree is covered', () => {
    const differing = new Map([
      [T1, new Set(['a.ts'])],
      [T2, new Set<string>()],
    ]);
    expect(coverage(['a.ts'], reviews, differing)).toEqual([{ path: 'a.ts', state: 'covered' }]);
  });
  test('a reviewed path changed since every review was edited after review', () => {
    const differing = new Map([
      [T1, new Set(['a.ts'])],
      [T2, new Set(['a.ts'])],
    ]);
    expect(coverage(['a.ts'], reviews, differing)).toEqual([
      { path: 'a.ts', state: 'edited-after-review' },
    ]);
  });
  test('a path no review touched was never reviewed', () => {
    const differing = new Map([
      [T1, new Set(['c.ts'])],
      [T2, new Set(['c.ts'])],
    ]);
    expect(coverage(['c.ts'], reviews, differing)).toEqual([
      { path: 'c.ts', state: 'never-reviewed' },
    ]);
  });
  test('a tree git could not diff covers nothing', () => {
    expect(coverage(['a.ts'], reviews, new Map())).toEqual([
      { path: 'a.ts', state: 'edited-after-review' },
    ]);
  });
  test('an edit while the leg ran leaves that path uncovered', () => {
    const spanning = [
      {
        type: 'review-cycle:code-reviewer',
        trees: [T1, T2] as const,
        reviewedPaths: ['a.ts', 'b.ts'],
      },
    ];
    const differing = new Map([
      [T1, new Set(['a.ts'])],
      [T2, new Set<string>()],
    ]);
    expect(coverage(['a.ts', 'b.ts'], spanning, differing)).toEqual([
      { path: 'a.ts', state: 'edited-after-review' },
      { path: 'b.ts', state: 'covered' },
    ]);
  });
  test('a review covers only paths it was shown', () => {
    const shownB = [
      { type: 'review-cycle:code-reviewer', trees: [T1, T1] as const, reviewedPaths: ['b.ts'] },
    ];
    const differing = new Map([[T1, new Set<string>()]]);
    expect(coverage(['a.ts'], shownB, differing)).toEqual([
      { path: 'a.ts', state: 'never-reviewed' },
    ]);
  });
  test('no reviews at all', () => {
    expect(coverage(['a.ts'], [], new Map())).toEqual([{ path: 'a.ts', state: 'never-reviewed' }]);
  });
});

test('describeUncovered names both kinds', () => {
  expect(
    describeUncovered([
      { path: 'a.ts', state: 'edited-after-review' },
      { path: 'b.ts', state: 'never-reviewed' },
      { path: 'c.ts', state: 'never-reviewed' },
    ]),
  ).toBe('edited after the last review: a.ts; never reviewed: b.ts, c.ts');
});

describe('what counts as a review', () => {
  test('reviewer types', () => {
    expect(isReviewerType('review-cycle:code-reviewer')).toBe(true);
    expect(isReviewerType('review-cycle:maintainability-auditor')).toBe(true);
    expect(isReviewerType('review-cycle:cleanup')).toBe(false);
    expect(isReviewerType('pr-review-toolkit:code-reviewer')).toBe(false);
    expect(isReviewerType('Explore')).toBe(false);
    expect(isReviewerType()).toBe(false);
  });
  test('the receipt needs both lines at a line start', () => {
    expect(
      hasReceipt('execution: bun test — 12 pass\nattempted-but-failed: none\n\n## Findings'),
    ).toBe(true);
    expect(hasReceipt('execution: none\n## Findings')).toBe(false);
    expect(hasReceipt('I checked execution: and attempted-but-failed: inline')).toBe(false);
    expect(hasReceipt('## Review\nexecution: none\nattempted-but-failed: none')).toBe(true);
    const buried = `${'finding\n'.repeat(8)}execution: none\nattempted-but-failed: none`;
    expect(hasReceipt(buried)).toBe(false);
    expect(hasReceipt('execution: none\nsomething\nattempted-but-failed: none')).toBe(false);
  });
});

test('ignore patterns from the config', () => {
  expect(ignoresOf('{"ignore": ["dist/**", 3, ""]}')).toEqual([':(exclude,glob)dist/**']);
  expect(ignoresOf('not json')).toEqual([]);
  expect(ignoresOf(null)).toEqual([]);
});
