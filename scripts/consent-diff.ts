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
  'merge 130 into main',
  'merge main into it',
  'merge the first PR',
  'merge the first',
  'push it',
  'commit it',
  'release it',
  'delete the branch',
  'open a PR',
  'approve it',
  'finish the rebase',
  'continue the merge',
  'carry on with the rebase',
  'continue merging',
  // Destinations and nouns a push, publish, merge or pull request may name.
  'publish the branch',
  'publish the changes',
  'publish to github',
  'publish the docs to the wiki',
  'publish it',
  'publish the PR to github',
  'publish the changes as a PR comment',
  'push to npm',
  'push the package',
  'push the package.json change',
  'push the v1 tag',
  'push tag 0.2.0',
  'merge version 2.0 now into main',
  'merge version 2.0 now please into main',
  'publish changes.md',
  'publish the changes now as a PR comment',
  'open a PR for tonight',
  // A period inside a word: a version, a file, or a typo.
  'merge 130.5',
  'merge it.2',
  'push it.2 more to go',
  'push it to later',
  'merge into main',
  'merge into later',
  'merge the version 2 PR',
  'merge the release fixes',
  'open a PR for the docs',
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
  ' when you are finished',
  ' when you are done with it',
  ' when I am done',
  ' as soon as you can',
  ' as soon as CI passes',
  ' before the checks pass',
  ' before the checks fail',
  ' before I say so',
  ' when you are done with the tests',
  ' when you are done and I say so',
  ' when you are done, and I say so',
  ' when you are done and release is approved',
  ' when you are done, then wait for my ok',
  ' if CI passes before the tests finish',
  ' as soon as you can review it',
  ' when we can',
  ' when you can',
  ' whenever you can',
  ' whenever we can',
  ' as soon as we can',
  ' when I can',
  ' when we can review it',
];
const TAILS = [
  '',
  ', then release it',
  ', but hold off',
  '. push it',
  ' please',
  '?',
  ' first',
  ' first please',
  ' first then start on the docs',
  ' not yet',
  '. once its ready, do not merge it',
  ' tonight',
  ' in an hour',
  '\nwhen you are done, merge it',
  ': when you are done, merge it',
  // A retraction, alone, re-asked, or re-asked in its own sentence.
  '. never mind',
  '. open a PR. no wait, never mind. push it',
  '. never mind. merge it',
  '. never mind, push it',
  '. push it. never mind. thanks',
  '. thanks. never mind. push it',
  '. never mind. merge it. never mind',
];
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
  'ok continue',
  'keep going',
];
const OFFERS = [
  '',
  'Merge #130?',
  'Merge #131? #130 is the version PR.',
  'Merge `#130` into `main` now?',
  'Merge `#131`? `#130` is the version PR.',
  'Push `#130`?',
  'Merge `fix/x` into `main`?',
  'Merge `fix/x` into main now?',
  'Merge fix/x into main?',
  'Merge `fix/x` to main now?',
  'Push `fix/x` to `origin`?',
  'Should I commit and push?',
  'Delete `fix/x` from `origin`?',
  'Release `review-cycle@0.27.0`?',
  'Should I merge it when CI passes?',
  'Should I merge #130, if the tests pass?',
  'Should I merge #130 first?',
  'Should I merge #130 first, but only if CI passes?',
  'Should I push it, and when CI passes, merge #130?',
  'Should I merge #130 first? If the tests pass.',
  'If that looks right, should I push?',
  'Should I continue the rebase on `fix/x`?',
  // Either/or hand-backs and how-questions a "yes" answers.
  'Should I push, or would you rather do it?',
  'Want me to push, or skip it?',
  'Would you rather push it yourself?',
  'Should I leave it, or push?',
  'Do we commit, then push?',
  'Do we push to main?',
  'Can we push to main, or is it protected?',
  'Do we merge #130 or close it?',
  'Should I merge #130 when you are done?',
  'Should I merge #130 or #131?',
  'Would you rather push it yourself, or should I?',
  'Did we push it?',
  'Do we push and merge?',
  'We push to main, right?',
  'Should I push, or is CI still running?',
  'I can merge #131 next, or leave it. Merge the version PR?',
  '#134 merged\nMerge the version PR?',
  'Merged #134\nMerge #130?',
  'Can we push `--dry-run` to main?',
  'Why do we merge #130 first?',
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
