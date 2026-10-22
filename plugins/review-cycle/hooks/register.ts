import {
  atom,
  read,
  update,
  type Caught,
  type CatchHandler,
  type EngineInterface,
  type HookFor,
  type MatchedHook,
  type PromptOrigin,
  type Register,
  type Timer,
  type ToolCallResult,
} from 'claude-code';

import type { Kept, KeptStep } from '../types';
import { added, madeBy, MARK, resolutionOf, type Entry } from './attribution';
import { readCodexLog } from './codex-log';
import {
  aliasCommits,
  classify,
  ghActions,
  possibleAliases,
  shownCommand,
  stackRewrite,
  type Classification,
} from './command';
import {
  closingOf,
  combine,
  covers,
  dropsGrant,
  endsReady,
  EPIC_ID,
  grantOf,
  holdOf,
  prNumbers,
  liftsHold,
  mandateAfter,
  NAMED_ELSEWHERE,
  NO_GRANT,
  isReply,
  stepsNamed,
  unreadOffer,
  type Grant,
  type HoldStep,
  type Mandate,
  type UnreadOffer,
} from './consent';
import {
  askOf,
  closingNamed,
  judge,
  offerOf,
  mentionedOf,
  RULES,
  TARGET,
  targetAskOf,
  unnamed,
  type Judged,
  type ModelGrant,
} from './consent-model';
import { containmentReport, insideRepo, repoStateOf, UNREAD, type Capture } from './containment';
import { editsSkipped, mayWrite, measureEdits } from './edits';
import {
  askThem,
  judgeGh,
  notAsked,
  unreadFor,
  parsePullRequest,
  permitted,
  PR_FIELDS,
  PR_JQ,
  type GhLookups,
  type Hold,
  type InForce,
  type Lookup,
  type ModelSteps,
  type Unasked as GhUnasked,
  type Standing,
  type Used,
  NO_STANDING,
  RELEASE_ASK,
  VERSION_BRANCH,
} from './gh-verdict';
import {
  coverageOf,
  firstLine,
  headOf,
  parentTree,
  prospectTree,
  headLog,
  headLogCount,
  messageOf,
  pushedRefs,
  remoteRefs,
  repoAt,
  reviewablePaths,
  snapshotOf,
  treeOf,
  worktreeTree,
  type Coverage,
  type Git,
  type Refs,
  type Repo,
  type Run,
} from './git';
import type { Finishes, PushSpec } from './git-args';
import { MCP_GITHUB, mcpAction, shownCall } from './github';
import {
  configured,
  STRICTEST,
  effective,
  stopBeforeOf,
  where,
  withMandate,
  type Step,
  type StopBefore,
} from './ladder';
import {
  KINDS,
  MAX_LEDGER_BYTES,
  MAX_READ,
  MAX_REPOS,
  MAX_TEXT,
  parseRecord,
  type Recording,
} from './ledger';
import { blobsAt, readLedger, recordInto, type Store } from './ledger-store';
import { asksUser, nudgeOf, nudgeOn } from './nudge';
import {
  askingReason,
  parseDryRun,
  pushOutcome,
  unasked,
  unnamedTarget,
  type DefaultBranch,
  type DryRunRef,
  type Unnamed,
  type Needed,
} from './push-verdict';
import { RESUMED, resumeText } from './resume';
import { readRounds, recordRounds, roundsOf } from './rounds';
import { applyEdit, bashTouchesGate, isJsonPath, namesSwitch, touchesGate } from './settings';
import { aliasScript, aliasShell, parseShellAliases, readAliases } from './shell';
import { MAX_BYTES, skipsPath, slopDirective, slopFindings, type Written } from './slop';
import {
  anonymized,
  layerOf,
  type LeaseIo,
  parseCatalog,
  readStack,
  remoteOf,
  stackLease,
} from './stack';
import { sweep } from './sweep';
import {
  EMPTY_TREE,
  describeUncovered,
  hasReceipt,
  isReviewerType,
  uncoveredOf,
  type Review,
  type Row,
} from './witness';

// Every function that calls `$` lives in this file: `claude plugin validate`
// follows `$` only into functions declared beside the hook, never across an
// import. The other modules are pure.
//
// The gate watches Bash with a function hook, not the classic PreToolUse
// bridge. While any `tool.call { tool: "Bash" }` hook is loaded, Bash inside an
// `isolation: "worktree"` subagent is refused (anthropics/claude-code#92533);
// the bridge avoids that at the cost of a stub script, should it matter.

type $ = EngineInterface;
type BashHook = MatchedHook<'tool.call', { tool: 'Bash' }>;
type GithubHook = MatchedHook<'tool.call', { tool: RegExp }>;
type SkillHook = MatchedHook<'tool.call', { tool: 'Skill' }>;
type StatusHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__status' }>;
type LedgerHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__ledger' }>;
type RecordHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__ledger_record' }>;
type ScratchHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__scratch' }>;
type SweepHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__sweep' }>;
type CodexLogHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__codex_log' }>;
type ConfigHook = MatchedHook<
  'config.set',
  {
    key:
      | 'review-cycle.enabled'
      | 'review-cycle.stopBefore'
      | 'review-cycle.nudge'
      | 'review-cycle.unaskedNotice'
      | 'review-cycle.modelCheck';
  }
>;
type EditHook = MatchedHook<'tool.call', { tool: 'Edit' }>;
type WriteHook = MatchedHook<'tool.call', { tool: 'Write' }>;
type NotebookHook = MatchedHook<'tool.call', { tool: 'NotebookEdit' }>;
type MonitorHook = MatchedHook<'tool.call', { tool: 'Monitor' }>;
type Input<H> = H extends ($: never, e: infer E, next: never) => unknown ? E : never;
type NextOf<H> = H extends ($: never, e: never, next: infer N) => unknown ? N : never;
type Output<H> = H extends (...args: never[]) => infer R ? Awaited<R> : never;

const HUMAN = new Set<PromptOrigin['kind']>(['composer', 'bridge', 'sdk']);

// `spawnTree` is null when the tree could not be read as the leg started; such
// a leg reviews nothing, but it is still under way until `done`.
type Leg = {
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
};

// Measured 2026-09-19 over 138 legs: a fan-out's slowest leg had a median of
// 16 minutes and the slowest normal leg type 25; runaways ran 60 to 70.
const LEG_BUDGET_MS = 30 * 60_000;

// What the user's latest message settled: a fresh message replaces it, a
// prompt queued into the running turn adds to its grant (dropsGrant).
type Message = {
  grant: Grant;
  // The working tree when it arrived; null when unreadable.
  tree: string | null;
  // Whether the agent was told to review since it arrived.
  nudged: boolean;
  // Legs spawned while review-pr runs review a PR worktree, not this tree.
  prWindow: boolean;
  // Why the reply granted nothing the agent's offer named, for refusals.
  unread: UnreadOffer | null;
  // The one message its grant came from; null once a queued one joined it.
  said: string | null;
  // The pull requests a merge naming none may reach, kept apart from the
  // grant since combining an unnamed merge with a named one names none.
  pointed: Pointed;
};

// A number the grammar could not place ("do not merge 130") voids the answers'.
type Pointed = { named: readonly string[]; answer: readonly string[]; unplaced: boolean };
const NOTHING_POINTED: Pointed = { named: [], answer: [], unplaced: false };

type Miss = { message: string; offer: string; steps: HoldStep[]; refusal: string };

type ModelRead = Judged | { kind: 'unanswered'; why: string };
type ModelAsk = { message: number; text: string; before: string; read: Promise<ModelRead> };

type GateState = {
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
  // The model check's reading of message number `message`, asked once.
  model: ModelAsk | null;
  // Whether that message's answer offered pull request `n`, asked once.
  target: { message: number; n: string; read: Promise<TargetRead> } | null;
  // The user's /config value for asking a model when the grammar refuses.
  modelCheck: boolean;
  // Refusals of a step the user's message or the offer it answered named:
  // candidate consent-grammar misses, kept in this session only.
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
  // The user's /config value for the end-of-turn review nudge.
  nudge: boolean;
  // The user's /config value for showing a step the setting ran unasked.
  unaskedNotice: boolean;
  // "don't push yet" makes every step ask until a message asks for one.
  held: Hold;
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
};

const state: GateState = {
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
  model: null,
  target: null,
  modelCheck: true,
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
  nudge: true,
  unaskedNotice: false,
  held: null,
  mandate: null,
  standing: NO_STANDING,
  roundsFrom: 0,
  pushed: [],
  reviewing: null,
};

// The gate's memory as the host keeps it: module variables start over when the
// module reloads (a saved hooks file, a /config change), so what the gate
// remembers is copied here after each change and read back at the start. What
// the user's message granted is not kept: a reload makes the next step ask, so
// a stale copy can never grant what a later message took back. Bump the shape
// whenever Kept changes, so a reload into new code starts fresh.
const gate = atom({ plugin: 'review-cycle', key: 'gate' } as const, null, { shape: 'gate-5' });
let keptText = '';
let isKeepFailing = false;
// Nothing is kept until what a reload left has been taken back, so an early
// save cannot overwrite it.
let isRecalled = false;
let saving: Promise<void> = Promise.resolve();
let saves = 0;
let ticker: Timer | undefined;

function keptOf(): Kept {
  const { tree, nudged, prWindow } = state.message;
  return {
    reviews: state.reviews,
    legs: [...state.legs].map(([id, { timer: _timer, ...leg }]) => [id, leg]),
    message: { tree, nudged, prWindow },
    messages: state.messages,
    lastAnswer: state.lastAnswer,
    misses: state.misses,
    dropped: state.dropped,
    capped: state.capped,
    scratch: state.scratch,
    reviewerChanges: state.reviewerChanges,
    held: state.held,
    mandate: state.mandate,
    roundsFrom: state.roundsFrom,
    pushed: state.pushed,
    reviewing: state.reviewing,
  };
}

// One write at a time, each taking what the gate holds as it runs, so an older
// copy never lands after a newer one. Never throws: the gate's decisions do not
// wait on it.
function keep($: $): Promise<void> {
  saving = saving.then(() => write($));
  return saving;
}

// A state call that never answers counts as failed, so one cannot stall every
// later save or the session's start.
const STATE_WAIT_MS = 5000;

async function within<T>($: $, call: Promise<T>, what: string): Promise<T> {
  let timer: Timer | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = $.clock.after(STATE_WAIT_MS, () =>
      reject(new Error(`${what} did not answer within ${STATE_WAIT_MS / 1000} s`)),
    );
  });
  try {
    return await Promise.race([call, late]);
  } finally {
    timer?.cancel();
  }
}

