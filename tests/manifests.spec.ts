// The conventions every plugin's manifest and the marketplace follow, so a new
// plugin, or an edit to one, cannot drift from them unnoticed.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPO = 'https://github.com/oakoss/claude-plugins';
const AUTHOR = { name: 'Oak OSS', email: 'hello@oakoss.dev', url: 'https://github.com/oakoss' };

const json = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
const plugins = readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe.each(plugins)('the %s plugin', (name) => {
  const manifest = json(`plugins/${name}/.claude-plugin/plugin.json`);

  test('names itself after its directory, with the shared author, license and links', () => {
    expect(manifest.name).toBe(name);
    expect(manifest.author).toEqual(AUTHOR);
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toBe(REPO);
    expect(manifest.homepage).toBe(`${REPO}/tree/main/plugins/${name}`);
  });

  test('has a one-sentence description, a version and keywords', () => {
    expect(manifest.description).toMatch(/\.$/);
    expect(manifest.description).not.toMatch(/\.\s+[A-Z]/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.keywords.length).toBeGreaterThan(0);
  });

  test.each(['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'])('ships %s', (file) => {
    expect(existsSync(path.join(ROOT, 'plugins', name, file))).toBe(true);
  });

  // Tracked files only: an untracked leftover on one machine is not the plugin.
  test('keeps only plugin.json inside .claude-plugin', () => {
    const tracked = execFileSync('git', ['ls-files', `plugins/${name}/.claude-plugin`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(tracked.trim().split('\n')).toEqual([`plugins/${name}/.claude-plugin/plugin.json`]);
  });
});

const byName = (a: string[], b: string[]) => (a[0] ?? '').localeCompare(b[0] ?? '');

test('the marketplace lists every plugin from its own directory, described as it describes itself', () => {
  const listed = json('.claude-plugin/marketplace.json').plugins.map(
    (p: { name: string; source: string; description: string }) => [p.name, p.source, p.description],
  );
  const own = plugins.map((n) => [
    n,
    `./plugins/${n}`,
    json(`plugins/${n}/.claude-plugin/plugin.json`).description,
  ]);
  expect(listed.toSorted(byName)).toEqual(own.toSorted(byName));
});
