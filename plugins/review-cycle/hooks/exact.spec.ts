import { describe, expect, test } from 'vitest';

import { NO_GRANT, type Grant } from './consent';
import {
  dropsGrant,
  endsReady,
  grantOf,
  holdOf,
  isReply,
  mandateAfter,
  mandateOf,
  stepsNamed,
  unreadOffer,
} from './exact';
import { OFFER_STEPS, offerQuestion, type OfferStep } from './offers';

const grant = (part: Partial<Grant>): Grant => ({ ...NO_GRANT, ...part });
const SHIP = { commit: true, push: 'push', pr: true } as const;

describe('a request, read exactly', () => {
  test.each<[string, Partial<Grant>]>([
    ['commit', { commit: true }],
    ['commit the changes', { commit: true }],
    ['push', { push: 'push' }],
    ['push it', { push: 'push' }],
    ['ship it', SHIP],
    ['open a pr', { pr: true }],
    ['create the pull request', { pr: true }],
    ['merge 316', { merge: true, mergeNamed: ['316'] }],
    ['merge #316', { merge: true, mergeNamed: ['316'] }],
    ['merge pr 316', { merge: true, mergeNamed: ['316'] }],
    ['merge 41, 42 and 43', { merge: true, mergeNamed: ['41', '42', '43'] }],
    ['merge Oakoss/Linesmith#53', { merge: true, mergeNamed: ['oakoss/linesmith#53'] }],
    ['approve 12', { approve: true }],
    ['release', { release: true }],
    ['publish it', { release: true }],

    ['push to main', { push: 'push', pushNamed: ['main'] }],
    ['push it to feat/x', { push: 'push', pushNamed: ['feat/x'] }],
    ['push to Main', { push: 'push', pushNamed: ['main'] }],
    ['push to fix/no-cache', { push: 'push', pushNamed: ['fix/no-cache'] }],
    ['push it to the wait-for-ci branch', { push: 'push', pushNamed: ['wait-for-ci'] }],
    ['push to the staging branch', { push: 'push', pushNamed: ['staging'] }],
    ['push it to origin', { push: 'push' }],
    ['force push', { push: 'lease' }],
    ['force-push it with a lease', { push: 'lease' }],
    ['force push without a lease', { push: 'bare' }],
    ['force push to main without a lease', { push: 'bare', pushNamed: ['main'] }],
    ['push the v1 tag', { push: 'push', pushNamed: ['tag:v1'] }],
    ['delete the branch', { push: 'push' }],

    ['push the stack', { push: 'push' }],
    ['force push the stack', { push: 'lease' }],
    ['merge the stack', { mergeStack: ['stack'] }],
    ['merge up to #42', { mergeStack: ['upto:42'] }],
    ['merge stack #4', { mergeStack: ['stack:4'] }],

    ['finish the rebase', { finish: ['rebase'] }],
    ['continue the cherry-pick', { finish: ['cherry-pick'] }],

    ['reply to the review', { comment: true }],
    ['reply to the review threads on #12', { comment: true }],

    ['ship them', SHIP],
    ['push both', { push: 'push' }],

    ['merge it when it is ready', { autoMerge: true }],
    ["merge 132 when it's ready", { autoMerge: true, readyNamed: ['132'] }],
    ['merge it once ci passes', { autoMerge: true }],
    ['release when the release pull request is ready', { readyRelease: true }],
    ['release once main and the release PR are ready', { readyRelease: true, readyMain: true }],

    ['commit and push', { commit: true, push: 'push' }],
    ['push it and open a pr', { push: 'push', pr: true }],
    ['merge 316, then release', { merge: true, mergeNamed: ['316'], release: true }],
    [
      'merge 46, and merge 62 once CI passes',
      { merge: true, mergeNamed: ['46'], autoMerge: true, readyNamed: ['62'] },
    ],
    ["merge it when it's ready, then release it", { autoMerge: true, readyRelease: true }],
    [
      'merge 46 once CI passes and release it',
      { autoMerge: true, readyNamed: ['46'], readyRelease: true },
    ],
    [
      'merge 41 and 42 and then release it',
      { merge: true, mergeNamed: ['41', '42'], release: true },
    ],
  ])('%s', (text, part) => {
    expect(grantOf(text)).toEqual(grant(part));
    expect(holdOf(text)).toBeNull();
  });

  test.each([
    'ok, lets ship them',
    'Ok, lets ship it.',
    'yes, ship it',
    'please ship it',
    'go ahead and ship it',
    'you can ship it',
    'ok, we can ship it',
    'also ship it',
    'and ship it',
    'then ship it',
    'well, ship it',
    'hey ship it',
    'please, ship it',
    'ok, well, please ship it',
    'ship it, please',
    'ship it, now',
    'ship it please',
    'Looks good, ship it now!',
    'ok,  let’s   ship it',
  ])('%s: an agreeing word, a lead and a tail change nothing', (text) => {
    expect(grantOf(text)).toEqual(grant(SHIP));
  });

  test.each([
    'ship it tomorrow',
    'ship it, later',
    'ship it, please and thanks',
    'lets, ship it',
    'well ship it tomorrow',
    'hey, can you ship it',
    'file the bead then ship',
    'merge 316 then start on cpl-12',
    'push the tag',
    'push first',
    'can we merge 347?',
    'push to npm',
    'push it to tomorrow',
    'merge 0',
    'merge the first one',
    'release 289',
    'merge it when Bob approves',
    'merge it when ready, then push, then release',
    'merge it when ready and push it',
    'merge 46 once CI passes and merge 47',
    'merge it when ready and release 289',
    'release when the release PR is ready, then merge it',
    'release when the release PR is ready and push',
    `push to ${'a/'.repeat(200)}x`,
    'looks good',
    'thanks',
    '',
  ])('%s: outside the vocabulary grants nothing', (text) => {
    expect(grantOf(text)).toEqual(NO_GRANT);
  });

  test.each(["don't push it", 'push it, but not yet', 'merge 316 later', 'no, ship it'])(
    '%s: a hold word grants nothing',
    (text) => {
      expect(grantOf(text)).toEqual(NO_GRANT);
      expect(holdOf(text)).not.toBeNull();
    },
  );
});