async function write($: $): Promise<void> {
  if (!isRecalled) return;
  try {
    const kept = keptOf();
    const text = JSON.stringify(kept);
    if (text === keptText) return;
    // A save that timed out is not cancelled, and `update` retries it; once a
    // newer save has started, it writes back what is stored rather than its own.
    const save = ++saves;
    await within(
      $,
      update($, gate, (stored) => (save === saves ? kept : stored)),
      'saving the gate',
    );
    keptText = text;
    isKeepFailing = false;
  } catch (error) {
    if (!isKeepFailing) {
      $.ui.toast(
        `review-cycle could not keep its reviews for a reload, so one would forget them: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    isKeepFailing = true;
  }
}

// The hooks that change what the gate remembers keep it once they have answered.
type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

async function keptScratch($: $, e: Args<typeof onScratch>[1], next: Args<typeof onScratch>[2]) {
  try {
    return await onScratch($, e, next);
  } finally {
    void keep($);
  }
}

async function keptSweep($: $, e: Args<typeof onSweep>[1], next: Args<typeof onSweep>[2]) {
  try {
    return await onSweep($, e, next);
  } finally {
    void keep($);
  }
}

async function keptPromptSubmit(
  $: $,
  e: Args<typeof onPromptSubmit>[1],
  next: Args<typeof onPromptSubmit>[2],
) {
  try {
    return await onPromptSubmit($, e, next);
  } finally {
    void keep($);
  }
}

async function keptAgentSpawn(
  $: $,
  e: Args<typeof onAgentSpawn>[1],
  next: Args<typeof onAgentSpawn>[2],
) {
  try {
    return await onAgentSpawn($, e, next);
  } finally {
    void keep($);
  }
}

async function keptTurnComplete(
  $: $,
  e: Args<typeof onTurnComplete>[1],
  next: Args<typeof onTurnComplete>[2],
) {
  try {
    return await onTurnComplete($, e, next);
  } finally {
    void keep($);
  }
}

async function keptSkill($: $, e: Args<typeof onSkill>[1], next: Args<typeof onSkill>[2]) {
  try {
    return await onSkill($, e, next);
  } finally {
    void keep($);
  }
}

async function keptBash($: $, e: Args<typeof onBash>[1], next: Args<typeof onBash>[2]) {
  try {
    return await onBash($, e, next);
  } finally {
    void keep($);
  }
}

async function keptGithubTool(
  $: $,
  e: Args<typeof onGithubTool>[1],
  next: Args<typeof onGithubTool>[2],
) {
  try {
    return await onGithubTool($, e, next);
  } finally {
    void keep($);
  }
}

// After a reload, the gate takes back what it remembered, and each leg still
// running gets the rest of its budget. A record it cannot read is set aside
// whole: nothing is taken back from it, so no part of an old record mixes with
// a fresh start.
async function recall($: $): Promise<void> {
  const kept = await within($, read($, gate), 'reading the gate');
  if (kept !== null) {
    if (!isKept(kept)) {
      $.ui.toast(
        'review-cycle could not read the reviews it kept, so it starts this load with none',
      );
    } else {
      const now = await $.clock.now();
      const legs = new Map<string, Leg>(
        kept.legs.map(([id, leg]) => [id, { ...leg, timer: null }]),
      );
      state.reviews = kept.reviews;
      state.legs = legs;
      state.message = {
        ...kept.message,
        grant: NO_GRANT,
        unread: null,
        said: null,
        pointed: NOTHING_POINTED,
      };
      state.messages = kept.messages;
      state.lastAnswer = kept.lastAnswer;
      state.misses = kept.misses;
      state.dropped = kept.dropped;
      state.capped = kept.capped;
      state.scratch = kept.scratch;
      state.reviewerChanges = kept.reviewerChanges;
      state.held = kept.held;
      state.mandate = kept.mandate;
      state.roundsFrom = kept.roundsFrom;
      state.pushed = kept.pushed;
      state.reviewing = kept.reviewing;
      for (const [id, leg] of legs) {
        if (leg.done || leg.capped) continue;
        const left = Math.max(0, LEG_BUDGET_MS - (now - leg.spawnedAt));
        leg.timer = $.clock.after(left, () => overBudget($, id, leg));
      }
      keptText = JSON.stringify(kept);
    }
  }
  isRecalled = true;
}

// A take-back that fails is not tried again: by then the session may have moved
// on, and an older record taken back late would undo it. It starts fresh.
async function recallOrSay($: $): Promise<void> {
  try {
    await recall($);
  } catch (error) {
    $.ui.toast(
      `review-cycle could not take back its reviews after a reload, so it starts this load with none: ${error instanceof Error ? error.message : String(error)}`,
    );
    isRecalled = true;
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const strings = (xs: unknown): boolean =>
  Array.isArray(xs) && xs.every((x) => typeof x === 'string');
const flags = (o: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => typeof o[key] === 'boolean');
const STEP_SET: Record<KeptStep, true> = {
  push: true,
  pr: true,
  merge: true,
  approve: true,
  release: true,
  comment: true,
};
const STEPS = Object.keys(STEP_SET);
const isStep = (x: unknown) => STEPS.some((step) => step === x);

function isReview(r: unknown): boolean {
  return (
    isRecord(r) &&
    typeof r.type === 'string' &&
    Array.isArray(r.trees) &&
    r.trees.length === 2 &&
    strings(r.trees) &&
    strings(r.reviewedPaths)
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

function isHeld(h: unknown): boolean {
  return (
    h === null || (isRecord(h) && isStep(h.step) && (h.how === 'mentioned' || h.how === 'declined'))
  );
}

// While off, a running leg finishes and a hold or question is answered unseen;
// a finished or capped leg is already settled.
function offKept(k: Kept): Kept {
  return {
    ...k,
    legs: k.legs.filter(([, leg]) => leg.done || leg.capped),
    message: { tree: null, nudged: false, prWindow: false },
    lastAnswer: '',
    held: null,
    mandate: null,
  };
}

// Every field the gate reads, element by element, so taking a record back
// cannot throw or leave a field unset; the shape tag declines one an older
// Kept wrote.
function isKept(k: unknown): k is Kept {
  if (!isRecord(k) || !isRecord(k.message)) return false;
  const m = k.message;
  return (
    Array.isArray(k.reviews) &&
    k.reviews.every(isReview) &&
    Array.isArray(k.legs) &&
    k.legs.every(isLeg) &&
    (m.tree === null || typeof m.tree === 'string') &&
    flags(m, ['nudged', 'prWindow']) &&
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
    strings(k.capped) &&
    strings(k.scratch) &&
    strings(k.reviewerChanges) &&
    isHeld(k.held) &&
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

// A SHA-1 or SHA-256 object name.
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// Each kept field matches the gate's own type exactly, so a field added to one
// and not the other fails the typecheck; the rest start over on a reload.
type Equal<A, B> =
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the exact-equality idiom compares two generic signatures
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Unkept =
  | 'root'
  | 'said'
  | 'model'
  | 'target'
  | 'modelCheck'
  | 'shellAliases'
  | 'aliasError'
  | 'aliasErrorShown'
  | 'aliasesLoaded'
  | 'ownRead'
  | 'sweepServed'
  | 'gateOn'
  | 'stopBefore'
  | 'nudge'
  | 'owed'
  | 'unaskedNotice'
  | 'standing';
const _keptFields: Equal<Exclude<keyof GateState, Unkept>, keyof Kept> = true;
const _keptLeg: Equal<Omit<Leg, 'timer'>, Kept['legs'][number][1]> = true;
const _keptReview: Equal<Review, Kept['reviews'][number]> = true;
const _keptHold: Equal<Hold, Kept['held']> = true;
const _keptMandate: Equal<Mandate | null, Kept['mandate']> = true;
const _keptMiss: Equal<Miss, Kept['misses'][number]> = true;
const _keptMessage: Equal<
  Omit<Message, 'grant' | 'unread' | 'said' | 'pointed'>,
  Kept['message']
> = true;
const _keptDropped: Equal<GateState['dropped'][number], Kept['dropped'][number]> = true;

// Without `cwd`, $.process.run runs in the Bash tool's current directory,
// which is what a command's own relative paths resolve against.
async function run(
  $: $,
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number } = {},
): Promise<Run> {
  // git's messages are matched in English, so its locale is pinned.
  const env = { LC_ALL: 'C', LANGUAGE: 'C', ...opts.env };
  return $.process.run(argv, { timeoutMs: 60_000, ...opts, env });
}

// The runner git.ts's reads take, bound to this hook's `$`.
function gitOf($: $): Git {
  return (argv, opts) => run($, argv, opts);
}

// Why uncovered content is uncovered, including what the gate itself lost.
function explain(c: Coverage): string {
  const parts = [describeUncovered(uncoveredOf(c.rows))];
  if (c.unread > 0) parts.push(`${c.unread} reviewed tree(s) could not be compared: git failed`);
  const dropped = state.dropped.filter((d) => !d.old).slice(-3);
  if (dropped.length > 0) {
    parts.push(`reviews not counted: ${dropped.map((d) => d.text).join('; ')}`);
  }
  return parts.join('; ');
}

function drop(agentId: string, text: string): void {
  state.dropped = state.dropped.filter((d) => d.agentId !== agentId);
  state.dropped.push({ agentId, text, old: false });
}

// Claude Code writes its shell snapshot only once the session's first Bash
// command runs, after this hook, so the gate reads the aliases itself, the
// way the snapshot does, when the session starts. Once per module load: an rc
// file that hangs costs the timeout once, then the snapshot is read instead.
async function readOwnAliases($: $): Promise<string | null> {
  try {
    const tag = Math.random().toString(36).slice(2);
    const home = await $.env.get('HOME');
    if (!home) return 'HOME is not set';
    const shell = aliasShell(await $.env.get('CLAUDE_CODE_SHELL'), await $.env.get('SHELL'));
    const rc = `${home}/${shell.rc}`;
    const script = aliasScript((await $.fs.exists(rc)) ? rc : null, tag);
    // The environment and time limit Claude Code gives its own snapshot: an rc
    // file can branch on them.
    const env = { CLAUDECODE: '1', SHELL: shell.path, GIT_EDITOR: 'true' };
    const argv = [shell.path, '-c', '-l', script];
    const r = await $.process.run(argv, { stdin: '', timeoutMs: 10_000, env });
    if (r.exitCode !== 0) {
      return `the shell exited ${r.exitCode}: ${firstLine(r.stderr) || 'no output'}`;
    }
    const aliases = readAliases(r.stdout, tag);
    if (aliases === null) return 'the shell stopped before printing its aliases';
    state.shellAliases = aliases;
    state.aliasesLoaded = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Failing both reads leaves the aliases unknown, not empty: the snapshot is
// retried on the next Bash call, and the first unchecked command says so.
async function loadShellAliases($: $): Promise<void> {
  if (state.aliasesLoaded) return;
  state.ownRead ??= readOwnAliases($);
  const own = await state.ownRead;
  if (state.aliasesLoaded) return;
  try {
    const home = await $.env.get('HOME');
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null);
    if (!config) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set');
    const shell = basenameOf((await $.env.get('SHELL')) ?? '');
    const dir = `${config}/shell-snapshots`;
    const newest = newestSnapshot(await $.fs.list(dir), shell);
    if (newest === null) throw new Error(`no shell snapshot in ${dir} yet`);
    state.shellAliases = parseShellAliases(await $.fs.read(`${dir}/${newest}`), true);
    state.aliasError = null;
    state.aliasesLoaded = true;
  } catch (error) {
    // Another Bash call's read may have succeeded while this one waited.
    if (state.aliasesLoaded) return;
    const snapshot = error instanceof Error ? error.message : String(error);
    state.aliasError = `reading them from the shell failed (${own}); ${snapshot}`;
  }
}

function basenameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

// Snapshot files are named snapshot-<shell>-<milliseconds>-<id>.sh.
function newestSnapshot(
  entries: readonly { name: string; kind: string }[],
  shell: string,
): string | null {
  let best: { name: string; at: number; same: boolean } | null = null;
  for (const e of entries) {
    const m = /^snapshot-([\w-]+?)-(\d+)-[\w-]+\.sh$/.exec(e.name);
    if (e.kind !== 'file' || !m) continue;
    const candidate = { name: e.name, at: Number(m[2]), same: m[1] === shell };
    if (
      best === null ||
      (candidate.same && !best.same) ||
      (candidate.same === best.same && candidate.at > best.at)
    ) {
      best = candidate;
    }
  }
  return best?.name ?? null;
}

async function ensureRoot($: $): Promise<Repo | null> {
  if (state.root === undefined) {
    const repo = await repoAt(gitOf($), null, await $.session.cwd());
    state.root = repo === 'none' ? null : repo;
  }
  return state.root;
}

function deny(reason: string): { deny: string } {
  if (reason.includes(ASKS_THEM)) noteMiss(reason);
  return { deny: `review-cycle: ${reason}` };
}

// What every refusal asking the user to decide a step says.
const ASKS_THEM = 'stop and ask them in your reply';
const MAX_MISSES = 20;
const MISS_TEXT = 300;
const clip = (s: string) => s.slice(0, MISS_TEXT);

// The question the answer's closing lines end on, which a reply like "yes" answers.
// Sentences split at a mark before a space, so "Release `v0.25.0`?" stays whole.
function questionOf(closing: string): string {
  const sentences = closing.split(/(?<=[.!?])\s+/);
  return sentences.findLast((s) => s.trim().endsWith('?'))?.trim() ?? '';
}

// The step a refusal is about, from how notAsked and the merge check word it:
// "doesn't ask for a merge", "the merge may be a release". Commits and
// approvals are not consent the grammar misses.
function refusedStep(refusal: string): HoldStep | null {
  if (/\bmay be a release\b/.test(refusal)) return 'release';
  const named =
    /\bask(?:ed)? for (a (?:force |bare )?push|a bare force|a pull request|a merge|a release)\b/.exec(
      refusal,
    )?.[1];
  if (named === undefined) return null;
  if (named.endsWith('push') || named === 'a bare force') return 'push';
  return named === 'a pull request' ? 'pr' : named === 'a merge' ? 'merge' : 'release';
}

function grants(grant: Grant, step: HoldStep): boolean {
  if (step === 'push') return covers(grant, 'push');
  if (step === 'merge') return grant.merge || grant.autoMerge || grant.mergeStack.length > 0;
  // A merge the user asked for covers the version pull request too.
  if (step === 'release') return grant.release || grant.merge || grant.mergeStack.length > 0;
  return grant.pr;
}

function noteMiss(refusal: string): void {
  const step = refusedStep(refusal);
  if (step === null) return;
  const { text, before } = state.said;
  // The whole closing is kept, so a spec row drafted from it reads as the gate did.
  const offer = isReply(text) ? closingOf(before) : '';
  const steps = [...new Set([...stepsNamed(text), ...stepsNamed(questionOf(offer))])];
  // Merging the version pull request is a release, so naming the merge counts.
  const named = steps.includes(step) || (step === 'release' && steps.includes('merge'));
  // A message queued while the gate judged may grant what an older one did not.
  if (!named || grants(grantOf(text, before), step)) return;
  recordMiss({ message: clip(text), offer: clip(offer), steps, refusal: clip(refusal) });
}

async function onSessionStart(
  $: $,
  e: Input<HookFor<'session.start'>>,
  next: NextOf<HookFor<'session.start'>>,
): Promise<Output<HookFor<'session.start'>>> {
  await registerLedger($);
  await registerScratch($);
  await registerCodexLog($);
  // A new session owes no reminder for an old one's turns.
  state.owed = null;
  if (!state.gateOn) {
    // Switched off, the gate watches nothing, so what only watching kept true
    // goes; a completed review stays true of the tree it saw.
    try {
      const kept = await within($, read($, gate), 'reading the gate');
      await within(
        $,
        update($, gate, () => (isKept(kept) ? offKept(kept) : null)),
        'clearing the gate',
      );
    } catch (error) {
      $.ui.toast(
        `review-cycle could not clear what it was watching, so switching it back on may bring back a stale question or hold: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return next(e);
  }
  await recallOrSay($);
  // What callbacks outside a hook change (a nudge, a capped leg) is kept here.
  ticker?.cancel();
  ticker = $.clock.every(1000, () => void keep($));
  try {
    await ensureRoot($);
  } catch {
    // Resolved again on first use; a gated command refuses if it still fails.
  }
  // Not awaited: the first Bash call waits on it instead of the session start.
  state.ownRead ??= readOwnAliases($);
  try {
    await $.tool.register({
      name: 'status',
      description:
        "review-cycle's view of the working tree: which changed paths a reviewer has seen, which were edited after the last review or never reviewed, and whether a push or a pull request may run now: asked for in the user's latest message, or below their stop-before setting. Read-only.",
      inputSchema: { type: 'object', properties: {} },
    });
  } catch {
    // The gate works without its status tool; the skill notes when it is missing.
  }
  try {
    await $.tool.register({
      name: 'misses',
      description:
        "The gate's refusals of a push, pull request, merge or release that the user's latest message, or the offer it answered, named: candidate rows for the consent grammar's spec. Each has the message, the offer (the answer's last lines, when the message replied to it), the steps named and the refusal. Read-only; kept in memory until Claude Code restarts.",
      inputSchema: { type: 'object', properties: {} },
    });
  } catch {
    // The misses skill says when the tool is missing.
  }
  return next(e);
}

async function onPromptSubmit(
  $: $,
  e: Input<HookFor<'prompt.submit'>>,
  next: NextOf<HookFor<'prompt.submit'>>,
): Promise<Output<HookFor<'prompt.submit'>>> {
  if (HUMAN.has(e.origin.kind)) {
    state.messages++;
    // What a held message asks for still runs: "push it; don't open a PR yet".
    state.said = { text: e.text, before: state.lastAnswer, origin: e.origin.kind };
    const grant = grantOf(e.text, state.lastAnswer);
    const unread = unreadOffer(e.text, state.lastAnswer);
    const hold = holdOf(e.text, state.lastAnswer);
    if (hold !== null) state.held = hold;
    else if (liftsHold(grant)) state.held = null;
    state.mandate = mandateAfter(state.mandate, e.text, state.lastAnswer);
    const ends = endsReady(e.text, state.lastAnswer);
    const ended = ends ? endedNote(state.standing) : null;
    state.standing = await standingAfter($, ends ? NO_STANDING : state.standing, grant);
    if (ended !== null) e = { ...e, context: [...(e.context ?? []), ended] };
    // A prompt queued into a running turn neither ends a review-pr run nor
    // replaces that turn's starting tree.
    if (e.turnId !== undefined) {
      const drops = dropsGrant(e.text, state.lastAnswer);
      state.message.grant = drops ? grant : combine(state.message.grant, grant);
      // A retraction takes the reason with the yes it explained.
      state.message.unread = drops ? null : (state.message.unread ?? unread);
      state.message.said = drops ? e.text : null;
      const more = pointedBy(e.text, state.lastAnswer, grant);
      state.message.pointed = drops ? more : joinPointed(state.message.pointed, more);
      // An owed reminder already covers this turn's changes.
      state.message.nudged = state.owed !== null;
    } else {
      let tree: string | null = null;
      try {
        const root = await ensureRoot($);
        if (root !== null) tree = await worktreeTree(gitOf($), root.top);
      } catch {
        // No starting tree means no nudge this message; the commit gate still holds.
      }
      // Read after the awaits, so a reminder armed meanwhile rides on this prompt.
      const owed = state.owed;
      const reviews = e.command?.name === 'review-cycle:review';
      // A slash command may never reach the agent, so the reminder waits for
      // the next message; typing the review skill is the review itself.
      const waits = owed !== null && e.command !== undefined && !reviews;
      state.message = {
        grant,
        tree,
        nudged: waits || reviews,
        prWindow: false,
        unread,
        said: e.text,
        pointed: pointedBy(e.text, state.lastAnswer, grant),
      };
      if (owed === null || waits) return next(e);
      const reminder = reviews ? null : await reminderFor($, owed.since, tree);
      const r = await next(
        reminder === null ? e : { ...e, context: [...(e.context ?? []), reminder] },
      );
      // Consumed once the prompt is accepted, and only if nothing has since
      // replaced or retired it: a refused or failed prompt leaves it owed.
      if (!('drop' in r && r.drop !== undefined) && state.owed === owed) state.owed = null;
      return r;
    }
  }
  return next(e);
}

// What changed between two trees that no reviewer has seen, or null when
// nothing did. Throws when git cannot say, so a failure never reads as clean.
async function unreviewedSince(
  $: $,
  top: string,
  since: string,
  tree: string,
): Promise<Coverage | null> {
  const paths = await reviewablePaths(gitOf($), top, since, tree);
  if (paths === null) throw new Error('git could not list what changed');
  const c = await coverageOf(gitOf($), top, await headOf(gitOf($), top), tree, state.reviews);
  if (c === null) throw new Error('git could not compare the tree with the reviewed ones');
  const touched = new Set(paths);
  const rows = c.rows.filter((row) => touched.has(row.path));
  return uncoveredOf(rows).length === 0 ? null : { ...c, rows };
}

// Built when the prompt is sent, so a review, an edit or the nudge turned off
// since the turn ended counts. When git cannot check, the reminder says so.
async function reminderFor($: $, since: string, tree: string | null): Promise<string | null> {
  if (!(await nudgeWanted($))) return null;
  try {
    const root = state.root;
    if (!root || tree === null) throw new Error('the working tree could not be read');
    const c = await unreviewedSince($, root.top, since, tree);
    if (c === null) return null;
    return `review-cycle: your last turn left changes no reviewer has seen (${explain(c)}). Invoke /review-cycle:review via the Skill tool before anything else, then carry on with this message. Skip it only if this message says not to review, or answers a question you asked that must come first.`;
  } catch (error) {
    return `review-cycle: could not check whether your last turn's changes were reviewed (${messageOf(error)}). Invoke /review-cycle:review via the Skill tool before anything else, unless this message says not to review.`;
  }
}

// The nudge as the settings set it. A file that cannot be read sets nothing,
// so the others decide: the nudge only prompts a review.
async function nudgeWanted($: $): Promise<boolean> {
  const set: Partial<Record<'project' | 'local', boolean | null>> = {};
  for (const source of ['project', 'local'] as const) {
    let settings: { pluginConfigs?: unknown } | null;
    try {
      settings = await $.settings.read({ source });
    } catch {
      continue;
    }
    set[source] = nudgeOf(settings?.pluginConfigs);
  }
  return nudgeOn(state.nudge, set.project ?? null, set.local ?? null);
}

// The agent reviews on the user's next prompt rather than asking whether to.
// Once per user message, and not while a review is under way.
async function nudgeReview($: $, e: Input<HookFor<'turn.complete'>>): Promise<void> {
  const message = state.message;
  if (message.nudged || e.reason !== 'answer' || asksUser(e.answer)) return;
  const root = state.root;
  const since = message.tree;
  if (!root || since === null) return;
  const pending = [...state.legs].filter(([, leg]) => leg.counts && !leg.done);
  if (pending.length > 0) {
    // A leg that ended without a turn.complete would otherwise hold this off for good.
    const agents = await $.agent.list();
    const live = new Set(agents.filter((a) => a.status === 'running').map((a) => a.id));
    for (const [id, leg] of pending) if (!live.has(id)) leg.done = true;
    if (pending.some(([, leg]) => !leg.done)) return;
  }
  // Checked from where the reminder will measure, an older one's tree if owed.
  const owedAtStart = state.owed;
  const from = owedAtStart?.since ?? since;
  try {
    const tree = await worktreeTree(gitOf($), root.top);
    if (tree === since) return;
    if ((await unreviewedSince($, root.top, from, tree)) === null) return;
  } catch {
    // A turn git cannot check still owes a reminder, which the next prompt
    // rebuilds or reports as unchecked.
  }
  if (!(await nudgeWanted($))) return;
  // A prompt that arrived meanwhile started from a tree holding these changes,
  // so the reminder is still owed and the next prompt carries it, unless that
  // prompt reviewed them or settled what was owed when this check began.
  if (state.message !== message && (state.message.nudged || state.owed !== owedAtStart)) return;
  if (state.message === message) message.nudged = true;
  // An older reminder still owed measures from further back, so it stays.
  state.owed ??= { since };
}

function onSkill($: $, e: Input<SkillHook>, next: NextOf<SkillHook>): ReturnType<SkillHook> {
  if (!e.agentId && e.skill === 'review-cycle:review-pr') state.message.prWindow = true;
  if (!e.agentId && e.skill === 'review-cycle:review') {
    state.message.prWindow = false;
    // A review already under way needs no reminder to start one.
    state.message.nudged = true;
    state.owed = null;
  }
  return next(e);
}

// Skill calls a subagent has running; `skill.prompt` names no loop, and a
// subagent's review is not the main conversation's.
let subagentSkills = 0;

async function onSubagentSkill(
  _$: $,
  e: Input<SkillHook>,
  next: NextOf<SkillHook>,
): Promise<Output<SkillHook>> {
  if (!e.agentId) return next(e);
  subagentSkills += 1;
  try {
    return await next(e);
  } finally {
    subagentSkills -= 1;
  }
}

async function onReviewSkill(
  $: $,
  e: Input<HookFor<'skill.prompt'>>,
  next: NextOf<HookFor<'skill.prompt'>>,
): Promise<Output<HookFor<'skill.prompt'>>> {
  const r = await next(e);
  if (e.pluginName === 'review-cycle' && subagentSkills === 0) {
    // The text the model reads, which is what the engine re-attaches and cuts.
    state.reviewing = r.text;
    void keep($);
  }
  return r;
}

// A summary computed ahead (`precompute`) and installed later may carry the
// phases, wanted or not by the time it is installed.
async function onCompact(
  _$: $,
  e: Input<HookFor<'session.compact'>>,
  next: NextOf<HookFor<'session.compact'>>,
): Promise<Output<HookFor<'session.compact'>>> {
  const skill = state.reviewing;
  const r = await next(e);
  if (e.agentId !== undefined || r.messages === undefined) return r;
  const carried = r.messages.some((m) => m.text.startsWith(RESUMED));
  if (skill === null) {
    return carried ? { ...r, messages: r.messages.filter((m) => !m.text.startsWith(RESUMED)) } : r;
  }
  const text = carried ? null : resumeText(skill);
  if (text === null) return r;
  return { ...r, messages: [...r.messages, { role: 'user', text, toolUses: [] }] };
}

async function onAgentSpawn(
  $: $,
  e: Input<HookFor<'agent.spawn'>>,
  next: NextOf<HookFor<'agent.spawn'>>,
): Promise<Output<HookFor<'agent.spawn'>>> {
  let isLeg = false;
  let spawnTree: string | null = null;
  let why = 'the working tree could not be read when it started';
  try {
    const root = await ensureRoot($);
    const inRoot =
      !e.cwd || (root !== null && (e.cwd === root.top || e.cwd.startsWith(`${root.top}/`)));
    isLeg = root !== null && !e.parentAgentId && isReviewerType(e.subagentType) && inRoot;
    // Captured before the leg starts, so it is the tree the leg is given.
    if (isLeg && root !== null) spawnTree = await worktreeTree(gitOf($), root.top);
  } catch (error) {
    isLeg = isReviewerType(e.subagentType) && !e.parentAgentId;
    why = `${why} (${error instanceof Error ? error.message : String(error)})`;
  }
  const r = await next(e);
  if (isLeg && 'agentId' in r && r.agentId) {
    if (spawnTree === null) drop(r.agentId, `${e.subagentType}: ${why}`);
    const counts = !state.message.prWindow;
    const leg: Leg = {
      type: e.subagentType,
      counts,
      spawnTree,
      done: false,
      timer: null,
      capped: false,
      counted: false,
      spawnedAt: await $.clock.now(),
    };
    state.legs.set(r.agentId, leg);
    const id = r.agentId;
    leg.timer = $.clock.after(LEG_BUDGET_MS, () => overBudget($, id, leg));
  }
  return r;
}

// The orchestrator waits on notifications, and a leg that keeps working sends
// none, so the gate keeps the clock and asks the session to stop the leg.
function overBudget($: $, agentId: string, leg: Leg): void {
  if (leg.done || leg.capped) return;
  leg.capped = true;
  const minutes = LEG_BUDGET_MS / 60_000;
  state.capped.push(`${leg.type} (agent ${agentId}): still running after ${minutes} minutes`);
  const text = `review-cycle: reviewer leg ${leg.type} (agent ${agentId}) has run past its ${minutes}-minute budget. Stop it with the TaskStop tool, continue the cycle without it, and list it under "Reviewers capped (over budget)" in the summary.`;
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .then(
      (r) => {
        if (r.drop !== undefined)
          state.capped.push(
            `${leg.type} (agent ${agentId}): the request to stop it was refused (${r.drop})`,
          );
      },
      (error: unknown) => {
        state.capped.push(
          `${leg.type} (agent ${agentId}): the request to stop it failed (${error instanceof Error ? error.message : String(error)})`,
        );
      },
    );
}

// A leg's completion is the review event: the tree it saw is the working tree
// now. Nothing edited after this moment is reviewed until a leg sees it.
async function onTurnComplete(
  $: $,
  e: Input<HookFor<'turn.complete'>>,
  next: NextOf<HookFor<'turn.complete'>>,
): Promise<Output<HookFor<'turn.complete'>>> {
  if (!e.agentId) {
    state.lastAnswer = e.answer;
    const r = await next(e);
    try {
      await nudgeReview($, e);
    } catch {
      // A missed nudge leaves the commit gate to refuse the unreviewed commit.
    }
    return r;
  }
  const leg = state.legs.get(e.agentId);
  if (leg) {
    leg.done = true;
    leg.timer?.cancel();
  }
  const root = state.root;
  if (!leg?.counts || leg.spawnTree === null || !root) return next(e);
  // A capped leg is already reported as capped, not as a dropped review.
  if (leg.capped && (e.isAborted || e.reason !== 'answer')) return next(e);
  const reported = !e.isAborted && e.reason === 'answer' && hasReceipt(e.answer);
  if (leg.counted && !reported) return next(e);
  if (e.isAborted || e.reason !== 'answer') {
    drop(e.agentId, `${leg.type}: it did not finish (${e.isAborted ? 'aborted' : e.reason})`);
    return next(e);
  }
  if (!hasReceipt(e.answer)) {
    drop(e.agentId, `${leg.type}: its report did not open with the execution receipt`);
    return next(e);
  }
  try {
    const tree = await worktreeTree(gitOf($), root.top);
    const head = await headOf(gitOf($), root.top);
    const reviewedPaths = await reviewablePaths(gitOf($), root.top, head, tree);
    if (reviewedPaths === null) throw new Error('the paths it reviewed could not be listed');
    state.reviews.push({ type: leg.type, trees: [leg.spawnTree, tree], reviewedPaths });
    leg.counted = true;
    // Refusals explain the current state; other legs' older failures stay in
    // the status tool, and this leg's own are superseded.
    const agentId = e.agentId;
    state.dropped = state.dropped
      .filter((d) => d.agentId !== agentId)
      .map((d) => ({ ...d, old: true }));
  } catch (error) {
    drop(e.agentId, `${leg.type}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return next(e);
}

const SWITCHED_BY_USER =
  'review-cycle is switched on and off only by the user, in /config. Ask them; to read a settings file, use the Read tool.';

async function currentText($: $, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null;
}

function runningLeg(agentId: string | undefined): Leg | null {
  const leg = agentId === undefined ? undefined : state.legs.get(agentId);
  return leg && !leg.done ? leg : null;
}

// A reviewer changing the tree it reviews voids its own review and can land in
// the user's commit; scratch work belongs outside the repository.
async function containedEdit(
  $: $,
  agentId: string | undefined,
  path: string,
): Promise<{ deny: string } | null> {
  if (runningLeg(agentId) === null) return null;
  let root: Repo | null;
  try {
    root = await ensureRoot($);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return deny(
      `the gate could not find the repository under review (${why}), so it refuses a reviewer's edits. Report back instead.`,
    );
  }
  if (root === null || !insideRepo(path, root.top)) return null;
  return deny(
    `reviewers do not edit the repository under review (${root.top}). Copy what you need into a private directory from mktemp -d and change the copy.`,
  );
}

async function onEditContained(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook>,
): Promise<Output<EditHook>> {
  return (await containedEdit($, e.agentId, e.file_path)) ?? next(e);
}

async function onWriteContained(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook>,
): Promise<Output<WriteHook>> {
  return (await containedEdit($, e.agentId, e.file_path)) ?? next(e);
}

async function onNotebookEdit(
  $: $,
  e: Input<NotebookHook>,
  next: NextOf<NotebookHook>,
): Promise<Output<NotebookHook>> {
  return (await containedEdit($, e.agentId, e.notebook_path)) ?? next(e);
}

async function onEdit($: $, e: Input<EditHook>, next: NextOf<EditHook>): Promise<Output<EditHook>> {
  if (!isJsonPath(e.file_path)) return next(e);
  const before = await currentText($, e.file_path);
  // An edit to a missing file creates it with the new text.
  if (before === null) return touchesGate(null, e.new_string) ? deny(SWITCHED_BY_USER) : next(e);
  const after = applyEdit(before, e.old_string, e.new_string, e.replace_all === true);
  // An edit the gate cannot replay passes only when neither the file, which
  // holds the text it replaces, nor its new text names a switch.
  const touches =
    after === null ? namesSwitch(before) || namesSwitch(e.new_string) : touchesGate(before, after);
  return touches ? deny(SWITCHED_BY_USER) : next(e);
}

async function onWrite(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook>,
): Promise<Output<WriteHook>> {
  if (!isJsonPath(e.file_path)) return next(e);
  if (touchesGate(await currentText($, e.file_path), e.content)) return deny(SWITCHED_BY_USER);
  return next(e);
}

// The comment-slop scan runs after the tool, beside the gate's own Edit and
// Write hooks and also when the gate is switched off.
async function onEditSlop(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook>,
): Promise<Output<EditHook>> {
  const r = await next(e);
  return withSlop($, r, { path: e.file_path, text: e.new_string, replaced: e.old_string });
}

async function onWriteSlop(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook>,
): Promise<Output<WriteHook>> {
  const r = await next(e);
  return withSlop($, r, { path: e.file_path, text: e.content, replaced: null });
}

// A refused or failed call wrote nothing, so it is not scanned.
async function withSlop<N extends string>(
  $: $,
  r: ToolCallResult<N>,
  w: Omit<Written, 'file'>,
): Promise<ToolCallResult<N>> {
  if (r.deny !== undefined || r.isError === true) return r;
  const note = await slopNote($, w);
  return note === null ? r : { ...r, context: [...(r.context ?? []), note] };
}

// Never refuses: the write has already happened. Files outside a git
// repository are not scanned.
async function slopNote($: $, w: Omit<Written, 'file'>): Promise<string | null> {
  const { path } = w;
  if (skipsPath(path)) return null;
  try {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '.' : path.slice(0, slash) || '/';
    const repo = await run($, ['git', '-C', dir, 'rev-parse', '--show-toplevel']);
    if (repo.exitCode !== 0) {
      if (repo.stderr.includes('not a git repository')) return null;
      const why = firstLine(repo.stderr) || `exit ${repo.exitCode}`;
      return `review-cycle: git failed (${why}); comment-slop scan skipped.`;
    }
    if (!(await $.fs.exists(path))) return null;
    const { kind, size } = await $.fs.stat(path);
    if (kind !== 'file' || size > MAX_BYTES) return null;
    const findings = slopFindings({ ...w, file: await $.fs.read(path) });
    return findings.length > 0 ? slopDirective(path, findings) : null;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `review-cycle: comment-slop scan skipped (${why}).`;
  }
}

// A settings file the gate could not read may be switching it off.
function fileCheckFailed(path: string, next: Caught): { deny: string } | null {
  if (next.called || !isJsonPath(path)) return null;
  return deny(
    `the gate could not check whether this changes its own switch (${next.error.message ?? next.error.kind}), so it is refused.`,
  );
}

function onEditError(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook> & Caught,
): ReturnType<CatchHandler<EditHook>> {
  return fileCheckFailed(e.file_path, next) ?? next(e);
}

function onWriteError(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook> & Caught,
): ReturnType<CatchHandler<WriteHook>> {
  return fileCheckFailed(e.file_path, next) ?? next(e);
}

// Monitor runs a shell command the Bash hooks never see, so one that the gate
// would judge, or that touches its switch, goes through Bash instead.
async function onMonitor(
  $: $,
  e: Input<MonitorHook>,
  next: NextOf<MonitorHook>,
): Promise<Output<MonitorHook>> {
  if (e.command === undefined) return next(e);
  await loadShellAliases($);
  const judged =
    bashTouchesGate(e.command) ||
    classify(e.command, state.shellAliases).kind !== 'none' ||
    ghActions(e.command, state.shellAliases).length > 0 ||
    possibleAliases(e.command, state.shellAliases).length > 0;
  if (!judged) return next(e);
  return deny(
    'Monitor runs commands the gate does not check. Run a command that commits, pushes, opens, merges, approves or comments on a pull request, releases, calls a git alias or writes settings with the Bash tool.',
  );
}

function onMonitorError(
  $: $,
  e: Input<MonitorHook>,
  next: NextOf<MonitorHook> & Caught,
): ReturnType<CatchHandler<MonitorHook>> {
  if (next.called || e.command === undefined) return next(e);
  return deny(
    `the gate could not check this command (${next.error.message ?? next.error.kind}), so it is refused.`,
  );
}

// The standing asks after a message: a merge once ready of the pull requests it
// named, and of the version pull request. An unnamed one binds to what its own
// message pointed at, so it ends with that message.
async function standingAfter($: $, prior: Standing, grant: Grant): Promise<Standing> {
  const named = grant.readyNamed.filter((n) => n !== NAMED_ELSEWHERE);
  const bound = grant.readyRelease ? await releaseOf($) : null;
  const release = bound ?? prior.release;
  // A main condition binds to this message's own asks, not to earlier ones.
  const releasing = grant.readyRelease && release !== null;
  const waits = grant.readyMain ? [...named, ...(releasing ? [RELEASE_ASK] : [])] : [];
  return {
    ready: [...new Set([...prior.ready, ...named])],
    release,
    main: [...new Set([...prior.main, ...waits])],
  };
}

const standsFor = (s: Pick<Standing, 'ready' | 'release'>): boolean =>
  s.ready.length > 0 || s.release !== null;

// The version pull request a standing release covers: the open one, or the
// first opened after the newest. Null when GitHub cannot say.
async function releaseOf($: $): Promise<Standing['release']> {
  const r = await ghLookups($).versionPulls();
  if (r.asks !== undefined) return null;
  const pulls = r.out
    .trim()
    .split(/\s+/)
    .map((x) => /^(\d+):(\w+)$/.exec(x))
    .filter((m) => m !== null);
  const open = pulls.find((m) => m[2] === 'OPEN');
  if (open?.[1] !== undefined) return { pr: open[1] };
  return { after: Math.max(0, ...pulls.map((m) => Number(m[1]))) };
}

// What a merge that ran under a standing ask fulfils ends that ask.
function spend(used: Used | undefined): void {
  if (used === undefined) return;
  const done = new Set([...used.ready, ...(used.release ? [RELEASE_ASK] : [])]);
  state.standing = {
    ready: state.standing.ready.filter((n) => !done.has(n)),
    release: used.release ? null : state.standing.release,
    main: state.standing.main.filter((n) => !done.has(n)),
  };
}

// The line telling the agent a message ended its standing asks, or null.
function endedNote(s: Standing): string | null {
  if (!standsFor(s)) return null;
  const which = [
    ...s.ready.map((n) => `#${n}`),
    ...(s.release === null ? [] : ["oakum's version pull request"]),
  ].join(' and ');
  return `review-cycle: this message ended the user's standing ask to merge ${which} once ready. Ask them before merging it.`;
}

function pointedNow(): readonly string[] {
  const { named, answer, unplaced } = state.message.pointed;
  return unplaced ? named : [...new Set([...named, ...answer])];
}

function pointedBy(text: string, before: string, grant: Grant): Pointed {
  const all = [...grant.mergeNamed, ...grant.readyNamed];
  return {
    named: all.filter((n) => n !== NAMED_ELSEWHERE),
    answer: prNumbers(before),
    unplaced: all.includes(NAMED_ELSEWHERE) && /\d/.test(text),
  };
}

function joinPointed(a: Pointed, b: Pointed): Pointed {
  return {
    named: [...new Set([...a.named, ...b.named])],
    answer: [...new Set([...a.answer, ...b.answer])],
    unplaced: a.unplaced || b.unplaced,
  };
}

// A GitHub MCP tool is judged as the gh command it stands for would be.
async function onGithubTool(
  $: $,
  e: Input<GithubHook>,
  next: NextOf<GithubHook>,
): Promise<Output<GithubHook>> {
  const action = mcpAction(e.tool, e);
  if (action === null) return next(e);
  if (e.agentId) return deny(SUBAGENT);
  const message = state.messages;
  const shown = shownCall(e.tool, e);
  const granted = state.message.grant;
  const first = await judgeGh(
    shown,
    [action],
    granted,
    state.held,
    ghLookups($),
    {},
    state.message.unread,
    pointedNow(),
    state.standing,
  );
  const { gh, yes } =
    'deny' in first && !first.final
      ? await ghWithModel($, shown, [action], granted, first)
      : { gh: first, yes: null };
  if ('deny' in gh) return deny(gh.deny);
  const stale = overtaken(message, next.signal, 'call');
  if (stale !== null) return stale;
  const r = await next(e);
  if (r.deny !== undefined) return r;
  // A merge that failed fulfilled nothing, so its ask stands.
  if (r.isError !== true) spend(gh.used);
  const notes = [
    ...(yes === null ? [] : [modelRan($, yes)]),
    ...unaskedNotes($, gh.ran),
    ...(gh.notes ?? []),
  ];
  return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] };
}

