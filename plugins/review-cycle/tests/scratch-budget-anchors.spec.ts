// The gate makes the scratch directory, sweeps it, and keeps each leg's clock,
// but only the skills tell the session to call those tools and stop a capped
// leg; nothing else notices when that wording goes missing.

import { expect, test } from 'vitest';

import { skillText } from './agents';

test('the review skill makes, hands out and sweeps the scratch directory', () => {
  const text = skillText('review');
  expect(text).toContain('**Before the first fan-out, call `mcp__review-cycle__scratch` once**');
  expect(text).toContain('a private directory you make with mktemp -d <SCRATCH>/leg.XXXXXX');
  expect(text).toContain('Call `mcp__review-cycle__sweep` first');
  expect(text).toContain('call `mcp__review-cycle__sweep` before it.');
  expect(text).toContain('Scratch swept:');
});

test('the review skill stops a leg past its budget and reports it as capped', () => {
  const text = skillText('review');
  expect(text).toContain('Stop that leg with the TaskStop tool');
  expect(text).toContain('Reviewers capped (over budget):');
  expect(text).toContain('<each `cappedReviews` entry from the status tool');
});

test('review-pr makes and sweeps the scratch directory too', () => {
  const text = skillText('review-pr');
  expect(text).toContain('**Call `mcp__review-cycle__scratch` once**');
  expect(text).toContain('mktemp -d <SCRATCH>/leg.XXXXXX');
  expect(text).toContain('First call `mcp__review-cycle__sweep`');
});

test('review-pr stops a leg past its budget and counts it against coverage', () => {
  const text = skillText('review-pr');
  expect(text).toContain('stop it with the TaskStop tool and list it as capped');
  expect(text).toContain('`capped (over budget, stopped)`');
  expect(text).toContain('if any dispatched leg is `failed`, `dropped` or `capped`');
  expect(text).toContain('failed | dropped | capped (over budget, stopped)>');
});
