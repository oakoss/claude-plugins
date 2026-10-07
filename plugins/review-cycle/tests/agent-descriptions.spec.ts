// Every session loads each agent's description into its agent listing, so
// worked examples belong in the body, which loads only when the agent runs.
// A hand port from pr-review-toolkit is the likely way one comes back.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { listAgents } from './agents';

test('no agent description carries <example> blocks', () => {
  for (const file of listAgents({ min: 7 })) {
    // The whole frontmatter, so a `description: |` block scalar is read too.
    const [, frontmatter] = readFileSync(file, 'utf8').split(/^---$/m);
    const name = path.basename(file);
    expect.soft(frontmatter, `${name}: no description`).toMatch(/^description:/m);
    expect.soft(frontmatter, name).not.toMatch(/<example\b/i);
  }
});
