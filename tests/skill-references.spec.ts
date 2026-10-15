// A skill with `disable-model-invocation: true` can only be run by the user,
// so prose that names one sends the model after a skill it cannot load. Any
// reference counts: telling the model to invoke one is too easy to word around
// a narrower check. Every skill and agent in the repository is read, since any
// of them can name a skill in any plugin.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT, skillText } from './skills';

const plugins = readdirSync(path.join(REPO_ROOT, 'plugins'));

function bodies(): [label: string, text: string][] {
  const found: [string, string][] = [];
  for (const plugin of plugins) {
    for (const kind of ['skills', 'agents']) {
      const dir = path.join(REPO_ROOT, 'plugins', plugin, kind);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const file = kind === 'skills' ? path.join(dir, entry, 'SKILL.md') : path.join(dir, entry);
        if (file.endsWith('.md') && existsSync(file)) {
          found.push([`${plugin}/${kind}/${entry}`, readFileSync(file, 'utf8')]);
        }
      }
    }
  }
  if (found.length < 10) throw new Error(`read only ${found.length} skills and agents`);
  return found;
}

const DISABLED = /^disable-model-invocation:\s*["']?true["']?\s*(?:#.*)?$/m;

test('no skill or agent names a skill only the user can run', () => {
  let resolved = 0;
  for (const [label, text] of bodies()) {
    for (const [ref, plugin = '', target = ''] of text.matchAll(
      /(?<![\w/.])\/([a-z][a-z-]*):([a-z][a-z-]*)\b/g,
    )) {
      // A plugin outside this repository cannot be checked; one inside it must
      // hold the skill, so a misspelled reference fails on the read.
      if (!plugins.includes(plugin)) continue;
      const front = skillText(plugin, target).split('\n---\n', 1)[0] ?? '';
      expect(front, `${label} → ${ref}`).not.toMatch(DISABLED);
      resolved += 1;
    }
  }
  expect(resolved, 'skill references resolved in this repository').toBeGreaterThan(5);
});
