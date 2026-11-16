// Codex's default sandbox can write the repository, and a leg once left probe
// files there. hooks/codex-command.ts runs it under a profile that writes only
// the scratch directory and tells it so (spec/codex-command.spec.ts); the
// skill keeps what makes that matter to a leg.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('the Codex leg measures in a copy, with the scratch directory made first', () => {
  const three = phase(skillText('review-cycle', 'review'), 3, 'Fan-out').join('\n');
  expect(three).toContain('after `mcp__review-cycle__scratch`');
  expect(three).toContain(
    'runs Codex under a profile that reads everything, writes only the scratch directory and has no network',
  );
  expect(three).toContain(
    "**The Codex leg measures in a copy.** Its question can need a run as much as a subagent's.",
  );
});

test("review-pr's Codex leg runs in the worktree under the same profile", () => {
  expect(skillText('review-cycle', 'review-pr')).toContain(
    'It runs Codex in `<WT>` under the same read-only profile as the working-tree review, writing only `<SCRATCH>`.',
  );
});
