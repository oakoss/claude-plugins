import { describe, expect, test } from 'vitest';

import { classify, type PushSpec } from './command';
import type { PushLevel } from './consent';
import { neededFor, unasked } from './push-verdict';

function specOf(command: string): PushSpec {
  const c = classify(command);
  if (c.kind !== 'gated' || c.push === null) throw new Error(`not a push: ${command}`);
  return c.push;
}

const grant = (push: PushLevel) => ({ push });

describe('the request a push needs', () => {
  test.each([
    ['git push', 'push'],
    ['git push --force-with-lease', 'lease'],
    ['git push --force', 'bare'],
    ['git push origin +main', 'bare'],
  ])('%s needs %s', (command, needed) => {
    expect(neededFor(specOf(command))).toBe(needed);
  });
});

describe('what a grant covers', () => {
  const cases: [string, PushLevel, string | null][] = [
    ['git push', 'none', 'push'],
    ['git push', 'push', null],
    ['git push --force-with-lease', 'push', 'lease'],
    ['git push --force-with-lease', 'lease', null],
    ['git push --force', 'lease', 'bare'],
    ['git push --force', 'bare', null],
    ['git push', 'bare', null],
  ];
  test.each(cases)('%s under %s', (command, level, missing) => {
    expect(unasked(specOf(command), grant(level))).toBe(missing);
  });
});
