import { describe, expect, test } from 'vitest';

import { grantOf, holdsOf, liftsHold, NO_GRANT, VERB_FORMS } from './consent';

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
const APPROVE = { ...NONE, approve: true };
const RELEASE = { ...NONE, release: true };
const REPLY = { ...NONE, comment: true };

describe('merges, approvals, releases and review replies', () => {
  const cases: [string, object][] = [
    ['merge it', MERGE],
    ['Ok, merge the PR', MERGE],
    ['Can we merge 73?', MERGE],
    ['lets merge it when its ready', NONE],
    // A local `git merge`, which the push checks judge when it is pushed.
    ['merge main into it', NONE],
    ['merge origin/main into the branch', NONE],
    ['merge 116 into main', MERGE],
    ['merge the PR into main', MERGE],
    ['merge it into the main branch', MERGE],
    // A merge into anything but the base names a local merge.
    ['merge into main', NONE],
    ['merge now into main', NONE],
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
    ['ok, publish the new release', RELEASE],
    ['the release notes look good', NONE],
    ['publish it', RELEASE],
    ['ok, publish to npm', RELEASE],
    ['publish the package', RELEASE],
    ['publish to crates', RELEASE],
    ['publish the docs to the wiki', NONE],
    ['publish the package to npm', RELEASE],
    ['release the package', RELEASE],
    // Package words belong to a publish: "push to npm" asks for no git push.
    ['push to npm', NONE],
    ['push the package', NONE],
    ['commit the package', NONE],
    // "Publish branch" is an editor's first push, not a release.
    ['publish the branch', NONE],
    ['publish the PR to github', NONE],
    ['publish the changes', NONE],
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
    ['publish to github', NONE],
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
    expect(grantOf('yes', 'Merge #116 now?')).toEqual(MERGE);
    expect(grantOf('yes', 'Should I cut the release?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Publish `review-cycle@0.25.0` to npm?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Should I mark #119 ready for review?')).toEqual(PR);
  });
  test('a mention of publishing or of a ready pull request holds', () => {
    expect(holdsOf('did it publish?')).toBe(true);
    expect(holdsOf('push to npm')).toBe(true);
    expect(grantOf('yes', 'Should I publish #119?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Should I publish it to the npm registry?')).toEqual(RELEASE);
    expect(grantOf('yes', 'Publish `x@1` to the registry?')).toEqual(RELEASE);
    expect(holdsOf('is it ready for review?')).toBe(true);
    expect(holdsOf('publish it')).toBe(false);
    expect(liftsHold(grantOf('publish it'))).toBe(true);
  });
  // The questions the gate's refusals give the agent to ask (register.ts GH_ASK).
  test.each([
    ['Merge #116?', MERGE],
    ['Approve #116?', APPROVE],
    // A bare version's dots end sentences; backticked, it names what is released.
    ['Release `v0.25.0`?', RELEASE],
    ['Reply to the review on #116?', REPLY],
    ['Merge and release #62?', { ...MERGE, release: true }],
  ])('a yes to the refusal\'s "%s" grants it', (question, grant) => {
    expect(grantOf('yes', question)).toEqual(grant);
    expect(holdsOf('not yet', question)).toBe(true);
  });
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
    ['merging #116', MERGE],
    ['approving #116', APPROVE],
    ['cutting a release', RELEASE],
    ['publishing to npm', RELEASE],
    ['marking it ready for review', PR],
    ['addressing the review', REPLY],
    ['replying to the review', REPLY],
    ['responding to the review', REPLY],
    ['releasing the crate', RELEASE],
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
  test('"not yet" to an offered merge holds; a merge request does not', () => {
    expect(holdsOf('not yet', 'Merge #116 now?')).toBe(true);
    expect(holdsOf('merge it')).toBe(false);
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
    ['push the v1 tag', NONE],
    ['push it from main', NONE],
    ['open a pull request', PR],
    ['create a new draft PR', PR],
    ['push it and create a draft PR against main', PUSH_PR],
    ['Please open the PR into main', PR],
    ['Please open the PR into `later`', NONE],
    ['open the file', NONE],
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
    expect(grantOf('yes', 'Do we push fix/x to main?')).toEqual(NONE);
  });
  test('a slash joining hand-back words still hands the push back', () => {
    expect(grantOf('yes', 'Should I push, or would you rather/prefer to do it?')).toEqual(NONE);
    expect(grantOf('yes', 'Want me to push, or skip/defer it?')).toEqual(NONE);
  });
  test('quoting a hand-back word still hands the push back', () => {
    expect(grantOf('yes', 'Should I push, or would you `rather/prefer` do it?')).toEqual(NONE);
    expect(grantOf('yes', 'Should I push, or would you `rather` do it?')).toEqual(NONE);
    expect(grantOf('yes', 'Want me to push, or run it in your `terminal`?')).toEqual(NONE);
    expect(grantOf('yes', "Should I push, or can't we `skip` it as 'deferred'?")).toEqual(NONE);
    expect(grantOf('yes', "I'd rather not force-push. Should I push, or you'd do it?")).toEqual(
      NONE,
    );
    expect(grantOf('yes', "That's rather slow. Should I push, or you'd prefer to?")).toEqual(NONE);
    expect(grantOf('yes', "I've committed it. Should I push?")).toEqual(PUSH);
    expect(grantOf('yes', 'Push `fix/x` to `origin`?')).toEqual(PUSH);
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
    expect(grantOf('yes', 'Do we commit, then push?')).toEqual(NONE);
    expect(grantOf('yes', 'Do we commit; then push?')).toEqual(NONE);
    expect(grantOf('yes', 'Should we commit; then push?')).toEqual(BOTH);
    expect(grantOf('yes', "I'll leave the docs alone; should I push?")).toEqual(PUSH);
    expect(grantOf('yes', 'Should I commit and push; or wait?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we commit, then push?')).toEqual(NONE);
    expect(grantOf('yes', 'We commit, then push?')).toEqual(NONE);
    expect(grantOf('yes', 'Should we push?')).toEqual(PUSH);
    expect(grantOf('yes', 'Do we push to main?')).toEqual(NONE);
    expect(grantOf('yes', 'Can we push to main, or is it protected?')).toEqual(NONE);
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
    ['open a PR. bare force push it. no wait, never mind. force push it', LEASE],
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
