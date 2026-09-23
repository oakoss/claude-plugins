// Prose anchors for the cleanup skill's rules. Five rules once diverged from
// the Google developer style guide or from each other, and the cleanup skill
// rewrote correct documents as a result — measured by pointing it at this
// plugin's own style guide. Nothing in this repository read these files, so a
// mutation run reverted each of the five in turn, and separately inverted two
// rules outright ("Exclamation points are encouraged", "Always run regex
// replacements"), with bin/run-bats, `claude plugin validate --strict`,
// markdownlint and `oakum check --strict` all staying green.
//
// Like containment-anchors.spec.ts, this checks the rule text is present, not
// that a model obeys it. Two ceilings, both measured rather than assumed:
//
//   - An anchor kept verbatim while the prose below it says the opposite still
//     passes. Appending "Ignore the scope statement above" three lines later
//     leaves every test green.
//   - Byte-identity proves the three copies agree, not that they are right.
//     The same negating clause appended to all three satisfies it. Closing that
//     needs full-text anchoring, which would churn on every wording tweak.
//
// What it does catch is a revert, a partial revert reaching two of three
// copies, a divergent fourth copy added anywhere under the plugin, and a merge
// that resolves a conflict by keeping both sides.
//
// Every extraction fails loudly when it comes back empty. An empty extraction
// that passed would check nothing — the failure this suite exists to prevent
// rather than reproduce.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const STYLE = 'output-styles/prose.md';
const SKILL = 'skills/cleanup/SKILL.md';
const SNIPPET = 'reference/claude-md-snippet.md';
const MECHANICS = 'skills/cleanup/references/docs-mechanics.md';

// The scope statement's declared homes. One test derives the real set from
// disk and compares, so a fourth copy added anywhere fails rather than hides.
const SCOPE_FILES = [STYLE, SKILL, SNIPPET];
const SCOPE_FLOOR = 3;
const LIST_RULE_FILES = [STYLE, SKILL, MECHANICS];
const LIST_RULE_FLOOR = 3;

// The plugin ships ten files; a floor, not a count.
const FILE_FLOOR = 6;

