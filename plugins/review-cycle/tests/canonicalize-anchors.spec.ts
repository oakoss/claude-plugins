// A pre-commit hook that rewrites a file the review never formatted makes the
// commit record content no reviewer saw, so Phase 2 formats what the hook does.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('canonicalizing covers every file type the pre-commit hook rewrites', () => {
  const text = skillText('review');
  expect(text).toContain(
    'Cover every file type the pre-commit hook rewrites, not only those a check script covers.',
  );
  expect(text).toContain("Read the hook config's globs");
  expect(text).toContain('Point a formatter at the changed files it handles, never at a directory');
});
