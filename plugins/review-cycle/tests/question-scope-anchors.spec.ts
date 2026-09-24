// A leg asked to find a way past a guard always finds one, so the review
// skill keeps guard questions inside what the guard claims to cover.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('the review skill keeps a question about a guard inside its stated scope', () => {
  const text = skillText('review');
  expect(text).toContain("Keep a question about a guard inside the guard's stated scope.");
  expect(text).toContain('not whether a leg can evade it');
  expect(text).toContain('A gap an ordinary command falls into');
  expect(text).toContain('whether or not the documentation lists it');
});
