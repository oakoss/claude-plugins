// Package publishes, the release step's commands besides `gh release`. Pure:
// no `$`, no I/O. A package script (`pnpm release`, `npm run publish`) runs
// whatever it holds, so it is not read.

import type { GhAction } from './github';
import type { Word } from './shell';

// Options that take a value before the command, from each tool's `--help`
// (npm 11.17, pnpm 12.7, cargo 1.98, bun 1.4); `publish`'s own value options
// are included, since npm and pnpm accept them first (`npm --tag beta publish`).
const PUBLISH_VALUES = ['--tag', '--access', '--otp', '--registry', '--loglevel'];
type Publisher = {
  values: ReadonlySet<string>;
  // The words that publish: npm takes any abbreviation from `pub`.
  publishes: (word: string) => boolean;
  // Words that pass the command on: `pnpm recursive publish`.
  passes?: ReadonlySet<string>;
  // Whether `--dry-run` is known to skip the upload.
  dryRuns: boolean;
};
const PUBLISHERS: Record<string, Publisher> = {
  npm: {
    values: new Set([
      '-w',
      '--workspace',
      '--prefix',
      '--userconfig',
      '--cache',
      ...PUBLISH_VALUES,
    ]),
    publishes: (w) => /^pub(l(i(sh?)?)?)?$/.test(w),
    dryRuns: true,
  },
  pnpm: {
    values: new Set([
      '-C',
      '--dir',
      '-F',
      '--filter',
      '--filter-prod',
      '--reporter',
      '--loglevel',
      '--workspace-concurrency',
      ...PUBLISH_VALUES,
    ]),
    publishes: (w) => w === 'publish',
    passes: new Set(['recursive', 'm', 'multi']),
    dryRuns: true,
  },
  yarn: { values: new Set(['--cwd']), publishes: (w) => w === 'publish', dryRuns: false },
  bun: { values: new Set(['--cwd']), publishes: (w) => w === 'publish', dryRuns: true },
  cargo: {
    values: new Set(['-Z', '--config', '-C', '--color']),
    publishes: (w) => w === 'publish',
    dryRuns: true,
  },
  // `oakum release` has no dry run.
  oakum: { values: new Set(), publishes: (w) => w === 'release', dryRuns: false },
};

// The package managers whose `run` hands the rest of the words to a script.
const RUNS_SCRIPTS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

// Whether the words ask for a dry run, the last word deciding: `--dry-run`,
// `--dry-run=true`, and cargo's `-n` alone or in a cluster (`-qn`).
function dryRun(name: string, words: string[]): boolean {
  let dry = false;
  for (const [i, t] of words.entries()) {
    const value = /^--dry-run=(.*)$/.exec(t)?.[1];
    if (value !== undefined) dry = !/^(false|0)$/.test(value);
    else if (t === '--dry-run') dry = !/^(false|0)$/.test(words[i + 1] ?? '');
    else if (t === '--no-dry-run') dry = false;
    else if (name === 'cargo' && /^-[a-zA-Z]+$/.test(t)) dry ||= cargoCluster(t);
  }
  return dry;
}

// Whether a cluster of cargo's short options holds `-n` before a letter that
// takes the rest of the cluster as its value (`-pn` names package `n`).
function cargoCluster(cluster: string): boolean {
  for (const letter of cluster.slice(1)) {
    if (letter === 'n') return true;
    if ('pjFZC'.includes(letter)) return false;
  }
  return false;
}

// The publish a word starts, when `tool` (its basename) is a publisher:
// `npm publish`, `pnpm -r publish`, `cargo +nightly publish`, `npx oakum
// release`. `script` when the words after it are a package script's.
// `underYarn` is a Yarn command running it (`yarn --cwd x npm publish`).
export function publishAt(
  tool: string,
  words: Word[],
  at: number,
  underYarn: boolean,
): GhAction | 'script' | null {
  const name = tool.replace(/@[^/]*$/, '');
  const publisher = Object.hasOwn(PUBLISHERS, name) ? PUBLISHERS[name] : undefined;
  if (publisher === undefined) return null;
  let i = at + 1;
  while (i < words.length) {
    const t = words[i]?.text ?? '';
    if (name === 'cargo' && t.startsWith('+')) i++;
    else if (publisher.values.has(t)) i += 2;
    else if (t.startsWith('-') || publisher.passes?.has(t)) i++;
    else break;
  }
  const command = words[i];
  if (command === undefined) return null;
  const later = words.slice(i + 1).map((w) => w.text);
  if (command.dynamic) {
    if (!later.some((t) => publisher.publishes(t))) return null;
    return {
      kind: 'unread',
      why: `its \`${name}\` command is built at run time`,
      remedy: 'Write the command out.',
    };
  }
  if (RUNS_SCRIPTS.has(name) && /^(run|run-script)$/.test(command.text)) return 'script';
  if (!publisher.publishes(command.text)) return null;
  // `yarn npm publish` is Yarn's, whose dry run the gate does not know.
  const dryRuns = publisher.dryRuns && !(name === 'npm' && underYarn);
  const all = words.slice(at + 1).map((w) => w.text);
  return dryRuns && dryRun(name, all) ? null : { kind: 'release' };
}
