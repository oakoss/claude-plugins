import type { PromptOrigin, Timer } from 'claude-code';

import type { Kept, KeptSpend } from '../../types';
import { NO_GRANT, NOTHING_POINTED } from '../consent/consent';
import type { Mandate } from '../consent/exact';
import type { Hold, HoldState, HoldStep } from '../consent/hold';
import type { StopBefore } from '../consent/ladder';
import type { MissKind } from '../consent/misses';
import type { PrUpdates } from '../consent/pr-updates';
import type { Consent } from '../consent/reading';
import { NO_STANDING, type Standing } from '../gate/gh-verdict';
import type { Coverage, Repo } from '../gate/git';
import { describeUncovered, uncoveredOf, type Review } from '../review/witness';
import type { Restored } from './kept';

export const HUMAN = new Set<PromptOrigin['kind']>(['composer', 'bridge', 'sdk']);

// `spawnTree` is null when the tree could not be read as the leg started; such
// a leg reviews nothing, but it is still under way until `done`.
export type Leg = {
  type: string;
  counts: boolean;
  spawnTree: string | null;
  done: boolean;
  // Fires once the leg outlives its budget; cancelled when it finishes.
  timer: Timer | null;
  spawnedAt: number;
  capped: boolean;
  // A report of it counted, so a later answer without a receipt drops nothing.
  counted: boolean;
  spend?: KeptSpend;
};

// Measured 2026-09-19 over 138 legs: a fan-out's slowest leg had a median of
// 16 minutes and the slowest normal leg type 25; runaways ran 60 to 70.
export const LEG_BUDGET_MS = 30 * 60_000;

// What the user's latest message settled: a fresh message replaces it, a
// prompt queued into the running turn joins it (consentJoined).
export type Message = Consent & {
  // The working tree when it arrived; null when unreadable.
  tree: string | null;
  // Whether the agent was told to review since it arrived.
  nudged: boolean;
  // Legs spawned while review-pr runs review a PR worktree, not this tree.
  prWindow: boolean;
};

// `key` is its name in the store, once one is chosen.
export type Miss = {
  message: string;
  offer: string;
  steps: HoldStep[];
  refusal: string;
  kind: MissKind;
  saved: boolean;
  key: string | null;
};

export type GateState = {
  // undefined until resolved; null when the session is not in a repository.
  root: Repo | null | undefined;
  reviews: Review[];
  legs: Map<string, Leg>;
  message: Message;
  // The review reminder the user's next prompt owes the agent, measured from
  // `since`. Apart from `message`, so a prompt replacing it cannot lose one.
  owed: { since: string } | null;
  // How many messages the user has typed, queued ones included.
  messages: number;
  lastAnswer: string;
  // The user's latest message, the answer it replied to, and where it came from.
  said: { text: string; before: string; origin: PromptOrigin['kind'] | null };
  // Refusals of a step the user's message or the offer it answered named:
  // candidate consent misses, kept in this session only.
  misses: Miss[];
  // The user's shell aliases, which the Bash tool expands.
  shellAliases: Map<string, string>;
  aliasError: string | null;
  // Whether the agent has been told the aliases could not be read.
  aliasErrorShown: boolean;
  aliasesLoaded: boolean;
  // The session-start read of the user's aliases; its error, or null.
  ownRead: Promise<string | null> | undefined;
  // Reviews that ran but could not be recorded, and why: one per leg, since a
  // leg's later report supersedes its earlier one. `old` predates the latest
  // recorded review.
  dropped: { agentId: string; text: string; old: boolean }[];
  // Legs that outlived their budget this cycle, which the session was asked to stop.
  capped: string[];
  // Scratch directories made for review cycles and not yet swept.
  scratch: string[];
  // Whether the sweep tool registered; scratch makes nothing without it.
  sweepServed: boolean;
  // What reviewers' commands changed in the repository under review.
  reviewerChanges: string[];
  // False when the user switched the gate off; the ledger is still served.
  gateOn: boolean;
  // From user or managed settings, which alone reach the register options.
  stopBefore: StopBefore | null;
  prUpdates: PrUpdates | null;
  // The user's /config value for the end-of-turn review nudge.
  nudge: boolean;
  // The user's /config value for showing a step the setting ran unasked.
  unaskedNotice: boolean;
  hold: HoldState;
  // "do epic <id>" raises the ladder to merge until a hold or decline ends it.
  mandate: Kept['mandate'];
  // "merge 46 once CI passes" outlasts its message until used, held or retracted.
  standing: Standing;
  // Where in `reviews` the next commit's rounds start counting.
  roundsFrom: number;
  // `<git common dir>\t<remote>/<branch>` and the commit this agent last
  // pushed there, newest last: what gh-stack's leased push may overwrite.
  pushed: [string, string][];
  // The review skill's text from when it loads until a commit lands or the
  // session ends, so a compaction can hand back what its re-attached copy drops.
  reviewing: string | null;
  // Finished Codex logs codex_log read since the last summary: path to tokens.
  codexRead: Map<string, number>;
};

