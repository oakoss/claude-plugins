// What a message may grant, and how grants combine. exact.ts reads a message
// into one.

import type { Finishes } from './git-args';
import type { HoldStep } from './hold';

// How far the user's message lets a push go; each level covers those before
// it.
const PUSH_LEVELS = ['none', 'push', 'lease', 'bare'] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];
export const pushRank = (level: PushLevel): number => PUSH_LEVELS.indexOf(level);

// What the user's message asked for. `push` is only what they asked to push:
// the push a pull request needs is judged by the gate, which still asks
// before a tag or default-branch push it would carry. `pushNamed` holds where
// a push request or the question it answered said the push goes: a branch, or
// a tag as `tag:<name>`. `comment` is a reply on a pull request, asked for by
// addressing its review. `autoMerge` is a merge asked for once the pull
// request is ready ("merge it when CI passes"), which only
// `gh pr merge --auto` leaves to GitHub. `mergeNamed` holds the pull requests
// a merge request named, by number ("merge 131") or as `<repo>#<n>`
// ("merge linesmith#53"), empty for "merge it"; `readyNamed` those a merge
// asked for once ready named, kept apart so they never cover a merge now.
// `mergeStack` holds the gh-stack merges a request named, which cover
// `gh stack merge` alone: `stack` for the whole stack, `upto:<n>` for the
// layers up to pull request <n>. `finish` holds the history commands a request
// to finish named ("finish the rebase"): a commit of that command's
// `--continue` only.
export type Grant = Readonly<{
  commit: boolean;
  finish: readonly Finishes[];
  push: PushLevel;
  pushNamed: readonly string[];
  pr: boolean;
  merge: boolean;
  mergeNamed: readonly string[];
  autoMerge: boolean;
  readyNamed: readonly string[];
  // The version pull request once ready, which is the release.
  readyRelease: boolean;
  // A ready merge also waits on the base branch's checks.
  readyMain: boolean;
  mergeStack: readonly string[];
  approve: boolean;
  release: boolean;
  comment: boolean;
}>;

export const NO_GRANT: Grant = Object.freeze({
  commit: false,
  finish: [],
  push: 'none',
  pushNamed: [],
  pr: false,
  merge: false,
  mergeNamed: [],
  autoMerge: false,
  readyNamed: [],
  readyRelease: false,
  readyMain: false,
  mergeStack: [],
  approve: false,
  release: false,
  comment: false,
});

// Typed, so a value added to Finishes fails to compile until it is listed.
const GRANT_FINISHES: Record<Finishes, true> = {
  merge: true,
  'cherry-pick': true,
  revert: true,
  rebase: true,
};
const isFlag = (v: unknown): v is boolean => typeof v === 'boolean';
export const isStrings = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

// One check per field, typed against Grant, so a field added there fails to
// compile until it is checked here.
const GRANT_CHECKS: { readonly [K in keyof Grant]-?: (v: unknown) => v is Grant[K] } = {
  commit: isFlag,
  finish: (v): v is readonly Finishes[] =>
    Array.isArray(v) && v.every((f) => typeof f === 'string' && Object.hasOwn(GRANT_FINISHES, f)),
  push: (v): v is PushLevel => (PUSH_LEVELS as readonly unknown[]).includes(v),
  pushNamed: isStrings,
  pr: isFlag,
  merge: isFlag,
  mergeNamed: isStrings,
  autoMerge: isFlag,
  readyNamed: isStrings,
  readyRelease: isFlag,
  readyMain: isFlag,
  mergeStack: isStrings,
  approve: isFlag,
  release: isFlag,
  comment: isFlag,
};

// A grant taken back from a reload's record, field by field.
export function isGrant(x: unknown): x is Grant {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const g = x as Record<string, unknown>;
  return Object.entries(GRANT_CHECKS).every(([k, ok]) => ok(g[k]));
}

