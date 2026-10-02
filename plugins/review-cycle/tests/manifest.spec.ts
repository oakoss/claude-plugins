// The /config picker is drawn from plugin.json while the gate reads the rungs
// from ladder.ts; a rung in one and not the other would fall back unseen.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { DEFAULT_STOP, RUNGS } from '../hooks/ladder';
import { REPO_ROOT } from './agents';

test("the manifest's picker offers exactly the rungs, defaulting to push", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'plugins/review-cycle/.claude-plugin/plugin.json'), 'utf8'),
  ) as { userConfig: { stopBefore: { options: string[]; default: string } } };
  expect(manifest.userConfig.stopBefore.options).toEqual([...RUNGS]);
  expect(manifest.userConfig.stopBefore.default).toBe(DEFAULT_STOP);
});
