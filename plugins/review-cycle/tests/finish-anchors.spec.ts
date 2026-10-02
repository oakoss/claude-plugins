// The skill is what makes a clean cycle end in a commit, or in a question when
// the user's stop-before setting stops before one, and what keeps a push
// waiting for the user's request.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('the review skill commits a clean result and pushes only on request', () => {
  const text = skillText('review');
  expect(text).toContain('commit the reviewed work now');
  expect(text).toContain('unless `mcp__review-cycle__status` reports `mayCommit` false');
  expect(text).toContain('held off a commit');
  expect(text).toContain("Push only when the user's latest message asked for one");
  expect(text).toContain('or when `mcp__review-cycle__status` reports `mayPush`');
  expect(text).toContain('After "ship it", also open the pull request');
  expect(text).toContain('open one only when the status reports `mayOpenPr`');
  expect(text).toContain(
    'The gate refuses it; ask them in your reply, naming what it pushes and where, and end your turn.',
  );
});