// Compared by rank, so a level added between two others keeps its meaning.
export function covers(grant: Grant, level: PushLevel): boolean {
  return pushRank(grant.push) >= pushRank(level);
}

// A merge with no pull request named covers any, so adding a named one must not
// narrow it. readyNamed stays whole: it also keeps those pull requests out of an
// open merge-now.
export function combine(a: Grant, b: Grant): Grant {
  const open = (g: Grant) => g.merge && g.mergeNamed.length === 0;
  return Object.freeze({
    commit: a.commit || b.commit,
    finish: [...a.finish, ...b.finish],
    push: pushRank(b.push) > pushRank(a.push) ? b.push : a.push,
    pushNamed: [...new Set([...a.pushNamed, ...b.pushNamed])],
    pr: a.pr || b.pr,
    merge: a.merge || b.merge,
    mergeNamed: open(a) || open(b) ? [] : [...a.mergeNamed, ...b.mergeNamed],
    autoMerge: a.autoMerge || b.autoMerge,
    readyNamed: [...a.readyNamed, ...b.readyNamed],
    readyRelease: a.readyRelease || b.readyRelease,
    readyMain: a.readyMain || b.readyMain,
    mergeStack: [...new Set([...a.mergeStack, ...b.mergeStack])],
    approve: a.approve || b.approve,
    release: a.release || b.release,
    comment: a.comment || b.comment,
  });
}

// Whether a message asks for a step on the way out: a push, a pull request, a
// merge or a release. An approval or a reply asks for none of them.
export function liftsHold(grant: Grant): boolean {
  return (
    covers(grant, 'push') ||
    grant.pr ||
    grant.merge ||
    grant.autoMerge ||
    grant.readyRelease ||
    grant.release ||
    grant.mergeStack.length > 0
  );
}

// Why a yes granted nothing, and the steps the answer before it named, for
// their refusals to say.
export type UnreadOffer = Readonly<{ why: string; steps: readonly (HoldStep | 'commit')[] }>;

export const EPIC_NAME = String.raw`[a-z][a-z0-9-]*-[a-z0-9]+(?:\.\d+)*`;
export const EPIC_ID = new RegExp(`^${EPIC_NAME}$`, 'i');

// In a merge's names: a pull request the message did not place, which matches none.
export const NAMED_ELSEWHERE = '?';

// A number the reader could not place voids the answers'.
export type Pointed = { named: readonly string[]; answer: readonly string[]; unplaced: boolean };
export const NOTHING_POINTED: Pointed = { named: [], answer: [], unplaced: false };
export const isPointed = (x: unknown): x is Pointed =>
  typeof x === 'object' &&
  x !== null &&
  isStrings((x as Pointed).named) &&
  isStrings((x as Pointed).answer) &&
  typeof (x as Pointed).unplaced === 'boolean';
// What a message keeps of its consent, which /clear and switching the gate off drop.
export const UNGRANTED = { grant: NO_GRANT, pointed: NOTHING_POINTED } as const;

// The pull request numbers a text names: #131, PR 131, /pull/131.
const prNumbers = (text: string): readonly string[] => [
  ...new Set(
    [...text.matchAll(/(?:#|\b(?:pr|pull request)\s+#?|\/pull\/)(\d+)\b/gi)].map((m) => m[1] ?? ''),
  ),
];

export function pointedBy(text: string, before: string, grant: Grant): Pointed {
  const all = [...grant.mergeNamed, ...grant.readyNamed];
  return {
    named: all.filter((n) => n !== NAMED_ELSEWHERE),
    answer: prNumbers(before),
    unplaced: all.includes(NAMED_ELSEWHERE) && /\d/.test(text),
  };
}

export function joinPointed(a: Pointed, b: Pointed): Pointed {
  return {
    named: [...new Set([...a.named, ...b.named])],
    answer: [...new Set([...a.answer, ...b.answer])],
    unplaced: a.unplaced || b.unplaced,
  };
}
