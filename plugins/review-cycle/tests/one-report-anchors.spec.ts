// A reviewer that ends its turn while its own background runs go on sends an
// interim answer, and each one wakes the orchestrator as a finished review:
// measured 2026-10-11, one pr-test-analyzer leg sent about 15 before its report.
// Waiting instead runs into the leg's 30-minute budget (register.ts
// LEG_BUDGET_MS), so the paragraph must carry that and how to wait.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import { expectAnchors, listAgents } from './agents';

test('every reviewer agent waits for its own runs before it reports', () => {
  for (const f of listAgents({ min: 6, exclude: ['cleanup.md'] })) {
    expectAnchors(readFileSync(f, 'utf8'), path.basename(f), [
      [
        'Ending your turn delivers your report, so never end it to wait',
        'may end its turn to wait',
      ],
      [
        'Wait for every command you started in the background to finish with a foreground command',
        'no longer says how to wait for its own runs',
      ],
      [
        /An interim answer \([^)]*\) is not a report/,
        'no longer says an interim answer is not a report',
      ],
      ['each leg has 30 minutes', 'no longer names the leg budget'],
      ['sample a long check', 'no longer says to sample a long check within the budget'],
      ['When your caller asks for your findings now', 'a nudge no longer wins over waiting'],
    ]);
  }
});
