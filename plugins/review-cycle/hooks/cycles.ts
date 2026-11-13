// What each review cycle's summary block says it did, kept per repository so a
// change to the loop can be measured: how many iterations it ran, how it ended,
// which legs' findings it fixed or deferred, in which iteration and on which
// side of Phase 6's bar, and how many later findings its own fixes caused.
// Pure; register.ts binds the store.

import { entryName, prune, readJournal, writeEntry } from './journal';
import { hashOf } from './ledger';
import type { Store } from './ledger-store';

export const LEGS = [
  'code-reviewer',
  'codex',
  'pr-test-analyzer',
  'silent-failure-hunter',
  'type-design-analyzer',
  'spec-conformance-analyzer',
  'maintainability-auditor',
  'cleanup',
] as const;
export type Leg = (typeof LEGS)[number] | 'other';
export type Side = 'above' | 'below' | 'unknown';
export type Exit = 'converged' | 'ceiling' | 'own-work' | 'spec' | 'unknown';
export type Finding = Readonly<{ legs: readonly Leg[]; side: Side; iteration: number | null }>;

// One iteration's clause of the Cost line; a number it does not state is null.
export type IterationCost = Readonly<{
  iteration: number;
  minutes: number | null;
  legs: number | null;
  subagentTokens: number | null;
  codexTokens: number | null;
  // The clause names legs whose usage was not reported.
  isPartial: boolean;
}>;

export type Cycle = Readonly<{
  date: string;
  head: string | null;
  tier: 'light' | 'full' | null;
  iterations: number | null;
  exit: Exit;
  // The counts the summary states; its bullets, which may fold findings
  // together, are what name the legs, sides and iterations.
  fixedCount: number | null;
  deferredCount: number | null;
  fixed: readonly Finding[];
  deferred: readonly Finding[];
  // Findings in iterations after the first, and those of them this cycle's
  // fixes caused; null when the Convergence line says neither.
  later: number | null;
  selfCaused: number | null;
  // Absent when the summary has no Cost line or says it was not recorded.
  cost?: readonly IterationCost[];
}>;

// A source as the summary names it, `review-cycle:` dropped, matched whole.
const ALIASES: readonly (readonly [RegExp, Leg])[] = [
  [/^codex$/, 'codex'],
  [/^code[- ]reviewer$/, 'code-reviewer'],
  [/^(?:pr-)?test[- ]analyzer$/, 'pr-test-analyzer'],
  [/^silent[- ]failure(?:[- ]hunter)?$/, 'silent-failure-hunter'],
  [/^type[- ]design(?:[- ]analyzer)?$/, 'type-design-analyzer'],
  [/^spec(?:[- ]conformance)?(?:[- ]analyzer)?$/, 'spec-conformance-analyzer'],
  [/^maintainability(?:[- ]auditor)?$/, 'maintainability-auditor'],
  [/^cleanup$/, 'cleanup'],
];

// A leg's own severity word beside its name, as summaries written before the
// side was asked for sometimes put it, read against Phase 6's bar.
const ABOVE = /^(?:above|critical|important|high)$/;
const BELOW = /^(?:below|medium|low|minor|nit|suggestion)$/;

// A bullet's trailing `(source, above | below, iteration N)`. A bullet that
// names neither a leg nor a side, such as `- none`, is no finding.
function findingOf(line: string): Finding | null {
  if (!/^\s*-\s/.test(line)) return null;
  const tail = /\(([^()]*)\)\s*$/.exec(line)?.[1] ?? '';
  const legs = new Set<Leg>();
  let side: Side = 'unknown';
  let iteration: number | null = null;
  for (const part of tail.split(/,|\+|\band\b/)) {
    const p = part
      .trim()
      .toLowerCase()
      .replace(/^review-cycle:/, '');
    const n = /^iteration (\d+)$/.exec(p)?.[1];
    if (p === '') continue;
    if (n !== undefined) iteration = Number(n) >= 1 ? Number(n) : null;
    else if (ABOVE.test(p)) side = 'above';
    else if (BELOW.test(p)) side = 'below';
    else legs.add(ALIASES.find(([re]) => re.test(p))?.[1] ?? 'other');
  }
  if (side === 'unknown' && [...legs].every((l) => l === 'other')) return null;
  return { legs: [...legs], side, iteration };
}

// The bullets under `heading`, up to a blank line or the next field. A
// deferred bullet's `reason:` line is no bullet.
function bulletsUnder(text: string, heading: string): Finding[] {
  const at = text.search(new RegExp(`^${heading}:`, 'm'));
  if (at === -1) return [];
  const out: Finding[] = [];
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (line.trim() === '' || (/^\S/.test(line) && !line.startsWith('- '))) break;
    const f = findingOf(line);
    if (f) out.push(f);
  }
  return out;
}

