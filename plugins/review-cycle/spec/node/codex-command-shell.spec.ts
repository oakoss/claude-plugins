// The command reaches Codex through bash, so its arguments are read back as
// bash splits them, with `codex review` swapped for printf.

import { execFileSync } from 'node:child_process';

import { expect, test } from 'vitest';

import { codexCommand, containmentOf } from '../../hooks/codex-command';

const SCRATCH = '/var/folders/x/T/review-cycle.AbC123';
const COPY = '/p/scripts/copy-tree.sh';
const BRIEF = "Intent: it's a fix for a.ts, b.ts. Settle this first: does x hold?";
const CHECKS = 'node_modules/.bin/vitest run plugins/x';

test('bash hands Codex each override as one TOML assignment', () => {
  const r = codexCommand(
    {
      scope: { base: 'origin/feature+fix' },
      tier: 'light',
      pass: 'review',
      effort: null,
      brief: BRIEF,
      checks: CHECKS,
    },
    SCRATCH,
    COPY,
    null,
  );
  if (!('command' in r)) throw new Error(r.refused);
  const shown = r.command.replace(
    'cd "$(git rev-parse --show-toplevel)" && FORCE_COLOR=1 codex review',
    String.raw`printf '%s\n'`,
  );
  const args = execFileSync('bash', ['-c', shown], { encoding: 'utf8' }).trimEnd().split('\n');
  expect(args.slice(0, 2)).toEqual(['--base', 'origin/feature+fix']);
  expect(args.filter((_, i) => args[i - 1] === '-c')).toEqual([
    'default_permissions="review-cycle"',
    `permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "${SCRATCH}"="write"}`,
    'permissions.review-cycle.network.enabled=false',
    'model_reasoning_effort="low"',
    `developer_instructions="${BRIEF} ${containmentOf(SCRATCH, COPY, CHECKS)}"`,
  ]);
});
