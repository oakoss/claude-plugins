// The ledger only cuts re-litigation if the skill reads it into every brief
// and records to it at the end; nothing but these anchors notices either step
// going missing.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('every brief carries the ledger, and changed code reopens an entry', () => {
  const text = skillText('review');
  expect(text).toContain('**Every brief carries what earlier cycles settled.**');
  expect(text).toContain('call the `mcp__review-cycle__ledger` tool with the changed-file list');
  expect(text).toContain('a `settled in earlier cycles` block');
  expect(text).toContain('each listed as reopened so the legs judge it afresh');
  expect(text).toContain(
    'a `changed` entry whose `git diff <blob> <current>` touches the code it cites',
  );
  expect(text).toContain(
    'an entry whose `changed` is null, since nothing checked it; and a `stale` one',
  );
  expect(text).toContain(
    "**Both report-only spawns also carry Phase 3's `settled in earlier cycles` block**",
  );
  expect(text).toContain('or answers with an error rather than JSON, write `Ledger: unavailable');
});

test('Phase 9 records what the cycle settled and resolves what it fixed', () => {
  const text = skillText('review');
  expect(text).toContain('**Record the cycle in the ledger first**');
  expect(text).toContain('`mcp__review-cycle__ledger_record`');
  expect(text).toContain('Pass as `resolve` the ids of carried entries this cycle fixed');
  expect(text).toContain('A fixed finding is never recorded');
  expect(text).toContain(
    'Pass as `keep` the ids of every other carried entry that was not reopened',
  );
  expect(text).toContain('A reopened entry the legs settled again goes in `entries`');
  expect(text).toContain('Ledger: carried N from earlier cycles');
  expect(text).toContain('K kept, R resolved[, G gone][, E evicted][, D dropped unreadable]');
});
