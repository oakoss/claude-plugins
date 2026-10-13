import { describe, expect, test } from 'vitest';

import {
  grantOf,
  holdOf,
  holdsOf,
  liftsHold,
  NAMED_ELSEWHERE,
  NO_GRANT,
  VERB_FORMS,
} from './consent';

const NONE = NO_GRANT;
const COMMIT = { ...NONE, commit: true };
const PUSH = { ...NONE, push: 'push' };
const BOTH = { ...COMMIT, push: 'push' };
const LEASE = { ...NONE, push: 'lease' };
const BARE = { ...NONE, push: 'bare' };
// A pull request grants no push of its own: the gate judges the push it needs.
const PR = { ...NONE, pr: true };
const PUSH_PR = { ...PUSH, pr: true };
const COMMIT_PR = { ...COMMIT, pr: true };
const SHIP = { ...BOTH, pr: true };

const MERGE = { ...NONE, merge: true };
// A merge request that names its pull requests: "merge 116".
const merging = (...named: string[]) => ({ ...MERGE, mergeNamed: named });
const AUTO = { ...NONE, autoMerge: true };
const autoNamed = (...numbers: string[]) => ({ ...AUTO, readyNamed: numbers });
const APPROVE = { ...NONE, approve: true };
const RELEASE = { ...NONE, release: true };
const REPLY = { ...NONE, comment: true };

