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

import { AGENTS_DIR, expectAnchors, listAgents, REPO_ROOT, skillText } from './agents';

const AGENT_ANCHOR = 'Open your report with the execution receipt';
// Both anchors quote the fenced template's own wording rather than the bare
// `execution:` / `attempted-but-failed:` tokens, which also appear in the
// surrounding prose: a bare substring match would pass with the template line
// deleted.
const FIRST_LINE = 'execution: <the heaviest verification that SUCCEEDED';
const SECOND_LINE = "and the project's own build or test suite when you did not attempt it at all";
const BOTH_REQUIRED = 'Both lines are required';
const OUTPUT_NOTE = 'Emit the execution receipt above this';

const GRADING = readFileSync(
  path.join(REPO_ROOT, 'plugins/review-cycle/reference/grading.md'),
  'utf8',
);

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

test('the shared grading reference defines every grade the skills weight legs by', () => {
  // Checked token by token so a failure names the missing token rather than
  // printing the whole file.
  for (const token of [
    'execution:',
    'attempted-but-failed:',
    'static-analysis-only',
    'partial (<what was unreachable>)',
    '`executed`',
    'the leg is `unknown`',
    'are not verifications',
    'a receipt quoting a compile error is `static-analysis-only`, never `executed`',
    'A leg that was skipped, failed, dropped, or capped carries no execution label',
  ]) {
    expect.soft(GRADING.includes(token), `reference/grading.md lacks: ${token}`).toBe(true);
  }
  expect(GRADING).toMatch(/\|\s*yes\s*\|\s*`none`\s*\|\s*`executed`\s*\|/);
  expect(GRADING).toMatch(/\|\s*no\s*\|\s*—\s*\|\s*`static-analysis-only`\s*\|/);
});

test('both skills grade legs by the shared reference, and carry no copy of it', () => {
  for (const skill of ['review', 'review-pr']) {
    const text = skillText('review-cycle', skill);
    expectAnchors(text, skill, [
      [
        `\`\${CLAUDE_PLUGIN_ROOT}/reference/grading.md\`: read it before grading the first leg`,
        'no pointer',
      ],
    ]);
    expect(text, `${skill}: still carries its own grading table`).not.toContain(
      '| line one names a verification that succeeded |',
    );
  }
});

const legExecutionLine = (skill: string) =>
  skillText('review-cycle', skill)
    .split('\n')
    .find((l) => l.startsWith('Leg execution:'));

test('both skills report leg execution with the same summary line', () => {
  expect(legExecutionLine('review'), 'review lost its Leg execution: line').toBeDefined();
  expect(legExecutionLine('review-pr'), 'review-pr drifted from review').toBe(
    legExecutionLine('review'),
  );
});

test('every reviewer agent carries the same receipt block, byte for byte', () => {
  // Agent bodies cannot include a shared file, so the copies are held equal here.
  const blocks = listReviewerAgents().map((f) => {
    const text = readFileSync(f, 'utf8');
    const start = text.indexOf(AGENT_ANCHOR);
    const end = text.indexOf(
      '\n\n',
      text.indexOf('**One report, when your work is done.**', start),
    );
    return { name: path.basename(f), block: text.slice(start, end) };
  });
  const [first] = blocks;
  expect(first?.block.length).toBeGreaterThan(200);
  for (const { name, block } of blocks) {
    expect(block, `${name} drifted from ${first?.name}`).toBe(first?.block);
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

test("the Codex leg's receipt is written from its command log", () => {
  // `codex review` prints its own verdict, which carries the receipt lines only
  // sometimes, so the receipt comes from the commands its log records.
  expectAnchors(GRADING, 'reference/grading.md', [
    ["**Write the Codex leg's receipt yourself, from its command log**", 'no log receipt'],
    ['call `mcp__review-cycle__codex_log` with its output file', 'log tool not named'],
    [
      'the heaviest verification among its `succeeded` commands not `guessed`',
      'line one source lost',
    ],
    [
      'every verification that `exited`, was `rejected`, stayed `unfinished` or is `guessed`',
      'line two source lost',
    ],
    ['failed despite exit 0', 'a masked failure reads as success'],
    ["the project's build or test suite when no command ran it", 'unattempted suite dropped'],
    [
      'A `masked` success confirms only its last part; its earlier verifications go on line two',
      'a chained failure reads as success',
    ],
    [
      'A leg that participated with no commands has `execution: none`',
      'a no-command run reads as unknown',
    ],
    [
      'When the tool is missing or answers with an error, read the receipt off its verdict',
      'no fallback',
    ],
  ]);
});

test("each skill's Codex brief steers it, and asks it for no receipt", () => {
  for (const skill of ['review', 'review-pr']) {
    const text = skillText('review-cycle', skill);
    expectAnchors(text, skill, [
      ['Leave the ask out of the Codex brief', 'brief still asks Codex for receipt lines'],
      [
        'tell Codex to join verification commands with &&, never ; or a newline',
        'Codex is not steered away from chains that hide failures',
      ],
      ['FORCE_COLOR=1 codex review', 'Codex logs lose the color its markers are read by'],
      ['attempted-but-failed:', 'brief omits line two'],
      ['never attempted it', 'brief omits the unattempted-check clause'],
    ]);
    expect(text, `${skill}: still sends Codex the receipt ask`).not.toMatch(
      /Codex learns them only from the brief|Codex does not, so the brief is the only channel/,
    );
  }
});
