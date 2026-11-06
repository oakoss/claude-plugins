import { describe, expect, test } from 'vitest';

import {
  cycleOf,
  isIncomplete,
  isSummary,
  KEPT,
  readCycles,
  recordCycle,
  rollupOf,
  type Cycle,
} from './cycles';
import type { Store } from './ledger-store';

const BLOCK = `Review cycle complete.

Tier: full
Iterations: 3 (ceiling of 3 reached, 2 findings held)
Convergence: iteration 2: 3 of 4 from this cycle's fixes, iteration 3: 1 of 1 from this cycle's fixes (confirmation pass)
Findings fixed inline: 3
  - hooks/a.ts:10 — misses the empty case (code-reviewer, above, iteration 1)
  - hooks/a.spec.ts — no test for the empty case (pr-test-analyzer, below, iteration 1)
  - hooks/b.ts:4 — swallows the error (codex, silent-failure-hunter, above, iteration 2)

Findings deferred: 1
  - hooks/c.ts:2 — narrows a union by cast (type-design, below, iteration 3)
    reason: held at the ceiling (maintainability, above)

Spec conformance (iteration 1): bead x
  - leaves out a line (spec-conformance-analyzer, above)

Structural suggestions (report-only — prompt to address the ones you want):
  - hooks/a.ts:1 — split the module (confidence: high)

Final state: clean`;

const ZERO = { above: 0, below: 0, unknown: 0 };

describe('cycleOf', () => {
  test('reads the fields, and each bullet under the two findings fields', () => {
    expect(cycleOf(BLOCK, '2026-11-05', 'abc')).toEqual({
      date: '2026-11-05',
      head: 'abc',
      tier: 'full',
      iterations: 3,
      exit: 'ceiling',
      fixedCount: 3,
      deferredCount: 1,
      fixed: [
        { legs: ['code-reviewer'], side: 'above', iteration: 1 },
        { legs: ['pr-test-analyzer'], side: 'below', iteration: 1 },
        { legs: ['codex', 'silent-failure-hunter'], side: 'above', iteration: 2 },
      ],
      deferred: [{ legs: ['type-design-analyzer'], side: 'below', iteration: 3 }],
      later: 5,
      selfCaused: 4,
    });
  });
  test.each([
    ['converged', '2 (converged)'],
    ['converged', '2 (converged; ceiling of 3 not reached)'],
    ['own-work', '2 (generating its own work, 6 findings held)'],
    ['spec', '1 (stopped at iteration 1 for a spec decision)'],
    ['unknown', '2'],
  ])('reads an exit of %s from %j', (exit, line) => {
    expect(cycleOf(`Iterations: ${line}`, 'd', null).exit).toBe(exit);
  });
  test('reads a severity word as a side, and skips a bullet naming no leg and no side', () => {
    const c = cycleOf(
      [
        'Findings fixed inline: 4',
        '  - a (codex, medium)',
        '  - b (Important)',
        '  - c (review-cycle:code-reviewer)',
        '  - d (an inspector)',
        '  - none',
      ].join('\n'),
      'd',
      null,
    );
    expect(c.fixed).toEqual([
      { legs: ['codex'], side: 'below', iteration: null },
      { legs: [], side: 'above', iteration: null },
      { legs: ['code-reviewer'], side: 'unknown', iteration: null },
    ]);
  });
  test('names a source it does not know as other, matched whole', () => {
    expect(cycleOf('Findings fixed inline: 1\n  - a (inspector, above)', 'd', null).fixed).toEqual([
      { legs: ['other'], side: 'above', iteration: null },
    ]);
  });
  test('ends a field at the next one, and reads flush-left bullets', () => {
    const c = cycleOf(
      'Findings fixed inline: 1\n- a (codex, above)\nFindings deferred: 1\n  - b (cleanup, below)\n',
      'd',
      null,
    );
    expect(c.fixed).toEqual([{ legs: ['codex'], side: 'above', iteration: null }]);
    expect(c.deferred).toEqual([{ legs: ['cleanup'], side: 'below', iteration: null }]);
  });
  test('ends a field at a blank line', () => {
    const c = cycleOf(
      'Findings fixed inline: 2\n  - a (codex, above)\n\n  - b (codex, above)\n',
      'd',
      null,
    );
    expect(c.fixed).toHaveLength(1);
  });
  test('keeps the stated count when the bullets fold findings together', () => {
    const c = cycleOf(
      'Findings fixed inline: 14\n  - iteration 1: five fixes (codex)\n\nFindings deferred: none\n',
      'd',
      null,
    );
    expect([c.fixedCount, c.fixed.length, c.deferredCount]).toEqual([14, 1, 0]);
  });
  test.each([
    [
      "iteration 2: 1 of 3 from this cycle’s fixes, iteration 3: 0 of 1 from this cycle's fixes",
      [4, 1],
    ],
    ['iteration 1 only', [0, 0]],
    ["iteration 2: 5 of 2 from this cycle's fixes", [null, null]],
    ['iteration 2: 3 of 4 from own fixes', [null, null]],
    [
      "iteration 2: 0 of 2 from this cycle's fixes, iteration 3: 1 of unknown from this cycle's fixes",
      [null, null],
    ],
    [
      "iteration 2: 1 of 2 from this cycle's fixes, iteration 3 (confirmation pass): 0 of 1 from this cycle's fixes",
      [null, null],
    ],
    ["iteration 2: 1 of 2 from this cycle's fixes; iteration 3: unclear", [null, null]],
    ["iteration 2: 1 of 2 from this cycle's fixes and 7 more elsewhere", [null, null]],
    ['', [null, null]],
    ["see iteration 2: 1 of 2 from this cycle's fixes", [null, null]],
    ['see iteration 1 only', [null, null]],
    ["iteration 1 only, iteration 2: 0 of 1 from this cycle's fixes", [null, null]],
  ])('reads the Convergence line %j as later and self-caused %j', (line, expected) => {
    const c = cycleOf(`Convergence: ${line}`, 'd', null);
    expect([c.later, c.selfCaused]).toEqual(expected);
  });
  test.each([
    ['iteration 1 only', 1, [0, 0]],
    ['iteration 1 only', 2, [null, null]],
    ["iteration 2: 1 of 2 from this cycle's fixes", 3, [null, null]],
    [
      "iteration 2: 1 of 2 from this cycle's fixes, iteration 3: 0 of 1 from this cycle's fixes",
      3,
      [3, 1],
    ],
  ])('reads %j after %i iterations as later and self-caused %j', (line, n, expected) => {
    const c = cycleOf(`Iterations: ${n} (converged)\nConvergence: ${line}`, 'd', null);
    expect([c.later, c.selfCaused]).toEqual(expected);
  });
  test('reads a finding at iteration 0 as having no iteration', () => {
    expect(
      cycleOf('Findings fixed inline: 1\n  - a (codex, above, iteration 0)', 'd', null).fixed,
    ).toEqual([{ legs: ['codex'], side: 'above', iteration: null }]);
  });
  test('reads a block missing every field as nothing, not a failure', () => {
    expect(cycleOf('Final state: clean', 'd', null)).toMatchObject({
      tier: null,
      iterations: null,
      exit: 'unknown',
      fixedCount: null,
      deferredCount: null,
      fixed: [],
      deferred: [],
      later: null,
      selfCaused: null,
    });
    expect(cycleOf('Iterations: 0 (converged)', 'd', null).iterations).toBeNull();
  });
});

