// The review skill's body loads whole into every session that runs a review;
// the parts it reaches only later live in files it reads then. These budgets
// keep the body from growing back.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT, skillText } from './agents';

const DIR = path.join(REPO_ROOT, 'plugins/review-cycle/skills/review');
const MAX_CHARS = 40_000;
const MAX_LINES = 500;
const byName = (a: string, b: string) => a.localeCompare(b);

test('the review skill body stays within its budget', () => {
  const body = readFileSync(path.join(DIR, 'SKILL.md'), 'utf8');
  expect(body.length).toBeLessThanOrEqual(MAX_CHARS);
  expect(body.split('\n').length).toBeLessThanOrEqual(MAX_LINES);
});

test('every file the review skill points at is read in', () => {
  const body = readFileSync(path.join(DIR, 'SKILL.md'), 'utf8');
  const pointed = [...body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/review\/([\w-]+\.md)/g)]
    .map((m) => m[1] ?? '')
    .toSorted(byName);
  expect(pointed).toEqual(['codex.md', 'loop.md', 'post-loop.md', 'summary.md']);
  // A file beside the skill that nothing points at is never read.
  const beside = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'SKILL.md');
  expect(beside.toSorted(byName)).toEqual(pointed);
  const text = skillText('review');
  for (const file of pointed) {
    expect(text).toContain(readFileSync(path.join(DIR, file), 'utf8'));
  }
});
