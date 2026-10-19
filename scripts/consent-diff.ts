// Compares how review-cycle's consent grammar reads messages at a git ref
// (default main) and in the working tree, and prints how many verdicts
// changed, grouped by what changed. A grammar change moves verdicts on
// purpose; this shows them, including the ones nobody wrote a spec for, over
// the messages and offers listed below.
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
  // Whether a message typed into a running turn replaces its grant; absent
  // before #182.
  dropsGrant?: (prompt: string, previousAnswer?: string) => boolean;
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
  'we can ',
  'we could ',
  'CI is green, we can ',
  'fix it and we can ',
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
  // Push targets a grant names, or leaves to the default branch's ask.
  'push to main',
  'push it to main',
  'push to origin main',
  'push main',
  'push to master',
  'push the tag',
  'push the tags',
  'push it to origin',
  'push the branch',
  'force push to main',
  'push the main fix',
  'push it to the main remote',
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
  // GitHub's merge methods, and pull requests named in turn.
  'squash-merge 130',
  'squash merge it',
  'squash and merge 130',
  'rebase-merge 130',
  'squash-merge the release',
  'merge 131, then 130',
  'merge 131, and then 130',
  // A gh-stack stack, whole or up to a layer, and its pushes.
  'push the stack',
  'push the whole stack',
  'ship the stack',
  'submit the stack',
  'merge the stack',
  'merge the whole stack',
  'merge the entire stack',
  'merge stack 4',
  'merge stack #4',
  'merge the stack into main',
  'merge up to #131',
  'merge up to 131',
  'merge everything up to #131',
  'merge all up to 131',
  'merge up to the version PR',
  'merge it up to main',
  'merge the stack of #12',
  'merge the PRs',
  'stack the PRs',
  'push the stack of PRs',
  // The stack's words on other verbs.
  'release the stack',
  'release the entire branch',
  'ship the whole branch',
  'commit the whole stack',
  'force push the stack',
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
  ', provided CI passes',
  ', assuming CI passes',
  ' as long as the tests pass',
  ', as long as the tests pass',
  ', but only if CI passes',
  ', but not until CI passes',
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
  // Retractions in other words, and opened by a filler word.
  '. nvm',
  '. nvm, push it',
  '. oh wait, never mind',
  '. sorry, never mind. push it',
  '. actually never mind',
  '. actually, don’t',
  '. hmm, no wait. merge it',
  '. ok, never mind',
  '. please, no wait. push it',
  // A condition in a sentence of its own.
  '. Only if CI passes.',
  '. Not before CI passes.',
  '. If CI passes.',
  '. If CI fails, fix it.',
];
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
  'Ok, lets ship as is',
  'ship it as-is',
  'push it as is',
  'the branch as is breaks the build',
  // Picking among the pull requests an offer named: all or some.
  'merge both',
  'yes, both',
  'merge them',
  'just #131',
  'only 131 for now',
  'yes to 131',
  'merge 131 but not 130',
  'not 130 yet',
  'only 131 of them',
  'merge only 131',
  'yes, merge just #131',
  'merge 131, not 130 yet',
  'yes, but wait for 131 to finish before merging 130',
  'merge 131, then merge 130 after it lands',
  'yes, one at a time',
  'ok wait',
  'is 131 merged',
  'merge both. Wait.',
  'merge 131? thanks',
  '"merge both"',
  '> merge both',
  '* merge both',
  'thanks for both',
  'not 131 and 130 yet',
  'merge 131 to 130',
  'merge 131 but not 131',
  'and merge 130',
  'merge neither',
  'skip both',
  'yes, but not yet',
  'merge both once CI passes',
  "merge 131, don't merge 130",
  // Answers to a stack's offers.
  'merge the stack',
  'push the stack',
  "don't merge the stack",
  'merge the stack, not 131',
  'merge up to 131',
];
const OFFERS = [
  '',
  'Merge #130?',
  'Merge #131? #130 is the version PR.',
  'Merge #131 and #130? Should I update the changelog or the README?',
  'Should I merge #131 and #130? Tell me which one to leave open.',
  'Merge `#130` into `main` now?',
  'Merge `#131`? `#130` is the version PR.',
  'Push `#130`?',
  'Merge `fix/x` into `main`?',
  'Merge `fix/x` into main now?',
  'Merge fix/x into main?',
  'Merge `fix/x` to main now?',
  'Push `fix/x` to `origin`?',
  'Push to `main`?',
  'Push to `develop`?',
  'Push `main` to `feature-x`?',
  'Push the `v1.2.0` tag?',
  'Push the `v1.2.0-rc.1` tag?',
  'Release `v0.25.0`?',
  'Release `v0.25.0`? It pushes the tag.',
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
  // Conditions an offer sets: in the question, before it, or after it.
  'Should I merge #130, if the tests pass?',
  'Should I merge #130, but not until CI passes?',
  'Should I merge #130, assuming CI passes?',
  'Should I merge #130 when CI passes, and only once staging is deployed?',
  'Should I push it, and when CI passes, merge #130?',
  'When CI passes, should I merge #130?',
  "When you're ready, should I push?",
  'If so, should I merge #130?',
  'Should I merge #130? If the tests pass.',
  'Should I merge #130? Only once CI passes.',
  "Should I push? If yes, I'll open the PR next.",
  'Should I push? After that, CI will run.',
  'Should I merge #130? Only if CI passes, though.',
  'Can we push? Not until CI is green.',
  'If CI passes,\nshould I merge #130?',
  'If it looks good, should I push?',
  'If that looks right and CI passes, should I push?',
  // GitHub's merge methods, pull requests offered in turn, and notes beside them.
  'Should I squash-merge #130?',
  'Should I squash merge #130?',
  'Squash and merge #130?',
  'Should I squash-merge #131, then #130?',
  'Should I merge #131, then #130?',
  'Merge #131 and then #130?',
  'Merge #131 (rust 1.99.1) and then #130 (jdx/mise-action v5.2.0)?',
  'Squash-merge #131 (rust 1.99.1) and then #130 (jdx/mise-action v5.2.0)?',
  'Merge #131 (the docs fix)?',
  'Should I squash-merge the release?',
  // A gh-stack stack's offers.
  'Force-push the stack with a lease?',
  'Merge #2, #3?',
  'Merge the stack?',
  'Merge stack #4 (#2 and #3)?',
];