describe('the pull request a merge names', () => {
  const report = 'Shipped: https://github.com/oakoss/linesmith/pull/53\n\nAll checks pass.';

  test('a bare number is the one pull request the answer links with it', () => {
    expect(grantOf('merge 53', report).mergeNamed).toEqual(['oakoss/linesmith#53']);
    expect(grantOf('merge 54', report).mergeNamed).toEqual(['54']);
  });
  test('a number two repositories hold, or one beside a named repository, matches no merge', () => {
    expect(grantOf('merge 53', `${report}\nAlso oakoss/oakum#53.`).mergeNamed).toEqual(['?#53']);
    expect(grantOf('merge linesmith#53 and 54').mergeNamed).toEqual(['linesmith#53', '?#54']);
  });
  test('"merge it" names the question\'s pull request before the closing\'s', () => {
    expect(grantOf('merge it', '#12 and #13 are green.\nMerge #12?').mergeNamed).toEqual(['12']);
    expect(grantOf('merge it', '#12 is green.').mergeNamed).toEqual(['12']);
    expect(grantOf('merge it', '#12 and #13 are green.').mergeNamed).toEqual(['?']);
    expect(grantOf('merge it', 'Done.').mergeNamed).toEqual([]);
    expect(grantOf('merge it when ready', '#12 is green.').readyNamed).toEqual(['12']);
  });
  test('"merge both" picks the two pull requests offered, the question\'s first', () => {
    const both = grant({ merge: true, mergeNamed: ['41', '42'] });
    expect(grantOf('merge both', 'Say "merge #41", "merge #42", or "merge both".')).toEqual(both);
    expect(grantOf('merge both', 'Fixes issue #9.\nMerge #41 and #42?')).toEqual(both);
    expect(grantOf('merge both', 'Merge #41, #42 and #43?')).toEqual(NO_GRANT);
    expect(grantOf('merge them', 'Merge #41, #42 and #43?').mergeNamed).toEqual(['41', '42', '43']);
    expect(grantOf('merge them', '#41 is green.')).toEqual(NO_GRANT);
  });
});

const SAMPLES: Record<OfferStep, readonly [object, Partial<Grant>][]> = {
  merge: [
    [{ pulls: ['316'] }, { merge: true, mergeNamed: ['316'] }],
    [
      { pulls: ['41', '42', '43'], method: 'squash' },
      { merge: true, mergeNamed: ['41', '42', '43'] },
    ],
    [
      { pulls: ['o/r#53'], method: 'rebase' },
      { merge: true, mergeNamed: ['o/r#53'] },
    ],
    [{ pulls: ['Oakoss/Linesmith#53'] }, { merge: true, mergeNamed: ['oakoss/linesmith#53'] }],
  ],
  release: [
    [{ pulls: ['343'] }, { release: true }],
    [{ version: 'review-cycle@0.39.0' }, { release: true }],
  ],
  'merge-release': [[{ pulls: ['343'] }, { merge: true, mergeNamed: ['343'], release: true }]],
  approve: [[{ pulls: ['12'] }, { approve: true }]],
  comment: [[{ pulls: ['o/r#12'] }, { comment: true }]],
  stack: [
    [{}, { mergeStack: ['stack'] }],
    [{ pulls: ['42'] }, { mergeStack: ['upto:42'] }],
  ],
  push: [[{ branch: 'main' }, { push: 'push' }]],
  'force-push': [[{ branch: 'feat/x', remote: 'fork' }, { push: 'lease' }]],
  'push-pr': [[{ branch: 'feat/x' }, { push: 'push', pr: true }]],
  pr: [[{}, { pr: true }]],
  commit: [[{ branch: 'feat/x' }, { commit: true }]],
  finish: [[{ branch: 'feat/x', operation: 'rebase' }, { finish: ['rebase'] }]],
  delete: [[{ branch: 'feat/x' }, { push: 'push' }]],
  'force-push-bare': [[{ branch: 'feat/x' }, { push: 'bare' }]],
  'stack-push': [[{}, { push: 'lease' }]],
  'stack-submit': [[{}, { push: 'lease', pr: true }]],
};