// Why a judged call does not run after all: a newer message than the one its
// grant was read at (`message`), or an abort, past which nothing would report
// what ran.
function overtaken(message: number, signal: AbortSignal, what: string): { deny: string } | null {
  if (state.messages !== message) {
    return deny(
      `the user sent a new message while the gate was checking this ${what}, so it did not run. Act on their message.`,
    );
  }
  if (signal.aborted) {
    return deny('the call was interrupted while the gate was checking it, so it did not run.');
  }
  return null;
}

// The notes for the steps a call ran unasked; a push a requested pull request
// needs is not noted.
function unaskedNotes($: $, ran: readonly Unasked[]): string[] {
  return ran.filter((step) => !step.forPr).map((step) => ranUnasked($, step));
}

function onGithubToolError(
  $: $,
  e: Input<GithubHook>,
  next: NextOf<GithubHook> & Caught,
): ReturnType<CatchHandler<GithubHook>> {
  if (next.called) return next(e);
  const why =
    next.error.message ??
    (next.error.kind === 'timeout'
      ? 'it ran out of time; calling it again may work'
      : next.error.kind);
  return deny(gateFailed('could not check this call', why, 'making the change on GitHub'));
}

// Offering another route as the next step would skip the check that failed.
function gateFailed(what: string, why: string, elsewhere: string): string {
  return `the gate ${what} (${why}), so it is refused. Tell the user what failed and stop; suggest ${elsewhere} only if they ask.`;
}

