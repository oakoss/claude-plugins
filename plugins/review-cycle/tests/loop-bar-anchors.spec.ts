// Pinning one more unpinned guard every iteration keeps a review from
// converging, so from iteration 1 only a finding that matters is fixed.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('from iteration 1, a minor finding is deferred and a broken fix is not', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain('From iteration 1, only a finding that matters is fixed.');
  expect(text).toContain('and so does a spec defect (Phase 4)');
  expect(text).toContain("apply the fix-vs-defer policy after Phase 6's bar, which decides first");
  expect(text).toContain("goes through Phase 6's bar and the fix-vs-defer policy");
  expect(text).toContain("shows one of this cycle's own fixes is wrong, at any severity");
  expect(text).toContain('a test-gap rating under 7');
  expect(text).toContain('on whichever scale its leg uses');
  expect(text).toContain('A numeric rating decides over the section it is listed under');
  expect(text).toContain('a finding with no rating counts as important');
  expect(text).toContain('a Codex `medium` or `low`');
  expect(text).toContain('leave it out of the count of applied fixes');
  expect(text).toContain("Apply Phase 6's bar from iteration 1");
  expect(text).toContain("ask only about the guards this cycle's fixes added");
});

// A leg confident about a rare edge case would otherwise have it fixed, and
// each such fix draws the next round's findings.
test("the bar grades a finding by the change's intent, and the summary records growth", () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain(
    "Grade every finding but one showing a fix is wrong, or a spec defect, by the change's intent first: a finding about another path than the one the change is for, a rare case, a small cost or extra compatibility is below the bar whatever its leg called it, with reason `below the bar (re-graded)`, unless it is about security or data loss.",
  );
  expect(text).toContain('Prefer the fix that deletes or narrows code');
  expect(text).toContain("`git diff --shortstat <iteration 1's spawnTree> <worktreeTree>`");
  expect(text).toContain("Growth: none | <+A -D from this cycle's fixes>");
  expect(text).toContain(
    'When `Growth:` is not `none`, your reply names the fixes that grew the diff, for the user to cut.',
  );
});

test('a contaminated target is attributed from the gate, Codex by elimination', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain("The status tool's `reviewerChanges` names each Claude reviewer command");
  expect(text).toContain('The gate never compares around the Codex leg');
  expect(text).toContain('read only the ones added since');
  expect(text).toContain('or could not check (a failed read)');
  expect(text).toContain('it resets at each commit, so note its count at the snapshot');
});