describe('merges, approvals, releases and review replies', () => {
  const cases: [string, object][] = [
    ['merge it', MERGE],
    ['Ok, merge the PR', MERGE],
    ['Can we merge 73?', merging('73')],
    // A closing "first" orders the step; elsewhere it is an ordinal.
    ['Lets merge 168 first then start on cpl-mm6y', merging('168')],
    ['merge it first please', MERGE],
    ['release it first', RELEASE],
    ['merge the first PR', NONE],
    ['merge the first', NONE],
    ['approve the first', NONE],
    ["don't merge it first", NONE],
    // A condition auto-merge waits on grants only `gh pr merge --auto`.
    ['lets merge it when its ready', AUTO],
    ["Let's merge it when it's ready.", AUTO],
    ['merge 132 once CI passes', autoNamed('132')],
    ['merge it when the checks pass', AUTO],
    ['merge the PR once it is green', AUTO],
    ['merge it after CI is green', AUTO],
    ['merge it as soon as checks pass', AUTO],
    ['merge when ready', AUTO],
    ['ok, merge it if CI passes, thanks', AUTO],
    ['go ahead and merge it when its ready', AUTO],
    ['merge it when the PR is ready to merge please', AUTO],
    ['merge it once the tests go green', AUTO],
    // The rest of the sentence may wait on the same condition.
    ['merge it when its ready, then release it', AUTO],
    ['merge it when its ready, and delete the branch', AUTO],
    ['merge it once CI passes, push the docs', AUTO],
    ['merge it once CI passes; then push', AUTO],
    ['push it, then merge it when its ready', { ...PUSH, autoMerge: true }],
    // A later hold or condition still withholds the whole sentence.
    ["merge 132 when it's ready, but hold off", NONE],
    ["merge 132 when it's ready, if Bob approves", NONE],
    ["merge 132 when it's ready, but don't do it yet", NONE],
    // "as soon as" withholds what follows like any other condition word.
    ['merge it as soon as I say so, then release it', NONE],
    // "As soon as you can" means now, where it ends the sentence.
    ['commit it as soon as you can', COMMIT],
    ['commit it as soon as you can, then push it', NONE],
    ['push it as soon as possible', PUSH],
    ['push it as soon as you can review it', NONE],
    ["merge it when it's ready, but I'll check first", NONE],
    ['squash and merge it when ready', NONE],
    ['merge it when I say its ready', NONE],
    ['merge it once Bob says the PR is ready', NONE],
    ['merge it unless CI passes', NONE],
    ['merge it until CI passes', NONE],
    // Merging before the checks pass is merging now.
    ['merge it before the checks pass', MERGE],
    ['merge it before CI finishes', MERGE],
    ['merge it before I say so', NONE],
    ['merge it before the checks fail', NONE],
    // The agent finishing its own work is a condition it sees come true.
    ['merge it when you are done', MERGE],
    ['merge 130 when you are done', merging('130')],
    ["push it when you're done", PUSH],
    ['open a PR once you are finished', PR],
    ['release it when you are done with it', RELEASE],
    ['approve it when you are done', APPROVE],
    // Only where it ends the sentence: before another clause it may lead that one.
    ['push it when you are done, then merge it', NONE],
    ['push it when you are done, merge it', NONE],
    ['merge it when you are done, and release is approved', NONE],
    ['push it -- when you are done, merge it', NONE],
    ['push it / when you are done, merge it', NONE],
    ['merge #130 when you are done', merging('130')],
    ['push it when I am done', NONE],
    ['push it when you are done with the tests', NONE],
    ['when you are done, push it', NONE],
    ['commit it. When you are done, push it.', COMMIT],
    // Another condition beside it still withholds the step.
    ['merge it when you are done and I say so', NONE],
    ['merge it when you are done, and I say so', NONE],
    ['push it when you are done and the tests pass', NONE],
    ['release it when you are done, then wait for my ok', NONE],
    ['merge 130 if CI passes before the tests finish', NONE],
    ['push it as soon as I can', NONE],
    ['merge it before the review completes', NONE],
    ['push it when you are done with review', NONE],
    // Only a comma or a sentence's end closes the condition.
    ['push it when you are done then merge it', NONE],
    ['push it when you are done and merge it', NONE],
    ['merge it when you are done and release is approved', NONE],
    ['only when you are done, merge it', NONE],
    ['please when you are done, push it', NONE],
    ['commit it and when you are done push it', NONE],
    ['looks good\nwhen you are done, merge it', NONE],
    ['looks good: when you are done, merge it', NONE],
    ["push it when you're done.", PUSH],
    ['push it: when you are done, merge it', NONE],
    ['push it - when you are done, merge it', NONE],
    ['push it (when you are done, merge it)', NONE],
    ['commit it: when you are done, merge 130', NONE],
    ['push it and when you are done, merge it', NONE],
    ['push it [when you are done, merge it]', NONE],
    ['push it and only when you are done, merge 130', NONE],
    ['fix the test and push it when you are done', PUSH],
    // What follows must itself be a request.
    ['merge it when you are done, I want to merge it myself', NONE],
    ['merge 130 when you are done, and I commit the changes', NONE],
    ['merge it when you are done, then wait for Bob to merge it', NONE],
    ['push it when you are done, and the reviewer may merge it', NONE],
    ['commit it when you are done, then please push it', NONE],
    ['commit it when you are done but push it', NONE],
    ['push it as soon as possible tomorrow', NONE],
    ['merge it as soon as CI passes when you are done', NONE],
    ['push it when you are done, and merge 130', NONE],
    ['push it after you are done', PUSH],
    // Any other condition is one the gate cannot see come true.
    ['merge it when I say so', NONE],
    ['merge it after I review it', NONE],
    ['merge it when its ready and then start the next one', NONE],
    ["don't merge it when it's ready", NONE],
    // A readiness condition may lead, as "merge it once it's ready" trails.
    ['when its ready, merge it', AUTO],
    ['Ok, once PR 133 is ready lets merge it', autoNamed('133')],
    ['when CI passes, merge it', AUTO],
    ['When the checks pass, lets merge #132.', autoNamed('132')],
    ['as soon as CI is green, merge it', AUTO],
    ['once it is ready, then merge it', AUTO],
    // Any other leading condition withholds the whole prompt.
    ["once it's ready, push it", NONE],
    ['once I say so, merge it', NONE],
    ['if CI fails, merge it', NONE],
    ["once it's ready, merge it and push", NONE],
    ["once it's ready, merge it, but hold off", NONE],
    ["once it's ready, push it. commit it", NONE],
    // The whole condition counts, and nothing beside the merge is granted.
    ['when it is ready to merge, merge it', AUTO],
    ['once its ready to merge merge it', AUTO],
    ['when it is ready to merge. merge it when I say so', NONE],
    ["once it's ready, release it, merge it", NONE],
    ["once it's ready, push it, merge it", NONE],
    // Declining the merge it waits for asks for nothing; the rest still counts.
    ["once it's ready, do not merge it. Push it.", PUSH],
    ["commit it. once it's ready, do not merge it", COMMIT],
    ["once it's ready, don’t merge it. Push it.", PUSH],
    ['merge 130 when its ready. once its ready, do not merge it', NONE],
    ["merge it. once it's ready, don't merge it. Push it.", PUSH],
    ["merge 130. once it's ready, don't merge it", NONE],
    // A semicolon's "then" continues the declined sentence and waits with it.
    ['once its ready, do not merge it; then push it', NONE],
    ["release it. once it's ready, do not merge it", NONE],
    ["once it's ready, don't merge it? push it", NONE],
    ["once it's ready, merge it. Push it.", { ...PUSH, autoMerge: true }],
    ["once it's ready, should I merge it? Push it.", NONE],
    // A condition naming a pull request names the one merged.
    ['once PR 133 is ready, merge 134', NONE],
    ['merge 134 once PR 133 is ready', NONE],
    ['once PR 133 is ready, merge 133', autoNamed('133')],
    // With no number and no offer, a ready merge names no pull request.
    ['merge it when its ready', AUTO],
    ['commit it when the tests pass', NONE],
    ['push it once CI is green', NONE],
    ['approve it when its ready', NONE],
    ['merge main into it when its ready', NONE],
    // A local `git merge`, which the push checks judge when it is pushed.
    ['merge main into it', NONE],
    ['merge origin/main into the branch', NONE],
    ['merge 116 into main', merging('116')],
    ['merge 116 into main please', merging('116')],
    ['merge the PR into main', MERGE],
    ['merge it into the main branch', MERGE],
    // A merge into the base with nothing named merges this branch's pull request.
    ['merge into main', MERGE],
    ['merge now into main', MERGE],
    ['merge into later', NONE],
    ['merge that into main', NONE],
    // A merge into anything but the base names a local merge.
    ['merge 116 into feature-x', NONE],
    ['merge this into the PR', NONE],
    ['merge it into the branch', NONE],
    ['merge it from main', NONE],
    ['address the comments', NONE],
    // "push on" carries on; it asks for nothing.
    ['Good, push on.', NONE],
    ['commit on it', NONE],
    ['approve it', APPROVE],
    ['approve the PR and merge it', { ...APPROVE, merge: true }],
    ['release it', RELEASE],
    ['cut a release', RELEASE],
    // Merging the version pull request is the release.
    ['Ok, lets merge the release', RELEASE],
    ['merge the version PR', RELEASE],
    ['merge the release PR', RELEASE],
    ['merge the version packages pull request', RELEASE],
    ['merge the release now', RELEASE],
    ['merge the version PR #140', RELEASE],
    ["don't merge the release yet", NONE],
    // Only where the noun ends the request: anything else names other work.
    ['merge the release branch into main', NONE],
    ['merge the release into main', NONE],
    ['merge the release PR branch into main', NONE],
    ['merge the release-please branch', NONE],
    ['merge the version changes', NONE],
    ['merge the release fixes', NONE],
    ['merge the release #3 fixes', NONE],
    ['merge the version 2 PR', RELEASE],
    ['merge the version 2.0 PR', RELEASE],
    ['merge the version v2 PR now', RELEASE],
    // A destination after "now" names a local merge of a version branch.
    ['merge version 2.0 now into main', NONE],
    ['merge the version PR now into main', NONE],
    ['merge version 2.0 now please into main', NONE],
    ['merge version 2.0 now thanks into main', NONE],
    ['merge the version PR now to main', NONE],
    ['merge the release then to main', NONE],
    ['merge the release now against main', NONE],
    // A period inside a number keeps it one word, which names no pull request.
    ['merge 130.5', NONE],
    ['merge it.2', NONE],
    ['merge the release 3.5', NONE],
    ['ok, publish the new release', RELEASE],
    ['the release notes look good', NONE],
    ['publish it', RELEASE],
    ['ok, publish to npm', RELEASE],
    ['publish the package', RELEASE],
    ['publish to crates', RELEASE],
    ['publish the docs to the wiki', NONE],
    ['publish the package to npm', RELEASE],
    ['release the package', RELEASE],
    // Pushing a package publishes it, and asks for no git push.
    ['push to npm', RELEASE],
    ['push it to npm', RELEASE],
    ['push the package', RELEASE],
    ['push to crates', RELEASE],
    ['pushing the package', NONE],
    // A file or host that only starts with the noun is git work.
    ['push the package.json change', NONE],
    ['push the crates.io token', NONE],
    ['commit the package', NONE],
    // Publishing git work pushes it: "Publish branch" is an editor's first push.
    ['publish the branch', PUSH],
    ['publish the PR to github', PR],
    ['publish the PR', PR],
    ['publish the PR description', NONE],
    ['publish the changes', PUSH],
    ['publish the branch to github and open a PR', PUSH_PR],
    ['publish to origin', PUSH],
    ['publishing the branch', NONE],
    ['publish the docs to github', NONE],
    ['publish the changes as a PR comment', NONE],
    ['publish the changes now as a PR comment', NONE],
    ['publish changes.md', NONE],
    ['publish the PR.md', NONE],
    ['publish the PR review', NONE],
    ['publish the branch now', PUSH],
    ['publish the branch, then open a PR', PUSH_PR],
    ['publish to github pages', NONE],
    ['publish them', RELEASE],
    ['publish all packages', RELEASE],
    ['publish my package to npm', RELEASE],
    ['commit, push and publish it as well', { ...BOTH, release: true }],
    ['publish on npm', RELEASE],
    ['publish it to the registry', RELEASE],
    ['publish it to our registry', RELEASE],
    ['publish it to my registry', RELEASE],
    ['publish to the npm registry', RELEASE],
    ['publish to it', NONE],
    ['publish to the', NONE],
    ['publish to github', PUSH],
    ['mark it ready for review', PR],
    ['mark the PR as ready', PR],
    ['ok, ready for review', PR],
    ['address the review comments', REPLY],
    ['reply to the reviewer', REPLY],
    ['address the PR feedback and push', { ...REPLY, push: 'push' }],
    ['address the TODO comments in the code', NONE],
    // Shipping stops at the pull request.
    ['ship it', SHIP],
  ];
  test.each(cases)('%s', (prompt, grant) => {
    expect(grantOf(prompt)).toEqual(grant);
  });
  test('a yes to an offered merge or release grants it', () => {
    expect(grantOf('yes', 'Merge #116 now?')).toEqual(merging('116'));
    // An offer's closing "first" stays unread until offers read every condition (cpl-pakf).
    expect(grantOf('yes', 'Should I merge #168 first, but only if CI passes?')).toEqual(NONE);
    expect(grantOf('yes', 'Should I cut the release?')).toEqual(RELEASE);
    // In an offer, "when you are done" waits on the user.
    expect(grantOf('yes', 'Should I merge it when you are done?')).toEqual(NONE);
    expect(grantOf('yes', 'Shall I merge 130 as soon as you can?')).toEqual(NONE);
    expect(grantOf('yes', 'Publish `review-cycle@0.25.0` to npm?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Should I mark #119 ready for review?')).toEqual(PR);
  });
  test('a mention of publishing or of a ready pull request holds', () => {
    expect(holdsOf('did it publish?')).toBe(true);
    expect(holdsOf('push to npm')).toBe(false);
    expect(holdsOf('push to pypi')).toBe(true);
    expect(grantOf('yes', 'Should I publish #119?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Should I publish it to the npm registry?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Publish `x@1` to the registry?')).toEqual(RELEASE);
    expect(holdsOf('is it ready for review?')).toBe(true);
    expect(holdsOf('publish it')).toBe(false);
    expect(liftsHold(grantOf('publish it'))).toBe(true);
  });
  // The questions the gate's refusals give the agent to ask (register.ts GH_ASK).
  test.each([
    ['Merge #116?', merging('116')],
    // An agent told to put names in backticks may backtick the number too.
    ['Merge `#116`?', merging('116')],
    ['Merge `#116` into `main` now?', merging('116')],
    ['Merge #116 into main now?', merging('116')],
    ['Approve #116?', APPROVE],
    // A bare version's dots end sentences; backticked, it names what is released.
    ['Release `v0.25.0`?', RELEASE],
    ['Reply to the review on #116?', REPLY],
    ['Merge and release #62?', { ...merging('62'), release: true }],
    ['Merge the version-packages PR?', RELEASE],
  ])('a yes to the refusal\'s "%s" grants it', (question, grant) => {
    expect(grantOf('yes', question)).toEqual(grant);
    expect(holdsOf('not yet', question)).toBe(true);
  });
  // A branch merged into the base is a local merge, not a pull request's.
  test.each([
    'Merge `fix/x` into `main`?',
    'Merge `feature` into `main` now?',
    'Merge `fix/x` into main now?',
    'Merge `v0.25.0` into main now?',
    'Merge fix/x into main?',
    'Merge `fix/x` to main now?',
    'Should I merge fix/x against the base please?',
  ])('a yes to "%s" grants no merge', (question) => expect(grantOf('yes', question)).toEqual(NONE));
  test.each([
    ['Should I respond to the review on #116?', REPLY],
    ['Should I respond to the comments?', NONE],
    ['Should I reply to the comments?', NONE],
    ['Should I address the review on #116?', REPLY],
    ['Should I cut a release on 116?', RELEASE],
    ['Should I cut a release of the crate?', RELEASE],
    ['Should I ship it from fix/x?', NONE],
  ])('a yes to "%s" grants exactly that', (question, grant) => {
    expect(grantOf('yes', question)).toEqual(grant);
  });
  // An offer's verb in its -ing form: "Shall I go ahead with pushing?".
  test.each([
    ['pushing', PUSH],
    ['opening a PR', PR],
    ['merging #116', merging('116')],
    ['approving #116', APPROVE],
    ['cutting a release', RELEASE],
    ['publishing to npm', RELEASE],
    ['marking it ready for review', PR],
    ['addressing the review', REPLY],
    ['replying to the review', REPLY],
    ['responding to the review', REPLY],
    ['releasing the crate', RELEASE],
    ['merging the version PR', RELEASE],
  ])('a yes to going ahead with %s grants it', (offer, grant) => {
    expect(grantOf('yes', `Shall I go ahead with ${offer}?`)).toEqual(grant);
  });
  test('each verb form belongs to one family and is a word the grammar reads', () => {
    expect(new Set(VERB_FORMS).size).toBe(VERB_FORMS.length);
    for (const form of VERB_FORMS) expect(form).toMatch(/^[a-z0-9'-]+$/);
  });
  test('an approval or a reply does not lift a hold; a merge does', () => {
    expect(liftsHold(grantOf('approve it'))).toBe(false);
    expect(liftsHold(grantOf('address the review comments'))).toBe(false);
    expect(liftsHold(grantOf('merge it'))).toBe(true);
    expect(liftsHold(grantOf('release it'))).toBe(true);
  });
  test.each([
    "don't merge yet",
    'did the merge go through?',
    'the release notes look good',
    'no need to approve it',
  ])('%s holds', (prompt) => {
    expect(holdsOf(prompt)).toBe(true);
  });
  test.each([
    ['Anything else before we merge?', '', { step: 'merge', how: 'mentioned' }],
    ['did the push go through?', '', { step: 'push', how: 'mentioned' }],
    ['is it ready for review?', '', { step: 'pr', how: 'mentioned' }],
    ['the release notes look good', '', { step: 'release', how: 'mentioned' }],
    ['no need to approve it', '', { step: 'approve', how: 'mentioned' }],
    ['not yet', 'Should I push `fix/x` to `origin`?', { step: 'push', how: 'declined' }],
    ['hold off', 'Merge #116 now?', { step: 'merge', how: 'declined' }],
    ['not yet', 'Merge #116 and delete the branch?', { step: 'merge', how: 'declined' }],
    ['not yet', 'Push and open a PR?', { step: 'pr', how: 'declined' }],
    ['wait', 'Reply to the review on #116?', { step: 'comment', how: 'declined' }],
    ['merge it', '', null],
    ['not yet', 'Should I rename the helper?', null],
  ])('"%s" after "%s" holds for %j', (prompt, offer, reason) => {
    expect(holdOf(prompt, offer)).toEqual(reason);
  });
  test('"not yet" to an offered merge holds; a merge request does not', () => {
    expect(holdsOf('not yet', 'Merge #116 now?')).toBe(true);
    expect(holdsOf('merge it')).toBe(false);
  });
  test('a merge once it is ready lifts a hold, and an offer of one grants it on a yes', () => {
    expect(holdsOf('lets merge it when its ready')).toBe(false);
    expect(liftsHold(grantOf('lets merge it when its ready'))).toBe(true);
    expect(holdsOf('merge it when I say so')).toBe(true);
    expect(holdsOf('not yet', 'Should I merge #132 when its checks pass?')).toBe(true);
    expect(holdsOf('wait', 'Should I merge #132 once CI passes?')).toBe(true);
    expect(grantOf('yes', 'Should I merge #132 when its checks pass?')).toEqual(autoNamed('132'));
    // An offer that names its pull request only before the question.
    expect(grantOf('yes', 'Opened #46.\nShould I merge it once CI passes?')).toEqual(
      autoNamed('46'),
    );
    expect(grantOf('yes', 'Pushed #46 and #47.\nMerge it once CI passes?')).toEqual(autoNamed('?'));
    // A ready merge's numbers never name a merge now.
    expect(grantOf('merge 46, and merge 62 once CI passes')).toMatchObject({
      mergeNamed: ['46'],
      readyNamed: ['62'],
    });
    expect(grantOf('yes', 'Merge #116 now?')).toEqual(merging('116'));
  });
});

describe('grants on a request', () => {
  const cases: [string, object][] = [
    ['commit it', COMMIT],
    ['Ok, commit it', COMMIT],
    ['commit all of them', COMMIT],
    ['please commit this', COMMIT],
    ['Can you commit this?', COMMIT],
    ['go ahead and commit', COMMIT],
    ['looks good, commit', COMMIT],
    ['push it', PUSH],
    ['ship it', SHIP],
    ['Ok, lets ship', SHIP],
    ['commit and push', BOTH],
    ['push it first', PUSH],
    ['commit it first, then push', BOTH],
    ["Commit it. Don't push.", COMMIT],
    ['I want you to commit this', COMMIT],
    ['can you push?', PUSH],
    ['Could you commit and push?', BOTH],
    ['will you push?', PUSH],
    ['can we commit this?', COMMIT],
    ["fix the test that doesn't pass and commit it", COMMIT],
    ['fix the handler so it never crashes and commit', COMMIT],
    ['remove the no-op check and commit', COMMIT],
    ['commit the code and open a PR', COMMIT_PR],
    ['open a PR, but not until CI passes', NONE],
    ['push the tag', PUSH],
    ['push the v1 tag', PUSH],
    ['push tag 0.2.0', PUSH],
    ['push the v1 tags', PUSH],
    ['push v1', NONE],
    ['push tag 0.2.0 but not yet', NONE],
    ['push tag 0.2.0 when CI passes', NONE],
    ['push tag v1.2.0', PUSH],
    ['push it.2 more to go', NONE],
    // A period before a letter still ends a sentence, so a condition after it counts.
    ['done.if CI passes, push it', NONE],
    ['fixed.not yet, push it', NONE],
    ['push it from main', NONE],
    ['open a pull request', PR],
    ['create a new draft PR', PR],
    ['push it and create a draft PR against main', PUSH_PR],
    ['Please open the PR into main', PR],
    ['Please open the PR into `later`', NONE],
    ['open the file', NONE],
    // What a pull request is "for" can be a time ("for tonight"), so the grammar
    // leaves it to the agent to ask.
    ['open a PR for the docs', NONE],
    ['create a test for the PR', NONE],
    ["it's not committed yet, commit it", COMMIT],
    ["commit it with the message 'fix: parser'", COMMIT],
    ['push the commits to origin', PUSH],
    ['yes, commit everything and push it up', BOTH],
    ['No problem, commit it', COMMIT],
    ['this looks good, commit it', COMMIT],
    ['fix the parser, then commit', COMMIT],
    ['Ok, we can delete the branch', PUSH],
    ['delete the remote branch', PUSH],
    ['Ok, we can ship', SHIP],
    ['Ok, we can push', PUSH],
    ['commit; then push', BOTH],
    ['fix it; then push', PUSH],
    ['I fixed it. Then please push it.', PUSH],
    ["I won't commit. Then please push it.", PUSH],
    ["we're done; then push it", PUSH],
    ['we commit; then push. Then push it.', PUSH],
    ['Ok we can push', PUSH],
    ['I want you to commit separately and push', PUSH],
    ['fix the handler so it never crashes and commit', COMMIT],
  ];
  for (const [prompt, want] of cases) {
    test(prompt, () => {
      expect(grantOf(prompt)).toEqual(want);
    });
  }
});

// Real user prompts that mention commit or push without asking for one.
describe('grants nothing on a mention', () => {
  const cases = [
    "What's the point of the commit gate? Do we really need a commit gate? I've hand instance where claude code would just commit for no reason or commit before we can run reviews.",
    "No, the commit isn't the problem, pushing would hurt but that can be handled with local changes and a push with force-with-lease. What really gets me is agents would just commit changes without going through the review cycle and that would give me doubt if the code is of good quality.",
    "Reviews shouldn't be needed on ever turn. I think before doing a commit is the best time and it keeps the review churn down.",
    'Essential I want the agents to go off be agentic as needed and before committing changes run the reviews needed if needed. But they would skip reviews or marked as reviewed then commit.',
    "don't commit yet",
    "no, don't commit",
    'hold off on committing',
    'do not push',
    'before you commit, run the tests',
    'never push to main',
    'what does the last commit do?',
    'the commit message is wrong',
    'why did it push?',
    "I'll commit it myself",
    'I will push it later',
    'why does git commit hang here?',
    'how do I commit a submodule change',
    'is it ready to commit',
    'explain what git push --force-with-lease does',
    'check whether this is safe to push',
    'deploy failed:\n$ git push origin main\nrejected',
    'if CI is green, push',
    'when the tests pass, commit',
    'if it is green push it',
    'Don’t push',
    "don't you ever push",
    'commit message looks off',
    'call constructor now',
    'commit? no',
    'push it if CI is green',
    'commit and push unless CI fails',
    'commit it once the tests pass',
    'as soon as CI is green, push',
    "I'm going to push",
    'will you push? no wait',
    "I didn't ask you to commit",
    "I don't want you to push yet",
    'I never told you to push anything',
    "Please don't go ahead and push",
    'I did not want you to commit that',
    'not yet, commit later',
    'not now; commit it later',
    'hold off, push tomorrow',
    "we'll commit tomorrow",
    'Please review commit and push handling.',
    'check push and commit logic',
    'push the button in the UI',
    'commit to this approach',
    "let's commit to this",
    'commit it later',
    'commit the parser changes separately',
    'we push it',
    "I'll review it first, then push",
    "I'll fix the typo, and push",
    'They review, then commit',
    'Agents review each diff, and then commit',
    'The workflow is: review, then commit, then push.',
    "Here's the flow:\n1. review\n2. commit\n3. push\nThoughts on it?",
    'The phases are\n* review\n* commit\n* push',
    '**Commit**',
    'Fix the tests, so we can push.',
    'delete the file',
    'i commit and push',
    'we commit; then push',
    "I'll commit; then push",
    'we commit; then review; then push',
    'we commit; then push; then push it',
    'we commit and push',
    'i always commit and push',
    'normally commit and then push',
    'delete it',
    'delete the branch file',
    'Ok, we can push later',
    'ok, CI is green, we can push',
    'ok, we will push',
    'ok, we push',
    'CI is green, we can ship.',
    'so the plan is: review and then commit',
    'usually I review and then commit',
    'normally we review and then push',
    'in this repo agents review then commit',
    'ok the flow is review then commit',
    "don't push yet, but commit it",
    "commit it and I'll push later",
    'Use this commit message: "release notes\npush to origin"',
    "Commit and push, but not until I've checked the diff",
    'push it but not now',
    'Push it, but only if CI is green.',
    'commit it but only after review',
    'Push to main (after CI passes).',
    'Push it (not yet though).',
    'Commit this (if the review is clean).',
  ];
  for (const prompt of cases) {
    test(prompt.slice(0, 60), () => {
      expect(grantOf(prompt)).toEqual(NONE);
    });
  }
});

describe('an affirmative grants what the previous answer asked', () => {
  test('yes to a commit question', () => {
    expect(grantOf('yes', 'Tests pass.\nWant me to commit this?')).toEqual(COMMIT);
  });
  test('go ahead to commit-and-push', () => {
    expect(grantOf('go ahead', 'Shall I commit and push?')).toEqual(BOTH);
  });
  // Seen in another session: an offer to delete a branch by name granted
  // nothing, whatever the reply.
  test.each([
    'Should I delete feat/reference-components from origin?',
    'Should I delete `feat/reference-components` from `origin`?',
    'Delete `fix/x` from `origin`?',
    'Should I delete the remote branch?',
  ])('a reply to "%s" grants the delete', (offer) => {
    for (const reply of [
      'yes',
      'Lets delete it',
      'Delete it',
      'ok, delete that',
      'delete them',
      'delete it from origin',
    ]) {
      expect(grantOf(reply, offer)).toEqual(PUSH);
    }
  });
  test.each([
    'Delete `fix/x` from `origin` too?',
    'Want me to delete `fix/x` from `fork`?',
    'Should I delete the branch now?',
    'Should I delete branch `old` from origin?',
    'Should I delete the remote branch feat/x?',
    'Should I go ahead with deleting feat/x from origin?',
  ])('yes to "%s" grants the delete', (offer) => {
    expect(grantOf('yes', offer)).toEqual(PUSH);
  });
  test.each([
    ['Push `fix/x` to `origin`?', 'delete it'],
    ['Should I commit the fix?', 'delete it'],
    ['Should I delete the TODO comment?', 'delete it'],
    ['Should I delete the TODO comment?', 'yes'],
    ['Should I delete src/old.ts from main?', 'yes'],
    ['Should I delete the file from the branch?', 'yes'],
    ['Should I delete the branch locally?', 'yes'],
    ['Should I delete the branch later?', 'yes'],
    ['Should I delete the branch protection?', 'yes'],
    // A plain word is never read as a branch name.
    ['Should I delete branch later from origin?', 'yes'],
    ['Should I delete branch tonight from origin?', 'yes'],
    ['Should I delete branch old from origin?', 'yes'],
    ['Should I delete the branch from `main`?', 'yes'],
    ['Should I delete the branch from `CHANGELOG.md`?', 'yes'],
    ['Should I delete the branch from docs/notes.md?', 'yes'],
    ['Should I delete the branch from the review comments?', 'yes'],
    ['Should I delete the branch locally?', 'delete it'],
    ['Delete `fix/x` from `origin`?', 'delete it, meaning the TODO comment'],
    ['', 'delete it'],
  ])('to "%s", "%s" deletes no branch', (offer, reply) => {
    expect(grantOf(reply, offer)).toEqual(NONE);
  });
  test('a delete beside another offer leaves that offer as it reads', () => {
    expect(grantOf('yes', 'Should I delete the stale test and open a PR from `fix/x`?')).toEqual(
      PR,
    );
  });
  test('a merge request names the pull requests it names, across its sentences', () => {
    expect(grantOf('merge 131 and 132')).toEqual(merging('131', '132'));
    expect(grantOf('merge #131 and then #132')).toEqual(merging('131', '132'));
    expect(grantOf('merge 131. merge 132 too')).toEqual(merging('131', '132'));
    expect(grantOf('merge it')).toEqual(MERGE);
  });
  // "merge it" covers any pull request, unless the message or the offer it
  // answers points elsewhere.
  test.each([
    ['merge it; do not merge 130', '', merging(NAMED_ELSEWHERE)],
    ['merge it, only 131', '', merging(NAMED_ELSEWHERE)],
    ['merge it, but leave the version PR', '', merging(NAMED_ELSEWHERE)],
    ['merge it', 'Merge #131? #130 is the version PR, which releases.', merging('131')],
    ['merge it', 'Should I merge #131 or #130?', merging(NAMED_ELSEWHERE)],
    [
      'lets merge it',
      'All checks pass on #130 and #134.\n\nRelease by merging #130?',
      merging('130'),
    ],
    ['merge it', 'CI is green.', MERGE],
    ['merge it', 'Merge PR 131? #130 is the version PR.', merging('131')],
    ['merge it', '#131 is green and ready.\n\nWant me to merge it?', merging('131')],
    ['merge it', '#130 is ready to merge. Say merge it.', merging('130')],
    ['yes', 'Merge it? Is this #131 or #130?', merging(NAMED_ELSEWHERE)],
    ['yes', 'Want me to merge it?', MERGE],
    ['merge it', '#134 merged. Merge the version PR?', MERGE],
    ['merge it', 'Merged #134.\nThe version PR is green.\nMerge it to release?', MERGE],
    ['merge it', '#131 is green. The version PR is separate. Merge it?', merging('131')],
    ['merge it', '#134 is green. Merge it before the release?', merging('134')],
  ])('"%s" after "%s" names %j', (prompt, offer, grant) => {
    expect(grantOf(prompt, offer)).toEqual(grant);
  });
  test('a delete names the branch as what goes, then at most where from', () => {
    expect(grantOf('delete the branch from origin')).toEqual(PUSH);
    expect(grantOf('delete the file')).toEqual(NONE);
    expect(grantOf('delete it from the branch')).toEqual(NONE);
    expect(grantOf('delete the branch comments')).toEqual(NONE);
  });
  // Seen in another session: "Ok, lets do that" granted nothing.
  const offer = 'Should I update the PR body, then merge #16 and delete the branch?';
  test.each([
    'Ok, lets do that',
    "Let's do it.",
    'let’s do this',
    'ok, do that',
    'sounds good, go ahead',
    'great, go ahead',
    'yes, lets go',
    'ok yes, do it please',
    'perfect, lets do it, thanks',
  ])('"%s" answers the offer', (reply) => {
    expect(grantOf(reply, offer)).toEqual({ ...merging('16'), push: 'push' });
    expect(holdsOf(reply, offer)).toBe(false);
  });
  test.each([
    'great',
    'looks good',
    'ok great',
    'yes, looks good',
    "ok, let's do that later",
    "don't do that",
    'lets do that for the other PR',
    'ok, lets do that after lunch',
  ])('"%s" does not', (reply) => {
    expect(grantOf(reply, offer)).toEqual(NONE);
  });
  // pr-kit's fix-ci asks this question verbatim, and its anchor pins the wording.
  test("yes to fix-ci's question grants the push", () => {
    expect(grantOf('yes', 'Should I commit and push the fixes?')).toEqual(BOTH);
  });
  test('yes to an unrelated question', () => {
    expect(grantOf('yes', 'Should I rename the helper?')).toEqual(NONE);
  });
  test('a statement that mentions commit is not a question', () => {
    expect(grantOf('ok', 'I did not commit anything.')).toEqual(NONE);
  });
  test('yes to a question about holding off', () => {
    expect(grantOf('yes', 'Should I hold off on committing until CI passes?')).toEqual(NONE);
  });
  test('yes to a question after a statement that mentions push', () => {
    expect(grantOf('yes', 'I will not push. Want me to run the tests?')).toEqual(NONE);
  });
  // The gate's refusal asks the agent to name what it pushes and where.
  test('yes to a push question that names the branch grants the push', () => {
    expect(grantOf('yes', 'Fixed.\nPush fix/x to origin?')).toEqual(PUSH);
    expect(grantOf('yes', 'Push `fix/x` to origin?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should I push feat/ask-in-prose to origin?')).toEqual(PUSH);
    expect(grantOf('yes', 'Push fix/x and open the PR?')).toEqual(PUSH_PR);
    expect(grantOf('yes', 'Open a PR from `fix/x` into `main`?')).toEqual(PR);
    expect(grantOf('yes', 'Push feat/a/b to origin/feat/a/b?')).toEqual(PUSH);
    expect(grantOf('yes', 'Push `fix/x` to `origin`?')).toEqual(PUSH);
    expect(grantOf('yes', 'Push `ask-in-prose` to `origin`?')).toEqual(PUSH);
    expect(grantOf('yes', 'Committed on fix/x. Push?')).toEqual(PUSH);
    expect(grantOf('yes', 'Done in src/a.ts. Want me to push?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should I rename src/a.ts?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we push fix/x to main?')).toEqual(PUSH);
  });
  test('a yes to an either/or question takes the first alternative', () => {
    expect(grantOf('yes', 'Should I push, or would you rather/prefer to do it?')).toEqual(PUSH);
    expect(grantOf('yes', 'Want me to push, or skip/defer it?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should I push, or would you `rather/prefer` do it?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should I push, or would you `rather` do it?')).toEqual(PUSH);
    expect(grantOf('yes', 'Want me to push, or run it in your `terminal`?')).toEqual(PUSH);
    expect(grantOf('yes', "Should I push, or can't we `skip` it as 'deferred'?")).toEqual(PUSH);
    expect(grantOf('yes', "I'd rather not force-push. Should I push, or you'd do it?")).toEqual(
      PUSH,
    );
    expect(grantOf('yes', "That's rather slow. Should I push, or you'd prefer to?")).toEqual(PUSH);
    expect(grantOf('yes', "I've committed it. Should I push?")).toEqual(PUSH);
    expect(grantOf('yes', 'Push `fix/x` to `origin`?')).toEqual(PUSH);
  });
  test('a first alternative that hands the step back still grants nothing', () => {
    expect(grantOf('yes', 'Would you rather push it yourself, or should I?')).toEqual(NONE);
    expect(grantOf('yes', 'Should I leave it to you, or push it?')).toEqual(NONE);
    expect(grantOf('yes', 'Do you want to push it from your `terminal`, or should I?')).toEqual(
      NONE,
    );
    // Without a comma, "or" lists what the question offers.
    expect(grantOf('yes', 'Should I merge #130 or #131?')).toEqual(NONE);
    // The first alternative is the user's, so the yes takes nothing.
    expect(grantOf('yes', 'Do you want to push it, or should I instead?')).toEqual(NONE);
    expect(grantOf('yes', 'Do you want to merge #130, or should I instead?')).toEqual(NONE);
    expect(grantOf('yes', 'Rather than wait, should I push?')).toEqual(NONE);
    expect(grantOf('yes', 'Instead of merging, should I push?')).toEqual(NONE);
    // Only the first ", or" splits, and only a question offers.
    expect(grantOf('yes', 'Should I commit, or commit and push, or wait?')).toEqual(COMMIT);
    expect(grantOf('yes', 'Push it, or not.')).toEqual(NONE);
    expect(grantOf('yes', 'Should I push, or not.')).toEqual(NONE);
    // The agent has to be the one doing the first alternative's steps.
    expect(
      grantOf('yes', 'Should I commit, and you push it, or should I do both instead?'),
    ).toEqual(NONE);
    expect(
      grantOf(
        'yes',
        'Do you want to push it, and have me open a PR, or should I do it all instead?',
      ),
    ).toEqual(NONE);
    // A line without a closing mark stays its own sentence.
    expect(grantOf('merge it', 'Merged #134\nMerge #130?')).toEqual(merging('130'));
    expect(grantOf('merge it', '#134 merged\nMerge the version PR?')).toEqual(MERGE);
    expect(
      grantOf('yes', 'PR #131 is ready.\nPR #130 is the version PR\nShould I merge it?'),
    ).toEqual(merging(NAMED_ELSEWHERE));
    expect(
      grantOf('merge it', 'Should I merge it, or leave #130 for later? Anything else?'),
    ).toEqual(MERGE);
    // A statement's alternatives name nothing, and a semicolon "or" splits as a comma does.
    expect(grantOf('yes', 'I can merge #130, or #131. Should I merge it?')).toEqual(
      merging(NAMED_ELSEWHERE),
    );
    expect(grantOf('merge it', 'Should I merge #131; or leave #130 for later?')).toEqual(
      merging('131'),
    );
    // The pull request merged is the one the kept alternative offers.
    expect(grantOf('yes', 'PR #131 is ready. Should I merge it, or leave #130 for later?')).toEqual(
      merging('131'),
    );
  });
  test('a quoted destination in a user message is not a push target', () => {
    expect(grantOf('push this to `next sprint`', '')).toEqual(NONE);
    expect(grantOf('push it to "later"', '')).toEqual(NONE);
  });
  test('yes to deleting a path is not a push', () => {
    expect(grantOf('yes', 'Should I delete src/old.ts?')).toEqual(NONE);
    expect(grantOf('yes', 'Delete scratch/tmp?')).toEqual(NONE);
    expect(grantOf('yes', 'Want me to delete the fix/x branch?')).toEqual(PUSH);
  });
  test('yes to a push question grants the push only', () => {
    expect(grantOf('yes', 'Should I push?')).toEqual(PUSH);
    expect(grantOf('yes', 'Merged. Want me to delete the branch?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should I go ahead with deleting the branch?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should we commit and push?')).toEqual(BOTH);
    expect(grantOf('yes', 'Should we commit, then push?')).toEqual(BOTH);
    expect(grantOf('yes', 'Should I fix it, then push?')).toEqual(PUSH);
    // A question about how the work goes offers it too: a yes agrees to it.
    expect(grantOf('yes', 'Do we commit, then push?')).toEqual(BOTH);
    expect(grantOf('yes', 'Do we commit; then push?')).toEqual(BOTH);
    expect(grantOf('yes', 'Should we commit; then push?')).toEqual(BOTH);
    expect(grantOf('yes', "I'll leave the docs alone; should I push?")).toEqual(PUSH);
    expect(grantOf('yes', 'Should I commit and push; or wait?')).toEqual(BOTH);
    expect(grantOf('yes', 'Can we commit, then push?')).toEqual(BOTH);
    expect(grantOf('yes', 'We commit, then push?')).toEqual(BOTH);
    expect(grantOf('yes', 'Should we push?')).toEqual(PUSH);
    expect(grantOf('yes', 'Do we push to main?')).toEqual(PUSH);
    // Whether main is protected is unchecked, so a yes doesn't answer it.
    expect(grantOf('yes', 'Can we push to main, or is it protected?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we push to main?')).toEqual(PUSH);
    expect(grantOf('yes', 'Did we push it?')).toEqual(NONE);
    expect(grantOf('yes', 'Why do we push to main?')).toEqual(NONE);
    // Only a commit or push, and only "do we", "can we" or "we": other "we"
    // questions about a merge, release or PR still need "should we".
    expect(grantOf('yes', 'Do we merge to main?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we merge #130?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we release?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we open a PR?')).toEqual(NONE);
    expect(grantOf('yes', 'Should we merge #130?')).toEqual(merging('130'));
    expect(grantOf('yes', 'Do we like force-pushing?')).toEqual(NONE);
    expect(grantOf('yes', 'Would we push to main?')).toEqual(NONE);
    // Only the whole question in one of those shapes: anything more asks something else.
    expect(grantOf('yes', 'We push to main, right?')).toEqual(NONE);
    expect(grantOf('yes', 'We merge #130, right?')).toEqual(NONE);
    expect(grantOf('yes', "We push to main, don't we?")).toEqual(NONE);
    expect(grantOf('yes', 'We push to main right?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we commit and open a PR?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we commit, then merge #130?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we push and merge?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we push --force?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we push to main, or does it require a PR?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we push to main, or to a branch?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we always push to main?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we commit?')).toEqual(COMMIT);
    expect(grantOf('yes', 'We commit?')).toEqual(COMMIT);
    expect(grantOf('yes', 'Can we push to tomorrow?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we commit or push?')).toEqual(NONE);
    expect(grantOf('yes', 'Could we push?')).toEqual(NONE);
    // Read in the agent's own words: a backticked option is not "it", and a quoted example is no offer.
    expect(grantOf('yes', 'Can we push `--dry-run` to main?')).toEqual(NONE);
    expect(grantOf('yes', 'Here is the template:\n"\nDo we commit, then push?\n"')).toEqual(NONE);
    // An agent's own offer with a question beside it still offers.
    expect(grantOf('yes', 'Should I push, or is CI still running?')).toEqual(PUSH);
    expect(grantOf('yes', 'Should we push, or would you rather do it?')).toEqual(NONE);
    expect(grantOf('yes', 'Should I delete it?')).toEqual(NONE);
  });
  test('yes after a statement, not a question, grants nothing', () => {
    expect(grantOf('yes', 'Ready to push. Run the tests?')).toEqual(NONE);
  });
  test('yes to a closing question about committing', () => {
    expect(grantOf('yes', 'Tests pass.\nShould I go ahead with committing?')).toEqual(COMMIT);
  });
  test('yes to a question handing the action back grants nothing', () => {
    for (const q of [
      'Would you rather commit this yourself?',
      'Do you want to push it yourself from your terminal?',
      'Should I skip the commit and leave it to you?',
      'Should I leave the commit to you?',
    ]) {
      expect(grantOf('yes', q)).toEqual(NONE);
    }
  });
  test('yes to a bare offer', () => {
    expect(grantOf('yes', 'Commit it?')).toEqual(COMMIT);
    expect(grantOf('yes', 'Want me to commit these changes and open the PR?')).toEqual(COMMIT_PR);
    expect(grantOf('yes', 'Shall I go ahead with shipping it?')).toEqual(SHIP);
    expect(grantOf('yes', 'Commit the changes to `fix/x`?')).toEqual(COMMIT);
  });
  test('yes to an offer that commits to something else grants nothing', () => {
    expect(grantOf('yes', 'Should I commit to the new layout?')).toEqual(NONE);
  });
  test('no previous answer', () => {
    expect(grantOf('sure')).toEqual(NONE);
  });
});

describe('a force push has to be named', () => {
  test.each([
    ['force push it', LEASE],
    ['ok, force-push it to origin', LEASE],
    ['force push it with a lease', LEASE],
    ['force push it without a lease', BARE],
    ['bare force push it', BARE],
    ['force push it with `--force`', BARE],
    ['force push it with `--force-with-lease`', LEASE],
    ['push it', PUSH],
    ['push it with --force', BARE],
    ['push --force', BARE],
    ['push it with `--force`', BARE],
    ["don't force push", NONE],
    ['force push it. never mind', NONE],
    ['force push it, but not until CI passes', NONE],
    ['open a PR. bare force push it. no wait, never mind. force push it', { ...LEASE, pr: true }],
    // A bare force mentioned outside the clause that asks grants none.
    ['force push it. never do a bare force though', LEASE],
    ['force push it. The hook refused `--force` earlier', LEASE],
    ['Force push it with a lease. Do not use `--force`.', LEASE],
    ['force push it. Do not use --force.', LEASE],
    ['force push it, without a lease', BARE],
    ['commit it with --force', COMMIT],
    ['commit it without a lease', COMMIT],
    ['commit and push it with a message `--force`', BOTH],
    ['push it. force push it with --force, but not until CI passes', PUSH],
  ])('%s', (prompt, grant) => {
    expect(grantOf(prompt)).toEqual(grant);
  });
  test('yes to an offer to force push grants what it named', () => {
    expect(grantOf('yes', 'Force-push `fix/x` to `origin` with a lease?')).toEqual(LEASE);
    expect(grantOf('yes', 'Force-push `fix/x` without a lease?')).toEqual(BARE);
    expect(grantOf('yes', 'Push `fix/x` to `origin`?')).toEqual(PUSH);
    expect(grantOf('yes', 'Shall I go ahead with force pushing `fix/x`?')).toEqual(LEASE);
    expect(grantOf('yes', 'Force-push `fix/x`, without a lease?')).toEqual(BARE);
    expect(grantOf('yes', 'Push it with a message: `--force`?')).toEqual(PUSH);
  });
  test("the agent's own mention of a bare force does not grant one", () => {
    const offers = [
      'The bare `--force` was refused by the gate. Force-push `fix/x` to `origin` with a lease?',
      "I won't use `--force`. Force-push `fix/x` to `origin` with a lease?",
      'A plain push would be rejected without a lease check.\nForce-push `fix/x` to `origin` with a lease?',
      'Force-push `fix/x` with a lease? A bare force would overwrite their work.',
      'Force-push `fix/x` to `origin` with a lease, not a bare `--force`?',
    ];
    for (const offer of offers) expect(grantOf('yes', offer), offer).toEqual(LEASE);
  });
});

describe('holds', () => {
  test.each([
    "don't push yet",
    "don't commit or push yet",
    'Can you commit it without pushing?',
    "let's not push yet",
    'did the push fail?',
    'no need to open a PR',
    'push it, but no need to open a PR',
    'Anything else before we ship?',
    'This script pushes automatically.',
    'Has this shipped yet?',
    'open a PR. do not push.',
  ])('%s holds', (prompt) => {
    expect(holdsOf(prompt)).toBe(true);
  });
  test.each([
    'push it',
    'ship it',
    'open a PR',
    'commit it',
    "don't commit yet",
    'rename the helper',
    'Lets merge PR 113',
    'run review-pr on it',
    "the message says 'don't push'",
  ])('%s holds nothing', (prompt) => {
    expect(holdsOf(prompt)).toBe(false);
  });
  test('not yet holds an offered push or PR', () => {
    expect(holdsOf('not yet, rename the helper first', 'Push `fix/x` to `origin`?')).toBe(true);
    expect(holdsOf('not yet', 'Open a PR from `fix/x` into `main`?')).toBe(true);
    expect(holdsOf('not yet', 'Should I rename the helper?')).toBe(false);
  });
});

describe('a retraction cancels the sentence it retracts', () => {
  test.each([
    // Re-asked: the sentences before the retracted one stand.
    ['open a PR. push it. never mind. merge it', { ...PR, merge: true }],
    ['commit it. bare force push it. no wait. force push it', { ...COMMIT, push: 'lease' }],
    ['open a PR. push it. thanks. never mind. merge it', { ...PR, merge: true }],
    ['open a PR. push it, but hold off. never mind. merge it', { ...PR, merge: true }],
    ['commit it. open a PR. never mind. push it. never mind. merge it', { ...COMMIT, merge: true }],
    ['open a PR. commit it. never mind. push it', PUSH_PR],
    ['open a PR. push it. never mind. commit it', COMMIT_PR],
    ['open a PR. finish the rebase. never mind. push it', PUSH_PR],
    ['open a PR. push it. never mind. finish the rebase', { ...PR, finish: ['rebase'] }],
    ['open a PR. push it. Never mind. merge it', { ...PR, merge: true }],
    ['open a PR. push it. no, don’t. merge it', { ...PR, merge: true }],
    // After a semicolon a retraction cancels everything.
    ['open a PR. push it; then merge it. never mind. commit it', COMMIT],
    ['open a PR. I fixed the tests; push it. never mind. commit it', COMMIT],
    ['push it, but hold off; never mind; then push it', PUSH],
    ['we push it; never mind; then merge it', MERGE],
    // So does one followed by anything but a request.
    ['Merge it. Release it. No. None of that. Commit it.', COMMIT],
    ['Merge it. Release it. No wait. Forget everything. Commit it.', COMMIT],
    ['Merge it. Release it. No. Never mind. Commit it.', COMMIT],
    // A retraction that says more than its cue words cancels everything.
    ['open a PR. push it. never mind. merge it. no wait, none of that. push it', PUSH],
    ['merge it. push it. no wait, don’t merge. push it', PUSH],
    ["merge it. push it. no wait, don't merge. push it", PUSH],
    ['merge it. push it. never mind the merge. push it', PUSH],
    ['merge #12. open a PR. scratch that, forget everything. push it', PUSH],
    ['open a PR. push it. no wait, none of that. merge it', MERGE],
    ['release it. open a PR. no wait, not the release. open a PR', PR],
    ['open a PR. push it. never mind; commit it', COMMIT_PR],
    ['open a PR. push it. never mind. merge it, but hold off. commit it', COMMIT],
    ['open a PR. push it. never mind. merge it, but not yet. commit it', COMMIT],
    // Nothing asked after it: everything before it is cancelled.
    ['open a PR. push it. never mind', NONE],
    ['open a PR. push it. never mind. thanks', NONE],
    ['open a PR. push it. never mind, merge it', NONE],
    ['open a PR. never mind. push it. never mind', NONE],
    ['open a PR. never mind. push it', PUSH],
  ])('%s', (prompt, grant) => {
    expect(grantOf(prompt)).toEqual(grant);
  });
});

// One case per cue word, each the only cue in its message, so dropping a word
// from its list fails here rather than passing behind a neighbour. AGREE_WORD's
// yep has none: REQUEST_LEAD lacks it, so no message reaches it.
describe('each cue word counts on its own', () => {
  test.each([
    'no',
    'nope',
    'wait',
    'never mind',
    'nevermind',
    'scratch that',
    'hold on',
    'actually no',
    "actually, don't",
  ])('push it. %s: retracts the push', (cue) => {
    expect(grantOf(`push it. ${cue}`)).toEqual(NONE);
  });
  test.each(['not yet', 'not now', 'hold off', 'hold on', 'wait', "don't yet"])(
    '%s: holds an offered push',
    (cue) => {
      expect(holdsOf(cue, 'Should I commit and push?')).toBe(true);
    },
  );
  test.each(['if', 'when', 'once', 'after', 'unless', 'until', 'as soon as'])(
    'commit it. push it, %s CI is green: grants nothing',
    (cue) => {
      expect(grantOf(`commit it. push it, ${cue} CI is green`)).toEqual(NONE);
    },
  );
  test.each([
    'ok',
    'okay',
    'alright',
    'yes',
    'yeah',
    'yep',
    'sure',
    'great',
    'cool',
    'perfect',
    'lgtm',
    'sounds good',
    'looks good',
  ])('%s, we can push it: answers', (cue) => {
    expect(grantOf(`${cue}, we can push it`)).toEqual(PUSH);
  });
  test.each(['ok', 'okay', 'alright', 'yes', 'yeah', 'sure', 'great', 'cool', 'perfect', 'lgtm'])(
    '%s we can push it: answers',
    (cue) => {
      expect(grantOf(`${cue} we can push it`)).toEqual(PUSH);
    },
  );
  test.each([
    'the',
    'a',
    'an',
    'this',
    'that',
    'these',
    'those',
    'our',
    'my',
    'their',
    'its',
    "it's",
    'it',
    'there',
    'here',
  ])('%s tests pass and push it: describes', (cue) => {
    expect(grantOf(`${cue} tests pass and push it`)).toEqual(NONE);
  });
  test.each([
    'is',
    'are',
    'was',
    'were',
    'i',
    'we',
    'they',
    'he',
    'she',
    'agents',
    'agent',
    'claude',
    'usually',
    'normally',
    'typically',
    'always',
    'often',
    'sometimes',
    'generally',
  ])('CI %s slow, then push it: describes', (cue) => {
    expect(grantOf(`CI ${cue} slow, then push it`)).toEqual(NONE);
  });
  // These also withhold their sentence; only a question lets a following
  // "; and" sentence grant.
  test.each(['when', 'which', 'who', 'should', 'whether'])(
    '%s did you push it; and push it: asks, then grants',
    (cue) => {
      expect(grantOf(`${cue} did you push it; and push it`)).toEqual(PUSH);
    },
  );
  test.each([
    'why',
    'how',
    'what',
    'where',
    'is',
    'are',
    'was',
    'does',
    'do',
    'did',
    'has',
    'have',
    'explain',
  ])('%s that, push it: asks', (cue) => {
    expect(grantOf(`${cue} that, push it`)).toEqual(NONE);
  });
  test.each([
    "don't",
    'not',
    'never',
    'no',
    "didn't",
    "won't",
    "can't",
    'cannot',
    "shouldn't",
    "wouldn't",
    "doesn't",
    "i'll",
    "i'm",
    "i've",
    "we'll",
    "we're",
    'they',
    'he',
    'she',
    'agent',
    'agents',
    'claude',
    'who',
    'which',
    'might',
    'should',
  ])('push it, %s review: withholds the sentence', (cue) => {
    expect(grantOf(`push it, ${cue} review`)).toEqual(NONE);
  });
  test.each(['whether', 'if', 'unless', 'when', 'once', 'until', 'before', 'after', 'without'])(
    'CI green %s ready and push it: conditional',
    (cue) => {
      expect(grantOf(`CI green ${cue} ready and push it`)).toEqual(NONE);
    },
  );
  test.each(['yourself', "you'd", 'rather', 'skip', 'leave', 'instead', 'terminal'])(
    'yes after an offer naming %s: hands back',
    (cue) => {
      expect(grantOf('yes', `Should I push it ${cue}?`)).toEqual(NONE);
    },
  );
});

const finish = (...ops: string[]) => ({ ...NONE, finish: ops });

describe('finishing a history command', () => {
  test.each([
    ['finish the rebase', finish('rebase')],
    ['ok, continue the merge please', finish('merge')],
    ['complete the cherry-pick', finish('cherry-pick')],
    ['finish the cherry pick', finish('cherry-pick')],
    ['continue this revert', finish('revert')],
    ['finish the rebase and push it', { ...finish('rebase'), push: 'push' }],
    ['finish the rebase. push it.', { ...finish('rebase'), push: 'push' }],
    ['finish the rebase and continue the merge', finish('rebase', 'merge')],
    ['finish our rebase', finish('rebase')],
    ['continue that cherrypick', finish('cherry-pick')],
    ['finish the current merge', finish('merge')],
    ['continue with the rebase', finish('rebase')],
    ['finish up the rebase', finish('rebase')],
    ['carry on with the cherry-pick', finish('cherry-pick')],
    ['continue rebasing', finish('rebase')],
    ['resume the revert', finish('revert')],
  ])('%j asks for that --continue, not a commit', (prompt, grant) => {
    expect(grantOf(prompt)).toEqual(grant);
  });
  test.each([
    "don't finish the rebase yet",
    "I'll finish the rebase",
    'finish the rebase once CI passes',
    'should I finish the rebase?',
    'finish the rebase docs',
    ...['rebase', 'merge', 'cherry-pick', 'revert'].map(
      (op) => `when CI passes, finish the ${op}, then merge it`,
    ),
  ])('%j grants nothing', (prompt) => {
    expect(grantOf(prompt)).toEqual(NONE);
  });
  test("a history merge is not a pull request's", () => {
    expect(grantOf('continue the merge').merge).toBe(false);
    expect(holdsOf('continue the merge')).toBe(false);
  });
  test('yes to an offer to finish grants it', () => {
    expect(grantOf('yes', 'Should I finish the rebase?')).toEqual(finish('rebase'));
    expect(grantOf('yes', 'Should I go ahead with continuing the merge?')).toEqual(finish('merge'));
    expect(grantOf('yes', 'Commit the resolution to `fix/x` and finish the revert?')).toEqual(
      finish('revert'),
    );
    expect(grantOf('yes', 'Should I continue the rebase on `fix/x`?')).toEqual(finish('rebase'));
  });
  test.each(['continue', 'ok continue', 'yes, continue', 'go on', 'carry on', 'keep going'])(
    '%j answers an offer to finish with that finish alone',
    (reply) => {
      expect(grantOf(reply, 'Should I continue the rebase?')).toEqual(finish('rebase'));
      expect(grantOf(reply, 'Should I finish the merge and push?')).toEqual(finish('merge'));
    },
  );
  test.each([
    ['finish the merge of #12', ''],
    ['continue the revert of #12', ''],
    ['yes', 'Should I continue merging #12 and #13?'],
  ])('%j names a pull request, not a --continue', (prompt, offer) => {
    expect(grantOf(prompt, offer).finish).toEqual([]);
  });
  test.each([
    'continue merging PR 131',
    'continue merging the other PRs',
    "don't resume the merge of PR #12",
    "don't continue with the merge of PR #12",
    "don't carry on with the merge of the PRs",
  ])('%j grants no finish and still holds the merge', (prompt) => {
    expect(grantOf(prompt).finish).toEqual([]);
    expect(holdsOf(prompt)).toBe(true);
  });
  test("a merge of pull requests still holds when it isn't asked for", () => {
    expect(holdsOf("don't continue merging the PRs yet")).toBe(true);
  });
  test.each(['continue', 'keep going', 'go on'])('%j answers nothing else', (reply) => {
    expect(grantOf(reply)).toEqual(NONE);
    expect(grantOf(reply, 'Should I push `fix/x`?')).toEqual(NONE);
    expect(grantOf(reply, 'Should I commit it?')).toEqual(NONE);
  });
});