// A reviewer's Bash is not refused, since it cannot be read for where it
// writes; the repository is compared around it instead, and what changed is
// put to the reviewer and kept for the status tool.
async function onBash($: $, e: Input<BashHook>, next: NextOf<BashHook>): Promise<Output<BashHook>> {
  const leg = runningLeg(e.agentId);
  if (!leg) return judgeBash($, e, next);
  let root: Repo | null = null;
  let lookup: string | null = null;
  try {
    root = await ensureRoot($);
  } catch (error) {
    lookup = error instanceof Error ? error.message : String(error);
  }
  if (root === null && lookup === null) return judgeBash($, e, next);
  const capture = async (): Promise<Capture> => {
    if (root === null) return { state: UNREAD, why: lookup };
    try {
      return await repoStateOf(gitOf($), root.top);
    } catch (error) {
      return { state: UNREAD, why: error instanceof Error ? error.message : String(error) };
    }
  };
  const before = await capture();
  const report = async (): Promise<string[]> => {
    const { notes, records } = containmentReport({
      type: leg.type,
      command: e.command,
      before,
      after: await capture(),
      background: e.run_in_background === true,
    });
    state.reviewerChanges.push(...records);
    return notes;
  };
  let r: Output<BashHook>;
  try {
    r = await judgeBash($, e, next);
  } catch (error) {
    // The gate's failure handler answers a call that threw, so no note can
    // ride along; the record still reaches the status tool. A separate hook
    // would never see this case, which is why the comparison wraps the gate.
    await report();
    throw error;
  }
  if (r.deny !== undefined) return r;
  const notes = await report();
  return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] };
}

// A note, never a refusal: the command has already run. Reviewer legs are
// compared by the gate already, and a background command is still running
// when the call returns. Never throws, so the gate's own notes always arrive.
async function onBashEdits(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  const skip =
    runningLeg(e.agentId) !== null ||
    e.run_in_background === true ||
    !mayWrite(e.command, state.shellAliases);
  if (skip) return next(e);
  let root: Repo | null;
  // onBash, registered first, has already looked the root up; this guards a
  // registration order where it has not.
  try {
    root = await ensureRoot($);
  } catch (error) {
    return withNote(next(e), editsSkipped(messageOf(error)));
  }
  if (root === null) return next(e);
  const { top } = root;
  const git = gitOf($);
  const { result, note } = await measureEdits(
    () => worktreeTree(git, top),
    (before, after) => reviewablePaths(git, top, before, after),
    () => next(e),
  );
  return note === null ? result : withNote(result, note);
}

// The model check's reading of the user's latest message, asked once per
// message; one that got no answer is asked again by the next step. None where
// it does not run: switched off, under -p or the Agent SDK, or while a message
// that declined a step holds.
function modelRead($: $): ModelAsk | null {
  const { text, before, origin } = state.said;
  if (!state.modelCheck || origin === 'sdk' || text.trim() === '') return null;
  if (state.held?.how === 'declined') return null;
  if (state.model?.message !== state.messages) {
    const ask = { message: state.messages, text, before, read: askModel($, text, before) };
    state.model = ask;
    void ask.read.then((r) => {
      if (r.kind === 'unanswered' && state.model === ask) state.model = null;
    });
  }
  return state.model;
}

// One model check call: its reply, or why it got none.
async function complete(
  $: $,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<{ text: string } | { why: string }> {
  try {
    const r = await $.model.complete({
      model: 'sonnet',
      effort: 'low',
      maxTokens,
      timeoutMs: 15_000,
      system: [{ text: system, cache: true }],
      prompt,
    });
    if (r.isAnswered) return { text: r.text };
    return {
      why:
        r.reason === 'api-error'
          ? `an API error, ${r.error}`
          : r.reason === 'aborted'
            ? 'it ran out of time or was interrupted'
            : 'an empty reply',
    };
  } catch (error) {
    return { why: error instanceof Error ? error.message : String(error) };
  }
}

async function askModel($: $, text: string, before: string): Promise<ModelRead> {
  const r = await complete($, RULES, askOf(text, offerOf(before)), 300);
  return 'why' in r ? { kind: 'unanswered', why: r.why } : judge(r.text, text);
}

// Kept with the misses, replacing an earlier one of the same message and refusal.
function recordMiss(miss: Miss): void {
  const same = (m: Miss) => m.message === miss.message && m.refusal === miss.refusal;
  state.misses = [...state.misses.filter((m) => !same(m)), miss].slice(-MAX_MISSES);
}

// The model's yes, with the message it read.
type ModelYes = Readonly<{
  steps: ModelSteps;
  added: ModelGrant;
  quote: string;
  text: string;
  before: string;
}>;

// What a refused step gets from the model check: its yes, why it could not
// judge the message, or nothing.
async function secondRead($: $): Promise<ModelYes | { why: string } | null> {
  const ask = modelRead($);
  if (ask === null) return null;
  const read = await ask.read;
  if (read.kind === 'unanswered') return { why: read.why };
  if (read.kind === 'refused') {
    if (read.why === 'malformed') return { why: 'its reply could not be read' };
    if (read.why === 'quote') return { why: 'its reply quoted words the message does not hold' };
    return null;
  }
  const m = read.grant;
  const steps: ModelSteps = {
    ...(m.push === 'push' ? { push: true } : {}),
    ...(m.pr ? { pr: true } : {}),
    ...(m.approve ? { approve: true } : {}),
    ...(m.release ? { release: true } : {}),
  } as const;
  return { steps, added: m, quote: read.quote, text: ask.text, before: ask.before };
}

// The typed grant with the model's yes, for reporting what ran, never for
// deciding what may.
function withModel(granted: Grant, m: ModelGrant): Grant {
  return {
    ...granted,
    push: m.push === 'push' && !covers(granted, 'push') ? 'push' : granted.push,
    pr: granted.pr || m.pr,
    approve: granted.approve || m.approve,
    release: granted.release || m.release,
  };
}

const MODEL_STEPS = ['push', 'pr', 'approve', 'release'] as const;

// Once the step ran: shown and told, and kept with the misses as a candidate
// for the grammar.
function modelRan($: $, yes: ModelYes): string {
  const steps = MODEL_STEPS.filter((s) => yes.steps[s] === true);
  const line = `review-cycle: the model check read "${yes.quote}" as asking for ${steps.map((s) => STEP_NAME[s]).join(' and ')}.`;
  $.ui.log(line);
  recordMiss({
    message: clip(yes.text),
    offer: clip(offerOf(yes.before)),
    steps: [...steps],
    refusal: clip(`granted by the model check: "${yes.quote}"`),
  });
  return line;
}

async function ranByModel(
  $: $,
  result: Output<BashHook> | Promise<Output<BashHook>>,
  yes: ModelYes,
): Promise<Output<BashHook>> {
  const r = await result;
  if (r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), modelRan($, yes)] };
}

