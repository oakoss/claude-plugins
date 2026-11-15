import type { KeptSpend } from '../types';

export const NO_SPEND: KeptSpend = { steps: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

// The four counts as the API reports one response's usage (ModelUsage).
type Usage = Readonly<{
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}>;

export const spentWith = (s: KeptSpend, u: Usage): KeptSpend => ({
  steps: s.steps + 1,
  input: s.input + u.input_tokens,
  cacheWrite: s.cacheWrite + u.cache_creation_input_tokens,
  cacheRead: s.cacheRead + u.cache_read_input_tokens,
  output: s.output + u.output_tokens,
});

const KEYS = ['steps', 'input', 'cacheWrite', 'cacheRead', 'output'] as const;

export function isSpend(x: unknown): x is KeptSpend {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return KEYS.every((k) => Number.isSafeInteger(o[k]) && (o[k] as number) >= 0);
}
