// The comment policy is restated in the skill, the cleanup agent and the
// snippet users copy, and a trim of any one would go unnoticed.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AGENTS_DIR, expectAnchors, REPO_ROOT, skillText, type Anchor } from './agents';

const EARNS =
  'without it, the next reader would get something wrong, or have to run or search something to learn it';
const ONCE = 'States a rule once, beside the code that enforces it';
const CHURN = 'lists presented as complete';
const SHORT = 'Summarizing a function short enough to read';

const read = (file: string) => readFileSync(file, 'utf8');

test('the skill deletes a comment not clearly worth keeping, and keeps no churn-prone facts', () => {
  const anchors: Anchor[] = [
    [EARNS, 'the test a comment must pass'],
    [ONCE, 'a rule is stated once'],
    [CHURN, 'facts the code holds and will change'],
    ['Facts the code holds and will change', 'churn-prone facts are avoided'],
    ['a measured version or number stays', 'measured facts are kept'],
    ['Labels on test cases or inputs that already read clearly', 'input labels'],
    ['Narrating the assertion or call on the next line', 'assertion narration'],
    [SHORT, 'short-function summaries'],
    ['If a comment is not clearly worth keeping, delete it.', 'delete by default'],
  ];
  expectAnchors(skillText('review-cycle', 'review'), 'review skill', anchors);
  expectAnchors(
    read(path.join(REPO_ROOT, 'plugins/review-cycle/reference/policies.md')),
    'policies.md',
    anchors,
  );
});

test('the cleanup agent applies the same test and rewrites churn-prone facts', () => {
  expectAnchors(read(path.join(AGENTS_DIR, 'cleanup.md')), 'cleanup agent', [
    [EARNS, 'the test a comment must pass'],
    [ONCE, 'a rule is stated once'],
    [CHURN, 'facts the code holds and will change'],
    ['Labels on test cases or inputs that already read clearly', 'input labels'],
    ['Narrating the assertion or call on the next line', 'assertion narration'],
    [SHORT, 'short-function summaries'],
    ['A rule restated from the code that enforces it', 'restated rules are cut'],
    ['will change** — counts', 'churn-prone facts have their own case'],
    ['**rewrite rather than remove**', 'churn-prone facts are rewritten, not removed'],
    ['A measured version or number stays', 'measured facts are kept'],
    ['If it is not clearly worth keeping, delete it.', 'delete by default'],
    ['Unsure whether it is worth keeping is not: delete it.', 'doubt about worth deletes'],
  ]);
});

// The cleanup agent takes the first case that matches, so a churn-carrying
// comment is rewritten only while its case comes before the one that keeps.
test("the cleanup agent's churn case comes before the case that keeps", () => {
  const text = read(path.join(AGENTS_DIR, 'cleanup.md'));
  const churn = text.indexOf('will change** — counts');
  const keep = text.indexOf('**Tight and genuinely useful** → **keep.**');
  expect(churn, 'churn case').toBeGreaterThan(-1);
  expect(keep, 'keep case').toBeGreaterThan(churn);
});