function exitOf(iterations: string): Exit {
  if (/ceiling of \d+ reached/.test(iterations)) return 'ceiling';
  if (iterations.includes('own work')) return 'own-work';
  if (iterations.includes('spec decision')) return 'spec';
  if (iterations.includes('converged')) return 'converged';
  return 'unknown';
}

const fieldOf = (text: string, name: string) =>
  new RegExp(`^${name}: *([^\\n]*)`, 'm').exec(text)?.[1];

// A block with no `Iterations:` line is no review cycle's summary.
export const isSummary = (text: string) => fieldOf(text, 'Iterations') !== undefined;

function countOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = /^\s*(\d+)/.exec(value)?.[1];
  if (n !== undefined) return Number(n);
  return /^\s*none\b/.test(value) ? 0 : null;
}

// A number too large for `isCycle` to read back is unstated, so the cycle
// is still kept.
const statedIn = (clause: string, re: RegExp): number | null => {
  const n = Number(re.exec(clause)?.[1]?.replaceAll(',', ''));
  return n <= Number.MAX_SAFE_INTEGER ? n : null;
};

// Opens a number whole, not at the tail of `.5`, `1.5` or `1,234`; a comma
// after anything but a digit separates amounts.
const WHOLE = String.raw`(?<![\d.])(?<!\d,)`;
const AMOUNTS = {
  minutes: new RegExp(String.raw`${WHOLE}(\d[\d,]*(?:\.\d+)?) min\b`),
  legs: new RegExp(String.raw`${WHOLE}(\d+) legs?\b`),
  subagentTokens: new RegExp(String.raw`${WHOLE}(\d[\d,]*) subagent tokens`),
  codexTokens: new RegExp(String.raw`${WHOLE}(\d[\d,]*) Codex tokens`, 'i'),
};
// Usage a clause says it lacks: `not reported: <legs>`, or a count given as
// unavailable.
const LACKS = /not reported:\s*(?!none\b)\S|\bunavailable\b/;

// The Cost line's `iteration N: …` clauses, however they are joined.
function costOf(line: string | undefined): IterationCost[] | undefined {
  if (line === undefined) return undefined;
  const out: IterationCost[] = [];
  for (const clause of line.split(/(?=\biteration \d+:)/)) {
    const n = /^iteration (\d+):/.exec(clause)?.[1];
    if (n === undefined || Number(n) < 1 || !Number.isSafeInteger(Number(n))) continue;
    out.push({
      iteration: Number(n),
      minutes: statedIn(clause, AMOUNTS.minutes),
      legs: statedIn(clause, AMOUNTS.legs),
      subagentTokens: statedIn(clause, AMOUNTS.subagentTokens),
      codexTokens: statedIn(clause, AMOUNTS.codexTokens),
      isPartial: LACKS.test(clause),
    });
  }
  return out.length > 0 ? out : undefined;
}

// Reads a summary block as the review skill's Phase 9 template writes it; a
// field it cannot find reads as null or unknown rather than failing.
export function cycleOf(text: string, date: string, head: string | null): Cycle {
  const tier = /^(light|full)\b/.exec(fieldOf(text, 'Tier') ?? '')?.[1];
  const iterationsLine = fieldOf(text, 'Iterations') ?? '';
  const n = /^\s*(\d+)/.exec(iterationsLine)?.[1];
  // Read only as the template writes it: `iteration 1 only` for one iteration,
  // or an `iteration N: X of Y from this cycle's fixes` clause, each read whole,
  // for every iteration after the first. Anything else is unread, not zero.
  const convergence = fieldOf(text, 'Convergence') ?? '';
  const iterations = n === undefined ? null : Number(n);
  const isOne = /^\s*iteration 1 only\s*$/.test(convergence);
  const counts = isOne
    ? []
    : convergence.split(',').map((clause) => {
        const c =
          /^iteration \d+: (\d+) of (\d+) from this cycle['’]s fixes(?: \(confirmation pass\))?$/.exec(
            clause.trim(),
          );
        return c ? ([Number(c[1]), Number(c[2])] as const) : null;
      });
  const isRead = isOne
    ? iterations === null || iterations === 1
    : counts.every((c) => c !== null && c[0] <= c[1]) &&
      (iterations === null || counts.length >= iterations - 1);
  const read = isRead ? counts.filter((c) => c !== null) : [];
  const later = isRead ? read.reduce((s, [, of]) => s + of, 0) : null;
  const selfCaused = isRead ? read.reduce((s, [caused]) => s + caused, 0) : null;
  const cost = costOf(fieldOf(text, 'Cost'));
  return {
    date,
    head,
    tier: tier === 'light' || tier === 'full' ? tier : null,
    iterations: n === undefined || Number(n) < 1 ? null : Number(n),
    exit: exitOf(iterationsLine),
    fixedCount: countOf(fieldOf(text, 'Findings fixed inline')),
    deferredCount: countOf(fieldOf(text, 'Findings deferred')),
    fixed: bulletsUnder(text, 'Findings fixed inline'),
    deferred: bulletsUnder(text, 'Findings deferred'),
    later,
    selfCaused,
    ...(cost && { cost }),
  };
}

