import { expect, test } from 'vitest';

import { isSpend, NO_SPEND, spentWith } from '../../hooks/review/spend';

const usage = (input: number, write: number, read: number, output: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  output_tokens: output,
});

test('each response adds a step and its four counts', () => {
  const once = spentWith(NO_SPEND, usage(1, 2, 3, 4));
  expect(spentWith(once, usage(10, 20, 30, 40))).toEqual({
    steps: 2,
    input: 11,
    cacheWrite: 22,
    cacheRead: 33,
    output: 44,
  });
});

test('a spend is five whole counts, none negative', () => {
  expect(isSpend(NO_SPEND)).toBe(true);
  expect(isSpend({ ...NO_SPEND, output: 1.5 })).toBe(false);
  expect(isSpend({ ...NO_SPEND, input: -1 })).toBe(false);
  const { steps: _, ...missing } = NO_SPEND;
  expect(isSpend(missing)).toBe(false);
  expect(isSpend(null)).toBe(false);
});
