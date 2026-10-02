// A fix to shell.ts changed what command.ts's classify returned, the suite
// stayed green, and only a question about parse's other callers caught it. A
// fix to code imported outside the diff names those importers, and the next
// iteration measures them.

import { expect, test } from 'vitest';

import { phase, skillText } from './agents';

test('a fix to imported code names its importers, and the next iteration measures them', () => {
  const text = skillText('review');
  const six = phase(text, 6, 'Verify').join('\n');
  expect(six).toContain(
    'A fix that changes what code imported by files outside the diff does is substantive whatever its size, even one that would otherwise be mechanical or a verified message fix.',
  );
  expect(six).toContain(
    'Find those importers with one search for the end of the module path, whatever prefix importers write before it (`./shell`, `../hooks/shell`, an alias), such as `/shell["\']` for `shell.ts`: a multi-line import puts only its last line next to the path. Name them in the summary draft.',
  );
  expect(six).toContain('`code-reviewer` always among them when importers were named;');
  expect(phase(text, 3, 'Fan-out').join('\n')).toContain(
    'From iteration 2, when Phase 6 named importers outside the diff, ask instead which of those callers behave differently, measured old against new on their existing inputs.',
  );
});