const couldNotJudge = (why: string) => ` The model check could not judge the message (${why}).`;

// The merge's grant naming no pull request, when the model check reads the
// one the grammar took from the answer as mentioned rather than offered.
async function offeredUnnamed(
  $: $,
  granted: Grant,
): Promise<{ grant: Grant; n: string } | { why: string; n: string } | null> {
  const { before, origin } = state.said;
  // A grant a queued message joined is not one message the model can be shown.
  const text = state.message.said;
  if (!state.modelCheck || origin === 'sdk' || text === null || text.trim() === '') return null;
  if (state.held?.how === 'declined') return null;
  const n = closingNamed(granted, text);
  if (n === null) return null;
  if (state.target?.message !== state.messages || state.target.n !== n) {
    const ask = { message: state.messages, n, read: askTarget($, before, n, text) };
    state.target = ask;
    // One that got no answer is asked again by the next step.
    void ask.read.then((r) => {
      if (r.kind === 'unanswered' && state.target === ask) state.target = null;
    });
  }
  const read = await state.target.read;
  if (read.kind !== 'read') return { why: read.why, n };
  return read.mentioned ? { grant: unnamed(granted, n), n } : null;
}

// A refused GitHub step judged again with the grant naming no pull request in
// place of one the answer only mentioned; the refusal says why when the model
// could not tell.
async function ghUnnamed(
  $: $,
  shown: string,
  actions: Parameters<typeof judgeGh>[1],
  granted: Grant,
  first: { deny: string },
): Promise<{ gh: Awaited<ReturnType<typeof judgeGh>>; granted: Grant; told: string | null }> {
  const kept = { gh: first, granted, told: null };
  if (actions.length === 0) return kept;
  const read = await offeredUnnamed($, granted);
  if (read === null) return kept;
  if ('why' in read) {
    const why = ` The model check could not judge whether the answer offered #${read.n} (${read.why}).`;
    return { ...kept, gh: { ...first, deny: first.deny + why } };
  }
  const gh = await judgeGh(
    shown,
    actions,
    read.grant,
    state.held,
    ghLookups($),
    {},
    state.message.unread,
    pointedNow(),
    state.standing,
  );
  return 'deny' in gh ? kept : { gh, granted: read.grant, told: targetRan($, read.n) };
}

type TargetRead =
  | { kind: 'read'; mentioned: boolean }
  | { kind: 'unanswered' | 'unread'; why: string };

async function askTarget($: $, before: string, n: string, text: string): Promise<TargetRead> {
  const r = await complete($, TARGET, targetAskOf(before, n, text), 100);
  if ('why' in r) return { kind: 'unanswered', why: r.why };
  const mentioned = mentionedOf(r.text);
  return mentioned === null
    ? { kind: 'unread', why: 'its reply could not be read' }
    : { kind: 'read', mentioned };
}

function targetRan($: $, n: string): string {
  const line = `review-cycle: the model check read #${n} as mentioned beside the merge the answer offered, not offered itself, so the merge names no pull request and oakum's version pull request still asks.`;
  $.ui.log(line);
  const { text, before } = state.said;
  recordMiss({
    message: clip(text),
    offer: clip(offerOf(before)),
    steps: ['merge'],
    refusal: clip(`#${n} read by the model check as mentioned, not offered`),
  });
  return line;
}

// A refused GitHub step judged again with the model check's yes letting steps
// through, as the stop-before setting would.
async function ghWithModel(
  $: $,
  shown: string,
  actions: Parameters<typeof judgeGh>[1],
  granted: Grant,
  first: { deny: string },
): Promise<{ gh: Awaited<ReturnType<typeof judgeGh>>; yes: ModelYes | null }> {
  const second = actions.length > 0 ? await secondRead($) : null;
  if (second === null) return { gh: first, yes: null };
  if ('why' in second) return { gh: { deny: first.deny + couldNotJudge(second.why) }, yes: null };
  const gh = await judgeGh(
    shown,
    actions,
    granted,
    state.held,
    ghLookups($),
    second.steps,
    state.message.unread,
    pointedNow(),
    state.standing,
  );
  return { gh, yes: 'deny' in gh ? null : second };
}

async function judgeBash(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  // A newer message overtakes anything decided from this one.
  const message = state.messages;
  const granted = state.message.grant;
  if (bashTouchesGate(e.command)) return deny(SWITCHED_BY_USER);
  await loadShellAliases($);
  const cls = classify(e.command, state.shellAliases);
  if (cls.kind === 'refuse') return deny(cls.reason);
  // A gh command beside a commit or push is refused by classify.
  if (cls.kind === 'none') {
    const actions = ghActions(e.command, state.shellAliases);
    if (actions.length > 0 && e.agentId) return deny(SUBAGENT);
    // It replays commits as `git rebase` does, so it is watched as history,
    // and alone, so no commit beside it goes unchecked.
    const rewrite = stackRewrite(e.command, state.shellAliases);
    if (rewrite === 'joined') {
      return deny(
        '`gh stack rebase` and `gh stack sync` rewrite commits, so the gate checks them only as their own command. Run it alone.',
      );
    }
    const typed = await judgeGh(
      quote(e.command),
      actions,
      granted,
      state.held,
      ghLookups($),
      {},
      state.message.unread,
      pointedNow(),
      state.standing,
    );
    const read =
      'deny' in typed && !typed.final
        ? await ghUnnamed($, quote(e.command), actions, granted, typed)
        : { gh: typed, granted, told: null };
    const first = read.gh;
    const { gh, yes } =
      'deny' in first && !first.final
        ? await ghWithModel($, quote(e.command), actions, read.granted, first)
        : { gh: first, yes: null };
    if ('deny' in gh) return deny(gh.deny);
    // Only a GitHub step is stopped by a newer message; other commands run.
    const since = actions.length > 0 ? message : null;
    const candidates = possibleAliases(e.command, state.shellAliases);
    if (candidates.length > 0) {
      const configured = await run($, ['git', 'config', '--get-regexp', String.raw`^alias\.`]);
      if (configured.exitCode > 1)
        throw new Error(`git config failed: ${firstLine(configured.stderr)}`);
      const aliases = new Map<string, string>();
      for (const line of configured.stdout.split('\n')) {
        const m = /^alias\.(\S+)\s(.*)$/.exec(line);
        if (m?.[1] && m[2] !== undefined) aliases.set(m[1], m[2]);
      }
      for (const a of candidates) {
        if (a.inline !== null) aliases.set(a.sub, a.inline);
      }
      for (const a of candidates) {
        if (aliasCommits(a.sub, (name) => aliases.get(name) ?? null)) {
          return deny(
            `\`git ${a.sub}\` is an alias that commits or pushes. Run the git command directly so the gate can check it.`,
          );
        }
      }
    }
    const grant = yes === null ? read.granted : withModel(read.granted, yes.added);
    const checked = rewrite === 'alone' ? 'history' : 'unchecked';
    const watched = watch($, await ensureRoot($), e, next, checked, grant, since, gh.ran);
    const ran = yes === null ? await watched : await ranByModel($, watched, yes);
    if (ran.deny === undefined && ran.isError !== true) spend(gh.used);
    const notes = [...(read.told === null ? [] : [read.told]), ...(gh.notes ?? [])];
    const r =
      notes.length === 0 || ran.deny !== undefined
        ? ran
        : { ...ran, context: [...(ran.context ?? []), ...notes] };
    if (state.aliasError === null || state.aliasErrorShown || r.deny !== undefined) return r;
    state.aliasErrorShown = true;
    return {
      ...r,
      context: [
        ...(r.context ?? []),
        `review-cycle could not read the user's shell aliases (${state.aliasError}), so an aliased git commit or push is not checked. Tell the user.`,
      ],
    };
  }

  const root = await ensureRoot($);
  if (root === null) return next(e);
  const target = await repoAt(gitOf($), cls.dir);
  if (target === 'none' || target.common !== root.common) return next(e);
  if (target.top !== root.top) {
    return deny(
      `this commits or pushes from another worktree of this repository (${target.top}). Do it from ${root.top}, where the gate can check it.`,
    );
  }
  if (e.agentId) return deny(SUBAGENT);

  // A commit needs only a review: it stays local, and undoing one costs a reset.
  const unreviewed = await reviewed($, root.top, cls);
  if (unreviewed !== null) return deny(unreviewed);

  const finishes = cls.commit?.finishes ?? null;
  // "finish the rebase" asks for that `--continue`'s commit and no other.
  const asked = granted.commit || (finishes !== null && granted.finish.includes(finishes));
  if (cls.commit && !cls.commit.dryRun && !asked) {
    const ladder = await ladderOf($);
    if (!permitted(granted, ladder, state.held !== null).commit) {
      return deny(commitRefusal(e.command, ladder, finishes));
    }
  }
  const ran: Unasked[] = [];
  let yes: ModelYes | null = null;
  let note: string | null = null;
  if (cls.push) {
    const commits = cls.commit !== null && finishes === null;
    let verdict = await judgePush($, root.top, e.command, commits, cls.push, granted);
    if ('deny' in verdict && verdict.final) return deny(verdict.deny);
    if ('deny' in verdict) {
      const second = await secondRead($);
      if (second === null) return deny(verdict.deny);
      if ('why' in second) return deny(verdict.deny + couldNotJudge(second.why));
      verdict = await judgePush($, root.top, e.command, commits, cls.push, granted, second.steps);
      if ('deny' in verdict) return deny(verdict.deny);
      yes = second;
    }
    // Only a push that would run is steered, so its own refusals come first.
    const layer = await stackLayerPushed($, root, cls.push);
    if (layer !== null) {
      return deny(
        `\`${layer}\` is a layer of a gh-stack stack, and a plain \`git push\` of it leaves gh-stack's record of the stack behind, so nothing ran. Push the stack with \`gh stack push\`, which runs on the user's push request while each of its branches is where this agent last pushed it. The command: ${quote(e.command)}`,
      );
    }
    if (verdict.ran !== null) ran.push(verdict.ran);
    if (verdict.note !== undefined) note = verdict.note;
  }
  const checked: Checked =
    finishes !== null
      ? { finishes }
      : cls.commit
        ? 'commit'
        : cls.history !== null
          ? 'history'
          : 'push';
  if (yes === null) {
    const r = await watch($, root, e, next, checked, granted, message, ran);
    if (note === null || r.deny !== undefined) return r;
    return { ...r, context: [...(r.context ?? []), note] };
  }
  const watched = watch($, root, e, next, checked, withModel(granted, yes.added), message, ran);
  return ranByModel($, watched, yes);
}

