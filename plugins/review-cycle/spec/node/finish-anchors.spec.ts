// The skill is what makes a clean cycle end in a commit, or in a question when
// the user's stop-before setting stops before one, and what keeps a push
// waiting for the user's request.

import { expect, test } from 'vitest';

import { skillText } from './agents';

// After the commit, cheap deferrals are fixed, a follow-up fix that fails its
// review is dropped rather than patched, and only filing waits for the user.
test('after the commit, the review fixes the cheap deferrals and asks only about filing', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain('Only after Phase 10 committed and the cycle deferred something');
  expect(text).toContain('Never ask the user which deferred findings to address');
  expect(text).toContain(
    '*Fix now*: the fix is a sentence or a test, below the bar and `pre-existing` included',
  );
  expect(text).toContain('*Leave*: held at the ceiling,');
  expect(text).toContain('a confirmation pass by `review-cycle:code-reviewer` on the follow-up');
  expect(text).toContain(
    'call `mcp__review-cycle__scratch` first and `mcp__review-cycle__sweep` after',
  );
  expect(text).toContain('**Never patch a follow-up fix.**');
  expect(text).toContain(
    'When the pass faults any of them, discard the whole follow-up (restore what it changed, delete what it created)',
  );
  expect(text).toContain('move every fix-now finding to *Leave* (`follow-up failed review`)');
  expect(text).toContain('When clean, commit it as one follow-up commit');
  expect(text).toContain('pass them to `mcp__review-cycle__ledger_record` as `resolve`');
  expect(text).toContain("once the commit is pushed, rewrite an open pull request's Known issues");
  // The consent gate reads a yes only to the reply's last line, and only
  // when a blank line sits above it, so an offer question keeps that line.
  expect(text).toContain(
    'one question in its own paragraph: whether to file any of them, above any offer question the reply must end with',
  );
  expect(text).toContain('Under a job (Phase 1), report them instead of asking');
  expect(text).toContain('Phase 11 fixes the cheap ones and asks before filing any');
});

test('the review skill commits a clean result and pushes only on request', () => {
  const text = skillText('review-cycle', 'review');
  expect(text).toContain('commit the reviewed work now');
  expect(text).toContain('unless `mcp__review-cycle__status` reports `mayCommit` false');
  expect(text).toContain('held off a commit');
  expect(text).toContain("Push only when the user's latest message asked for one");
  expect(text).toContain('or when `mcp__review-cycle__status` reports `mayPush`');
  // prUpdates lets a fix's push to the user's own pull request run unasked;
  // mayPush leaves prUpdates out, and prUpdates leaves a held push out.
  expect(text).toContain(
    "When its `prUpdates` is not `ask` and the user held off no push, also push a fix to the user's own open, unapproved pull request without asking",
  );
  expect(text).toContain('neither their stop-before nor their prUpdates setting allows');
  expect(text).toContain('After "ship it", also open the pull request');
  expect(text).toContain('open one only when the status reports `mayOpenPr`');
  expect(text).toContain(
    'The gate refuses it; ask them in your reply, naming what it pushes and where, and end your turn.',
  );
});
