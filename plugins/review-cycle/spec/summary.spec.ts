import { expect, test } from 'vitest';

import { summaryHeader, summaryText } from '../hooks/summary';

const BLOCK = ['Review cycle complete.', '', 'Tier: light', 'Final state: clean'].join('\n');

test('reads the summary the call carries, and nothing else', () => {
  expect(summaryText({ text: BLOCK })).toBe(BLOCK);
  expect(summaryText({ text: 5 })).toBe('');
  expect(summaryText(null)).toBe('');
  expect(summaryText({})).toBe('');
});

test('draws the call as a line count, not the block', () => {
  expect(summaryHeader({ text: BLOCK })).toEqual({ lines: 4 });
  expect(summaryHeader({})).toEqual({ lines: 0 });
});
