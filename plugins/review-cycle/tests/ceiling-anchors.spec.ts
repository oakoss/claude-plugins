// A fix applied on the last iteration is content no reviewer sees, so the gate
// refuses the commit and "commit with it deferred" could never succeed. The
// last iteration holds its findings and asks instead.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('the ceiling is 2 light and 3 full, and the last iteration holds its findings', () => {
  const text = skillText('review');
  expect(text).toContain('overriding the tier default (3 for the full tier, 2 for light;');
  expect(text).toContain('default iteration ceiling 2 (an explicit user `max` still wins)');
  expect(text).toContain('Full conditional fan-out, default ceiling 3,');
  expect(phase(text, 5, 'Apply').join('\n')).toContain(
    '- On the iteration that reaches the ceiling, apply no fix: no reviewer would see it, so the gate would refuse the commit. Hold each finding you would have fixed, with its severity and leg, for Phase 10\n',
  );
  const six = phase(text, 6, 'Verify').join('\n');
  expect(six).toContain(
    '- NO inline fixes applied and none held at the ceiling (everything clean or correctly deferred) → exit loop, converged.',
  );
  expect(six).toContain('- Findings held at the ceiling (Phase 5) → exit loop **held**.');
  const ten = text.slice(text.indexOf('### Phase 10'));
  expect(ten).toContain(
    'When the final state is clean, nothing is still held at the ceiling, and every path is covered, commit',
  );
  expect(ten).toContain('or when findings other than held ones remain that need their decision.');
  expect(ten).toContain(
    "When findings are held at the ceiling, skip the commit and end the summary by listing them and asking in plain prose, not a dialog, whether to apply them or commit with them deferred; the user may answer with something else entirely. Applied, they get the re-review Phase 6 gives their class, outside Phase 5's ceiling rule, and that pass's own findings follow Phase 8's rule: one more pass, then stop and list. A clean re-review with every path covered commits as above. Deferred, they leave nothing held: commit as above.",
  );
  expect(text).toContain('ceiling of <max> reached, N findings held');
  expect(text).toContain('<criterion from fix-vs-defer policy | held at the ceiling>');
});
