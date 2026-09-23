// Prose anchors for the review cycle's contracts. The containment contract is
// the largest: every measuring reviewer works in a private mktemp -d — never a
// shared session scratchpad — names that directory in its report, and no agent
// the cycle spawns may reshape a command to slip past a guard. Later tests
// anchor the effort argument, the settled-findings brief, and release-note
// verification the same way.
//
// Two measured incidents motivate the anchors: a reviewer's copy mutated
// mid-run by a sibling agent sharing the session scratchpad, and a reviewer
// that ran another agent's script by accident and received a results matrix it
// had not authored. Like execution-receipt.spec.ts, this checks the instruction
// is present, not that an agent obeys it at runtime — it catches a partial
// revert and an agent that never joined the contract. An anchor kept verbatim
// but contradicted by surrounding prose still passes; that is the inherent
// limit of prose anchoring.
//
// `cleanup.md` edits the target by design, so it carries only the never-evade
// rule, not the private-workdir requirement.

import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { AGENTS_DIR, expectAnchors, listAgents, REPO_ROOT, skillText } from './agents';

const REVIEW_SKILL = path.join(REPO_ROOT, 'plugins/review-cycle/skills/review/SKILL.md');
const CLEANUP_AGENT = path.join(AGENTS_DIR, 'cleanup.md');

const PRIVATE_DIR_ANCHOR = 'mktemp -d';
const SHARED_SCRATCHPAD_ANCHOR = 'never a shared session scratchpad';
const NAME_DIR_ANCHOR = /name that directory in your report/i;
const WRITE_NOWHERE_ANCHOR = /write nowhere outside it/i;
const EVADE_ANCHOR = 'slip past a guard';

// Seven agents today, cleanup included. A floor, not a count: the per-file
// loop catches one dropping out; this only catches the enumeration collapsing.
const AGENT_FLOOR = 7;

function listAllAgents(dir = AGENTS_DIR): string[] {
  return listAgents({ dir, min: AGENT_FLOOR });
}

// The lines from the `Phase n` heading through the `Phase n+1` heading that
// closes it. A missing close throws rather than running to EOF, so a renamed
// heading cannot widen the section past the phase it names.
function phase(text: string, n: number, label: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##+ Phase ${n}`).test(l));
  if (start === -1) throw new Error(`${label}: Phase ${n} section not found`);
  const close = new RegExp(`^##+ Phase ${n + 1}`);
  const end = lines.findIndex((l, i) => i >= start && close.test(l));
  if (end === -1) throw new Error(`${label}: Phase ${n} section unterminated`);
  return lines.slice(start, end + 1);
}

// The one line in `lines` containing `marker`, or undefined after a soft
// failure naming how many there were.
function markedLine(lines: string[], marker: string, what: string): string | undefined {
  const marked = lines.filter((line) => line.includes(marker));
  expect.soft(marked.length, `${what}, found ${marked.length}`).toBe(1);
  return marked.length === 1 ? marked[0] : undefined;
}

// The body under `## heading`, up to the next `## ` heading or EOF.
function h2Section(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'containment-anchors-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('every measuring agent requires a private mktemp -d it names in its report', () => {
  for (const f of listAllAgents()) {
    const name = path.basename(f);
    if (name === 'cleanup.md') continue;
    expectAnchors(readFileSync(f, 'utf8'), name, [
      [PRIVATE_DIR_ANCHOR, 'no mktemp -d requirement'],
      [SHARED_SCRATCHPAD_ANCHOR, 'shared-scratchpad ban lost'],
      [NAME_DIR_ANCHOR, 'measurements not traceable to a named directory'],
      [WRITE_NOWHERE_ANCHOR, 'write-nowhere clause lost'],
    ]);
  }
});

test('every agent, cleanup included, carries the never-evade rule', () => {
  for (const f of listAllAgents()) {
    expectAnchors(readFileSync(f, 'utf8'), path.basename(f), [
      [EVADE_ANCHOR, 'never-evade rule lost'],
    ]);
  }
});

