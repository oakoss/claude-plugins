import { describe, expect, test } from 'vitest';

import { grantOf, grantOfAnswers } from './consent';

const NONE = { commit: false, push: false };
const COMMIT = { commit: true, push: false };
const PUSH = { commit: false, push: true };
const BOTH = { commit: true, push: true };

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
    ['ship it', BOTH],
    ['Ok, lets ship', BOTH],
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
    ['commit the code and open a PR', COMMIT],
    ["commit it with the message 'fix: parser'", COMMIT],
    ['push the commits to origin', PUSH],
    ['yes, commit everything and push it up', BOTH],
    ['No problem, commit it', COMMIT],
    ['this looks good, commit it', COMMIT],
    ['fix the parser, then commit', COMMIT],
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
    'Can we merge 73?',
    "don't commit yet",
    'do not push',
    "no, don't commit",
    'hold off on committing',
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
    'push --force',
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
    'CI is green, we can ship.',
    'so the plan is: review and then commit',
    'usually I review and then commit',
    'normally we review and then push',
    'in this repo agents review then commit',
    'ok the flow is review then commit',
    "don't push yet, but commit it",
    "commit it and I'll push later",
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
  test('yes to a push question grants the push only', () => {
    expect(grantOf('yes', 'Should I push?')).toEqual(PUSH);
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
  test('a declined verb in one dialog answer wins over a grant in another', () => {
    expect(
      grantOfAnswers({
        'Commit and push this?': 'Yes',
        'Push now, or keep it local for now?': 'Keep it local',
      }),
    ).toEqual(COMMIT);
    expect(grantOfAnswers({ 'Commit the change?': 'Review, then commit (Recommended)' })).toEqual(
      COMMIT,
    );
  });
  test('yes to a bare offer', () => {
    expect(grantOf('yes', 'Commit it?')).toEqual(COMMIT);
    expect(grantOf('yes', 'Want me to commit these changes and open the PR?')).toEqual(COMMIT);
  });
  test('yes to an offer that commits to something else grants nothing', () => {
    expect(grantOf('yes', 'Should I commit to the new layout?')).toEqual(NONE);
  });
  test('no previous answer', () => {
    expect(grantOf('sure')).toEqual(NONE);
  });
});