// The refusal when a reviewer has not seen all of what a real commit would
// record; null otherwise.
async function reviewed(
  $: $,
  top: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<string | null> {
  if (!cls.commit || cls.commit.dryRun) return null;
  const { amend } = cls.commit;
  const head = await headOf(gitOf($), top);
  // An amend replaces HEAD, so what it records is judged against HEAD's parent.
  const base = amend && head !== EMPTY_TREE ? await parentTree(gitOf($), top) : head;
  if (base === null)
    throw new Error("could not read the tree of HEAD's parent, which an amend replaces");
  let prospect: string;
  try {
    prospect = await prospectTree(gitOf($), top, cls);
  } catch (error) {
    // git names one unmerged path per line; the error keeps the first.
    const unmerged = /write-tree failed: (.+): unmerged \(/.exec(messageOf(error))?.[1];
    if (unmerged === undefined) throw error;
    return `conflicts are still unresolved, starting with ${unmerged} (paths are from the repository root; \`git status\` lists the rest). Resolve them and \`git add\` or \`git rm\` them; once a reviewer has seen the resolution, run the command again.`;
  }
  const c = await coverageOf(gitOf($), top, base, prospect, state.reviews);
  if (c === null) {
    const against = base === EMPTY_TREE ? 'the empty tree' : amend ? "HEAD's parent" : 'HEAD';
    throw new Error(`could not compare the tree this commit would record with ${against}`);
  }
  if (uncoveredOf(c.rows).length > 0) {
    return `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then ${cls.commit.finishes === undefined ? 'commit' : 'continue'}.`;
  }
  return null;
}

// Longer than this, the refusal quotes only the start of the command.
const MAX_SHOWN = 300;

const LEASE = '`--force-with-lease --force-if-includes`';

const SUBAGENT =
  'subagents do not commit, push, open, merge, approve or comment on pull requests, or release, in this repository. Report back to the main session instead.';

// A push a requested pull request needs (`forPr`) runs unasked, not noted.
type Unasked = GhUnasked & { forPr?: true };

// The rung in force: the local file's, else the user's, made earlier by the
// project file's. Settings that cannot be read stop before every step.
async function ladderOf($: $): Promise<InForce> {
  const rungs: Partial<Record<'project' | 'local', StopBefore | null>> = {};
  for (const source of ['project', 'local'] as const) {
    try {
      const settings = await $.settings.read({ source });
      rungs[source] = configured(settings.pluginConfigs);
    } catch (error) {
      const unreadable = `${where(source)}: ${messageOf(error)}`;
      return { stopBefore: STRICTEST, source: 'default', unreadable };
    }
  }
  const set = effective(state.stopBefore, rungs.project ?? null, rungs.local ?? null);
  return withMandate(set, state.mandate?.epic ?? null);
}

// Told to the agent, so the step is never silent. Worded as having run, not
// succeeded: the command may still fail.
const STEP_NAME: Record<Step, string> = {
  commit: 'a commit',
  push: 'a push',
  pr: 'a pull request',
  merge: 'a merge',
  approve: 'an approval',
  release: 'a release',
};

function ranUnasked($: $, { step, ladder, ready }: Unasked): string {
  const line =
    ready === undefined
      ? `review-cycle: ran ${STEP_NAME[step]} without asking, since the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)}).`
      : `review-cycle: ran ${STEP_NAME[step]} now, though the user asked for it once the pull request is ready: ${ready}.`;
  // A step the setting lets through repeats a choice the user made once.
  if (ready !== undefined || state.unaskedNotice) $.ui.log(line);
  return line;
}

// Git's own credential prompt fails instead of waiting, so the push asks.
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0' };
// Also after the push's options, to beat a -q or --verify; the leading
// --dry-run is the one no option value can swallow. Measured on git 2.56.
// A submodule push runs that submodule's hooks, which --no-verify misses.
const DRY_RUN = [
  '--dry-run',
  '--porcelain',
  '--no-verify',
  '--no-quiet',
  '--recurse-submodules=no',
];

const DELETES = 'it deletes a remote branch';

// Why a push asks whatever the setting, or null. Off the ladder: a push that
// changes a remote's default branch, pushes a tag, deletes or force-updates a
// ref, and one the gate cannot see the targets of. Git itself names the refs
// a push updates, with its own push config applied, through a dry run.
async function alwaysAsks($: $, top: string, spec: PushSpec): Promise<string | null> {
  if (spec.deletes) return DELETES;
  if (spec.every) return 'it pushes every branch';
  if (spec.tags) return 'it pushes tags';
  if (spec.argv === null) return 'its remote or branch is built at run time';
  if (spec.after !== null) {
    return `\`git ${spec.after}\` runs before it in the same command, which can change where it goes (run that step on its own first, and the push is judged after it)`;
  }
  const targets = await pushTargets($, top, spec.argv);
  if (targets.failed !== null) {
    return `a dry run of it, which shows what it would push, failed (${targets.failed})`;
  }
  return askingReason(targets.refs, targets.defaults);
}

// The unmerged stack layer a `git push` updates, when this clone tracks a
// gh-stack stack. A catalog or dry run it cannot read leaves the push to the
// other checks: this steers to `gh stack push`, and guards nothing they miss.
async function stackLayerPushed($: $, root: Repo, spec: PushSpec): Promise<string | null> {
  if (spec.argv === null) return null;
  const io = leaseIoOf($, root);
  const text = await io.catalog();
  const stacks = typeof text === 'string' ? parseCatalog(text) : null;
  if (stacks === null || stacks.length === 0) return null;
  const { refs } = await pushTargets($, root.top, spec.argv);
  // A deleted ref, or one pushed to a remote other than the one gh-stack
  // pushes the layer to, leaves the stack's record as it was.
  for (const r of refs) {
    if (r.flag === '-' || !r.to.startsWith('refs/heads/')) continue;
    const layer = layerOf(stacks, [r.to.slice('refs/heads/'.length)]);
    if (layer === null) continue;
    const remote = await remoteOf(layer, io);
    if (typeof remote !== 'string') continue;
    const urls = await io.urls(remote);
    if ('asks' in urls) continue;
    if (urls.push.split('\n').some((u) => anonymized(u.trim()) === r.url)) return layer;
  }
  return null;
}

// One dry run per push judged, shared by every check that reads its targets.
const targetsRead = new WeakMap<object, ReturnType<typeof readPushTargets>>();

function pushTargets($: $, top: string, argv: NonNullable<PushSpec['argv']>) {
  const known = targetsRead.get(argv);
  if (known !== undefined) return known;
  const read = readPushTargets($, top, argv);
  targetsRead.set(argv, read);
  return read;
}

// The refs a push updates, from a dry run with git's own push config applied,
// and the default branch of each remote it goes to. A dry run that fails
// still lists the refs it would update: one ref rejected does not stop the rest.
async function readPushTargets(
  $: $,
  top: string,
  argv: NonNullable<PushSpec['argv']>,
): Promise<{ refs: DryRunRef[]; defaults: Map<string, DefaultBranch>; failed: string | null }> {
  const { config, args, end } = argv;
  const probe = ['--dry-run', ...args.slice(0, end), ...DRY_RUN, ...args.slice(end)];
  const dry = await run($, ['git', ...config, 'push', ...probe], { cwd: top, env: NO_PROMPT });
  const failed = dry.exitCode === 0 ? null : firstLine(dry.stderr) || `exit ${dry.exitCode}`;
  const refs = parseDryRun(dry.stdout);
  const defaults = new Map<string, DefaultBranch>();
  for (const url of new Set(refs.map((r) => r.url))) {
    const head = await run($, ['git', 'ls-remote', '--symref', url, 'HEAD'], {
      cwd: top,
      env: NO_PROMPT,
    });
    const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(head.stdout)?.[1];
    if (head.exitCode === 0 && branch !== undefined) defaults.set(url, { branch });
    else defaults.set(url, { unreadable: firstLine(head.stderr) || 'no default branch named' });
  }
  return { refs, defaults, failed };
}

// What a push the user asked for still needs: their naming of the default
// branch or tag it pushes, or a word to the agent that its targets went
// unread. One whose targets a step before it can change asks.
async function coveredAsks(
  $: $,
  top: string,
  command: string,
  commits: boolean,
  spec: PushSpec,
  named: readonly string[],
): Promise<{ deny: string } | { note: string } | null> {
  const asked = "the user's latest message asks for a push, but";
  if (spec.after !== null) {
    return {
      deny: `${asked} \`git ${spec.after}\` runs before it in the same command, which can change where it goes, so nothing ran. Run that step on its own first, and the push is judged after it.`,
    };
  }
  if (spec.argv === null) {
    return {
      deny: `${asked} its remote or branch is built at run time, so the gate cannot tell where it goes, and nothing ran. Write the remote and branch out.`,
    };
  }
  const t = await pushTargets($, top, spec.argv);
  // Exit 1 is a detached HEAD; any other failure leaves the branch unknown.
  const branch = commits ? await run($, ['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: top }) : null;
  const moved =
    branch === null
      ? null
      : branch.exitCode === 0
        ? branch.stdout.trim()
        : branch.exitCode === 1
          ? 'HEAD'
          : '*';
  const u = unnamedTarget(t.refs, t.defaults, named, moved);
  if (u !== null) return { deny: unnamedRefusal(command, commits, u) };
  const unread = [...t.defaults].filter(([, head]) => 'unreadable' in head);
  const why =
    t.refs.length === 0
      ? t.failed === null
        ? 'its dry run named no ref it would update'
        : `a dry run of it failed (${t.failed})`
      : unread.length > 0
        ? `the default branch of ${unread[0]?.[0]} could not be read, so only \`main\` and \`master\` were checked`
        : null;
  if (why === null) return null;
  return {
    note: `review-cycle ran the push the user asked for without fully checking where it goes: ${why}. If it may have reached the default branch or a tag they did not name, tell them.`,
  };
}

// What the push may run, or why not: a grant covers it, or a plain push the
// ladder or a requested pull request lets through, unless it always asks.
async function judgePush(
  $: $,
  top: string,
  command: string,
  commits: boolean,
  spec: PushSpec,
  granted: Grant,
  model: ModelSteps = {},
): Promise<{ deny: string; final?: true } | { ran: Unasked | null; note?: string }> {
  const missing = unasked(spec, granted);
  if (missing === null) {
    const c = await coveredAsks($, top, command, commits, spec, granted.pushNamed);
    if (c === null) return { ran: null };
    return 'deny' in c ? { deny: c.deny, final: true } : { ran: null, note: c.note };
  }
  const ladder = await ladderOf($);
  const forPr = granted.pr && state.held === null;
  const bySetting = forPr || permitted(granted, ladder, state.held !== null).push;
  // The model's yes to a push, or to the pull request it needs, lets it through
  // as the setting does, so the pushes that always ask still ask.
  const byModel =
    (model.pr === true && state.held?.step !== 'push') ||
    permitted(granted, ladder, state.held !== null, model).push;
  const outcome = await pushOutcome(missing, bySetting || byModel, () => alwaysAsks($, top, spec));
  if (outcome.kind === 'covered') return { ran: null };
  if (outcome.kind === 'refused') {
    return {
      deny: pushRefusal(command, commits, outcome.missing, granted, ladder, outcome.always),
    };
  }
  // A push the model's yes to a pull request let through is that pull
  // request's, as a typed request's is.
  if (!bySetting) return { ran: model.pr === true ? { step: 'push', ladder, forPr: true } : null };
  return { ran: forPr ? { step: 'push', ladder, forPr: true } : { step: 'push', ladder } };
}

function quote(command: string): string {
  const shown = shownCommand(command, state.shellAliases);
  return shown.length > MAX_SHOWN ? `${shown.slice(0, MAX_SHOWN)}…` : shown;
}

function commitRefusal(command: string, ladder: InForce, finishes: Finishes | null): string {
  const setting =
    ladder.unreadable === undefined
      ? `, and the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)})`
      : '';
  const ask =
    finishes === null
      ? `To commit, ${askThem('what it commits and on which branch', '"Commit the changes to `fix/x`?"', quote(command))}`
      : `To finish the ${finishes}, which commits the resolution, ${askThem('what it commits and on which branch', `"Commit the resolution to \`fix/x\` and finish the ${finishes}?"`, quote(command))}`;
  return `${notAsked('a commit', ladder, false, state.held, unreadFor(state.message.unread, 'commit'))}${setting}, so nothing ran. ${ask}`;
}

// How long the user waits on a gh read before the step asks.
const LOOKUP_MS = [5000];
// A read confirming a merge the user asked for is tried once more for longer,
// since GitHub is slow at times and asking them again gains nothing.
const MERGE_LOOKUP_MS = [5000, 10_000];

// What a gh read printed, or why it asks: "looking up <what> failed (…)" or
// "… printed nothing". `slow` only when every try timed out.
async function ghRead($: $, args: string[], what: string, schedule = LOOKUP_MS): Promise<Lookup> {
  let r: Awaited<ReturnType<typeof $.process.run>> | null = null;
  let failed = '';
  for (const timeoutMs of schedule) {
    try {
      r = await $.process.run(['gh', ...args], { timeoutMs, env: { GH_PROMPT_DISABLED: '1' } });
      break;
    } catch (error) {
      failed = messageOf(error);
      // The wording of a timeout is the test kit's; a real host's is inferred to match.
      if (!/timed? ?out/i.test(failed)) break;
    }
  }
  if (r === null) {
    const slow = /timed? ?out/i.test(failed);
    return slow
      ? { asks: `looking up ${what} failed (${failed})`, slow }
      : { asks: `looking up ${what} failed (${failed})` };
  }
  if (r.exitCode !== 0) {
    const why = firstLine(r.stderr) || `it ended with no output, exit ${r.exitCode}`;
    return { asks: `looking up ${what} failed (${why})` };
  }
  // A jq path that meets null prints an empty line and exits 0 (gh 2.102.0).
  const out = r.stdout.trim();
  if (out === '') return { asks: `looking up ${what} printed nothing` };
  return { out };
}

// The gh reads GitHub judging needs, each failing into a reason to ask.
function ghLookups($: $): GhLookups {
  return {
    ladder: () => ladderOf($),
    mergeTarget: (lookup) =>
      ghRead(
        $,
        [
          'pr',
          'view',
          ...lookup,
          '--json',
          'url,state,mergeStateStatus',
          '--jq',
          String.raw`"\(.url) \(.state) \(.mergeStateStatus)"`,
        ],
        'the pull request it merges',
        MERGE_LOOKUP_MS,
      ),
    repoUrl: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'url', '--jq', '.url'],
        'the current repository',
        MERGE_LOOKUP_MS,
      ),
    branch: async () => {
      try {
        const r = await $.process.run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
          timeoutMs: 5000,
        });
        if (r.exitCode === 0) return { out: r.stdout };
        // --quiet leaves a detached HEAD exit 1 with nothing on stderr.
        const why = r.stderr.trim().split('\n')[0] ?? '';
        if (r.exitCode === 1 && why === '') return { out: '' };
        return { asks: `reading the current branch printed \`${why}\` (exit ${r.exitCode})` };
      } catch (error) {
        return { asks: `reading the current branch failed (${messageOf(error)})` };
      }
    },
    // GitHub's rollup counts check runs and commit statuses alike, unpaged.
    mainChecks: () =>
      ghRead(
        $,
        [
          'api',
          'graphql',
          '-F',
          'owner={owner}',
          '-F',
          'name={repo}',
          '-f',
          'query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name target{... on Commit{statusCheckRollup{state}}}}}}',
          '--jq',
          String.raw`"\(.data.repository.defaultBranchRef.name) \(.data.repository.defaultBranchRef.target.statusCheckRollup.state // "NONE")"`,
        ],
        "the default branch's checks",
        MERGE_LOOKUP_MS,
      ),
    versionPulls: () =>
      ghRead(
        $,
        [
          'pr',
          'list',
          '--head',
          VERSION_BRANCH,
          '--state',
          'all',
          '--limit',
          '50',
          '--json',
          'number,state,isCrossRepository',
          '--jq',
          String.raw`[.[] | select(.isCrossRepository | not) | "\(.number):\(.state)"] | if length == 0 then "none" else join(" ") end`,
        ],
        "oakum's version pull requests",
        MERGE_LOOKUP_MS,
      ),
    pullRequest: async (lookup, what) => {
      const args = ['pr', 'view', ...lookup, '--json', PR_FIELDS, '--jq', PR_JQ];
      const r = await ghRead($, args, what);
      if (r.asks === undefined) return parsePullRequest(r.out, what);
      return r.slow ? { asks: r.asks, slow: true } : { asks: r.asks };
    },
    defaultBranch: (repo) =>
      ghRead(
        $,
        [
          'repo',
          'view',
          ...(repo === null ? [] : [repo]),
          '--json',
          'defaultBranchRef',
          '--jq',
          '.defaultBranchRef.name',
        ],
        'the default branch',
      ),
    stack: (n) => readStack(n, (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS)),
    stackLease: (step, remote) => stackLeaseOf($, step, remote),
  };
}

// How long the remote may take to list its branches before the push asks.
const LS_REMOTE_MS = 15_000;

// gh-stack's lease boundary, read from this clone, its remote and GitHub.
async function stackLeaseOf(
  $: $,
  step: 'push' | 'sync' | 'submit',
  remote: string | null,
): Promise<{ ok: true } | { asks: string }> {
  const root = await ensureRoot($);
  if (root === null) return { asks: 'the gate cannot find the repository' };
  return stackLease(step, remote, leaseIoOf($, root));
}

// The clone, its remotes and GitHub as gh-stack's lease boundary reads them.
function leaseIoOf($: $, root: Repo): LeaseIo {
  const git = async (args: string[], timeoutMs = 10_000) => {
    try {
      const r = await run($, ['git', ...args], {
        cwd: root.top,
        env: { GIT_TERMINAL_PROMPT: '0' },
        timeoutMs,
      });
      return { code: r.exitCode, out: r.stdout, why: firstLine(r.stderr) || `exit ${r.exitCode}` };
    } catch (error) {
      return { code: -1, out: '', why: messageOf(error) };
    }
  };
  const prefix = `${root.common}\t`;
  const pushed = new Map(
    state.pushed
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, id]) => [k.slice(prefix.length), id]),
  );
  return {
    catalog: async () => {
      try {
        return await within(
          $,
          currentText($, `${root.common}/gh-stack`),
          'reading the stack catalog',
        );
      } catch (error) {
        return { asks: `gh-stack's catalog could not be read (${messageOf(error)})` };
      }
    },
    branch: async () => {
      const r = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
      return r.code === 0 ? r.out.trim() : { asks: 'HEAD is on no branch' };
    },
    config: async (key) => {
      const r = await git(['config', '--get', key]);
      // git config exits 1 for a key that is not set.
      if (r.code === 1) return null;
      if (r.code !== 0) return { asks: `reading ${key} failed (${r.why})` };
      return r.out.trim() === '' ? null : r.out.trim();
    },
    urls: async (name) => {
      const fetch = await git(['remote', 'get-url', '--all', name]);
      const push = await git(['remote', 'get-url', '--push', '--all', name]);
      if (fetch.code !== 0 || push.code !== 0) {
        return {
          asks: `reading ${name}'s URLs failed (${fetch.code === 0 ? push.why : fetch.why})`,
        };
      }
      return { fetch: fetch.out, push: push.out };
    },
    remotes: async () => {
      const r = await git(['remote']);
      return r.code === 0
        ? r.out.split(/\s+/).filter(Boolean)
        : { asks: `listing remotes failed (${r.why})` };
    },
    heads: async (name) => {
      const r = await git(['ls-remote', '--heads', name], LS_REMOTE_MS);
      return r.code === 0 ? r.out : { asks: `listing ${name}'s branches failed (${r.why})` };
    },
    defaultBranch: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
        'the default branch',
      ),
    ghApi: (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS),
    pushed,
  };
}

