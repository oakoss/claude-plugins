// The round summary says when the loop is making its own work, what each
// round cost, and hands the user a block for the pull request; only the
// skill's wording carries any of it.

import { expect, test } from 'vitest';

import { cycleOf } from '../../hooks/cycles';
import { phase, skillText } from './agents';

function section(n: number): string {
  return phase(skillText('review-cycle', 'review'), n, 'review').join('\n');
}

test("the review skill counts the findings this cycle's fixes caused", () => {
  const six = section(6);
  expect(six).toContain("**Count the findings this cycle's fixes caused.**");
  expect(six).toContain("`git diff <iteration 1's spawnTree> <spawnTree>`");
  expect(six).toContain("`iteration N: X of Y from this cycle's fixes`");
  expect(six).toContain(
    "When most of a non-confirmation iteration's findings came from this cycle's fixes, the loop is generating its own work: hold them as at the ceiling, one showing a fix is wrong included, so Phase 10 offers the structural fix or a cut before more patches.",
  );
  expect(six).not.toContain('The count changes nothing in the loop');
  expect(six).not.toContain('is still fixed');
  expect(phase(skillText('review-cycle', 'review'), 5, 'Apply').join('\n')).toContain(
    "On the iteration that reaches the ceiling, or a non-confirmation one whose findings came mostly from this cycle's fixes (Phase 6), apply no fix:",
  );
  expect(six).not.toContain('stop before the next fan-out and ask');
  expect(section(3)).toContain("keep every iteration's");
  expect(section(9)).toContain(
    "Convergence: iteration 1 only | <iteration N: X of Y from this cycle's fixes",
  );
  expect(section(9)).toContain(
    'Iterations: N (converged | ceiling of <max> reached, N findings held | generating its own work, N findings held |',
  );
});

test("the review skill records each round's cost as its legs report", () => {
  const six = section(6);
  expect(six).toContain("**Record each iteration's cost as its legs report.**");
  expect(six).toContain("the difference from Phase 3's is the iteration's wall-clock");
  expect(six).toContain('so keep only its latest');
  expect(six).toContain('Name every leg whose usage was not reported');
  expect(six).toContain('Codex runs the review in a child session of the `session id`');
  expect(six).toContain(
    'read its `total` from the `tokens` of the `mcp__review-cycle__codex_log` answer, or the `unavailable` reason',
  );
  expect(six).toContain('report it apart from the subagents');
  expect(section(3)).toContain("the time (`date +%s`, the start of the iteration's wall-clock)");
  expect(six).toContain('The cost covers loop iterations only, not Phases 7 and 8.');
  expect(section(9)).toContain(
    'Cost: <iteration N: W min wall-clock, L legs, T subagent tokens, C Codex tokens',
  );
});

test('the summary block goes to the summary tool, and the reply ends with the decision', () => {
  const nine = section(9);
  expect(nine).toContain(
    'after any Phase 10 commit, pass this summary as `text` to `mcp__review-cycle__summary`',
  );
  expect(nine).toContain('every field by its name below and in this order');
  expect(nine).toContain('the transcript folds its result, so your reply stays on screen');
  expect(nine).toContain(
    'When that tool does not exist, print it in your final message as a `text` block instead',
  );
  expect(nine).toContain('Prose may explain it, but never replaces it');
  expect(nine).toContain(
    'your reply ends with the final state and what the user must read or answer',
  );
  expect(nine).toContain('follow the summary in your reply, before any question Phase 10 asks');
});

test('each fixed and deferred finding names its leg, side and iteration, for the rollup', () => {
  const nine = section(9);
  expect(nine).toContain('List each fixed and deferred finding as its own bullet');
  expect(nine).toContain(
    "the side of Phase 6's bar it falls on (`above` or `below`, whatever the iteration) and the iteration that raised it",
  );
});

// The template's own lines, filled in, are what the summary tool's parser reads.
test('the summary template, filled in, reads back through cycleOf', () => {
  const block = /```text\n(Review cycle complete\.[\s\S]*?)```/.exec(section(9))?.[1];
  if (block === undefined) throw new Error('Phase 9 template block not found');
  const filled = block
    .replace(/^Iterations: .*$/m, 'Iterations: 2 (converged)')
    .replace(/^Convergence: .*$/m, "Convergence: iteration 2: 1 of 2 from this cycle's fixes")
    .replaceAll(/^(Findings fixed inline|Findings deferred): \w$/gm, '$1: 1')
    .replaceAll('(source, above | below, iteration N)', '(codex, below, iteration 2)')
    .replaceAll('  - ...\n', '');
  const c = cycleOf(filled, 'd', null);
  expect(c).toMatchObject({ iterations: 2, exit: 'converged', later: 2, selfCaused: 1 });
  expect([c.fixedCount, c.deferredCount]).toEqual([1, 1]);
  expect(c.fixed).toEqual([{ legs: ['codex'], side: 'below', iteration: 2 }]);
  expect(c.deferred).toEqual([{ legs: ['codex'], side: 'below', iteration: 2 }]);
});

test('the summary is followed by a paste-ready block, never filed in a tracker', () => {
  const nine = section(9);
  expect(nine).toContain('with a paste-ready markdown block');
  expect(nine).toContain('`## Known issues`');
  expect(nine).toContain('`### Open questions`');
  expect(nine).toContain('leaves out findings still held at the ceiling');
  expect(nine).toContain('Never file it in a tracker');
  expect(nine).toContain('with any held findings the user chose in Phase 10 to defer added first');
});