const SIDES: ReadonlySet<string> = new Set<Side>(['above', 'below', 'unknown']);
const KNOWN_LEGS: ReadonlySet<string> = new Set<string>([...LEGS, 'other']);
const EXITS: ReadonlySet<string> = new Set<Exit>([
  'converged',
  'ceiling',
  'own-work',
  'spec',
  'unknown',
]);

const isCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const isCountOrNull = (x: unknown) => x === null || isCount(x);

const isFinding = (x: unknown): x is Finding => {
  if (typeof x !== 'object' || x === null) return false;
  const f = x as Finding;
  return (
    Array.isArray(f.legs) &&
    f.legs.every((l) => KNOWN_LEGS.has(l)) &&
    new Set(f.legs).size === f.legs.length &&
    SIDES.has(f.side) &&
    (f.iteration === null || (isCount(f.iteration) && f.iteration >= 1))
  );
};

const isAmount = (x: unknown) =>
  x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);

const isIterationCost = (x: unknown): x is IterationCost => {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as IterationCost;
  return (
    isCount(c.iteration) &&
    c.iteration >= 1 &&
    isAmount(c.minutes) &&
    isCountOrNull(c.legs) &&
    isCountOrNull(c.subagentTokens) &&
    isCountOrNull(c.codexTokens) &&
    typeof c.isPartial === 'boolean'
  );
};

const isCycle = (x: unknown): x is Cycle => {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Cycle;
  return (
    typeof c.date === 'string' &&
    (c.head === null || typeof c.head === 'string') &&
    (c.tier === null || c.tier === 'light' || c.tier === 'full') &&
    (c.iterations === null || (isCount(c.iterations) && c.iterations >= 1)) &&
    EXITS.has(c.exit) &&
    isCountOrNull(c.fixedCount) &&
    isCountOrNull(c.deferredCount) &&
    Array.isArray(c.fixed) &&
    c.fixed.every((f) => isFinding(f)) &&
    Array.isArray(c.deferred) &&
    c.deferred.every((f) => isFinding(f)) &&
    isCountOrNull(c.later) &&
    isCountOrNull(c.selfCaused) &&
    (c.later === null) === (c.selfCaused === null) &&
    (c.selfCaused ?? 0) <= (c.later ?? 0) &&
    (c.cost === undefined ||
      (Array.isArray(c.cost) && c.cost.length > 0 && c.cost.every((i) => isIterationCost(i))))
  );
};

// Enough cycles to compare a change to the loop before and after.
export const KEPT = 100;

const baseOf = (common: string) => `cycles:${hashOf(common)}@`;

export function readCycles(store: Store, common: string): Promise<Cycle[]> {
  return readJournal(store, baseOf(common), isCycle, KEPT);
}

// Prunes to make room, then writes, so a failure at either step means the
// cycle was not kept.
export async function recordCycle(
  store: Store,
  common: string,
  cycle: Cycle,
  at: number,
  tag: string,
): Promise<void> {
  await prune(store, baseOf(common), KEPT - 1);
  await writeEntry(store, baseOf(common), entryName(at, tag), cycle);
}

// Whether a cycle left anything unread: a count or Convergence line it could
// not read, fewer readable bullets than a stated count, or a finding with no
// iteration.
export function isIncomplete(c: Cycle): boolean {
  return (
    c.iterations === null ||
    c.fixedCount === null ||
    c.deferredCount === null ||
    c.later === null ||
    c.fixed.length < c.fixedCount ||
    c.deferred.length < c.deferredCount ||
    [...c.fixed, ...c.deferred].some((f) => f.iteration === null)
  );
}

type Sides = Record<Side, number>;
const sides = (): Sides => ({ above: 0, below: 0, unknown: 0 });
type LegTotals = { fixed: Sides; droveRounds: Sides; deferred: Sides };

