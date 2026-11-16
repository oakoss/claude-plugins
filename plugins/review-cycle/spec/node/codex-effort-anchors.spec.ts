// The effort rule lives in hooks/review/codex-command.ts (spec/review/codex-command.spec.ts);
// each place that launches Codex must take its command from the tool, or it
// runs at whatever effort and permissions the model writes by hand.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('both review skills and the confirmation pass take the command from the tool', () => {
  const review = skillText('review-cycle', 'review');
  expect(phase(review, 3, 'Fan-out').join('\n')).toContain(
    'Get its command from the `mcp__review-cycle__codex_command` tool',
  );
  expect(phase(review, 6, 'Verify fixes (self-check), then loop check').join('\n')).toContain(
    'its command from `mcp__review-cycle__codex_command` with `pass: "confirmation"`',
  );
  expect(skillText('review-cycle', 'review-pr')).toContain(
    'Get its command from `mcp__review-cycle__codex_command`',
  );
});

test('neither skill keeps a hand-assembly recipe beside the tool', () => {
  for (const skill of ['review', 'review-pr']) {
    const text = skillText('review-cycle', skill);
    expect(text, skill).not.toContain('model_reasoning_effort');
    expect(text, skill).not.toContain('developer_instructions=');
  }
});
