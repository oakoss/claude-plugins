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

test('a contaminated target is attributed from the gate, Codex by elimination', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain("The status tool's `reviewerChanges` names each Claude reviewer command");
  expect(text).toContain('The gate never compares around the Codex leg');
  expect(text).toContain('read only the ones added since');
  expect(text).toContain('or could not check (a failed read)');
  expect(text).toContain('it resets at each commit, so note its count at the snapshot');
});
