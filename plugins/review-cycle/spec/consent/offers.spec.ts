import { describe, expect, test } from 'vitest';

import { NO_GRANT } from '../../hooks/consent/consent';
import { grantOf } from '../../hooks/consent/exact';
import { offerQuestion } from '../../hooks/consent/offers';

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
    [
      { step: 'push', branch: 'fix/x' },
      'Push `fix/x` to `origin`?',
      { push: 'push', pushNamed: ['fix/x'] },
    ],
    [
      { step: 'force-push', branch: 'fix/x' },
      'Force-push `fix/x` to `origin` with a lease?',
      { push: 'lease' },
    ],
    [
      { step: 'push-pr', branch: 'fix/x' },
      'Push `fix/x` to `origin` and open a pull request?',
      { push: 'push', pushNamed: ['fix/x'], pr: true },
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
    [
      { step: 'release', version: 'v0.25.0' },
      'Release `v0.25.0`?',
      { release: true, releaseNamed: ['v0.25.0'], push: 'push', pushNamed: ['tag:v0.25.0'] },
    ],
    [
      { step: 'release', version: 'review-cycle@0.27.0' },
      'Release `review-cycle@0.27.0`?',
      {
        release: true,
        releaseNamed: ['review-cycle@0.27.0'],
        push: 'push',
        pushNamed: ['tag:review-cycle@0.27.0'],
      },
    ],
    [
      { step: 'release', versions: ['pr-kit@0.6.1', 'pr-watch@0.9.0', 'review-cycle@0.39.0'] },
      'Release `pr-kit@0.6.1`, `pr-watch@0.9.0` and `review-cycle@0.39.0`?',
      {
        release: true,
        releaseNamed: ['pr-kit@0.6.1', 'pr-watch@0.9.0', 'review-cycle@0.39.0'],
        push: 'push',
        pushNamed: ['tag:pr-kit@0.6.1', 'tag:pr-watch@0.9.0', 'tag:review-cycle@0.39.0'],
      },
    ],
    [
      { step: 'push-tag', version: 'pr-kit@0.6.1' },
      'Push the `pr-kit@0.6.1` tag?',
      { push: 'push', pushNamed: ['tag:pr-kit@0.6.1'] },
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

const errorOf = (input: unknown) => {
  const o = offerQuestion(input);
  return 'error' in o ? o.error : '';
};

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
    [{ step: 'release', versions: ['v1', 'v1'] }],
    [{ step: 'release', versions: ['v1', 'v2`'] }],
    [{ step: 'release', versions: 'v1' }],
    [{ step: 'release', version: 'v1', versions: ['v2'] }],
    [{ step: 'release', pulls: ['289'], versions: ['v1'] }],
    [{ step: 'push-tag' }],
    [{ step: 'push-tag', versions: ['v1', 'v2'] }],
    [{ step: 'push-tag', version: '-f' }],
    [null],
  ])('%j', (input) => {
    expect(offerQuestion(input)).toHaveProperty('error');
  });

  // A caller without the schema learns the key from the refusal.
  const PULLS = 'pass pulls, a list such as ["316"] or ["owner/name#53"]';

  test.each([
    [{ step: 'merge' }],
    [{ step: 'release' }],
    [{ step: 'approve' }],
    [{ step: 'comment', pulls: ['3', '4'] }],
    [{ step: 'merge-release' }],
    [{ step: 'stack', pulls: ['3', '4'] }],
  ])('%j says where the pull requests go', (input) => {
    expect(errorOf(input)).toContain(PULLS);
  });

  test('a release with neither names both of its keys', () => {
    expect(errorOf({ step: 'release' })).toBe(
      `release needs one pull request or a version: ${PULLS}, or version`,
    );
  });

  test.each([
    [{ step: 'merge', pr: 'oakoss/oakum#395' }, 'not read: pr.'],
    [{ step: 'merge', prs: ['oakoss/oakum#395'] }, 'not read: prs.'],
    [
      { step: 'merge', pr: '395', repo: 'oakoss/oakum', pullRequests: ['395'] },
      'not read: pr, pullRequests, repo.',
    ],
    [{ step: 'merge', pulls: ['316'], pull: '316' }, 'not read: pull.'],
    [{ step: 'merge', number: 316, repository: 'o/n' }, 'not read: number, repository.'],
  ])('%j names the key it does not read, and the ones it does', (input, said) => {
    const error = errorOf(input);
    expect(error).toContain(said);
    expect(error).toContain(
      'The keys are step, pulls, branch, remote, method, operation, version, versions.',
    );
    expect(error).toContain(PULLS);
  });

  test('a key the engine sends beside the caller’s is no guess', () => {
    const sent = {
      tool: 'mcp__review-cycle__offer',
      tool_use_id: 't1',
      step: 'merge',
      pulls: ['316'],
    };
    expect(offerQuestion(sent)).toEqual({ question: 'Merge #316?' });
  });

  test('a pull request passed as a string is told to pass a list', () => {
    expect(errorOf({ step: 'merge', pulls: 'oakoss/oakum#395' })).toBe(
      'pulls must be a list of distinct pull requests, each "316" or "owner/name#53"',
    );
  });
});
