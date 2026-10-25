// Codex's default sandbox can write the repository, and a leg once left probe
// files there. The review runs it under a profile that writes only the
// scratch directory, and tells it so, so a refused write is reported, not fought.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('the Codex leg runs with the repository read-only and is told why', () => {
  const three = phase(skillText('review-cycle', 'review'), 3, 'Fan-out').join('\n');
  expect(three).toContain(
    `codex review --uncommitted -c 'default_permissions="review-cycle"' -c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "<SCRATCH>"="write"}' -c 'permissions.review-cycle.network.enabled=false'`,
  );
  expect(three).toContain(
    'In a trusted project its sandbox is `workspace-write`, which can write the repository',
  );
  expect(three).toContain(
    'Write the absolute scratch path itself into the filesystem table and the brief on every Codex launch this cycle; when `mcp__review-cycle__scratch` failed, run `mktemp -d` once and use the path it prints. Then pass the filesystem table as one `-c` value, since a dotted key splits on the dot in the scratch path.',
  );
  expect(three).toContain(
    `*The repository is read-only for this review, by design: write only inside <SCRATCH>, making your own directory there with mktemp -d <SCRATCH>/codex.XXXXXX and pointing TMPDIR at it. A command that writes inside the repository fails with Operation not permitted, and you have no network; neither is a defect in the change nor a reason to request wider permissions. Run tests and builds in a copy you make with \${CLAUDE_PLUGIN_ROOT}/scripts/copy-tree.sh <PROJECT_ROOT> <your directory>/tree, using the project's own checks: <the commands Phase 2 ran, a JavaScript tool by path as node_modules/.bin/<tool>, since a package-manager script tries an install first; with none, end at tree>.*`,
  );
  expect(three).toContain(
    "**The Codex leg measures in a copy.** Its question can need a run as much as a subagent's.",
  );
});
