// A lint run piped through `tail` showed its last lines and hid three errors,
// so Phase 2 reads each check's exit code rather than its truncated output.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test("Phase 2 reads each project check's exit code", () => {
  const two = phase(skillText('review'), 2, 'Canonicalize').join('\n');
  expect(two).toContain("Read each check's exit code, or run it unpiped");
  expect(two).toContain('a nonzero exit is never a pass');
  expect(two).toContain('output cut short by `tail` or `head` is not a pass');
  expect(two).toContain(
    'Fail-open: a check that could not run at all — the tool missing, the command or script not found — is noted and skipped, never blocks the review.',
  );
  expect(two).toContain('Its output says which case applies');
  expect(two).toContain('a check that ran and failed is a finding');
});