// The gate does not ask: the agent asks in its reply, so the user can answer
// with anything at all. Their next message grants through the consent grammar.
// `always` is why this push asks whatever the setting, when it does.
function pushRefusal(
  command: string,
  commits: boolean,
  missing: Needed,
  granted: Grant,
  ladder: InForce,
  always: string | null,
): string {
  const alone = commits ? ' To commit without pushing, run the commit on its own.' : '';
  const ask = (example: string) => askThem('what it pushes and where', example, quote(command));
  switch (missing) {
    case 'bare': {
      const leaseToo = covers(granted, 'lease') ? '' : ', which also needs their request';
      return `a bare --force (or a \`+refspec\`) overwrites whatever the remote holds, and the user's latest message doesn't ask for a bare force, so nothing ran.${alone} Use ${LEASE} instead${leaseToo}; if they want a bare --force, ${ask('"Force-push `fix/x` to `origin` without a lease?"')}`;
    }
    case 'lease': {
      return `the user's latest message doesn't ask for a force push, so nothing ran.${alone} To force-push, ${ask('"Force-push `fix/x` to `origin` with a lease?"')}`;
    }
    case 'push': {
      const asksAnyway = always === null ? '' : ` This push asks whatever the setting: ${always}.`;
      if (always === DELETES) {
        return `${notAsked('a push', ladder, true, state.held, unreadFor(state.message.unread, 'push'))}, so nothing ran.${asksAnyway}${alone} A merge the user asked for also covers \`gh pr merge --delete-branch\`. To delete it, ${ask('"Delete `fix/x` from `origin`?"')}`;
      }
      return `${notAsked('a push', ladder, true, state.held, unreadFor(state.message.unread, 'push'))}, so nothing ran.${asksAnyway}${alone} To push, ${ask('"Push `fix/x` to `origin`?"')}`;
    }
    default: {
      const unhandled: never = missing;
      throw new Error(`no refusal for the push level ${String(unhandled)}`);
    }
  }
}

// A push the user asked for, to a target their request did not name.
function unnamedRefusal(command: string, commits: boolean, u: Unnamed): string {
  const alone = commits ? ' To commit without pushing, run the commit on its own.' : '';
  const shown = quote(command);
  const then =
    u.offer === null
      ? `The gate never does that for the user. Give them the command to run themselves, and say why it is needed. The command: ${shown}`
      : `To push there, ${askThem('where it pushes', u.offer, shown)}`;
  return `the user's latest message asks for a push, but ${u.why}, so nothing ran.${alone} ${then}`;
}

// `finishes`: a `--continue` of that history command.
type Checked = 'commit' | 'history' | 'push' | 'unchecked' | { finishes: Finishes };
// HEAD's newest reflog entries and the log's length before a command, so the
// entries it added can be told apart afterwards.
type Start = { head: string; refs: Refs; log: Entry[]; count: number };

// More entries than this in one command are not read; the command is then
// reported as unchecked.
const MAX_ADDED = 200;

// Runs the command, then reports a commit the gate did not check (a script),
// one whose content changed after the check (a pre-commit hook restaging),
// and a push the user did not ask for. A history command records existing
// commits, so only a `--continue`'s resolution commit is judged afterwards,
// not the picks it replays. A commit made in another worktree is not seen:
// each worktree has its own HEAD.
async function watch(
  $: $,
  root: Repo | null,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
  checked: Checked,
  // What the user allowed for this call: their message, or their pick.
  granted: Grant = state.message.grant,
  // The message count `granted` was read at; a newer message stops the call.
  message: number | null = null,
  ran: readonly Unasked[] = [],
): Promise<Output<BashHook>> {
  const git = gitOf($);
  let start: Start | null = null;
  let startError: unknown = null;
  if (root !== null) {
    try {
      const head = await headOf(git, root.top);
      const unborn = head === EMPTY_TREE;
      const log = unborn ? [] : await headLog(git, root.top, MARK);
      const count = await headLogCount(git, root.top, unborn);
      start = { head, refs: await remoteRefs(git, root.top), log, count };
    } catch (error) {
      startError = error;
    }
  }
  const stale = message === null ? null : overtaken(message, next.signal, 'command');
  if (stale !== null) return stale;
  const group = root !== null && judgedCommit(checked) ? joinCommits(start?.head ?? null) : null;
  let r: Output<BashHook>;
  try {
    r = await next(e);
  } catch (error) {
    if (group !== null) group.running--;
    throw error;
  }
  const notes = r.deny === undefined ? unaskedNotes($, ran) : [];
  if (root === null) {
    if (notes.length === 0 || r.deny !== undefined) return r;
    return { ...r, context: [...(r.context ?? []), ...notes] };
  }
  const failed = (what: string, error: unknown) => {
    const why = error instanceof Error ? error.message : String(error);
    notes.push(
      `review-cycle could not check whether this command ${what} (${why}). Tell the user.`,
    );
  };
  if (start === null) {
    failed('committed or pushed', startError);
  } else {
    try {
      const after = await remoteRefs(git, root.top);
      const pushed = await pushedRefs(git, root.top, start.refs, after);
      notePushed(root, pushed);
      // A push the gate judged was told already; one from a script was not.
      const judged = ran.some((step) => step.step === 'push');
      if (pushed.length > 0 && !covers(granted, 'push') && !judged) {
        const ladder = await ladderOf($);
        notes.push(
          permitted(granted, ladder, state.held !== null).push
            ? ranUnasked($, { step: 'push', ladder })
            : `review-cycle: this command pushed to ${pushed.map((p) => p.name).join(', ')} without the user asking for a push. Tell the user.`,
        );
      }
    } catch (error) {
      failed('pushed', error);
    }
    try {
      notes.push(...(await commitNotes(git, root.top, start, checked)));
    } catch (error) {
      failed('committed', error);
    }
  }
  // The group stays open until here, so a commit that starts while this one
  // is still being checked joins it rather than reading this one's HEAD.
  if (group !== null && --group.running === 0) {
    try {
      await recordCommitRounds($, root, group, r.deny !== undefined);
    } catch (error) {
      notes.push(
        `review-cycle could not record this commit's review rounds (${messageOf(error)}).`,
      );
    }
  }
  if (notes.length === 0 || r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), ...notes] };
}

// The most pushed branches the gate remembers, across repositories.
const PUSHED_MAX = 200;

function notePushed(root: Repo, pushed: readonly { name: string; id: string }[]): void {
  for (const { name, id } of pushed) {
    const key = `${root.common}\t${name}`;
    state.pushed = [...state.pushed.filter(([k]) => k !== key), [key, id]];
  }
  state.pushed = state.pushed.slice(-PUSHED_MAX);
}

// Judged commits whose calls overlap: the rounds before them are the same
// reviews, so the last to finish records one entry for all of them.
type CommitGroup = { before: string | null; running: number; size: number };
let committing: CommitGroup | null = null;

function joinCommits(head: string | null): CommitGroup {
  if (committing === null || committing.running === 0) {
    committing = { before: head, running: 0, size: 0 };
  }
  committing.running++;
  committing.size++;
  return committing;
}

// Records the rounds reviewed since the last entry, once a group's commits land.
// A count the store does not take is named in the error and not carried into
// the next commit's, unless the call was refused and cannot carry the note.
async function recordCommitRounds(
  $: $,
  root: Repo,
  group: CommitGroup,
  refused: boolean,
): Promise<void> {
  const { before } = group;
  if (before === null) return;
  const after = await headOf(gitOf($), root.top);
  if (after === before || after === EMPTY_TREE) return;
  const from = state.roundsFrom;
  const rounds = roundsOf(state.reviews.slice(from));
  state.roundsFrom = state.reviews.length;
  state.reviewing = null;
  void keep($);
  const now = await $.clock.now();
  roundsAt = Math.max(now, roundsAt + 1);
  const tip = after.slice(0, 12);
  const entry = {
    commit: group.size > 1 && before !== EMPTY_TREE ? `${before.slice(0, 12)}..${tip}` : tip,
    rounds,
    date: new Date(now).toISOString().slice(0, 10),
  };
  try {
    await within(
      $,
      recordRounds(storeOf($), root.common, entry, roundsAt, ROUNDS_TAG),
      'recording review rounds',
    );
  } catch (error) {
    if (refused) {
      state.roundsFrom = Math.min(state.roundsFrom, from);
      void keep($);
    }
    throw new Error(`${rounds} round${rounds === 1 ? '' : 's'}: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

// Orders this session's entries even when the clock does not move between
// them; the tag keeps another session's entry at the same moment apart.
let roundsAt = 0;
const ROUNDS_TAG = Math.random().toString(36).slice(2, 10);

function judgedCommit(checked: Checked): boolean {
  return checked === 'commit' || typeof checked === 'object';
}

async function commitNotes(
  git: Git,
  root: string,
  start: Start,
  checked: Checked,
): Promise<string[]> {
  const after = await headOf(git, root);
  if (after === EMPTY_TREE) {
    if (start.head !== EMPTY_TREE) {
      return [
        'review-cycle: HEAD no longer resolves to a commit after this command. Tell the user.',
      ];
    }
    // Unborn before and after, but a commit may have landed in between.
    if ((await headLogCount(git, root, true)) === start.count) return [];
    throw new Error("HEAD's reflog grew while HEAD ended unborn");
  }
  const count = (await headLogCount(git, root, false)) - start.count;
  if (count < 0 || count > MAX_ADDED) {
    throw new Error(`HEAD's reflog changed by ${count} entries, which the gate does not read`);
  }
  const entries = added(await headLog(git, root, count + MARK), start.log, count);
  if (entries === null) throw new Error("HEAD's reflog does not reach where the command began");
  if (entries.length === 0 && after !== start.head) {
    throw new Error('HEAD moved without a reflog entry');
  }
  const finishes = typeof checked === 'object' ? checked.finishes : null;
  const lineages = (finishes === null ? madeBy : resolutionOf)(entries, start.head);
  const tip = lineages.at(-1)?.tip;
  if (tip === undefined) return [];
  const short = tip.slice(0, 12);
  // Each lineage is judged from its own base, so a commit on another branch
  // is not hidden behind the one HEAD ended on.
  const rows: Row[] = [];
  let unread = 0;
  for (const lineage of lineages) {
    const tree = await treeOf(git, root, lineage.tip);
    const baseTree = await treeOf(git, root, lineage.base);
    const c = tree && baseTree ? await coverageOf(git, root, baseTree, tree, state.reviews) : null;
    if (c === null)
      return [`review-cycle could not check commit ${lineage.tip.slice(0, 12)}. Tell the user.`];
    rows.push(...c.rows);
    unread += c.unread;
  }
  const notes: string[] = [];
  const c = { rows, unread };
  if (checked !== 'history' && uncoveredOf(rows).length > 0) {
    // A rebase runs no pre-commit hook (measured on git 2.56).
    const why =
      finishes === 'rebase'
        ? "It changed after the gate's check."
        : checked === 'commit' || finishes !== null
          ? "A pre-commit hook may have changed it after the gate's check."
          : 'It did not go through the commit gate.';
    notes.push(
      `review-cycle: commit ${short} records content no reviewer saw (${explain(c)}). ${why} Tell the user.`,
    );
  }
  return notes;
}

async function onStatus(
  $: $,
  _e: Input<StatusHook>,
  _next: NextOf<StatusHook>,
): Promise<Output<StatusHook>> {
  const last = state.reviews.at(-1);
  const status: Record<string, unknown> = {
    // The tree the latest counting reviewer was given: the delta from it is
    // everything that reviewer may not have read.
    lastReviewedTree: last?.trees[0] ?? null,
    reviews: state.reviews.length,
    droppedReviews: state.dropped.map((d) => d.text),
    cappedReviews: state.capped,
    reviewerChanges: state.reviewerChanges,
    shellAliases: state.aliasError ?? state.shellAliases.size,
    pushRequested: covers(state.message.grant, 'push'),
    prRequested: state.message.grant.pr,
    error: null,
    worktreeTree: null,
  };
  const ladder = await ladderOf($);
  const may = permitted(state.message.grant, ladder, state.held !== null);
  const from = ladder.unreadable === undefined ? where(ladder.source) : 'unreadable settings';
  status.stopBefore = {
    ...ladder,
    from,
    held: state.held !== null,
    heldBy: state.held,
    mandate: state.mandate,
  };
  status.mayCommit = may.commit;
  status.mayPush = may.push;
  status.mayOpenPr = may.pr;
  status.mayMerge = may.merge;
  status.mayRelease = may.release;
  status.commentRequested = state.message.grant.comment;
  const g = state.message.grant;
  status.autoMergeRequested = g.autoMerge || g.readyRelease || standsFor(state.standing);
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'Not in a git repository; review-cycle gates nothing here.' };
    const head = await headOf(gitOf($), root.top);
    const tree = await worktreeTree(gitOf($), root.top);
    const c = await coverageOf(gitOf($), root.top, head, tree, state.reviews);
    status.worktreeTree = tree;
    status.snapshot = await snapshotOf(gitOf($), root.top, head, tree);
    status.changed = c?.rows.length ?? null;
    status.uncovered = c ? uncoveredOf(c.rows) : null;
    status.unreadReviews = c?.unread ?? null;
    status.roundsSinceCommit = roundsOf(state.reviews.slice(state.roundsFrom));
    // The newest last: how many rounds each recent commit took to converge.
    // Unreadable, it is null with the reason; the rest of the status still holds.
    try {
      const rounds = await within($, readRounds(storeOf($), root.common), 'reading review rounds');
      status.rounds = rounds.slice(-10);
    } catch (error) {
      status.rounds = null;
      status.roundsError = messageOf(error);
    }
    if (c === null) status.error = 'could not diff the working tree';
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }
  return { result: JSON.stringify(status, null, 2) };
}

// A leg that stalls, is dropped or dies cleans up nothing, so the cycle gives
// every leg one parent directory and sweeps it when the cycle ends. Served
// whether or not the gate is on: it gates nothing.
async function registerScratch($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'scratch',
      description:
        "Makes this review cycle's scratch directory and returns its path. Every reviewer leg makes its private directory inside it with mktemp -d <path>/leg.XXXXXX, so mcp__review-cycle__sweep can end what the legs left running there and remove it, including what a stalled or dropped leg never cleaned up.",
      inputSchema: { type: 'object', properties: {} },
    });
    await $.tool.register({
      name: 'sweep',
      description:
        'Ends every process still running in, or naming a path inside, a scratch directory mcp__review-cycle__scratch made this session, then removes the directory. Call it once the cycle ends, after every leg reported, was dropped, or was stopped. Reports per directory how many processes it ended, whether it removed the directory, and any errors; a directory it could not remove stays listed for the next sweep.',
      inputSchema: { type: 'object', properties: {} },
    });
    state.sweepServed = true;
  } catch {
    // Without the sweep, scratch refuses, and legs fall back to their own mktemp -d.
  }
}

