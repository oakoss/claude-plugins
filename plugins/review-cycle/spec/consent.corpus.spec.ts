// The corpus the user labeled: each message, the offer it answered, and the
// steps it may grant ([] for none). Most rows are phrasings the reader takes no
// request from; the corpus holds it to granting nothing a row does not allow.
import { describe, expect, test } from 'vitest';

import type { Grant } from '../hooks/consent';
import corpus from '../hooks/consent.corpus.json' with { type: 'json' };
import { grantOf } from '../hooks/exact';

type Case = { prompt: string; offer?: string; may: string[] };

const STEPS = new Set(['push', 'pr', 'merge', 'approve', 'release', 'comment', 'finish']);
const KEYS = new Set(['prompt', 'offer', 'may']);

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
  });

  test.each(named)('%s', (_name, c) => {
    expect(steps(grantOf(c.prompt, c.offer)).filter((s) => !c.may.includes(s))).toEqual([]);
  });
});