export const state: GateState = {
  root: undefined,
  reviews: [],
  legs: new Map(),
  // No message yet, so nothing to nudge about.
  message: {
    grant: NO_GRANT,
    tree: null,
    nudged: true,
    prWindow: false,
    unread: null,
    said: null,
    pointed: NOTHING_POINTED,
  },
  owed: null,
  messages: 0,
  lastAnswer: '',
  said: { text: '', before: '', origin: null },
  misses: [],
  shellAliases: new Map(),
  aliasError: null,
  aliasErrorShown: false,
  aliasesLoaded: false,
  ownRead: undefined,
  dropped: [],
  capped: [],
  scratch: [],
  sweepServed: false,
  reviewerChanges: [],
  gateOn: true,
  stopBefore: null,
  prUpdates: null,
  nudge: true,
  unaskedNotice: false,
  hold: null,
  mandate: null,
  standing: NO_STANDING,
  roundsFrom: 0,
  pushed: [],
  reviewing: null,
  codexRead: new Map(),
};

export const held = (): Hold => state.hold?.floor ?? null;

// Each kept field matches the gate's own type exactly, so a field added to one
// and not the other fails the typecheck; the rest start over on a reload.
type Equal<A, B> =
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the exact-equality idiom compares two generic signatures
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Unkept =
  | 'root'
  | 'said'
  | 'shellAliases'
  | 'aliasError'
  | 'aliasErrorShown'
  | 'aliasesLoaded'
  | 'ownRead'
  | 'sweepServed'
  | 'gateOn'
  | 'stopBefore'
  | 'prUpdates'
  | 'nudge'
  | 'owed'
  | 'unaskedNotice'
  | 'standing'
  | 'codexRead';
const _keptFields: Equal<Exclude<keyof GateState, Unkept>, keyof Kept> = true;
const _keptLeg: Equal<Omit<Leg, 'timer'>, Kept['legs'][number][1]> = true;
const _keptReview: Equal<Review, Kept['reviews'][number]> = true;
const _keptHold: Equal<HoldState, Kept['hold']> = true;
const _keptMandate: Equal<Mandate | null, Kept['mandate']> = true;
const _keptMiss: Equal<Miss, Kept['misses'][number]> = true;
const _keptMessage: Equal<Omit<Message, 'unread' | 'said'>, Kept['message']> = true;
const _keptDropped: Equal<GateState['dropped'][number], Kept['dropped'][number]> = true;
// recall's Pick<GateState, keyof Restored> annotation is what type-checks the
// values it assigns; this keeps it from reaching state that is never kept.
const _restoredKeys: Equal<keyof Restored, keyof Kept> = true;

// Why uncovered content is uncovered, including what the gate itself lost.
export function explain(c: Coverage): string {
  const parts = [describeUncovered(uncoveredOf(c.rows))];
  if (c.unread > 0) parts.push(`${c.unread} reviewed tree(s) could not be compared: git failed`);
  const dropped = state.dropped.filter((d) => !d.old).slice(-3);
  if (dropped.length > 0) {
    parts.push(`reviews not counted: ${dropped.map((d) => d.text).join('; ')}`);
  }
  return parts.join('; ');
}

export function drop(agentId: string, text: string): void {
  state.dropped = state.dropped.filter((d) => d.agentId !== agentId);
  state.dropped.push({ agentId, text, old: false });
}

export function runningLeg(agentId: string | undefined): Leg | null {
  const leg = agentId === undefined ? undefined : state.legs.get(agentId);
  return leg && !leg.done ? leg : null;
}