const questions = OFFER_STEPS.flatMap((step) =>
  SAMPLES[step].map(([input, part]): [string, Partial<Grant>] => {
    const q = offerQuestion({ step, ...input });
    if ('error' in q) throw new Error(`${step}: ${q.error}`);
    return [q.question, part];
  }),
);

describe("a yes to the offer tool's question", () => {
  test.each(questions)('%s', (question, part) => {
    const answer = `Checks pass.\n\n${question}`;
    expect(grantOf('yes', answer)).toEqual(grant(part));
    expect(grantOf('Ok, lets do that.', answer)).toEqual(grant(part));
    expect(unreadOffer('yes', answer)).toBeNull();
  });

  test.each(questions)('%s: only as the whole last line', (question) => {
    expect(grantOf('yes', `${question} Or should I wait?`)).toEqual(NO_GRANT);
    expect(grantOf('yes', `${question}\n\nSay the word.`)).toEqual(NO_GRANT);
    expect(grantOf('yes', question.toLowerCase())).toEqual(NO_GRANT);
    expect(grantOf('yes', `If CI passes:\n${question}`)).toEqual(NO_GRANT);
    expect(grantOf('yes', `If CI passes:\n \t\n${question}`)).toEqual(NO_GRANT);
    expect(grantOf('yes', `If CI passes:\r\n\r\n${question}`)).toEqual(NO_GRANT);
    expect(grantOf('yes', `Once the docs land,\n\n${question}`)).toEqual(NO_GRANT);
    expect(grantOf('yes', `CI is green.\n${question}`)).toEqual(NO_GRANT);
  });

  test('a yes to the two questions a push refusal writes names where the push goes', () => {
    expect(grantOf('yes', 'Done.\n\nPush to `main`?')).toEqual(
      grant({ push: 'push', pushNamed: ['main'] }),
    );
    expect(grantOf('yes', 'Done.\n\nPush the `v1` tag?')).toEqual(
      grant({ push: 'push', pushNamed: ['tag:v1'] }),
    );
  });

  test('a yes to any other question grants nothing, and says why', () => {
    const answer = 'All green.\n\nWant me to push and open the PR?';
    expect(grantOf('yes', answer)).toEqual(NO_GRANT);
    expect(unreadOffer('yes', answer)).toEqual({
      why: expect.stringContaining('"Want me to push and open the PR?"') as string,
      steps: ['push', 'pr'],
    });
    expect(grantOf('yes', 'Merge Linesmith#53?')).toEqual(NO_GRANT);
    // offers.ts writes a URL only where `owner/name#n` cannot name the repository.
    expect(grantOf('yes', 'Merge https://github.com/o/r/pull/5?')).toEqual(NO_GRANT);
    expect(grantOf('yes', 'Merge #4 and https://github.com/o/r/pull/5?')).toEqual(NO_GRANT);
    expect(unreadOffer('yes', 'Tests pass.')).toBeNull();
    // A step the answer only reported is not one it offered.
    expect(unreadOffer('yes', 'Pushed. Opened #12.\nWant me to fix the lint?')).toBeNull();
    expect(unreadOffer('thanks', answer)).toBeNull();
  });

  test.each([
    'yes',
    'Yep.',
    'ok',
    'sure',
    'go ahead',
    'do it',
    'yes please',
    'ok, go ahead',
    'lgtm',
  ])('%s is a yes', (text) => expect(isReply(text)).toBe(true));
  test.each(['looks good', 'yes but wait', 'ok, ship it', 'great', ''])('%s is not', (text) =>
    expect(isReply(text)).toBe(false),
  );
});

