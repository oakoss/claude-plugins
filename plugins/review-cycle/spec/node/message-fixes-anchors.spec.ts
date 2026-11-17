// The verified-message-fix rules load only through Phase 6's pointer, so the
// pointer and the rules it leads to are pinned together.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import { expectAnchors, REPO_ROOT, skillText } from './agents';

test('Phase 6 points at the message-fix rules, and the rules are there', () => {
  expectAnchors(skillText('review-cycle', 'review'), 'review', [
    [
      `Read \`\${CLAUDE_PLUGIN_ROOT}/reference/message-fixes.md\` before classifying a fix whose diff is message text`,
      'no pointer to the message-fix rules',
    ],
  ]);
  const rules = readFileSync(
    path.join(REPO_ROOT, 'plugins/review-cycle/reference/message-fixes.md'),
    'utf8',
  );
  expectAnchors(rules, 'reference/message-fixes.md', [
    ['of ≤ ~15 added-plus-changed lines consumed only by such strings', 'helper limit'],
    ['every changed output path a user can trigger has a test or a reproduction', 'coverage'],
    [
      'reproduce the state a remedy is for, run it exactly as printed, and confirm it clears',
      'repro',
    ],
    ['Never eligible: machine-readable output', 'machine-readable exclusion'],
    ['Write each verification line into the Phase 9 summary draft', 'summary line'],
  ]);
});
