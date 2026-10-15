// Helpers the prose-anchor specs share, across plugins. Every extraction
// throws when it finds nothing, so a renamed heading fails a spec instead of
// passing it with nothing checked.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect } from 'vitest';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

export function skillText(plugin: string, skill: string): string {
  return readFileSync(path.join(REPO_ROOT, 'plugins', plugin, 'skills', skill, 'SKILL.md'), 'utf8');
}

// The body under the `## heading` line, up to the next `## ` heading.
export function section(text: string, heading: string, label: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`${label}: no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  if (body.trim() === '') throw new Error(`${label}: "## ${heading}" section is empty`);
  return body;
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
