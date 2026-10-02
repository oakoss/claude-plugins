// The gate does not ask about commits, so the skill is what makes a clean
// cycle end in a commit, and what keeps a push waiting for the user's request.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('the review skill commits a clean result and pushes only on request', () => {
  const text = skillText('review');
  expect(text).toContain('commit the reviewed work now');
  expect(text).toContain('held off a commit');
  expect(text).toContain("Push only when the user's latest message asked for one");
  expect(text).toContain('After "ship it", also open the pull request.');
  expect(text).toContain(
    'Without a request, the gate refuses the push; ask them in your reply, naming what it pushes and where, and end your turn.',
  );
});
