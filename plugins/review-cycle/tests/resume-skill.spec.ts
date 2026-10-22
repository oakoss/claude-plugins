// What a compaction hands back of the review skill as it stands: a change to
// the skill's size or headings moves where the re-attached copy is cut.

import path from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT, skillText } from '../../../tests/skills';
import { KEPT, RESUMED, resumeText } from '../hooks/resume';

// The skill as the engine expands it: a base-directory line, then the body.
const DIR = path.join(REPO_ROOT, 'plugins/review-cycle/skills/review');
const EXPANDED = `Base directory for this skill: ${DIR}\n\n${skillText('review-cycle', 'review').replace(/^---\n[\s\S]*?\n---\n\s*/, '')}`;

// The re-attached copy is cut inside Phase 3's ledger step.
test('hands back everything from Phase 3 on, and nothing the copy lacks', () => {
  const text = resumeText(EXPANDED);
  expect(text?.startsWith(RESUMED)).toBe(true);
  const rest = text!.slice(text!.indexOf('\n\n') + 2);
  expect(rest.startsWith('### Phase 3: Fan-out')).toBe(true);
  expect(EXPANDED.endsWith(rest)).toBe(true);
  expect(EXPANDED.length - rest.length).toBeLessThanOrEqual(KEPT);
});
