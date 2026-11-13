import { describe, expect, test } from 'vitest';

import {
  cycleOf,
  isIncomplete,
  isSummary,
  KEPT,
  readCycles,
  RECENT,
  recordCycle,
  rollupOf,
  type Cycle,
} from '../hooks/cycles';
import type { Store } from '../hooks/ledger-store';

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

const costOf = (line: string) => cycleOf(`Iterations: 1 (converged)\n${line}`, 'd', null).cost;

const clause = (text: string) => costOf(`Cost: iteration 1: ${text}`)?.[0];

const costed = (head: string, cost: string) =>
  cycleOf(
    `Tier: full\nIterations: 1 (converged)\nFindings fixed inline: 2\nFindings deferred: 1\nCost: ${cost}`,
    '2026-11-12',
    head,
  );

describe('the Cost line', () => {
  const one = {
    iteration: 1,
    minutes: 12,
    legs: 5,
    subagentTokens: 253_086,
    codexTokens: 1_812_691,
    isPartial: false,
  };

  test.each([
    [
      'the template’s commas',
      'Cost: iteration 1: 12 min wall-clock, 5 legs, 253086 subagent tokens, 1812691 Codex tokens, iteration 2: 3 min wall-clock, 1 leg, 36458 subagent tokens',
    ],
    [
      'a semicolon and thousands separators',
      'Cost: iteration 1: 12 min wall-clock, 5 legs, 253,086 subagent tokens, 1,812,691 Codex tokens; iteration 2: 3 min wall-clock, 1 leg, 36,458 subagent tokens',
    ],
  ])('reads each iteration’s clause, joined by %s', (_, line) => {
    expect(costOf(line)).toEqual([
      one,
      { ...one, iteration: 2, minutes: 3, legs: 1, subagentTokens: 36_458, codexTokens: null },
    ]);
  });

  test('reads a number a clause leaves out as null, and names a partial clause', () => {
    expect(
      costOf(
        'Cost: iteration 1: 8.5 min wall-clock, 2 legs, 78474 subagent tokens, not reported: codex',
      ),
    ).toEqual([
      {
        iteration: 1,
        minutes: 8.5,
        legs: 2,
        subagentTokens: 78_474,
        codexTokens: null,
        isPartial: true,
      },
    ]);
  });

  test.each([
    ['Codex tokens unavailable (no session id)', true],
    ['2 legs, not reported: codex', true],
    ['2 legs, not reported: none', false],
    ['2 legs, 10 subagent tokens', false],
  ])('reads %j as missing usage: %s', (text, isPartial) => {
    expect(clause(text)?.isPartial).toBe(isPartial);
  });

  test.each([
    ['.5 min wall-clock', { minutes: null }],
    ['1,234.5 min wall-clock', { minutes: 1234.5 }],
    ['1.5 subagent tokens', { subagentTokens: null }],
    ['1 leg, 500 Codex tokens', { subagentTokens: null, codexTokens: 500 }],
    ['20 codex tokens', { codexTokens: 20 }],
    [
      '2 min wall-clock,2 legs,500 subagent tokens,800 Codex tokens',
      { minutes: 2, legs: 2, subagentTokens: 500, codexTokens: 800 },
    ],
    ['1,234 subagent tokens', { subagentTokens: 1234 }],
    [
      '99999999999999999999 subagent tokens, 7 Codex tokens',
      { subagentTokens: null, codexTokens: 7 },
    ],
  ])('reads %j whole or not at all', (text, read) => {
    expect(clause(text)).toMatchObject(read);
  });

  test('skips a clause whose iteration number is too large to keep', () => {
    expect(costOf('Cost: iteration 99999999999999999999: 2 min wall-clock')).toBeUndefined();
  });

  test.each([
    ['no Cost line', 'Tier: full'],
    ['not recorded', 'Cost: not recorded (the legs reported no usage)'],
    ['no iteration clause', 'Cost: 12 min wall-clock, 5 legs'],
    ['iteration 0', 'Cost: iteration 0: 12 min wall-clock'],
  ])('keeps no cost for %s', (_, line) => {
    expect(costOf(line)).toBeUndefined();
    expect(cycleOf(`Iterations: 1 (converged)\n${line}`, 'd', null)).not.toHaveProperty('cost');
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

  test('totals what the costed cycles spent, and counts the partial ones', () => {
    const r = rollupOf([
      costed(
        'a1',
        'iteration 1: 12 min wall-clock, 5 legs, 1000 subagent tokens, 9000 Codex tokens, iteration 2: 3.5 min wall-clock, 1 leg, 200 subagent tokens',
      ),
      costed(
        'b2',
        'iteration 1: 0.1 min wall-clock, 2 legs, 300 subagent tokens, iteration 2: 0.2 min wall-clock, 1 leg, not reported: codex',
      ),
      costed('c3', 'not recorded (no usage reported)'),
    ]);
    expect(r.recent.map((c) => c.cost?.minutes)).toEqual([15.5, 0.3, undefined]);
    expect(r.recent.map((c) => c.cost?.isPartial)).toEqual([false, true, undefined]);
    expect(r.cost).toEqual({
      cycles: 2,
      partial: 1,
      minutes: 15.8,
      legs: 9,
      subagentTokens: 1500,
      codexTokens: 9000,
    });
  });
  test('lists the newest cycles with their commit, cost and findings, oldest first', () => {
    const r = rollupOf([
      costed('a1', 'iteration 1: 12 min wall-clock, 5 legs, 1000 subagent tokens'),
      costed('b2', 'not recorded (no usage reported)'),
    ]);
    const row = { date: '2026-11-12', tier: 'full', iterations: 1, fixed: 2, deferred: 1 };
    expect(r.recent).toEqual([
      {
        ...row,
        head: 'a1',
        cost: { minutes: 12, legs: 5, subagentTokens: 1000, codexTokens: null, isPartial: false },
      },
      { ...row, head: 'b2', cost: null },
    ]);
  });
  test('totals the largest token count it keeps without rounding it', () => {
    const r = rollupOf([costed('a1', 'iteration 1: 9007199254740991 subagent tokens')]);
    expect(r.recent[0]?.cost?.subagentTokens).toBe(Number.MAX_SAFE_INTEGER);
  });
  test(`lists at most the newest ${RECENT}`, () => {
    const many = Array.from({ length: RECENT + 2 }, (_, i) => costed(`h${i}`, 'not recorded'));
    const heads = rollupOf(many).recent.map((c) => c.head);
    expect([heads.length, heads[0], heads.at(-1)]).toEqual([RECENT, 'h2', `h${RECENT + 1}`]);
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
  const spent = {
    iteration: 1,
    minutes: 2.5,
    legs: 2,
    subagentTokens: 10,
    codexTokens: null,
    isPartial: false,
  };
  test('keeps an entry with a cost, and one written before costs were kept', async () => {
    const s = memoryStore();
    await recordCycle(s, '/r/.git', cycle(1), 1, 't');
    const unstated = { ...spent, iteration: 2, minutes: null, legs: null, subagentTokens: null };
    await recordCycle(s, '/r/.git', { ...cycle(2), cost: [spent, unstated] }, 2, 't');
    const kept = await readCycles(s, '/r/.git');
    expect(kept.map((c) => c.cost)).toEqual([undefined, [spent, unstated]]);
  });
  test('keeps a cycle whose Cost line states a number too large to keep', async () => {
    const s = memoryStore();
    const block = `${BLOCK}\nCost: iteration 1: 2 min wall-clock, 99999999999999999999 subagent tokens`;
    await recordCycle(s, '/r/.git', cycleOf(block, 'd', null), 1, 't');
    const kept = await readCycles(s, '/r/.git');
    expect(kept.map((c) => c.cost?.[0]?.subagentTokens)).toEqual([null]);
  });
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
    ['a cost that is no list', { cost: 'cheap' }],
    ['an empty cost', { cost: [] }],
    ['one bad clause among good ones', { cost: [spent, { ...spent, iteration: 0 }] }],
    ['negative legs', { cost: [{ ...spent, legs: -1 }] }],
    ['fractional Codex tokens', { cost: [{ ...spent, codexTokens: 1.5 }] }],
    ['a cost clause with no iteration', { cost: [{ ...spent, iteration: 0 }] }],
    ['negative minutes', { cost: [{ ...spent, minutes: -1 }] }],
    ['fractional tokens', { cost: [{ ...spent, subagentTokens: 1.5 }] }],
    ['a partial flag that is no boolean', { cost: [{ ...spent, isPartial: 'yes' }] }],
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
