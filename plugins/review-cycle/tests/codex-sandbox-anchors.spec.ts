// Codex's default sandbox can write the repository, and a leg once left probe
// files there. The review runs it under a profile that writes only the
// scratch directory, and tells it so, so a refused write is reported, not fought.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('the Codex leg runs with the repository read-only and is told why', () => {
  const three = phase(skillText('review'), 3, 'Fan-out').join('\n');
  expect(three).toContain(
    `codex review --uncommitted -c 'default_permissions="review-cycle"' -c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "<SCRATCH>"="write"}'`,
  );
  expect(three).toContain(
    'In a trusted project its sandbox is `workspace-write`, which can write the repository',
  );
  expect(three).toContain(
    'Write the absolute scratch path itself into the filesystem table and the brief on every Codex launch this cycle; when `mcp__review-cycle__scratch` failed, run `mktemp -d` once and use the path it prints. Then pass the filesystem table as one `-c` value, since a dotted key splits on the dot in the scratch path.',
  );
  expect(three).toContain(
    '*The repository is read-only for this review, by design: write only inside <SCRATCH>, making your own directory there with mktemp -d <SCRATCH>/codex.XXXXXX and pointing TMPDIR at it. A command that writes inside the repository, such as a test runner writing a cache, fails with Operation not permitted; that is expected, not a defect in the change and not a reason to request wider permissions. List it under attempted-but-failed and continue with checks that only read.*',
  );
  expect(three).toContain(
    'Under the step 1 profile, reading and checks that write nothing succeed — typecheck, lint, `git diff` — while a build or test runner that writes inside the repository is denied',
  );
});
