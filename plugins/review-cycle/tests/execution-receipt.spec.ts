// Guard for the execution receipt: every reviewer leg the cycle can dispatch
// must ask for it, and both skills must define the grades they weight legs by.
//
// The contract lives in eight prose files with nothing linking them, so it
// breaks silently: a seventh reviewer added later, or the paragraph lost in a
// rewrite, leaves the cycle grading that leg `unknown` with nothing saying why.
//
// This checks that the instruction is present, not that an agent emits the line
// at runtime — it catches a partial revert and an agent that never joined.
//
// `cleanup.md` is excluded by name: it edits the target and files no findings,
// so there is nothing to grade.

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

import { AGENTS_DIR, expectAnchors, listAgents, skillText } from './agents';

const AGENT_ANCHOR = 'Open your report with the execution receipt';
// Both anchors quote the fenced template's own wording rather than the bare
// `execution:` / `attempted-but-failed:` tokens, which also appear in the
// surrounding prose: a bare substring match would pass with the template line
// deleted.
const FIRST_LINE = 'execution: <the heaviest verification that SUCCEEDED';
const SECOND_LINE = "and the project's own build or test suite when you did not attempt it at all";
const BOTH_REQUIRED = 'Both lines are required';
const OUTPUT_NOTE = 'Emit the execution receipt above this';

// Six reviewers today. A floor, not a count: the per-file loop is what catches
// one dropping out, and this only catches the enumeration collapsing.
const AGENT_FLOOR = 6;

function listReviewerAgents(dir = AGENTS_DIR): string[] {
  return listAgents({ dir, min: AGENT_FLOOR, exclude: ['cleanup.md'] });
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'execution-receipt-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('every reviewer agent asks for the execution receipt', () => {
  for (const f of listReviewerAgents()) {
    expectAnchors(readFileSync(f, 'utf8'), path.basename(f), [
      [AGENT_ANCHOR, 'no receipt instruction'],
      [FIRST_LINE, 'no execution: line'],
      [SECOND_LINE, 'line two lost the unattempted-check clause'],
      [BOTH_REQUIRED, 'no longer requires both lines'],
      [OUTPUT_NOTE, 'output template does not place the receipt first'],
    ]);
  }
});

test('cleanup is excluded, and is the only agent that is', () => {
  const names = listReviewerAgents().map((f) => path.basename(f));
  expect(names).not.toContain('cleanup.md');
  expect(names).toContain('code-reviewer.md');
  expect(names).toContain('spec-conformance-analyzer.md');
});

test('both skills define every grade they weight legs by', () => {
  for (const skill of ['review', 'review-pr']) {
    const text = skillText(skill);
    // Checked token by token so a failure names the missing token rather than
    // printing a body that runs to hundreds of lines.
    for (const token of [
      'execution:',
      'attempted-but-failed:',
      'static-analysis-only',
      'partial (<what was unreachable>)',
      '`executed`',
      'the leg is `unknown`',
      'are not verifications',
      'Leg execution:',
      '| yes | `none` | `executed` |',
      '| no | — | `static-analysis-only` |',
    ]) {
      expect.soft(text.includes(token), `${skill}/SKILL.md lacks: ${token}`).toBe(true);
    }
  }
});

test('the scan fails instead of passing when enumeration reaches too few files', () => {
  expect(() => listReviewerAgents(makeTempDir())).toThrow('scan reached only 0');
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
    '---\nname: zz-not-a-real-agent\n---\n\nNo receipt here.\n',
  );

  const files = listReviewerAgents(sandbox);
  expect(files.map((f) => path.basename(f))).toContain('zz-not-a-real-agent.md');
  const missing = files
    .filter((f) => !readFileSync(f, 'utf8').includes(AGENT_ANCHOR))
    .map((f) => path.basename(f));
  expect(missing).toContain('zz-not-a-real-agent.md');
});

test("each skill's brief carries the receipt ask that reaches Codex", () => {
  // Its own test, not a token in the grade list: the brief is the only channel
  // that reaches the Codex leg, and a guard that reports "a grade is missing"
  // when the whole channel was deleted sends the reader to the wrong file.
  for (const skill of ['review', 'review-pr']) {
    const text = skillText(skill);
    const brief = text
      .split('\n')
      .some((line) =>
        /the (only )?channel that reaches it|brief is (again )?the only channel/i.test(line),
      );
    expect.soft(brief, `${skill}: no brief paragraph naming the Codex channel`).toBe(true);
    if (!brief) continue;
    expectAnchors(text, skill, [
      ['attempted-but-failed:', 'brief omits line two'],
      ['never attempted it', 'brief omits the unattempted-check clause'],
    ]);
  }
});
