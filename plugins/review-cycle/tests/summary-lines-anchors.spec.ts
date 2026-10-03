// The round summary says when the loop is making its own work, what each
// round cost, and hands the user a block for the pull request; only the
// skill's wording carries any of it.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

function section(n: number): string {
  return phase(skillText('review'), n, 'review').join('\n');
}

test("the review skill counts the findings this cycle's fixes caused", () => {
  const six = section(6);
  expect(six).toContain("**Count the findings this cycle's fixes caused.**");
  expect(six).toContain("`git diff <iteration 1's spawnTree> <spawnTree>`");
  expect(six).toContain("`iteration N: X of Y from this cycle's fixes`");
  expect(six).toContain('the loop is generating its own work');
  expect(six).toContain('a fix a finding shows is wrong is still fixed, as the bar above requires');
  expect(six).toContain('The count changes nothing in the loop');
  expect(six).not.toContain('stop before the next fan-out and ask');
  expect(section(3)).toContain("keep every iteration's");
  expect(section(9)).toContain(
    "Convergence: iteration 1 only | <iteration N: X of Y from this cycle's fixes",
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
    '`grep -rl --include=\'rollout-*.jsonl\' \'"parent_thread_id":"<session id>"\' ~/.codex/sessions | xargs grep -ho \'"total_token_usage":{[^}]*}\' | tail -1`',
  );
  expect(six).toContain('report it apart from the subagents');
  expect(section(3)).toContain("the time (`date +%s`, the start of the iteration's wall-clock)");
  expect(six).toContain('The cost covers loop iterations only, not Phases 7 and 8.');
  expect(section(9)).toContain(
    'Cost: <iteration N: W min wall-clock, L legs, T subagent tokens, C Codex tokens',
  );
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
