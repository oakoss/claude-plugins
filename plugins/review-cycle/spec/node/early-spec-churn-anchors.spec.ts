// Spec conformance runs before any fix and stops a cycle whose scope is wrong,
// and a file the fixes touch every round is named; only the skill's wording
// carries either rule, and each rule only works in its own phase.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AGENTS_DIR, phase, skillText } from './agents';

function section(n: number): string {
  return phase(skillText('review-cycle', 'review'), n, 'review').join('\n');
}

test('the review skill checks the spec in the first round, not after the loop', () => {
  expect(section(3)).toContain(
    '`review-cycle:spec-conformance-analyzer` — **iteration 1 only, on either tier**',
  );
  expect(section(3)).toContain('plus spec conformance in iteration 1 (below), and nothing else.');
  expect(section(7)).not.toContain('spec-conformance-analyzer');
});

test('a scope finding stops the cycle before Phase 5 applies any fix', () => {
  const four = section(4);
  expect(four).toContain('**Spec conformance decides whether the loop runs at all.**');
  expect(four).toContain("apply no review fix (Phase 2's formatting stays), run Phase 9");
  expect(four).toContain('findings against an unverified source are caveated, never a stop');
  expect(four).toContain('as pending, not deferred');
  expect(section(3)).toContain(
    'Name a source in its prompt only when the user named one or the commits under review reference it',
  );
  expect(four).toContain('record only the scope finding in the ledger, as a `question`');
  expect(four).toContain("Scope creep against a current spec source needs the user's decision");
});

// A branch reviewed a commit at a time hands the spec leg only the newest
// work, so without the earlier commits it reports them as scope creep.
test("the spec leg is told the branch's earlier commits are reviewed work", () => {
  expect(section(3)).toContain(
    'Reviewing the working tree on a branch with commits, its prompt lists them with their trailers (`git log <default branch>..HEAD`) as reviewed work, not to be judged again.',
  );
  const agent = readFileSync(path.join(AGENTS_DIR, 'spec-conformance-analyzer.md'), 'utf8');
  expect(agent).toContain(
    "Work the caller lists as the branch's earlier, reviewed commits is not scope creep",
  );
  expect(agent).toContain(
    "A requirement met by work the caller lists as the branch's earlier, reviewed commits is not missing.",
  );
  expect(agent).toContain(
    'An ID that appears only in the commits the caller lists as earlier, reviewed work is context, not a handed source',
  );
});

test('the review skill names a file the fixes touch in every round', () => {
  const six = section(6);
  expect(six).toContain('**Track where the fixes land.**');
  expect(six).toContain('`git diff --name-only <spawnTree> <worktreeTree>`');
  expect(six).toContain(
    "a file in every fixing iteration's set means the fixes are not converging there",
  );
  expect(six).toContain(
    "A flagged file stays on the summary's `Churn:` line even when the loop later converges.",
  );
  expect(six).toContain(
    "a spec defect fix's domain is spec conformance, scoped to the requirement it addressed",
  );
  expect(six).toContain("Churn covers loop iterations only, not Phase 8's pass.");
  expect(six).toContain('repeated patching at one site argues for the structural fix');
  expect(section(3)).toContain("its `worktreeTree` (this iteration's `<spawnTree>`");
  expect(section(9)).toContain(
    "Churn: none | <file[:hunks] in every fixing iteration's set (N of N fixing iterations)>",
  );
});
