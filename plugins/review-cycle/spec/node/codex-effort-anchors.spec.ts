// The Codex effort rules live in Phase 3 and are applied again by Phase 6's
// confirmation pass; a size prune once dropped each place's guard.

import { expect, test } from 'vitest';

import { skillText } from './agents';

const text = skillText('review-cycle', 'review');

function phase(n: number): string {
  const start = text.indexOf(`### Phase ${n}:`);
  const end = text.indexOf(`### Phase ${n + 1}:`);
  if (start === -1 || end === -1) throw new Error(`no Phase ${n} section`);
  return text.slice(start, end);
}

test('the light tier lowers effort only without an explicit one, and never raises it', () => {
  const three = phase(3);
  expect(three).toContain('**An explicit effort argument wins over the tier**');
  expect(three).toContain(
    'Without an explicit argument, on the light tier, append `-c model_reasoning_effort="low"`',
  );
  expect(three).toContain('when it is already `low`, `minimal`, or `none`, **pass no override**');
});

test("the confirmation pass's Codex leg keeps both guards", () => {
  const six = phase(6);
  expect(six).toContain('at the explicit effort argument when one was given');
  expect(six).toContain(
    'or no override when the configured effort is already `low`, `minimal`, or `none`',
  );
});
