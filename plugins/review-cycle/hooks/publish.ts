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
  publishes: 'publish' | 'release';
  // The shortest abbreviation the tool accepts: npm takes any from `pub`.
  abbreviates?: string;
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
    publishes: 'publish',
    abbreviates: 'pub',
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
    publishes: 'publish',
    passes: new Set(['recursive', 'm', 'multi']),
    dryRuns: true,
  },
  yarn: { values: new Set(['--cwd']), publishes: 'publish', dryRuns: false },
  bun: { values: new Set(['--cwd']), publishes: 'publish', dryRuns: true },
  cargo: {
    values: new Set(['-Z', '--config', '-C', '--color']),
    publishes: 'publish',
    dryRuns: true,
  },
  // `oakum release` has no dry run.
  oakum: { values: new Set(), publishes: 'release', dryRuns: false },
};

function publishes(publisher: Publisher, word: string): boolean {
  const { abbreviates } = publisher;
  if (abbreviates) return word.startsWith(abbreviates) && publisher.publishes.startsWith(word);
  return word === publisher.publishes;
}

// A publish read as text, for a command that does not parse: a publisher, then
// its command written in full later on the same line.
const toolsByCommand = new Map<string, string[]>();
for (const [tool, { publishes }] of Object.entries(PUBLISHERS)) {
  toolsByCommand.set(publishes, [...(toolsByCommand.get(publishes) ?? []), tool]);
}
export const PUBLISH_TEXT = new RegExp(
  [...toolsByCommand]
    .map(([command, tools]) => String.raw`\b(${tools.join('|')})\b[^|;&\n]*\b${command}\b`)
    .join('|'),
);

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

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

// The publish each word starts, by its index: a publisher at any word runs
// (`timeout 60 npm publish`, `npx oakum release`). The words after `npm run`
// are a script's name and arguments, so the scan stops there.
export function publishActionsOf(words: Word[]): ReadonlyMap<number, GhAction> {
  const found = new Map<number, GhAction>();
  // A Yarn command running npm (`yarn --cwd x npm publish`).
  let underYarn = false;
  for (const [at, word] of words.entries()) {
    const tool = basename(word.text);
    const published = publishAt(tool, words, at, underYarn);
    if (published === 'script') break;
    if (published) found.set(at, published);
    underYarn ||= tool === 'yarn';
  }
  return found;
}

// The publish a word starts, when `tool` (its basename) is a publisher:
// `npm publish`, `pnpm -r publish`, `cargo +nightly publish`. `script` when
// the words after it are a package script's.
function publishAt(
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
    if (!later.some((t) => publishes(publisher, t))) return null;
    return {
      kind: 'unread',
      why: `its \`${name}\` command is built at run time`,
      remedy: 'Write the command out.',
    };
  }
  if (RUNS_SCRIPTS.has(name) && /^(run|run-script)$/.test(command.text)) return 'script';
  if (!publishes(publisher, command.text)) return null;
  // `yarn npm publish` is Yarn's, whose dry run the gate does not know.
  const dryRuns = publisher.dryRuns && !(name === 'npm' && underYarn);
  const all = words.slice(at + 1).map((w) => w.text);
  return dryRuns && dryRun(name, all) ? null : { kind: 'release' };
}