const HYPE_WORDS = [
  'robust',
  'seamless',
  'powerful',
  'comprehensive',
  'cutting-edge',
  'game-changer',
  'delve',
  'tapestry',
  'landscape',
  'journey',
  'crucial',
  'vital',
];

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function linesOf(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function readPluginFile(rel: string): string {
  const file = path.join(PLUGIN_ROOT, rel);
  if (!isFile(file)) throw new Error(`missing file: ${rel}`);
  return readFileSync(file, 'utf8');
}

// The first line containing a fixed string, or a thrown failure. Anchoring a
// word to one line matters: the hype words also appear in this plugin's own
// examples and prose, so a file-wide or section-wide match passes on a gutted
// ban list.
function lineWith(rel: string, needle: string): string {
  if (needle === '') throw new Error(`empty needle for ${rel}`);
  const line = linesOf(readPluginFile(rel)).find((l) => l.includes(needle));
  if (line === undefined) throw new Error(`no line containing '${needle}' in ${rel}`);
  return line;
}

// 1-indexed line number of a pattern's first match, or a thrown failure.
function lineOf(rel: string, pattern: RegExp): number {
  const index = linesOf(readPluginFile(rel)).findIndex((l) => pattern.test(l));
  if (index === -1) throw new Error(`no match for '${pattern.source}' in ${rel}`);
  return index + 1;
}

// The first rule each copy states. The scope statement must precede it.
function firstRulePattern(rel: string): RegExp {
  switch (rel) {
    case STYLE: {
      return /^## Never write/;
    }
    case SKILL: {
      return /^## Workflow/;
    }
    case SNIPPET: {
      return /^Never write:/;
    }
    default: {
      throw new Error(`no first-rule pattern for ${rel}`);
    }
  }
}

// Soft, so every missing anchor in a test is reported on its own. An empty
// needle would match anything, passing vacuously.
function expectContains(rel: string, needle: string): void {
  if (needle === '') throw new Error(`empty anchor for ${rel}`);
  expect
    .soft(readPluginFile(rel).includes(needle), `${rel} is missing the anchor: ${needle}`)
    .toBe(true);
}

function sorted(words: string[]): string {
  return words.toSorted().join('\n');
}

// The words the canonical bullet bans, one per line, sorted. Quoted
// in the output style, bare and comma-separated in the skill's table row, so
// each is normalised to the same shape before comparison.
function styleHypeWords(): string {
  const bullet = lineWith(STYLE, '- Hype and stock LLM vocabulary:');
  return sorted([...bullet.matchAll(/"[^"]*"/g)].map((m) => m[0].replaceAll('"', '')));
}

function skillHypeWords(): string {
  const row = lineWith(SKILL, 'canonical list: the "Never write" section');
  let cell = row.startsWith('| ') ? row.slice(2) : row;
  const cut = cell.indexOf('(canonical list:');
  if (cut !== -1) cell = cell.slice(0, cut);
  return sorted(
    cell
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w !== ''),
  );
}

test('the enumerations have not collapsed', () => {
  expect(SCOPE_FILES.length).toBeGreaterThanOrEqual(SCOPE_FLOOR);
  expect(LIST_RULE_FILES.length).toBeGreaterThanOrEqual(LIST_RULE_FLOOR);
  expect(HYPE_WORDS.length).toBeGreaterThanOrEqual(12);
  for (const f of [...SCOPE_FILES, ...LIST_RULE_FILES]) {
    expect(isFile(path.join(PLUGIN_ROOT, f)), `missing file: ${f}`).toBe(true);
  }
});

test('no file outside the declared set carries a scope statement', () => {
  // Divergence by addition is at least as likely as divergence by edit: it is
  // what happens when someone adds a reference page or a second snippet.
  //
  // Enumerated with git, not a filesystem walk: a gitignored *.md under the
  // plugin sits on disk without being part of it. Untracked files still count,
  // because a fourth copy is a divergence before it is committed -- but merge
  // artifacts are dropped, since .orig and .rej are copies by definition and
  // would report every conflicted merge as a divergent scope statement. The
  // floor is what stops a broken enumeration from reading as a clean tree.
  const listing = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: PLUGIN_ROOT, encoding: 'utf8' },
  );
  const entries = (listing.stdout ?? '').split('\0').filter((e) => e !== '');
  expect(
    entries.length,
    `enumeration reached ${entries.length} files, expected at least ${FILE_FLOOR}`,
  ).toBeGreaterThanOrEqual(FILE_FLOOR);
  const withScope: string[] = [];
  for (const rel of entries) {
    let text: string;
    try {
      text = readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    if (linesOf(text).some((l) => l.startsWith('Scope: prose only.'))) withScope.push(rel);
  }
  const found = sorted(withScope.filter((rel) => !/\.(orig|rej|bak)$|~$/.test(rel)));
  expect(found, 'no scope statement found in any tracked file').not.toBe('');
  const expected = sorted(SCOPE_FILES);
  expect(
    found,
    `scope statements on disk do not match the declared set\n  on disk:  ${found.replaceAll('\n', ' ')}\n  declared: ${expected.replaceAll('\n', ' ')}`,
  ).toBe(expected);
});

test('the scope statement is byte-identical in all three copies', () => {
  const [firstFile, ...rest] = SCOPE_FILES;
  if (firstFile === undefined) throw new Error('SCOPE_FILES is empty');
  const first = lineWith(firstFile, 'Scope: prose only.');
  expect(first).not.toBe('');
  for (const f of rest) {
    const line = lineWith(f, 'Scope: prose only.');
    expect(line).not.toBe('');
    expect(
      line,
      `scope statement differs between ${firstFile} and ${f}\n  ${firstFile}: ${first}\n  ${f}: ${line}`,
    ).toBe(first);
  }
});

test('the scope statement governs generation, not only rewriting', () => {
  for (const f of SCOPE_FILES) {
    expectContains(f, 'prose you write and prose you rewrite');
    expectContains(f, 'an example quoted to illustrate a rule');
  }
});

test('the scope statement precedes the rules it governs in every copy', () => {
  for (const f of SCOPE_FILES) {
    const pattern = firstRulePattern(f);
    const scopeAt = lineOf(f, /^Scope: prose only\./);
    const rulesAt = lineOf(f, pattern);
    expect(
      scopeAt,
      `${f} states its scope at line ${scopeAt}, below its first rule at ${rulesAt}`,
    ).toBeLessThan(rulesAt);
  }
});

test('the register table sits below the scope statement', () => {
  // Its "Too chummy" column carries an exclamation point and a filler "just" on
  // purpose. The table has to sit below the scope statement, or the one block
  // the rules would condemn is the one they reach first.
  const scopeAt = lineOf(STYLE, /^Scope: prose only\./);
  const tableAt = lineOf(STYLE, /^The following table shows/);
  expect(
    scopeAt,
    `${STYLE} states its scope at line ${scopeAt}, below the register table at ${tableAt}`,
  ).toBeLessThan(tableAt);
});

test("the list rule carries Google's colon-or-period latitude", () => {
  for (const f of LIST_RULE_FILES) {
    expectContains(f, 'can end with a colon or a period');
    expectContains(f, 'usually a colon immediately before the list');
  }
});

test("the list rule carries Google's heading exemption", () => {
  expectContains(STYLE, 'unless the heading directly above it already supplies the context');
  expectContains(SKILL, 'needs no context beyond the heading');
  expectContains(MECHANICS, 'needs no context beyond the heading');
});

test('tables and code blocks still require an introduction, with its reason', () => {
  // Google states this one unconditionally; its single-table exemption covers
  // captions, not introductions. The rationale is what stops the rule being
  // re-softened, so it is anchored alongside the rule.
  expectContains(STYLE, 'Introduce a table or code block with a complete sentence');
  expectContains(STYLE, 'not all screen readers preannounce tables');
  expectContains(MECHANICS, 'Introduce with a complete sentence; say "the following table"');
});

test('the future-tense swap covers will, and neither would nor could', () => {
  const row = lineWith(SKILL, '| will (');
  expect(row, `the will row lost its example: ${row}`).toContain('will ("the server will send")');
  // Matches only a row naming would or could as a swap TARGET -- the first
  // cell must open with one of the three. A bare 'would' anywhere would hit
  // the Pass 1 row 'Sentences that would fit unchanged', a correct subjunctive.
  // Scoped this way a merge that keeps both sides, adding a second row rather
  // than restoring the original, still fails.
  const swapRows = linesOf(readPluginFile(SKILL)).filter((l) =>
    /^\|[ \t\v\f\r]*(will|would|could)\b[^|]*\b(would|could)\b/.test(l),
  );
  expect(swapRows).toEqual([]);
  expectContains(SKILL, 'keep it for a genuinely future event');
});

test('the exception pass 3 grants survives the step 5 re-scan', () => {
  expectContains(SKILL, 'Skip anything pass 3 or pass 4 deliberately licensed');
  expectContains(SKILL, 'Reserve future tense for genuinely future events');
});

test('all three copies carry the future-tense exception', () => {
  expectContains(STYLE, 'Keep the future tense for a genuinely future event');
  expectContains(SKILL, 'keep it for a genuinely future event');
  expectContains(SNIPPET, 'future only for a genuinely future event');
});

test('all three copies scope superlatives to claims about behavior', () => {
  expectContains(STYLE, 'governs claims about behavior, not instructions');
  expectContains(SKILL, 'in a claim about behavior');
  expectContains(SNIPPET, 'in claims about behavior');
  // Without the exception the narrowing is decorative: the subject is scoped
  // while the remedy still says to delete every absolute.
  expectContains(STYLE, '"never bypass the gate" is a rule');
  expectContains(SKILL, 'an imperative ("never bypass hooks") is a rule, and stays');
  expectContains(SNIPPET, '"never bypass the gate") is a rule and stays');
});

test('the canonical hype list is exactly the declared set', () => {
  // Set equality, not subset: adding a word to one copy and not the other is
  // the divergence this plugin was filed for, and a subset check passes on it.
  const found = styleHypeWords();
  expect(found, 'no words in the canonical hype bullet').not.toBe('');
  const expected = sorted(HYPE_WORDS);
  expect(
    found,
    `${STYLE}'s hype bullet does not match the declared set\n  in the bullet: ${found.replaceAll('\n', ' ')}\n  declared:      ${expected.replaceAll('\n', ' ')}`,
  ).toBe(expected);
});

test("the skill's hype list is the same set, restated rather than only cited", () => {
  // AGENTS.md, Skill conventions: the skill should be self-contained. A bare
  // cross-file link degrades to citing nothing if the target moves.
  // Measured: seamless and powerful also appear in the skill's "Not
  // recommended" example, delve and tapestry in its prose about the 2024 word
  // set, so a file-wide match passed with four words dropped from the row.
  const found = skillHypeWords();
  expect(found, "no words in the skill's hype row").not.toBe('');
  const expected = sorted(HYPE_WORDS);
  expect(
    found,
    `${SKILL}'s hype row does not match the declared set\n  in the row: ${found.replaceAll('\n', ' ')}\n  declared:   ${expected.replaceAll('\n', ' ')}`,
  ).toBe(expected);
});

test("the skill's citation of the output style resolves on disk", () => {
  expectContains(SKILL, '../../output-styles/prose.md');
  const target = path.join(PLUGIN_ROOT, 'skills/cleanup', '../../output-styles/prose.md');
  expect(existsSync(target) && statSync(target).size > 0, `${target} is missing or empty`).toBe(
    true,
  );
  // The citation names this heading; a rename would leave it pointing at
  // nothing while every check stayed green.
  expect(linesOf(readFileSync(target, 'utf8')).some((l) => l.startsWith('## Never write'))).toBe(
    true,
  );
});

test('the two rules a mutation run inverted are anchored', () => {
  // Both inversions passed every check in this repository before this suite
  // existed, and the header names them as the motivating silent failures.
  expectContains(STYLE, '- Exclamation points.');
  expectContains(SKILL, 'Never run regex replacements');
});
