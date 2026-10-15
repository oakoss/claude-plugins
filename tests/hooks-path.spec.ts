// `bd init` and `bd hooks install --beads` set core.hooksPath, and git then
// skips lefthook without a word: no commitlint, no formatters, no beads hooks.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

test('core.hooksPath is unset, so git runs lefthook', () => {
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const set = r.status === 0 ? r.stdout.trim() : null;
  expect(
    set,
    `core.hooksPath is ${set}, so git bypasses lefthook. Run: git config --unset core.hooksPath (add --global if it is set there)`,
  ).toBeNull();
});