test('a block is a summary when it has an Iterations line', () => {
  expect([isSummary(BLOCK), isSummary('Iterations:'), isSummary('Tier: full')]).toEqual([
    true,
    true,
    false,
  ]);
});

describe('isIncomplete', () => {
  const COMPLETE = [
    'Iterations: 2 (converged)',
    "Convergence: iteration 2: 0 of 1 from this cycle's fixes",
    'Findings fixed inline: 1',
    '  - a (codex, above, iteration 1)',
    '',
    'Findings deferred: 0',
  ].join('\n');
  test('is false for a block read whole', () => {
    expect(isIncomplete(cycleOf(COMPLETE, 'd', null))).toBe(false);
  });
  test.each([
    ['an unread iteration count', COMPLETE.replace('Iterations: 2', 'Iterations: several')],
    ['an unread fixed count', COMPLETE.replace('inline: 1', 'inline: not recorded')],
    ['no deferred count', COMPLETE.replace('Findings deferred: 0', '')],
    ['an unread Convergence line', COMPLETE.replace("this cycle's", 'own')],
    ['fewer readable bullets than stated', COMPLETE.replace('inline: 1', 'inline: 2')],
    ['a bullet with text after its source', COMPLETE.replace('iteration 1)', 'iteration 1) — 85')],
    ['a finding with no iteration', COMPLETE.replace(', iteration 1', '')],
  ])('is true for %s', (_name, block) => {
    expect(isIncomplete(cycleOf(block, 'd', null))).toBe(true);
  });
});

