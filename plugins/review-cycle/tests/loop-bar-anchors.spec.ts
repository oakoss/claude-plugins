// Pinning one more unpinned guard every iteration keeps a review from
// converging, so from iteration 2 only a finding that matters reopens the loop.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('from iteration 2, a minor finding is deferred and a broken fix is not', () => {
  const text = skillText('review');
  expect(text).toContain('From iteration 2, only a finding that matters reopens the loop.');
  expect(text).toContain("shows one of this cycle's own fixes is wrong, at any severity");
  expect(text).toContain('a test-gap rating under 7');
  expect(text).toContain('on whichever scale its leg uses');
  expect(text).toContain('A numeric rating decides over the section it is listed under');
  expect(text).toContain('a finding with no rating counts as important.');
  expect(text).toContain('a Codex `medium` or `low`');
  expect(text).toContain('leave it out of the count of applied fixes');
  expect(text).toContain("From iteration 2, also apply Phase 6's bar");
  expect(text).toContain("ask only about the guards this cycle's fixes added");
});

test('a contaminated target is attributed from the gate, Codex by elimination', () => {
  const text = skillText('review');
  expect(text).toContain("The status tool's `reviewerChanges` names each Claude reviewer command");
  expect(text).toContain('The gate never compares around the Codex leg');
  expect(text).toContain('read only the ones added since');
});
