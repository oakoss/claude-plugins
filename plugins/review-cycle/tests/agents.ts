import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const AGENTS_DIR = path.join(REPO_ROOT, 'plugins/review-cycle/agents');

export function skillText(skill: string): string {
  return readFileSync(
    path.join(REPO_ROOT, 'plugins/review-cycle/skills', skill, 'SKILL.md'),
    'utf8',
  );
}

// Throws rather than returning a short list, so a collapsed enumeration never
// reads as a clean tree. `min` counts what is left after `exclude`.
export function listAgents({
  dir = AGENTS_DIR,
  min,
  exclude = [],
}: {
  dir?: string;
  min: number;
  exclude?: string[];
}): string[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !exclude.includes(name))
    .toSorted()
    .map((name) => path.join(dir, name));
  if (files.length < min) {
    throw new Error(
      `scan reached only ${files.length} agents under ${dir} (expected at least ${min})`,
    );
  }
  return files;
}

// A string anchor matches as a fixed substring; a RegExp one lets a table
// mark an anchor caseless with /i.
export type Anchor = readonly [needle: string | RegExp, reason: string];

// Soft, so every missing anchor is reported on its own, prefixed by `label`.
export function expectAnchors(text: string, label: string, anchors: readonly Anchor[]): void {
  for (const [needle, reason] of anchors) {
    const hit = typeof needle === 'string' ? text.includes(needle) : needle.test(text);
    expect.soft(hit, `${label}: ${reason}`).toBe(true);
  }
}

// The lines from the `Phase n` heading through the `Phase n+1` heading that
// closes it. A missing close throws rather than running to EOF, so a renamed
// heading cannot widen the section past the phase it names.
export function phase(text: string, n: number, label: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##+ Phase ${n}`).test(l));
  if (start === -1) throw new Error(`${label}: Phase ${n} section not found`);
  const close = new RegExp(`^##+ Phase ${n + 1}`);
  const end = lines.findIndex((l, i) => i >= start && close.test(l));
  if (end === -1) throw new Error(`${label}: Phase ${n} section unterminated`);
  return lines.slice(start, end + 1);
}
