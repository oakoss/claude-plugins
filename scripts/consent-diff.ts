// Compares how review-cycle's consent grammar reads messages at a git ref
// (default main) and in the working tree, and prints how many verdicts
// changed, grouped by what changed. A grammar change moves verdicts on
// purpose; this shows all of them, including the ones nobody wrote a spec for.
//
//   node scripts/consent-diff.ts [ref]

/* oxlint-disable eslint/no-console -- a command-line report: printing is its output */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Grammar = {
  grantOf: (prompt: string, previousAnswer?: string) => Record<string, unknown>;
  holdsOf: (prompt: string, previousAnswer?: string) => boolean;
};

const CONSENT = 'plugins/review-cycle/hooks/consent.ts';
const SOURCES = [CONSENT.replace('.ts', '.spec.ts'), 'plugins/review-cycle/hooks/register.test.ts'];

const ref = process.argv[2] ?? 'main';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

function atRef(path: string): string {
  try {
    return git('show', `${ref}:${path}`);
  } catch (error) {
    throw new Error(`cannot read ${path} at ${ref}`, { cause: error });
  }
}

// Every quoted string in the specs and hook tests, at both versions, with its
// escapes read as JavaScript reads them ("a\nb" is two lines).
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' };
function literals(text: string): string[] {
  const found = text.matchAll(
    /'((?:[^'\\\n]|\\.){2,200})'|"((?:[^"\\\n]|\\.){2,200})"|`([^`$\\\n]{2,200})`/g,
  );
  return [...found].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? '').replaceAll(/\\(.)/g, (_e: string, c: string) => ESCAPES[c] ?? c),
  );
}
const quoted = new Set<string>();
for (const path of SOURCES) {
  for (const text of [readFileSync(path, 'utf8'), atRef(path)]) {
    for (const s of literals(text)) quoted.add(s);
  }
}

// Requests built from parts, so a change in one part shows across the others.
// The near misses ("when its done", a leading condition, a reply that only
// ends in "delete it") are where a loosened rule shows that no spec names.
const LEADS = [
  '',
  'ok, ',
  'lets ',
  'go ahead and ',
  "don't ",
  'please ',
  'once its ready, ',
  'when CI passes, then ',
  // Where a regex read and a word read part: hyphens, brackets, curly quotes.
  'when-ready, ',
  'no-op, ',
  '(not yet) ',
  'don’t ',
  'ok :), ',
];
const VERBS = [
  'merge it',
  'merge 130',
  'merge 131 and 130',
  'push it',
  'commit it',
  'release it',
  'delete the branch',
  'open a PR',
  'approve it',
];
const CONDITIONS = [
  '',
  ' when its ready',
  ' once CI passes',
  ' when I say so',
  ' if CI fails',
  ' when its done',
  ' once its fixed',
  ' when you are done',
];
const TAILS = ['', ', then release it', ', but hold off', '. push it', ' please', '?'];
const generated = LEADS.flatMap((lead) =>
  VERBS.flatMap((verb) =>
    CONDITIONS.flatMap((when) => TAILS.map((tail) => `${lead}${verb}${when}${tail}`)),
  ),
);
const REPLIES = [
  'yes',
  'ok',
  'not yet',
  'ok, lets do that',
  'merge it',
  'delete it',
  'go ahead',
  'great',
  'looks good',
  'fix the TODO, then delete it',
  'no, not the branch. delete it',
];
const OFFERS = [
  '',
  'Merge #130?',
  'Merge #131? #130 is the version PR.',
  'Push `fix/x` to `origin`?',
  'Should I commit and push?',
  'Delete `fix/x` from `origin`?',
  'Release `review-cycle@0.27.0`?',
  'Should I merge it when CI passes?',
];

const prompts = [...new Set([...quoted, ...generated, ...REPLIES])];

// A verdict as one comparable line: the grant's non-default fields in key
// order, and whether it holds (the reason a hold gives is wording, not a verdict).
function verdict(g: Grammar, prompt: string, offer: string): string {
  const out: string[] = [];
  const fields = Object.entries(g.grantOf(prompt, offer)).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of fields) {
    if (value === false || value === 'none' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    if (value === true) out.push(key);
    else out.push(`${key}=${Array.isArray(value) ? value.join('+') : String(value)}`);
  }
  if (g.holdsOf(prompt, offer)) out.push('held');
  return out.join(', ') || 'nothing';
}

const base = atRef(CONSENT);
// Copied to .mts so Node reads both versions as ES modules, without warnings.
const dir = mkdtempSync(join(tmpdir(), 'consent-diff-'));
const groups = new Map<string, string[]>();
let cases = 0;
try {
  const load = async (name: string, source: string): Promise<Grammar> => {
    const file = join(dir, `${name}.mts`);
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as Partial<Grammar>;
    if (typeof module.grantOf !== 'function' || typeof module.holdsOf !== 'function') {
      throw new TypeError(`${CONSENT} (${name}) exports no grantOf and holdsOf to compare`);
    }
    return module as Grammar;
  };
  const before = await load('before', base);
  const after = await load('after', readFileSync(CONSENT, 'utf8'));
  for (const offer of OFFERS) {
    for (const prompt of prompts) {
      cases++;
      const was = verdict(before, prompt, offer);
      const now = verdict(after, prompt, offer);
      if (was === now) continue;
      const key = `${was}  →  ${now}`;
      const examples = groups.get(key) ?? [];
      examples.push(
        offer === ''
          ? JSON.stringify(prompt)
          : `${JSON.stringify(prompt)} after ${JSON.stringify(offer)}`,
      );
      groups.set(key, examples);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const changed = [...groups.values()].reduce((n, e) => n + e.length, 0);
console.log(
  `${cases} cases (${prompts.length} messages × ${OFFERS.length} offers) against ${ref}: ${changed} changed\n`,
);
for (const [key, examples] of [...groups].toSorted((a, b) => b[1].length - a[1].length)) {
  console.log(`${examples.length.toString().padStart(6)}  ${key}`);
  for (const example of examples.slice(0, 3)) console.log(`          ${example}`);
}
