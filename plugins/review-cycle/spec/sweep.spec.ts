import { describe, expect, test } from 'vitest';

import { madeByAnother, ownerOf, scratchNamed } from '../hooks/sweep';

describe('the owner mark', () => {
  // As measured: ps -o lstart= pads its answer with trailing spaces.
  const mark = '63359\tSat Nov  7 14:42:33 2026    \n';

  test('reads a pid and a start time, and nothing else', () => {
    expect(ownerOf(mark)).toEqual({ pid: 63_359, started: 'Sat Nov  7 14:42:33 2026' });
    for (const bad of ['', '63359', 'x\tSat', '1\tSat Nov  7', '63359\t   ']) {
      expect(ownerOf(bad)).toBeNull();
    }
  });

  test('another process still running made it; this one, or a reused pid, did not', () => {
    const owner = ownerOf(mark)!;
    expect(madeByAnother(owner, 63_390, 'Sat Nov  7 14:42:33 2026  ')).toBe(true);
    expect(madeByAnother(owner, 63_359, 'Sat Nov  7 14:42:33 2026')).toBe(false);
    expect(madeByAnother(owner, 63_390, 'Sun Nov  8 09:00:00 2026')).toBe(false);
    expect(madeByAnother(owner, 63_390, '')).toBe(false);
  });
});

const answer = (dir: string) => `${dir}\nGive every reviewer leg this path: …`;

describe('scratchNamed', () => {
  test("reads each scratch answer's directory under tmp, once each", () => {
    expect(
      scratchNamed(
        [
          answer('/tmp/review-cycle.aB3dE9'),
          answer('/tmp/review-cycle.aB3dE9'),
          answer('/tmp/review-cycle.Zz9'),
        ],
        '/tmp',
      ),
    ).toEqual(['/tmp/review-cycle.aB3dE9', '/tmp/review-cycle.Zz9']);
  });

  test('a refusal, another directory, or a path that leaves tmp names nothing', () => {
    expect(
      scratchNamed(
        [
          "review-cycle's sweep tool is not registered, so it made no scratch directory.",
          '/tmpx/review-cycle.abc123\n…',
          '/tmp/review-cycle.abc/../../etc\n…',
          '/tmp/review-cycle.\n…',
          '/tmp/other.abc123\n…',
          // As long as the prefix, so only the prefix check refuses it.
          '/Users/jacebabin/code\n…',
        ],
        '/tmp',
      ),
    ).toEqual([]);
  });
});