export type Rollup = {
  cycles: number;
  // Cycles that left something unread (`isIncomplete`); a null count adds
  // nothing to its total.
  incomplete: number;
  meanIterations: number | null;
  exits: Record<Exit, number>;
  fixedCount: number;
  deferredCount: number;
  // Every bullet by side; `droveRounds` holds those fixed in an iteration
  // another followed, since each such fix was reviewed again.
  fixed: Sides;
  droveRounds: Sides;
  deferred: Sides;
  later: number;
  selfCaused: number;
  byLeg: Partial<Record<Leg, LegTotals>>;
  // Over the cycles whose Cost line was read; `partial` counts those that say
  // some usage is missing, so their token totals run low. `legs` counts leg
  // runs, a leg once for each iteration it ran in.
  cost: { cycles: number; partial: number } & Spent<number>;
  // The newest cycles, oldest first: the commit each reviewed, what it cost
  // and what it found.
  recent: readonly Recent[];
};

type Spent<T> = { minutes: T; legs: T; subagentTokens: T; codexTokens: T };

export type Recent = Pick<Cycle, 'date' | 'head' | 'tier' | 'iterations'> & {
  fixed: number | null;
  deferred: number | null;
  // An amount no iteration states is null, not zero.
  cost: (Spent<number | null> & { isPartial: boolean }) | null;
};

// Few, since the status tool is read several times a cycle.
export const RECENT = 5;

const tenths = (n: number) => Math.round(n * 10) / 10;

function spentOf(cost: readonly IterationCost[]): Spent<number | null> & { isPartial: boolean } {
  const total = (pick: (i: IterationCost) => number | null) => {
    const stated = cost.map((i) => pick(i)).filter((n) => n !== null);
    return stated.length === 0 ? null : stated.reduce((s, n) => s + n, 0);
  };
  const minutes = total((i) => i.minutes);
  return {
    minutes: minutes === null ? null : tenths(minutes),
    legs: total((i) => i.legs),
    subagentTokens: total((i) => i.subagentTokens),
    codexTokens: total((i) => i.codexTokens),
    isPartial: cost.some((i) => i.isPartial),
  };
}

// Totals over the kept cycles. A finding two legs raised counts once in the
// totals, and once for each leg in `byLeg`.
export function rollupOf(cycles: readonly Cycle[]): Rollup {
  const byLeg = new Map<Leg, LegTotals>();
  const r: Rollup = {
    cycles: cycles.length,
    incomplete: 0,
    meanIterations: null,
    exits: { converged: 0, ceiling: 0, 'own-work': 0, spec: 0, unknown: 0 },
    fixedCount: 0,
    deferredCount: 0,
    fixed: sides(),
    droveRounds: sides(),
    deferred: sides(),
    later: 0,
    selfCaused: 0,
    byLeg: {},
    cost: { cycles: 0, partial: 0, minutes: 0, legs: 0, subagentTokens: 0, codexTokens: 0 },
    recent: cycles.slice(-RECENT).map((c) => ({
      date: c.date,
      head: c.head,
      tier: c.tier,
      iterations: c.iterations,
      fixed: c.fixedCount,
      deferred: c.deferredCount,
      cost: c.cost ? spentOf(c.cost) : null,
    })),
  };
  const counted = cycles.filter((c) => c.iterations !== null);
  if (counted.length > 0) {
    const total = counted.reduce((s, c) => s + (c.iterations ?? 0), 0);
    r.meanIterations = Math.round((total / counted.length) * 100) / 100;
  }
  for (const c of cycles) {
    r.exits[c.exit]++;
    if (isIncomplete(c)) r.incomplete++;
    r.fixedCount += c.fixedCount ?? 0;
    r.deferredCount += c.deferredCount ?? 0;
    r.later += c.later ?? 0;
    r.selfCaused += c.selfCaused ?? 0;
    if (c.cost) {
      const spent = spentOf(c.cost);
      r.cost.cycles++;
      if (spent.isPartial) r.cost.partial++;
      r.cost.minutes = tenths(r.cost.minutes + (spent.minutes ?? 0));
      r.cost.legs += spent.legs ?? 0;
      r.cost.subagentTokens += spent.subagentTokens ?? 0;
      r.cost.codexTokens += spent.codexTokens ?? 0;
    }
    for (const [list, key] of [
      [c.fixed, 'fixed'],
      [c.deferred, 'deferred'],
    ] as const) {
      for (const f of list) {
        const drove =
          key === 'fixed' &&
          f.iteration !== null &&
          c.iterations !== null &&
          f.iteration < c.iterations;
        r[key][f.side]++;
        if (drove) r.droveRounds[f.side]++;
        for (const leg of f.legs) {
          let l = byLeg.get(leg);
          if (!l) byLeg.set(leg, (l = { fixed: sides(), droveRounds: sides(), deferred: sides() }));
          l[key][f.side]++;
          if (drove) l.droveRounds[f.side]++;
        }
      }
    }
  }
  r.byLeg = Object.fromEntries(byLeg);
  return r;
}
