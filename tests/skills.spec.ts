import { expect, test } from 'vitest';

import { section } from './skills';

const DOC = '# Title\n\n## Rules\n\nKeep it short.\n\n## Empty\n\n## Last\n\nEnd.\n';

test('section returns the body up to the next heading', () => {
  expect(section(DOC, 'Rules', 'doc').trim()).toBe('Keep it short.');
  expect(section(DOC, 'Last', 'doc').trim()).toBe('End.');
});

test('section throws on a missing or empty heading rather than returning nothing to check', () => {
  expect(() => section(DOC, 'Renamed', 'doc')).toThrow('doc: no "## Renamed" section');
  expect(() => section(DOC, 'Empty', 'doc')).toThrow('doc: "## Empty" section is empty');
  expect(() => section(DOC, 'Rule', 'doc')).toThrow('no "## Rule" section');
});
