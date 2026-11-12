import { describe, expect, test } from 'vitest';

import { NO_GRANT } from './consent';
import { grantOf } from './exact';
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
    [{ step: 'commit', branch: 'fix/x' }, 'Commit the changes to `fix/x`?', { commit: true }],
    [
      { step: 'finish', branch: 'fix/x', operation: 'rebase' },
      'Commit the resolution to `fix/x` and finish the rebase?',
      { finish: ['rebase'] },
    ],
    [
      { step: 'finish', branch: 'fix/x', operation: 'cherry-pick' },
      'Commit the resolution to `fix/x` and finish the cherry-pick?',
      { finish: ['cherry-pick'] },
    ],
    [
      { step: 'finish', branch: 'fix/x', operation: 'merge' },
      'Commit the resolution to `fix/x` and finish the merge?',
      { finish: ['merge'] },
    ],
    [
      { step: 'finish', branch: 'fix/x', operation: 'revert' },
      'Commit the resolution to `fix/x` and finish the revert?',
      { finish: ['revert'] },
    ],
    [{ step: 'delete', branch: 'fix/x' }, 'Delete `fix/x` from `origin`?', { push: 'push' }],
    [
      { step: 'force-push-bare', branch: 'fix/x' },
      'Force-push `fix/x` to `origin` without a lease?',
      { push: 'bare' },
    ],
    [{ step: 'stack-push' }, 'Force-push the stack with a lease?', { push: 'lease' }],
    [
      { step: 'stack-submit' },
      'Force-push the stack with a lease and open its pull requests?',
      { push: 'lease', pr: true },
    ],
    [
      { step: 'merge-release', pulls: ['62'] },
      'Merge and release #62?',
      { merge: true, mergeNamed: ['62'], release: true },
    ],
    // `owner/name#n` cannot name a repository whose name opens with a dot.
    [
      { step: 'merge', pulls: ['o/.github#5'] },
      'Merge https://github.com/o/.github/pull/5?',
      { merge: true, mergeNamed: ['o/.github#5'] },
    ],
    [
      { step: 'approve', pulls: ['.o/r#5'] },
      'Approve https://github.com/.o/r/pull/5?',
      { approve: true },
    ],
    [{ step: 'release', version: 'v0.25.0' }, 'Release `v0.25.0`?', { release: true }],
    [
      { step: 'release', version: 'review-cycle@0.27.0' },
      'Release `review-cycle@0.27.0`?',
      { release: true },
    ],
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
    [{ step: 'commit' }],
    [{ step: 'finish', branch: 'fix/x' }],
    [{ step: 'finish', branch: 'fix/x', operation: 'squash' }],
    [{ step: 'merge', pulls: ['o/-r#5'] }],
    [{ step: 'merge', pulls: ['o/...#5'] }],
    [{ step: 'delete' }],
    [{ step: 'merge-release', pulls: ['1', '2'] }],
    [{ step: 'release', pulls: ['289'], version: 'v1' }],
    [{ step: 'release', version: 'v1`; rm' }],
    [null],
  ])('%j', (input) => {
    expect(offerQuestion(input)).toHaveProperty('error');
  });
});
