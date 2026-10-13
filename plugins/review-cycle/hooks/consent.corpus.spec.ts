// The corpus the user labeled: each message, the offer it answered, and the
// steps it may grant ([] for none). `missed` marks a case the grammar does not
// grant yet, so a change that starts granting one updates the corpus with it.
import { describe, expect, test } from 'vitest';

import { grantOf, type Grant } from './consent';
import corpus from './consent.corpus.json' with { type: 'json' };

type Case = { prompt: string; offer?: string; may: string[]; missed?: boolean };

const STEPS = new Set(['push', 'pr', 'merge', 'approve', 'release', 'comment', 'finish']);
const KEYS = new Set(['prompt', 'offer', 'may', 'missed']);

function steps(g: Grant): string[] {
  return [
    ...(g.push === 'none' ? [] : ['push']),
    ...(g.pr ? ['pr'] : []),
    ...(g.merge || g.autoMerge ? ['merge'] : []),
    ...(g.approve ? ['approve'] : []),
    ...(g.release ? ['release'] : []),
    ...(g.comment ? ['comment'] : []),
    ...(g.finish.length > 0 ? ['finish'] : []),
  ];
}

const cases: readonly Case[] = corpus;
const named = cases.map((c): [string, Case] => [
  c.offer === undefined ? c.prompt : `${c.prompt} ‹after› ${c.offer.split('\n').at(-1)}`,
  c,
]);

describe('the labeled corpus', () => {
  // A typo in a label would otherwise pin nothing.
  test.each(named)('%s: is well formed', (_name, c) => {
    expect(Object.keys(c).filter((k) => !KEYS.has(k))).toEqual([]);
    expect(c.may.filter((s) => !STEPS.has(s))).toEqual([]);
    if (c.missed !== undefined) expect([c.missed, c.may.length > 0]).toEqual([true, true]);
  });

  // The gate runs what a held message grants, so a hold changes neither check.
  test.each(named)('%s', (_name, c) => {
    const got = steps(grantOf(c.prompt, c.offer));
    expect(got.filter((s) => !c.may.includes(s))).toEqual([]);
    if (c.may.length > 0) expect(got.some((s) => c.may.includes(s))).toBe(c.missed !== true);
  });
});