// The anchors must sit on each reviewer spawn-prompt line individually:
// a file-wide match is satisfied by the Phase 7 sentence or by review-pr's
// worktree mktemp command, and a concatenated multi-prompt match is satisfied
// by clauses parked on the cleanup prompt — both measured survivors.
// `prompt: "Review` matches the reviewer prompts and excludes cleanup's
// `prompt: "Run cleanup`, which intentionally carries no containment.
test('every reviewer spawn prompt carries the containment clauses on its own line', () => {
  const heads: Record<string, string> = {
    review: 'prompt: "Review uncommitted changes in <PROJECT_ROOT>',
    'review-pr': 'prompt: "Review git diff',
  };
  for (const skill of ['review', 'review-pr']) {
    // Each layer closes a measured survivor: a range that fails open past a
    // renamed heading, and a prose decoy defeating a file-wide or mid-line
    // match. Residual: a verbatim line-start counterfeit inside Phase 3 passes.
    const head = heads[skill] ?? '';
    const prompts = phase(skillText(skill), 3, skill).filter(
      (line) => /^[ \t\v\f\r]*prompt: "/.test(line) && line.includes(head),
    );
    expect
      .soft(
        prompts.length,
        `${skill}: reviewer spawn prompt head expected exactly once in Phase 3, found ${prompts.length}`,
      )
      .toBe(1);
    if (prompts.length !== 1) continue;
    expectAnchors(prompts[0] ?? '', skill, [
      [PRIVATE_DIR_ANCHOR, 'the reviewer prompt lost mktemp -d'],
      ['never a shared scratchpad', 'the reviewer prompt lost the scratchpad ban'],
      [
        'never reshape a command to slip past a guard',
        'the reviewer prompt lost the never-evade clause',
      ],
      [NAME_DIR_ANCHOR, 'the reviewer prompt lost the name-directory clause'],
      [WRITE_NOWHERE_ANCHOR, 'the reviewer prompt lost the write-nowhere clause'],
    ]);
  }
});

// Phase 7's report-only containment sentence is a separate site with its own
// drift history — a reverted copy left the file-wide form green, and a
// verbatim sentence relocated to unrelated prose survived a bare count guard.
// Binding to the paragraph marker line forces a decoy to counterfeit the
// whole paragraph header, and the marker is required exactly once.
test("the review skill's Phase 7 containment sentence stands on its own", () => {
  const line = markedLine(
    phase(readFileSync(REVIEW_SKILL, 'utf8'), 7, 'review'),
    'Both report-only spawns carry the containment sentence',
    'review: Phase 7 containment paragraph expected exactly once in Phase 7',
  );
  if (line === undefined) return;
  expectAnchors(line, 'review', [
    ['work only on a copy in a private', 'Phase 7 sentence lost its private-workdir clause'],
    ['never a shared scratchpad', 'Phase 7 sentence lost the scratchpad ban'],
    ['reshape a command', 'Phase 7 sentence lost the never-evade clause'],
    [NAME_DIR_ANCHOR, 'Phase 7 sentence lost the name-directory clause'],
    [WRITE_NOWHERE_ANCHOR, 'Phase 7 sentence lost the write-nowhere clause'],
  ]);
});

test('both skills carry the effort-argument contract', () => {
  for (const skill of ['review', 'review-pr']) {
    expectAnchors(skillText(skill), skill, [
      [
        '`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`',
        'seven-literal effort set lost',
      ],
      ['name the invalid value, list the valid set, and stop', 'invalid-effort stop rule lost'],
      ['on either tier, raising included', 'explicit-argument override lost'],
      ['requested, unused]', 'unused-effort template vocabulary lost'],
      [
        'Carry the never-evade rule into the brief the same way: never reshape a command to slip past a guard',
        'never-evade lost its route to the Codex brief',
      ],
    ]);
  }
  expectAnchors(readFileSync(REVIEW_SKILL, 'utf8'), 'review', [
    ['for reading, not measurement', 'reading-shaped Codex question rule lost'],
  ]);
});

test('the scan fails instead of passing when enumeration reaches too few files', () => {
  expect(() => listAllAgents(makeTempDir())).toThrow('scan reached only 0');
});

test('Phase 3 tells later iterations what earlier ones settled', () => {
  const line = markedLine(
    phase(readFileSync(REVIEW_SKILL, 'utf8'), 3, 'review'),
    'already settled this cycle',
    'review: settled-findings block expected exactly once in Phase 3',
  );
  if (line === undefined) return;
  // Anchors span enough words that a splice cutting THROUGH them breaks the
  // match — measured: 'not to be re-reported' alone stayed green under
  // "Nothing here says these are not to be re-reported"; the widened form
  // fails. Residual: a negation wrapped around an intact span still passes,
  // as does the paragraph relocated elsewhere within the same phase.
  expectAnchors(line, 'review', [
    ['From iteration 2 on', 'settled block lost its iteration-2 trigger'],
    [
      'listing four things: what was fixed; what was deferred and why; what was rebutted and on what basis, whether a measurement, the documentation, or a deliberate design decision',
      'settled block lost the four-item enumeration',
    ],
    [
      '; and what was examined and left alone on purpose. That last category is not optional',
      'examined-and-left-alone demoted out of the mandated list',
    ],
    [
      'these are settled and are not to be re-reported',
      'settled block lost its do-not-re-report rule',
    ],
    [
      'must say so with new evidence rather than restating',
      'settled block lost the new-evidence escape',
    ],
    ['Every leg gets it, Codex included,', 'settled block lost its route to the Codex brief'],
  ]);
});

