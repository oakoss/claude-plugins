// Every review loads the whole skill into the session, so its size is a cost
// paid on each one; the ceiling keeps the prune from growing back unnoticed.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('the review skill stays within its budget', () => {
  const text = skillText('review-cycle', 'review');
  expect(text.length).toBeLessThanOrEqual(62_000);
  expect(text.split('\n').length).toBeLessThanOrEqual(500);
});