// Which offers each message is read against. Crossing every generated message
// with every offer multiplies with each list a grammar change grows (31M cases
// at #177), so: the quoted strings and replies meet every offer; a generated
// message meets no offer, plus every offer when it has no lead, plus two offers
// picked by its place in the product. Replaying #168-#177 this way showed every
// verdict group the full product did but two in #173 (87 of 89).
const offered = new Map<string, Set<string>>();
const spread = (i: number, salt: number): number => Math.imul(i ^ salt, 0x9e_37_79_b1) >>> 0;
const meet = (prompt: string, offers: readonly string[]) => {
  const set = offered.get(prompt) ?? new Set<string>();
  for (const offer of offers) set.add(offer);
  offered.set(prompt, set);
};
const asked = [...new Set(OFFERS.filter((o) => o !== ''))];
for (const prompt of [...quoted, ...REPLIES]) meet(prompt, ['', ...asked]);
let at = 0;
for (const lead of LEADS) {
  for (const verb of VERBS) {
    for (const when of CONDITIONS) {
      for (const tail of TAILS) {
        const i = at++;
        // Hashed, so no stride shares a factor with the offer count; the second
        // always differs from the first.
        const first = spread(i, 0) % asked.length;
        const second = (first + 1 + (spread(i, 1) % (asked.length - 1))) % asked.length;
        const rotated = [asked[first], asked[second]];
        meet(`${lead}${verb}${when}${tail}`, lead === '' ? ['', ...asked] : ['', ...rotated]);
      }
    }
  }
}

// A verdict as one comparable line: the grant's non-default fields in key
// order, and whether it holds (the reason a hold gives is wording, not a verdict).
function verdict(g: Grammar, prompt: string, offer: string, queued: boolean): string {
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
  if (queued && g.dropsGrant?.(prompt, offer)) out.push('drops a queued grant');
  return out.join(', ') || 'nothing';
}

async function compare(base: string, current: string): Promise<void> {
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
    const after = await load('after', current);
    // Compared only where both versions read queued messages, so an older ref
    // does not report every message as newly dropping.
    const queued = before.dropsGrant !== undefined && after.dropsGrant !== undefined;
    if (!queued)
      console.log(`dropsGrant is missing at ${ref} or here: queued messages not compared`);
    for (const [prompt, offers] of offered) {
      for (const offer of offers) {
        cases++;
        const was = verdict(before, prompt, offer, queued);
        const now = verdict(after, prompt, offer, queued);
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
    `${cases} cases (${offered.size} messages, ${asked.length + 1} offers) against ${ref}: ${changed} changed\n`,
  );
  for (const [key, examples] of [...groups].toSorted((a, b) => b[1].length - a[1].length)) {
    console.log(`${examples.length.toString().padStart(6)}  ${key}`);
    for (const example of examples.slice(0, 3)) console.log(`          ${example}`);
  }
}

const base = atRef(CONSENT);
const current = readFileSync(CONSENT, 'utf8');
if (base === current) {
  console.log(`${CONSENT} is the same at ${ref} and in the working tree: 0 changed`);
} else {
  await compare(base, current);
}
