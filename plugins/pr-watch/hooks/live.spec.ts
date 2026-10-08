import { expect, test } from 'vitest';

// Throwaway: fails on purpose to exercise pr-watch's failure wake.
test('fails on purpose', () => {
  expect(1).toBe(2);
});
