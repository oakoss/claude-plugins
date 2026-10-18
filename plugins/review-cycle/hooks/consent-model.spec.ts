import { describe, expect, test } from 'vitest';

import { grantOf, NO_GRANT } from './consent';
import {
  askOf,
  grantOfModel,
  judge,
  offerOf,
  RULES,
  vetoed,
  type ModelGrant,
} from './consent-model';
import recorded from './consent-model.replies.json' with { type: 'json' };
import corpus from './consent.corpus.json' with { type: 'json' };
import { hashOf } from './ledger';

const { replies } = recorded;

const reply = (steps: object, quote: string) => JSON.stringify({ steps, quote });
const NOW = { now: true, condition: false, declined: false };
const NONE: ModelGrant = { push: 'none', pr: false, approve: false, release: false };

function stepsOf(g: ModelGrant): string[] {
  return [
    ...(g.push === 'none' ? [] : ['push']),
    ...(g.pr ? ['pr'] : []),
    ...(g.approve ? ['approve'] : []),
    ...(g.release ? ['release'] : []),
  ];
}

describe('askOf', () => {
  test('puts the offer before the message', () => {
    expect(askOf('yes', 'Merge #130?')).toBe(
      "The agent's last question:\n<question>\nMerge #130?\n</question>\n\nThe person's latest message:\n<message>\nyes\n</message>",
    );
  });
  test('leaves the question out with no offer', () => {
    expect(askOf('push it', '')).toBe(
      "The person's latest message:\n<message>\npush it\n</message>",
    );
  });
});

test('offerOf keeps the last six non-empty lines, as measured', () => {
  expect(offerOf('a\n\nb\nc\nd\n\ne\nf\ng\n\n')).toBe('b\nc\nd\ne\nf\ng');
  expect(offerOf('1\n2\n3\n4\n5\n  \n6\n')).toBe('2\n3\n4\n5\n  \n6');
});

describe('judge', () => {
  test('grants what the model says now, quoting the message', () => {
    const j = judge(
      reply({ push: NOW, pr: NOW }, 'ship the react aria update'),
      'Ok, lets ship the react aria update',
    );
    expect(j).toEqual({
      kind: 'granted',
      grant: { ...NONE, push: 'push', pr: true },
      quote: 'ship the react aria update',
    });
  });
  test('reads the one JSON object after prose, compact or pretty, or in a fence', () => {
    const json = reply({ push: NOW }, 'push it');
    const pretty = JSON.stringify(JSON.parse(json), null, 2);
    expect(judge(`It asks for the push.\n\n${json}`, 'push it').kind).toBe('granted');
    expect(judge(`It asks.\n${pretty}`, 'push it').kind).toBe('granted');
    expect(judge(`\`\`\`json\n${json}\n\`\`\``, 'push it').kind).toBe('granted');
  });
  test.each([
    ['not JSON', 'it asks to push', 'malformed'],
    [
      'two answers',
      `${reply({ push: { ...NOW, now: false } }, '')}\n${reply({ push: NOW }, 'push it')}`,
      'malformed',
    ],
    [
      'two answers, the first with its quote first',
      `${JSON.stringify({ quote: '', steps: { push: { ...NOW, now: false } } })}\n${reply({ push: NOW }, 'push it')}`,
      'malformed',
    ],
    [
      'steps that are not an object',
      JSON.stringify({ steps: ['push'], quote: 'push it' }),
      'malformed',
    ],
    ['now false', reply({ push: { ...NOW, now: false } }, 'push it'), 'none'],
    ['now as a string', reply({ push: { ...NOW, now: 'true' } }, 'push it'), 'none'],
    ['a condition', reply({ push: { ...NOW, condition: true } }, 'push it'), 'none'],
    ['a condition not false', reply({ push: { ...NOW, condition: 'yes' } }, 'push it'), 'none'],
    ['no condition flag', reply({ push: { now: true, declined: false } }, 'push it'), 'none'],
    ['a decline', reply({ push: { ...NOW, declined: true } }, 'push it'), 'none'],
    ['no decline flag', reply({ push: { now: true, condition: false } }, 'push it'), 'none'],
    [
      'merge, comment and finish only',
      reply({ merge: NOW, comment: NOW, finish: NOW }, 'push it'),
      'none',
    ],
    ['nothing asked, with no quote', reply({ push: { ...NOW, now: false } }, ''), 'none'],
    ['a quote the person did not type', reply({ push: NOW }, 'push it now'), 'quote'],
    ['an empty quote', reply({ push: NOW }, ''), 'quote'],
  ])('refuses %s', (_name, text, why) => {
    expect(judge(text, 'push it')).toEqual({ kind: 'refused', why });
  });
  test('grants an approval', () => {
    const j = judge(reply({ approve: NOW }, 'approve it'), 'ok, approve it');
    expect(j.kind === 'granted' && j.grant).toEqual({ ...NONE, approve: true });
  });
  test('grants the other steps beside a merge', () => {
    const j = judge(reply({ merge: NOW, release: NOW }, 'cut it'), 'yep, cut it');
    expect(j).toEqual({ kind: 'granted', grant: { ...NONE, release: true }, quote: 'cut it' });
  });
  test('matches a quote across apostrophes and accents', () => {
    expect(judge(reply({ push: NOW }, "let's push"), 'let’s push').kind).toBe('granted');
  });
  test('push is a plain push, never a force', () => {
    const j = judge(reply({ push: NOW }, 'force push it'), 'force push it');
    expect(j.kind === 'granted' && j.grant.push).toBe('push');
  });
  test('a model grant is a typed grant with nothing else set', () => {
    const all: ModelGrant = { push: 'push', pr: true, approve: true, release: true };
    const carrying = { ...all, merge: true, commit: true, comment: true };
    expect(grantOfModel(carrying)).toEqual({ ...NO_GRANT, ...all });
  });
});

