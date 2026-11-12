// Under a job started with "do epic <id>" nobody answers mid-run, so the cycle
// turns each of its stops into something the job's report carries; only this
// wording does it.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('under a job the review never stops to ask', () => {
  const text = skillText('review-cycle', 'review');
  const one = phase(text, 1, 'Preflight').join('\n');
  expect(one).toContain(
    "**Under a job, the cycle never stops to ask.** When the status tool's `stopBefore.mandate` names an epic, the user started a job and reads its report, not this turn.",
  );
  expect(one).toContain(
    'Scope creep (Phase 4) becomes a `question` in the ledger and the summary, and the loop runs on to a commit.',
  );
  expect(one).toContain(
    "Findings held at the ceiling are deferred at Phase 6's exit with the reason `held at the ceiling`, so Phase 9 records them, and the clean result commits.",
  );
  expect(one).toContain(
    "Shelve the bead instead of committing, its held findings still deferred, when those findings fall in an area an earlier iteration also fixed or came mostly from this cycle's fixes, when Phase 8 leaves paths uncovered or finds the target contaminated, or when `mayCommit` is false: leave the tree for the job to set aside, and end the summary with `Final state: shelved (<why>)`.",
  );
  expect(phase(text, 4, 'Aggregate').join('\n')).toContain(
    "needs the user's decision, except under a job (Phase 1): stop here,",
  );
  expect(phase(text, 9, 'Final summary').join('\n')).toContain(
    'Final state: clean / N findings remain / shelved (<why>)',
  );
  expect(text.slice(text.indexOf('### Phase 10'))).toContain(
    'held at the ceiling outside a job (Phase 1)',
  );
});
