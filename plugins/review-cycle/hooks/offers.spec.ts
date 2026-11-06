import { describe, expect, test } from 'vitest';

import { grantOf, NO_GRANT } from './consent';
import { offerQuestion } from './offers';

const question = (input: object): string => {
  const o = offerQuestion(input);
  if ('error' in o) throw new Error(o.error);
  return o.question;
};

describe('a yes to each question, ending an answer, grants exactly its step', () => {
  test.each([
    [{ step: 'merge', pulls: ['316'] }, 'Merge #316?', { merge: true, mergeNamed: ['316'] }],
    [
      { step: 'merge', pulls: ['3', '4'], method: 'squash' },
      'Squash-merge #3 and #4?',
      { merge: true, mergeNamed: ['3', '4'] },
    ],
    [
      { step: 'merge', pulls: ['oakoss/linesmith#53'] },
      'Merge oakoss/linesmith#53?',
      { merge: true, mergeNamed: ['oakoss/linesmith#53'] },
    ],
    [{ step: 'release', pulls: ['289'] }, 'Release #289?', { release: true }],
    [{ step: 'approve', pulls: ['316'] }, 'Approve #316?', { approve: true }],
    [{ step: 'comment', pulls: ['95'] }, 'Reply to the review on #95?', { comment: true }],
    [{ step: 'stack' }, 'Merge the stack?', { mergeStack: ['stack'] }],
    [{ step: 'stack', pulls: ['42'] }, 'Merge up to #42?', { mergeStack: ['upto:42'] }],
    [{ step: 'push', branch: 'fix/x' }, 'Push `fix/x` to `origin`?', { push: 'push' }],
    [
      { step: 'force-push', branch: 'fix/x' },
      'Force-push `fix/x` to `origin` with a lease?',
      { push: 'lease' },
    ],
    [
      { step: 'push-pr', branch: 'fix/x' },
      'Push `fix/x` to `origin` and open a pull request?',
      { push: 'push', pr: true },
    ],
    [{ step: 'pr' }, 'Open a pull request?', { pr: true }],
  ])('%j asks %s', (input, asked, grant) => {
    expect(question(input)).toBe(asked);
    for (const answer of [asked, `CI is green.\n\n${asked}`]) {
      for (const yes of ['yes', 'ok, go ahead']) {
        expect(grantOf(yes, answer)).toEqual({ ...NO_GRANT, ...grant });
      }
    }
  });
});

describe('an offer with no question', () => {
  test.each([
    [{ step: 'deploy' }],
    [{ step: 'merge' }],
    [{ step: 'merge', pulls: ['#316'] }],
    [{ step: 'merge', pulls: ['316'], method: 'fast-forward' }],
    [{ step: 'merge', pulls: ['316'], method: 'constructor' }],
    [{ step: 'release', pulls: ['1', '2'] }],
    [{ step: 'release' }],
    [{ step: 'approve', pulls: ['3', '4'] }],
    [{ step: 'comment' }],
    [{ step: 'comment', pulls: ['3', '4'] }],
    [{ step: 'stack', pulls: ['3', '4'] }],
    [{ step: 'merge', pulls: ['0'] }],
    [{ step: 'merge', pulls: ['3', '3'] }],
    [{ step: 'merge', pulls: ['316', 'o/n#5'] }],
    [{ step: 'merge', pulls: [316] }],
    [{ step: 'push', branch: '-f' }],
    [{ step: 'push', branch: 'fix/x', remote: '..' }],
    [{ step: 'push' }],
    [{ step: 'push', branch: 'fix/`x`' }],
    [{ step: 'push', branch: 'fix/x', remote: 'a b' }],
    [null],
  ])('%j', (input) => {
    expect(offerQuestion(input)).toHaveProperty('error');
  });
});