test('Phase 7 checks release-note files against the diff, and cleanup may not fake the check', () => {
  const skillBody = readFileSync(REVIEW_SKILL, 'utf8');
  const section = phase(skillBody, 7, 'review');
  const line = markedLine(
    section,
    'Check every release-note file in play against the diff itself',
    'review: release-note check expected exactly once in Phase 7',
  );
  if (line !== undefined) {
    // Bound to the marker's own line: a clause parked in an unrelated Phase 7
    // bullet satisfied a section-wide match (measured). Residuals, as in the
    // Phase 3 test: a negation wrapped around an intact span, and the
    // paragraph relocated within the section, both still pass.
    expectAnchors(line, 'review', [
      [
        'plus any already staged before the cycle began',
        'release-note check no longer covers files staged in an earlier pass',
      ],
      [
        'against the final post-fix state and correct it',
        'release-note check lost its final-state correct-or-report rule',
      ],
      [
        'last, after cleanup has finished editing',
        'release-note check no longer runs after cleanup',
      ],
      [
        'Do this yourself, whichever cleanup mode runs',
        'release-note check no longer binds both cleanup modes',
      ],
      [
        "the summary's release-note field, separately from wording changes",
        'release-note check lost its route to the Phase 9 field',
      ],
    ]);
    // A second directive elsewhere in Phase 7 restores the pre-fix order while
    // every anchor above still matches. Bold-lead lines only: an unscoped
    // count also fires on prose describing the step; bullet and indented
    // directives count too, being the form Phase 7 already uses. Residual:
    // splitting the instruction into two bold directives trips this
    // legitimately.
    const directives = section.filter(
      (l) => /^[ \t\v\f\r]*(- )?\*\*/.test(l) && /release[- ]note|changeset|bump file/i.test(l),
    );
    expect
      .soft(
        directives.length,
        'review: Phase 7 mentions release notes off the marker line — a second, earlier check would undo the ordering',
      )
      .toBe(1);
  }
  // Whole line, not the label: 'Release-note corrections: N — <ignore; always
  // print none>' satisfied a label-only anchor.
  expectAnchors(phase(skillBody, 9, 'review').join('\n'), 'review', [
    [
      'Release-note corrections: N — <file, the claim that no longer matched the diff> | none | not checked (<reason>) | no release-note file in this diff',
      'Phase 9 lost the release-note corrections field',
    ],
  ]);
  const evidence = h2Section(readFileSync(CLEANUP_AGENT, 'utf8'), 'Evidence');
  expect(evidence.trim(), 'cleanup: Evidence section not found').not.toBe('');
  expectAnchors(evidence, 'cleanup', [
    [
      'Never report that prose matches the code unless you compared them line by line.',
      'lost the ban on asserting an unverified match',
    ],
    [
      'Either compare and say what you compared, or say you did not check',
      'lost the sanctioned alternative to the ban',
    ],
  ]);
});

test('a planted agent without the contract is named', () => {
  // Planted in a sandbox rather than the repo: a run killed mid-test never
  // reaches its cleanup, so a plant here would strand a file that Claude Code
  // then loads as a live plugin agent.
  const sandbox = makeTempDir();
  for (const name of readdirSync(AGENTS_DIR).filter((entry) => entry.endsWith('.md'))) {
    copyFileSync(path.join(AGENTS_DIR, name), path.join(sandbox, name));
  }
  writeFileSync(
    path.join(sandbox, 'zz-not-a-real-agent.md'),
    '---\nname: zz-not-a-real-agent\n---\n\nNo containment here.\n',
  );

  const files = listAllAgents(sandbox);
  expect(files.map((f) => path.basename(f))).toContain('zz-not-a-real-agent.md');
  const missing = files
    .filter((f) => !readFileSync(f, 'utf8').includes(EVADE_ANCHOR))
    .map((f) => path.basename(f));
  expect(missing).toContain('zz-not-a-real-agent.md');
});
