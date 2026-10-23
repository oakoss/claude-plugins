import type { Kept, KeptLeg } from '../types';
import { EPIC_ID, isGrant, isPointed, isStrings, UNGRANTED } from './consent';
import { HOLD_STEPS } from './hold';

// A SHA-1 or SHA-256 object name.
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// The gate's state as keptOf reads it. Leg and message fields are copied by
// name; the rest pass through, held to Kept by register.ts's Equal checks.
export type KeptSource = Omit<Kept, 'legs'> & {
  legs: ReadonlyMap<string, KeptLeg & { timer: unknown }>;
};

export function keptOf(s: KeptSource): Kept {
  const { tree, nudged, prWindow, grant, pointed } = s.message;
  return {
    reviews: s.reviews,
    legs: [...s.legs].map(([id, l]) => [
      id,
      {
        type: l.type,
        counts: l.counts,
        spawnTree: l.spawnTree,
        done: l.done,
        capped: l.capped,
        counted: l.counted,
        spawnedAt: l.spawnedAt,
      } satisfies Record<keyof KeptLeg, unknown>,
    ]),
    message: { tree, nudged, prWindow, grant, pointed } satisfies Record<
      keyof Kept['message'],
      unknown
    >,
    messages: s.messages,
    lastAnswer: s.lastAnswer,
    misses: s.misses,
    dropped: s.dropped,
    capped: s.capped,
    scratch: s.scratch,
    reviewerChanges: s.reviewerChanges,
    hold: s.hold,
    mandate: s.mandate,
    roundsFrom: s.roundsFrom,
    pushed: s.pushed,
    reviewing: s.reviewing,
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const flags = (o: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => typeof o[key] === 'boolean');
const isStep = (x: unknown) => HOLD_STEPS.some((step) => step === x);

function isReview(r: unknown): boolean {
  return (
    isRecord(r) &&
    typeof r.type === 'string' &&
    Array.isArray(r.trees) &&
    r.trees.length === 2 &&
    isStrings(r.trees) &&
    isStrings(r.reviewedPaths)
  );
}

function isLeg(entry: unknown): boolean {
  if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRecord(entry[1])) return false;
  const leg = entry[1];
  return (
    typeof leg.type === 'string' &&
    (leg.spawnTree === null || typeof leg.spawnTree === 'string') &&
    Number.isFinite(leg.spawnedAt) &&
    flags(leg, ['counts', 'done', 'capped', 'counted'])
  );
}

function isHold(h: unknown): boolean {
  if (h === null) return true;
  if (!isRecord(h) || typeof h.declined !== 'boolean' || !isRecord(h.floor)) return false;
  const { step, how } = h.floor;
  return isStep(step) && (how === 'mentioned' || how === 'declined');
}

// While off, a running leg finishes and a hold or question is answered unseen;
// a finished or capped leg is already settled.
export function offKept(k: Kept): Kept {
  return {
    ...k,
    legs: k.legs.filter(([, leg]) => leg.done || leg.capped),
    message: { tree: null, nudged: false, prWindow: false, ...UNGRANTED },
    lastAnswer: '',
    hold: null,
    mandate: null,
    reviewing: null,
  };
}

// Every field the gate reads, element by element, so taking a record back
// cannot throw or leave a field unset; the shape tag declines one an older
// Kept wrote.
export function isKept(k: unknown): k is Kept {
  if (!isRecord(k) || !isRecord(k.message)) return false;
  const m = k.message;
  return (
    Array.isArray(k.reviews) &&
    k.reviews.every(isReview) &&
    Array.isArray(k.legs) &&
    k.legs.every(isLeg) &&
    (m.tree === null || typeof m.tree === 'string') &&
    flags(m, ['nudged', 'prWindow']) &&
    isGrant(m.grant) &&
    isPointed(m.pointed) &&
    Number.isFinite(k.messages) &&
    typeof k.lastAnswer === 'string' &&
    Array.isArray(k.misses) &&
    k.misses.every(
      (x) =>
        isRecord(x) &&
        typeof x.message === 'string' &&
        typeof x.offer === 'string' &&
        typeof x.refusal === 'string' &&
        Array.isArray(x.steps) &&
        x.steps.every(isStep),
    ) &&
    Array.isArray(k.dropped) &&
    k.dropped.every(
      (x) =>
        isRecord(x) &&
        typeof x.agentId === 'string' &&
        typeof x.text === 'string' &&
        typeof x.old === 'boolean',
    ) &&
    isStrings(k.capped) &&
    isStrings(k.scratch) &&
    isStrings(k.reviewerChanges) &&
    isHold(k.hold) &&
    (k.mandate === null ||
      (isRecord(k.mandate) &&
        typeof k.mandate.epic === 'string' &&
        EPIC_ID.test(k.mandate.epic))) &&
    Number.isInteger(k.roundsFrom) &&
    (k.roundsFrom as number) >= 0 &&
    (k.roundsFrom as number) <= k.reviews.length &&
    Array.isArray(k.pushed) &&
    k.pushed.every(
      (x) =>
        Array.isArray(x) &&
        x.length === 2 &&
        typeof x[0] === 'string' &&
        x[0].includes('\t') &&
        typeof x[1] === 'string' &&
        OBJECT_ID.test(x[1]),
    ) &&
    (k.reviewing === null || typeof k.reviewing === 'string')
  );
}