describe('holds', () => {
  test.each<[string, string, ReturnType<typeof holdOf>]>([
    ["don't push yet", '', { step: 'push', how: 'declined' }],
    ['hold off on the merge', '', { step: 'merge', how: 'declined' }],
    ["don't merge or release", '', { step: 'merge', how: 'declined' }],
    ['not yet', 'Merge #5?', { step: 'merge', how: 'declined' }],
    ['no', 'Push `feat/x` to `origin` and open a pull request?', { step: 'push', how: 'declined' }],
    ['not yet', 'Tests pass.', null],
    ['not yet', 'Should I merge #41?', { step: 'merge', how: 'declined' }],
    ['nope', 'Want me to push?', { step: 'push', how: 'declined' }],
    ['no worries, rename the helper', 'Merge #316?', null],
    ['wait here', 'Push `fix/x` to `origin`?', { step: 'push', how: 'declined' }],
    ['wait a sec', 'Should I merge #41?', { step: 'merge', how: 'declined' }],
    [
      'not yet, fix the release notes',
      'Push `fix/x` to `origin`?',
      { step: 'push', how: 'declined' },
    ],
    ["don't reply yet", '', { step: 'comment', how: 'declined' }],
    ['while we wait on that, plan the next bit', 'Merge #5?', null],
    ['anything else before we ship?', '', { step: 'push', how: 'mentioned' }],
    ['file the bead then ship', '', { step: 'push', how: 'mentioned' }],
    ['what did the merge change?', '', { step: 'merge', how: 'mentioned' }],
    ['fix the test', '', null],
    ['ship it', '', null],
  ])('%s ‹after› %s', (text, before, hold) => {
    expect(holdOf(text, before)).toEqual(hold);
  });

  test.each<[string, boolean, boolean]>([
    ['not yet', true, true],
    ["don't push", true, false],
    ["don't merge it yet", true, true],
    ['hold the release', true, true],
    ['anything else before we merge?', true, true],
    ['anything else before we ship?', true, false],
    ['merge it', false, false],
    ['fix the test', false, false],
    ['nvm', true, true],
    ['scratch that', true, true],
    ['abort', true, true],
    ['stop the epic', true, true],
    ['wait here', true, true],
    ['fix the test. Stop.', true, true],
    ['no problem, also fix the lint', false, false],
    // Read generously: each costs a question, where a missed decline costs a push.
    ['Use Node 20. nvm use 20.', true, true],
    ['Abort handling is fixed. What next?', true, true],
    ["don't", true, true],
    ["please don't", true, true],
    ['wait a sec', true, true],
    ['stop please', true, true],
    ['sorry, wait', true, true],
    ['actually, please stop', true, true],
    ['stop working on this', true, true],
    ['cancel please', true, true],
    ['halt', true, true],
    ['ok,wait', true, true],
    ['I agree, but wait a minute', true, true],
    ['looks fine but wait', true, true],
    ['No. Fix the push test first', true, true],
    // Mid-sentence, a hold word takes nothing back: 161 of 7,422 real messages hold one.
    ["I don't think you are looking at the right tab", false, false],
    ["It's fine, just continue, I'll rotate later", false, false],
    ["don't forget the tests", false, false],
    ["don't worry about the lint", false, false],
    ['no rush, also fix the lint', false, false],
    ['Does it wait? yes, it does', false, false],
    ['cancel that', true, true],
    ['hold off for a bit', true, true],
    ['nothing else for now', false, false],
    ['stop-gap fix for the parser', false, false],
    ['wait, rename the helper first', true, true],
    ['While we wait on that lets plan out our next bit of work', false, false],
  ])('%s: drops %s, ends a standing merge %s', (text, drops, ends) => {
    expect(dropsGrant(text)).toBe(drops);
    expect(endsReady(text)).toBe(ends);
  });

  test('names the steps a message mentions', () => {
    expect(stepsNamed('ship it, then merge and publish')).toEqual(['push', 'merge', 'release']);
    expect(stepsNamed('open a draft PR and get it approved')).toEqual(['pr', 'approve']);
    expect(stepsNamed('the PR looks fine')).toEqual([]);
  });
});

describe('an epic job', () => {
  test.each([
    ['do epic cpl-12', 'cpl-12'],
    ['Ok, lets run the epic CPL-12 as drafts.', 'CPL-12'],
    ['/pr-kit:do-epic cpl-x1y2.3', 'cpl-x1y2.3'],
    ['/do-epic cpl-12', 'cpl-12'],
  ])('%s', (text, epic) => expect(mandateOf(text)).toBe(epic));

  test.each([
    "don't do epic cpl-12 yet",
    'do epic cpl-12 after lunch',
    'what does do epic cpl-12 do?',
  ])('%s starts none', (text) => expect(mandateOf(text)).toBeNull());

  test('a hold ends the job; anything else leaves it running', () => {
    const job = { epic: 'cpl-12' };
    expect(mandateAfter(job, 'not yet')).toBeNull();
    expect(mandateAfter(job, 'fix the test')).toEqual(job);
    expect(mandateAfter(job, 'no worries, rename the helper')).toEqual(job);
    expect(mandateAfter(job, 'do epic cpl-13')).toEqual({ epic: 'cpl-13' });
  });
});