describe('vetoes', () => {
  test.each([
    'merge the first PR',
    'push it to later',
    'push it, but hold off',
    'push it, but wait',
    'merge the release-please branch',
    'merge the release 3.5',
    'merge the release #3 fixes',
    'merge the release, then push',
    'publish to it',
    'publish to the',
    '(not yet) push it',
    'push it later, not now',
    'hold off on the push',
    'push it from main',
  ])('%s', (message) => {
    expect(vetoed(message)).toBe(true);
  });
  test.each([
    'Ok, lets merge the release',
    'merge the release PR',
    'merge the release now',
    'publish it',
    'push it first',
    'never mind the tests, push it',
    "don't wait, push it",
    "don't forget to push",
    "don't worry just push it",
    'do not hesitate to open a PR',
    "don't wait for CI push it",
    "don't overthink it and open the PR",
  ])('not %s', (message) => {
    expect(vetoed(message)).toBe(false);
  });
});

// The model's recorded answers (pnpm consent:model live) for each labeled case
// the grammar grants nothing, replayed through judge.
describe('recorded replies', () => {
  // Replies to other rules say nothing about these: `pnpm consent:model live`, then adopt.
  test('were recorded against the current RULES', () => {
    expect(recorded.rules).toBe(hashOf(RULES));
  });

  const may = new Map(corpus.map((c) => [`${c.prompt}\u0000${c.offer ?? ''}`, c.may]));
  const labels = (r: (typeof replies)[number]) => may.get(`${r.prompt}\u0000${r.offer ?? ''}`);

  test.each(replies.map((r): [string, typeof r] => [r.prompt, r]))(
    '%s: no wrong yes',
    (_name, r) => {
      const j = judge(r.reply, r.prompt);
      const granted = j.kind === 'granted' ? stepsOf(j.grant) : [];
      expect(granted.filter((s) => !(labels(r) ?? []).includes(s))).toEqual([]);
    },
  );

  test('every reply answers a labeled case', () => {
    expect(replies.filter((r) => labels(r) === undefined)).toEqual([]);
  });

  // A recording that lost some replies would score their misses as nothing.
  test('every case the grammar refuses has a reply', () => {
    const replied = new Set(replies.map((r) => `${r.prompt}\u0000${r.offer ?? ''}`));
    const refused = corpus.filter((c) => {
      const g = grantOf(c.prompt, c.offer);
      return (
        g.push === 'none' &&
        !g.pr &&
        !g.merge &&
        !g.autoMerge &&
        !g.approve &&
        !g.release &&
        !g.comment &&
        g.finish.length === 0
      );
    });
    expect(refused.filter((c) => !replied.has(`${c.prompt}\u0000${c.offer ?? ''}`))).toEqual([]);
  });

  test('the cases the model grants', () => {
    const granted = new Set(
      replies.filter((r) => judge(r.reply, r.prompt).kind === 'granted').map((r) => r.prompt),
    );
    expect([...granted].toSorted()).toEqual([
      'Ok, lets do that',
      'Ok, lets ship the react aria update',
      'Push the branch delete',
      'commit it as soon as you can, then push it',
      'open a PR for the docs',
      'sure, send it up',
      'yep, cut it',
      'yes',
      'yes, push on',
    ]);
  });
});
