// A review converges in fewer rounds when legs name a finding's cause, keep
// the base's defects out of the fix loop, finish inside a budget, and the
// ceiling offers a smaller design; only this wording asks for any of it.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { AGENTS_DIR, skillText } from './agents';

test('every brief asks for the cause, a pre-existing tag and a budget', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain("**Every brief, Codex's included, also asks for three things.**");
  expect(text).toContain('report the cause and the change that removes it, not only each instance');
  expect(text).toContain('Tag a finding `pre-existing` when it reproduces on the base');
  expect(text).toContain('Report within 10 minutes: settle the question first');
});

test('review-pr briefs ask for the same three things', () => {
  const text = skillText('review-cycle', 'review-pr');
  expect(text).toContain("Every brief, Codex's included, also asks for three things:");
  expect(text).toContain('tag a finding `pre-existing` when it reproduces on the base');
  expect(text).toContain('report within 10 minutes, settling the question first');
  expect(text).toContain(
    "A `pre-existing` tag survives too: such a finding is reported, and posted, apart from the pull request's own findings",
  );
  expect(text).toContain('does not count toward the verdict.');
  expect(text).toContain('Pre-existing (predates this PR, not counted): <items | none>');
  expect(text).toContain(
    "<N> counts only the PR's own findings: a report whose only findings are pre-existing reads clean under full coverage)",
  );
  expect(text).toContain('pre-existing findings wherever they sit — goes in the review body');
});

test('the code reviewer reports a pre-existing issue instead of scoring it away', () => {
  const body = readFileSync(path.join(AGENTS_DIR, 'code-reviewer.md'), 'utf8');
  expect(body).not.toContain('false positive or pre-existing');
  expect(body).toContain('is scored on its own merits and reported tagged `pre-existing`');
});

test('a pre-existing finding is deferred to the ledger, not fixed', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain(
    "A finding tagged `pre-existing`, once you confirm it on the base, is not this change's: defer it",
  );
  expect(text).toContain(
    '<criterion from fix-vs-defer policy | held at the ceiling | pre-existing>',
  );
});

test('findings held in an area fixed before offer to reconsider the approach first', () => {
  const text = skillText('review-cycle', 'review');
  const ten = text.slice(text.indexOf('### Phase 10'));
  expect(ten).toContain('offer first to reconsider the approach, naming the smaller design');
});
