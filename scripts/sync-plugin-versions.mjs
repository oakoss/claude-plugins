#!/usr/bin/env node
// Keeps the three per-plugin version records aligned:
//   plugins/<name>/package.json        (source of truth; bumped by `changeset version`)
//   plugins/<name>/.claude-plugin/plugin.json
//   .claude-plugin/marketplace.json    (the matching entry)
//
// Default mode writes package.json's version into the other two.
// --check writes nothing and exits 1 on any drift, or on a version that has
// no matching CHANGELOG.md heading — the cross-file consistency the
// commit-time bump gate cannot see. Plugins without a package.json are
// checked for plugin.json/marketplace.json/CHANGELOG agreement only.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const repoRoot = process.env.PLUGIN_REPO_ROOT || new URL('..', import.meta.url).pathname;
const check = process.argv.includes('--check');
const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));

const problems = [];
let marketplaceDirty = false;

const pluginDirs = readdirSync(join(repoRoot, 'plugins'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of pluginDirs) {
  const dir = join(repoRoot, 'plugins', name);
  const pluginJsonPath = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginJsonPath)) continue;

  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const entry = marketplace.plugins.find((p) => p.name === name);
  if (!entry) {
    problems.push(`${name}: no entry in marketplace.json`);
    continue;
  }

  const pkgPath = join(dir, 'package.json');
  const pkgVersion = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')).version : null;
  const truth = pkgVersion ?? pluginJson.version;

  if (check) {
    if (pkgVersion && pluginJson.version !== pkgVersion) {
      problems.push(`${name}: plugin.json ${pluginJson.version} != package.json ${pkgVersion}`);
    }
    if (entry.version !== truth) {
      problems.push(`${name}: marketplace.json ${entry.version} != ${truth}`);
    }
  } else {
    if (pluginJson.version !== truth) {
      pluginJson.version = truth;
      writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');
      console.log(`${name}: plugin.json -> ${truth}`);
    }
    if (entry.version !== truth) {
      entry.version = truth;
      marketplaceDirty = true;
      console.log(`${name}: marketplace.json -> ${truth}`);
    }
  }

  const changelogPath = join(dir, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  if (!changelog.includes(`## [${truth}]`) && !changelog.includes(`## ${truth}`)) {
    problems.push(`${name}: CHANGELOG.md has no heading for ${truth}`);
  }
}

if (marketplaceDirty) {
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
}

if (problems.length > 0) {
  for (const p of problems) console.error(`version drift: ${p}`);
  process.exit(1);
}
console.log(check ? 'versions consistent' : 'versions synced');