async function onScratch(
  $: $,
  _e: Input<ScratchHook>,
  _next: NextOf<ScratchHook>,
): Promise<Output<ScratchHook>> {
  // A new cycle starts here, whether or not it gets a directory, so the capped
  // legs listed from now on are this cycle's.
  state.capped = [];
  const fallback =
    'Legs use their own mktemp -d instead, and nothing sweeps them; say so in the summary.';
  // A directory nothing can sweep would only pile up.
  if (!state.sweepServed) {
    return {
      result: `review-cycle's sweep tool is not registered, so it made no scratch directory. ${fallback}`,
    };
  }
  try {
    const tmpdir = await $.env.get('TMPDIR');
    // An empty TMPDIR is as good as none.
    const tmp = tmpdir?.replace(/\/+$/, '') ? tmpdir.replace(/\/+$/, '') : '/tmp';
    const r = await run($, ['mktemp', '-d', `${tmp}/review-cycle.XXXXXX`]);
    const dir = r.stdout.trim();
    if (r.exitCode !== 0 || dir === '') {
      return {
        result: `review-cycle could not make a scratch directory (${firstLine(r.stderr) || `exit ${r.exitCode}`}). ${fallback}`,
      };
    }
    state.scratch.push(dir);
    return {
      result: `${dir}\nGive every reviewer leg this path: each makes its private directory with mktemp -d ${dir}/leg.XXXXXX. Call mcp__review-cycle__sweep when the cycle ends.`,
    };
  } catch (error) {
    return {
      result: `review-cycle could not make a scratch directory (${messageOf(error)}). ${fallback}`,
    };
  }
}

async function onSweep(
  $: $,
  _e: Input<SweepHook>,
  _next: NextOf<SweepHook>,
): Promise<Output<SweepHook>> {
  if (state.scratch.length === 0) return { result: 'No scratch directory to sweep.' };
  const swept = [];
  for (const dir of state.scratch) {
    let r;
    try {
      r = await sweep(
        (argv) => run($, argv),
        (ms) => $.clock.sleep(ms),
        dir,
        0,
      );
    } catch (error) {
      r = { dir, stopped: 0, removed: false, errors: [messageOf(error)] };
    }
    // Kept until it is gone, so a failed sweep can be tried again.
    if (r.removed) state.scratch = state.scratch.filter((d) => d !== dir);
    swept.push(r);
  }
  return { result: JSON.stringify(swept, null, 2) };
}

// The Codex leg's receipt comes from its command log, so the cycle grades what
// Codex ran rather than what its verdict says it ran. Gates nothing.
async function registerCodexLog($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'codex_log',
      description:
        "Reads a `codex review` output file and lists every command Codex ran, in order: the command, its working directory, `status` (`succeeded`, `exited`, `rejected` when Codex refused to run it, or `unfinished` when the log ends with no status for it), `exitCode`, `durationMs`, `guessed` (true when overlapping commands, or a log without color, leave it unclear which command a status belongs to), `masked` (true when the command chains parts with `;`, a newline, `||`, `|` or `&`, so its exit code is only the last part's), and the first and last non-empty lines of its output, each clipped at 200 characters. Answers with an error, not an empty list, for a file that is not a Codex log. Build the Codex leg's execution receipt from this, not from its verdict. Read-only.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Absolute path of the Codex leg's output file." },
        },
        required: ['path'],
      },
    });
  } catch {
    // Without it, the skill grades the Codex leg from its verdict.
  }
}

async function onCodexLog(
  $: $,
  e: Input<CodexLogHook>,
  _next: NextOf<CodexLogHook>,
): Promise<Output<CodexLogHook>> {
  const { path } = e as { path?: unknown };
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { result: 'review-cycle codex_log: `path` must be an absolute path.' };
  }
  try {
    if (!(await $.fs.exists(path))) {
      return { result: `review-cycle codex_log: no file at ${path}.` };
    }
    const { recognized, commands } = readCodexLog(await $.fs.read(path));
    // An empty list would read as a Codex that ran nothing.
    if (!recognized) {
      return {
        result: `review-cycle codex_log: ${path} is not a codex review log (no \`OpenAI Codex v\` banner).`,
      };
    }
    return { result: JSON.stringify({ commands }, null, 2) };
  } catch (error) {
    return { result: `review-cycle codex_log: could not read ${path}: ${messageOf(error)}` };
  }
}

// The ledger gates nothing, so its tools are served whether or not the gate is on.
async function registerLedger($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'ledger',
      description: `Findings earlier review cycles in this repository settled without fixing: deferred, rebutted, left alone on purpose, or raised as questions. Each entry has an id, path, line, kind, finding, reason, source, \`date\` (when a cycle last settled it), \`changed\` (whether its file differs from what the last cycle to carry it reviewed; null when the working tree could not be read), and \`stale\` (settled more than 90 days ago); unless \`changed\` is false it also has \`blob\` and \`current\`, short ids for \`git diff <blob> <current>\`. Entries come ranked, in an answer of at most ${MAX_READ} characters unless its first entry and the answer's header together are longer: first every stale entry, query or not, since it is open again, then those holding the most \`query\` words, then the newest. \`reopened\` counts the stale entries, \`matched\` the rest, and \`next\`, when present, is the \`offset\` that reads on. \`unreadable\` counts stored entries this version cannot read; the next record drops them. Read-only.`,
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only the entries for these repository-relative paths.',
          },
          query: {
            type: 'string',
            description:
              'Only the entries whose finding or reason holds any of these words (three characters or more), plus every stale one, ranked first.',
          },
          offset: { type: 'integer', minimum: 0, description: 'Where to start: a `next` value.' },
        },
      },
    });
    await $.tool.register({
      name: 'ledger_record',
      description: `Records what a review cycle settled without fixing into this repository's findings ledger. \`entries\` adds findings, each stamped with its file's blob in the working tree and today's date, so every path must be a file there; text is collapsed to one line and clipped at ${MAX_TEXT} characters, and the same finding at the same path replaces its entry. \`keep\` carries entries by id: each gets its file's current blob and keeps its date, and one whose file is gone is dropped. \`resolve\` removes entries by id. The ledger keeps the newest entries that fit in ${MAX_LEDGER_BYTES / 1024} KiB per repository, and ledgers for the ${MAX_REPOS} most recently recorded repositories.`,
      inputSchema: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Repository-relative path.' },
                line: { type: ['integer', 'null'], minimum: 1 },
                kind: { type: 'string', enum: [...KINDS] },
                finding: { type: 'string' },
                reason: {
                  type: 'string',
                  description:
                    'Why it was not fixed: the deferral criterion, the measurement or documentation that rebutted it, or why it was left alone.',
                },
                source: { type: 'string', description: 'The reviewer that raised it.' },
              },
              required: ['path', 'kind', 'finding', 'reason', 'source'],
            },
          },
          resolve: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of entries to remove.',
          },
          keep: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of carried entries settled again unchanged.',
          },
        },
      },
    });
  } catch {
    // Without the tools the skill says the ledger was unavailable.
  }
}

function storeOf($: $): Store {
  return {
    get: (key) => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    keys: () => $.store.keys(),
    delete: (key) => $.store.delete(key),
  };
}

async function onLedger(
  $: $,
  e: Input<LedgerHook>,
  _next: NextOf<LedgerHook>,
): Promise<Output<LedgerHook>> {
  const { paths, query, offset } = e as { paths?: unknown; query?: unknown; offset?: unknown };
  if (paths !== undefined && !(Array.isArray(paths) && paths.every((p) => typeof p === 'string'))) {
    return {
      result: 'review-cycle ledger: `paths` must be an array of repository-relative paths.',
    };
  }
  if (query !== undefined && typeof query !== 'string') {
    return { result: 'review-cycle ledger: `query` must be a string.' };
  }
  if (offset !== undefined && !(Number.isInteger(offset) && (offset as number) >= 0)) {
    return { result: 'review-cycle ledger: `offset` must be a whole number, 0 or more.' };
  }
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'review-cycle ledger: not in a git repository.' };
    const blobs = (ps: string[]) => blobsAt(gitOf($), root.top, ps);
    const read = { paths, query, offset: offset as number | undefined };
    const status = await readLedger(storeOf($), blobs, root.common, read, await $.clock.now());
    return { result: JSON.stringify(status) };
  } catch (error) {
    return {
      result: `review-cycle ledger: could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Records run one at a time: each reads the ledger, merges, and writes it
// back. A record waits for the one before it for at most this long and then
// refuses, so a store call that never settles cannot hang every later record,
// nor finish late over one that ran past it. Well under the hook's 10-second
// budget, which the sleep spends: a wait that reached it would lose the
// refusal to the engine's own answer.
const RECORD_WAIT_MS = 5000;
let recording: Promise<unknown> = Promise.resolve();

async function onLedgerRecord(
  $: $,
  e: Input<RecordHook>,
  _next: NextOf<RecordHook>,
): Promise<Output<RecordHook>> {
  const rec = parseRecord(e);
  if ('error' in rec) return { result: `review-cycle ledger: nothing recorded: ${rec.error}` };
  const before = recording;
  const ready = Promise.race([
    before.then(
      () => true,
      () => true,
    ),
    $.clock.sleep(RECORD_WAIT_MS).then(() => false),
  ]);
  const task = ready.then((go) =>
    go
      ? recordNow($, rec)
      : {
          result: `review-cycle ledger: nothing recorded: an earlier record has not finished after ${RECORD_WAIT_MS / 1000} seconds`,
        },
  );
  recording = Promise.allSettled([before, task]);
  return task;
}

async function recordNow($: $, rec: Recording): Promise<Output<RecordHook>> {
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'review-cycle ledger: not in a git repository; nothing recorded.' };
    const blobs = (ps: string[]) => blobsAt(gitOf($), root.top, ps);
    return {
      result: await recordInto(storeOf($), blobs, root.common, rec, await $.clock.now()),
    };
  } catch (error) {
    return {
      result: `review-cycle ledger: nothing recorded: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function onStatusOff(
  _$: $,
  _e: Input<StatusHook>,
  _next: NextOf<StatusHook>,
): ReturnType<StatusHook> {
  return {
    result:
      "review-cycle's commit gate is switched off in /config (review-cycle.enabled), so nothing is gated.",
  };
}

function onConfigSet($: $, e: Input<ConfigHook>, next: NextOf<ConfigHook>): ReturnType<ConfigHook> {
  if (e.origin?.kind !== 'composer') {
    return { deny: "review-cycle's settings are changed only by the user in /config." };
  }
  return e.key === 'review-cycle.nudge' ? nudgeSet($, e, next) : next(e);
}

// The local settings file can keep the nudge on whatever this value says, so
// what is owed goes only when the nudge is off once every setting is read.
async function nudgeSet(
  $: $,
  e: Input<ConfigHook>,
  next: NextOf<ConfigHook>,
): Promise<Output<ConfigHook>> {
  const r = await next(e);
  if (r.deny !== undefined) return r;
  state.nudge = r.value !== false;
  if (state.owed !== null && !(await nudgeWanted($))) state.owed = null;
  return r;
}

async function withNote(
  result: Output<BashHook> | Promise<Output<BashHook>>,
  note: string,
): Promise<Output<BashHook>> {
  const r = await result;
  if (r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), note] };
}

// A throw is skipped by the engine and the call proceeds, so a failure while
// judging a commit, a push or a possible alias is caught here and refused.
// Anything else runs, with a note that the gate could not watch it.
function onBashError(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook> & Caught,
): ReturnType<CatchHandler<BashHook>> {
  if (next.called) return next(e);
  const why =
    next.error.message ??
    (next.error.kind === 'timeout'
      ? 'it ran out of time; running it again may work'
      : next.error.kind);
  const cls = classify(e.command, state.shellAliases);
  const quiet =
    possibleAliases(e.command, state.shellAliases).length === 0 &&
    ghActions(e.command, state.shellAliases).length === 0;
  if (cls.kind === 'none' && quiet) {
    return withNote(
      next(e),
      `review-cycle could not watch this command (${why}); a commit it made would not be reported. Tell the user.`,
    );
  }
  return deny(
    gateFailed('failed while checking this command', why, 'running the step outside the gate'),
  );
}

export const register: Register = (on, options) => {
  state.gateOn = options.enabled !== false;
  state.stopBefore = stopBeforeOf(options.stopBefore);
  state.nudge = options.nudge !== false;
  state.unaskedNotice = options.unaskedNotice === true;
  state.modelCheck = options.modelCheck !== false;
  on('config.set', { key: 'review-cycle.modelCheck' }, onConfigSet);
  on('config.set', { key: 'review-cycle.enabled' }, onConfigSet);
  on('config.set', { key: 'review-cycle.stopBefore' }, onConfigSet);
  on('config.set', { key: 'review-cycle.nudge' }, onConfigSet);
  on('config.set', { key: 'review-cycle.unaskedNotice' }, onConfigSet);
  on('tool.call', { tool: 'Edit' }, onEditSlop);
  on('tool.call', { tool: 'Write' }, onWriteSlop);
  on('session.start', onSessionStart);
  // `/clear` and a resume end the session without a fresh session.start.
  on('session.end', async ($, e, next) => {
    state.standing = NO_STANDING;
    state.reviewing = null;
    void keep($);
    return next(e);
  });
  on('tool.call', { tool: 'mcp__review-cycle__ledger' }, onLedger);
  on('tool.call', { tool: 'mcp__review-cycle__ledger_record' }, onLedgerRecord);
  on('tool.call', { tool: 'mcp__review-cycle__scratch' }, keptScratch);
  on('tool.call', { tool: 'mcp__review-cycle__sweep' }, keptSweep);
  on('tool.call', { tool: 'mcp__review-cycle__codex_log' }, onCodexLog);
  on('tool.call', { tool: 'Skill' }, onSubagentSkill);
  on('skill.prompt', { skill: 'review-cycle:review' }, onReviewSkill);
  on('session.compact', onCompact);
  if (options.enabled === false) {
    // The status tool stays registered from before the switch; say why it is idle.
    on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatusOff);
    return;
  }
  on('prompt.submit', keptPromptSubmit);
  on('agent.spawn', keptAgentSpawn);
  on('turn.complete', keptTurnComplete);
  on('tool.call', { tool: 'Skill' }, keptSkill);
  on('tool.call', { tool: 'Bash' }, keptBash).catch(onBashError);
  on('tool.call', { tool: MCP_GITHUB }, keptGithubTool).catch(onGithubToolError);
  on('tool.call', { tool: 'Bash' }, onBashEdits);
  on('tool.call', { tool: 'Edit' }, onEditContained);
  on('tool.call', { tool: 'Write' }, onWriteContained);
  on('tool.call', { tool: 'Edit' }, onEdit).catch(onEditError);
  on('tool.call', { tool: 'Write' }, onWrite).catch(onWriteError);
  on('tool.call', { tool: 'NotebookEdit' }, onNotebookEdit);
  on('tool.call', { tool: 'Monitor' }, onMonitor).catch(onMonitorError);
  on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatus);
  on('tool.call', { tool: 'mcp__review-cycle__misses' }, () => ({
    result: JSON.stringify({ misses: state.misses }),
  }));
};