describe('rollupOf', () => {
  test('totals the cycles, a finding counted once overall and once per leg', () => {
    const a = cycleOf(BLOCK, 'd', null);
    const b = cycleOf(
      'Iterations: 1 (converged)\nConvergence: iteration 1 only\nFindings fixed inline: 0\nFindings deferred: 0',
      'd',
      null,
    );
    const r = rollupOf([a, b]);
    expect(r).toMatchObject({
      cycles: 2,
      incomplete: 0,
      meanIterations: 2,
      exits: { converged: 1, ceiling: 1, 'own-work': 0, spec: 0, unknown: 0 },
      fixedCount: 3,
      deferredCount: 1,
      fixed: { above: 2, below: 1, unknown: 0 },
      droveRounds: { above: 2, below: 1, unknown: 0 },
      deferred: { above: 0, below: 1, unknown: 0 },
      later: 5,
      selfCaused: 4,
    });
    const drove = (side: 'above' | 'below') => ({ ...ZERO, [side]: 1 });
    expect(r.byLeg).toEqual({
      'code-reviewer': { fixed: drove('above'), droveRounds: drove('above'), deferred: ZERO },
      'pr-test-analyzer': { fixed: drove('below'), droveRounds: drove('below'), deferred: ZERO },
      codex: { fixed: drove('above'), droveRounds: drove('above'), deferred: ZERO },
      'silent-failure-hunter': {
        fixed: drove('above'),
        droveRounds: drove('above'),
        deferred: ZERO,
      },
      'type-design-analyzer': { fixed: ZERO, droveRounds: ZERO, deferred: drove('below') },
    });
  });
  test('counts a fix as driving a round only when another iteration followed it', () => {
    const r = rollupOf([
      cycleOf(
        [
          'Iterations: 2 (converged)',
          '  - x',
          'Findings fixed inline: 3',
          '  - a (codex, above, iteration 1)',
          '  - b (codex, above, iteration 2)',
          '  - c (codex, above)',
        ].join('\n'),
        'd',
        null,
      ),
    ]);
    expect([r.fixed.above, r.droveRounds.above]).toEqual([3, 1]);
  });
  test('counts an incomplete cycle, its null counts adding nothing', () => {
    const r = rollupOf([
      cycleOf('Iterations: 2 (converged)\n- a (codex, above)', 'd', null),
      cycleOf(BLOCK, 'd', null),
    ]);
    expect([r.cycles, r.incomplete, r.fixedCount, r.later]).toEqual([2, 1, 3, 5]);
  });
  test('has no mean with no counted iterations', () => {
    expect(rollupOf([]).meanIterations).toBeNull();
  });
});

function memoryStore(): Store {
  const data = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(structuredClone(data.get(k))),
    set: (k, v) => {
      data.set(k, structuredClone(v));
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
    delete: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
}

const cycle = (n: number): Cycle => ({ ...cycleOf(BLOCK, 'd', null), iterations: n });
const iterationsIn = async (s: Store) => {
  const kept = await readCycles(s, '/r/.git');
  return kept.map((c) => c.iterations);
};

describe('the cycle store', () => {
  test('keeps cycles per repository, oldest first', async () => {
    const s = memoryStore();
    await recordCycle(s, '/r/.git', cycle(1), 1, 't');
    await recordCycle(s, '/r/.git', cycle(2), 2, 't');
    await recordCycle(s, '/other/.git', cycle(3), 3, 't');
    expect(await iterationsIn(s)).toEqual([1, 2]);
  });
  test(`keeps the newest ${KEPT}`, async () => {
    const s = memoryStore();
    for (let i = 1; i <= KEPT + 2; i++) await recordCycle(s, '/r/.git', cycle(i), i, 't');
    const kept = await readCycles(s, '/r/.git');
    expect([kept.length, kept[0]?.iterations]).toEqual([KEPT, 3]);
  });
  test('keeps nothing, and throws, when the prune fails', async () => {
    const s = memoryStore();
    const failing: Store = { ...s, keys: () => Promise.reject(new Error('keys refused')) };
    await expect(recordCycle(failing, '/r/.git', cycle(1), 1, 't')).rejects.toThrow('keys refused');
    expect(await iterationsIn(s)).toEqual([]);
  });
  const finding = { legs: ['codex'], side: 'above', iteration: 1 };
  test.each([
    ['an unknown exit', { exit: 'gone' }],
    ['an unknown tier', { tier: 'heavy' }],
    ['a date that is no string', { date: 0 }],
    ['a string iteration count', { iterations: '2' }],
    ['zero iterations', { iterations: 0 }],
    ['a negative later count', { later: -1 }],
    ['a fractional self-caused count', { selfCaused: 1.5 }],
    ['more self-caused than later', { later: 1, selfCaused: 2 }],
    ['later missing, self-caused zero', { later: null, selfCaused: 0 }],
    ['later set, self-caused missing', { later: 3, selfCaused: null }],
    ['an unsafe count', { fixedCount: 1e300 }],
    ['deferred that is no list', { deferred: 'abc' }],
    ['legs that are no list', { fixed: [{ ...finding, legs: 'codex' }] }],
    ['an unknown leg', { fixed: [{ ...finding, legs: ['__proto__'] }] }],
    ['a leg twice', { fixed: [{ ...finding, legs: ['codex', 'codex'] }] }],
    ['an unknown side', { deferred: [{ ...finding, side: 'x' }] }],
    ['an iteration of zero', { fixed: [{ ...finding, iteration: 0 }] }],
  ])('leaves out an entry with %s', async (_name, broken) => {
    const s = memoryStore();
    await recordCycle(s, '/r/.git', cycle(1), 1, 't');
    await recordCycle(s, '/r/.git', { ...cycle(2), ...broken } as unknown as Cycle, 2, 't');
    expect(await iterationsIn(s)).toEqual([1]);
  });
  test('keeps an entry whose stated counts are missing', async () => {
    const s = memoryStore();
    await recordCycle(
      s,
      '/r/.git',
      { ...cycle(1), fixedCount: null, later: null, selfCaused: null },
      1,
      't',
    );
    expect(await iterationsIn(s)).toEqual([1]);
  });
});
