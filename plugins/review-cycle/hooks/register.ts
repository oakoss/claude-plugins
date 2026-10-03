import type {
  Caught,
  CatchHandler,
  EngineInterface,
  HookFor,
  MatchedHook,
  PromptOrigin,
  Register,
  Timer,
  ToolCallResult,
} from 'claude-code';

import { added, madeBy, MARK, type Entry } from './attribution';
import {
  aliasCommits,
  classify,
  ghActions,
  possibleAliases,
  shownCommand,
  type Classification,
} from './command';
import { covers, grantOf, holdsOf, liftsHold, NO_GRANT, type Grant } from './consent';
import { containmentReport, insideRepo, repoStateOf, UNREAD, type Capture } from './containment';
import { editsSkipped, mayWrite, measureEdits } from './edits';
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
import type { PushSpec } from './git-args';
import { MCP_GITHUB, mcpAction, shownCall, type GhAction, type PushRef } from './github';
import {
  asks,
  configured,
  STRICTEST,
  effective,
  stopBeforeOf,
  where,
  type Ladder,
  type Step,
  type StopBefore,
} from './ladder';
import { KINDS, parseRecord, type Recording } from './ledger';
import { blobsAt, readLedger, recordInto, type Store } from './ledger-store';
import {
  askingReason,
  parseDryRun,
  unasked,
  type DefaultBranch,
  type Needed,
} from './push-verdict';
import { applyEdit, bashTouchesGate, isJsonPath, touchesGate } from './settings';
import { aliasScript, aliasShell, parseShellAliases, readAliases } from './shell';
import { MAX_BYTES, skipsPath, slopDirective, slopFindings, type Written } from './slop';
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
type ConfigHook = MatchedHook<
  'config.set',
  { key: 'review-cycle.enabled' | 'review-cycle.stopBefore' }
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
  capped: boolean;
};

// Measured 2026-09-19 over 138 legs: a fan-out's slowest leg had a median of
// 16 minutes and the slowest normal leg type 25; runaways ran 60 to 70.
const LEG_BUDGET_MS = 30 * 60_000;

// What the user's latest message settled: a fresh message replaces it, a
// prompt queued into the running turn updates it.
type Message = {
  grant: Grant;
  // The working tree when it arrived; null when unreadable.
  tree: string | null;
  // Whether the agent was told to review since it arrived.
  nudged: boolean;
  // Legs spawned while review-pr runs review a PR worktree, not this tree.
  prWindow: boolean;
};

type GateState = {
  // undefined until resolved; null when the session is not in a repository.
  root: Repo | null | undefined;
  reviews: Review[];
  legs: Map<string, Leg>;
  message: Message;
  // How many messages the user has typed, queued ones included.
  messages: number;
  lastAnswer: string;
  // The user's shell aliases, which the Bash tool expands.
  shellAliases: Map<string, string>;
  aliasError: string | null;
  // Whether the agent has been told the aliases could not be read.
  aliasErrorShown: boolean;
  aliasesLoaded: boolean;
  // The session-start read of the user's aliases; its error, or null.
  ownRead: Promise<string | null> | undefined;
  // Reviews that ran but could not be recorded, and why.
  dropped: string[];
  // Legs that outlived their budget this cycle, which the session was asked to stop.
  capped: string[];
  // Scratch directories made for review cycles and not yet swept.
  scratch: string[];
  // Whether the sweep tool registered; scratch makes nothing without it.
  sweepServed: boolean;
  // How many of `dropped` predate the latest recorded review.
  droppedSince: number;
  // What reviewers' commands changed in the repository under review.
  reviewerChanges: string[];
  // False when the user switched the gate off; the ledger is still served.
  gateOn: boolean;
  // From user or managed settings, which alone reach the register options.
  stopBefore: StopBefore | null;
  // "don't push yet" makes every step ask until a message asks for one.
  held: boolean;
};

const state: GateState = {
  root: undefined,
  reviews: [],
  legs: new Map(),
  // No message yet, so nothing to nudge about.
  message: { grant: NO_GRANT, tree: null, nudged: true, prWindow: false },
  messages: 0,
  lastAnswer: '',
  shellAliases: new Map(),
  aliasError: null,
  aliasErrorShown: false,
  aliasesLoaded: false,
  ownRead: undefined,
  dropped: [],
  capped: [],
  scratch: [],
  sweepServed: false,
  droppedSince: 0,
  reviewerChanges: [],
  gateOn: true,
  stopBefore: null,
  held: false,
};

// Without `cwd`, $.process.run runs in the Bash tool's current directory,
// which is what a command's own relative paths resolve against.
async function run(
  $: $,
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
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
  const dropped = state.dropped.slice(state.droppedSince).slice(-3);
  if (dropped.length > 0) parts.push(`reviews not counted: ${dropped.join('; ')}`);
  return parts.join('; ');
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
  return { deny: `review-cycle: ${reason}` };
}

async function onSessionStart(
  $: $,
  e: Input<HookFor<'session.start'>>,
  next: NextOf<HookFor<'session.start'>>,
): Promise<Output<HookFor<'session.start'>>> {
  await registerLedger($);
  await registerScratch($);
  if (!state.gateOn) return next(e);
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
    const grant = grantOf(e.text, state.lastAnswer);
    if (holdsOf(e.text, state.lastAnswer)) state.held = true;
    else if (liftsHold(grant)) state.held = false;
    // A prompt queued into a running turn neither ends a review-pr run nor
    // replaces that turn's starting tree.
    if (e.turnId !== undefined) {
      // Updated in place: a pending nudge's rollback holds this record.
      state.message.grant = grant;
      state.message.nudged = false;
    } else {
      let tree: string | null = null;
      try {
        const root = await ensureRoot($);
        if (root !== null) tree = await worktreeTree(gitOf($), root.top);
      } catch {
        // No starting tree means no nudge this message; the commit gate still holds.
      }
      state.message = { grant, tree, nudged: false, prWindow: false };
    }
  }
  return next(e);
}

// At the end of a main-loop turn that changed the tree, content no reviewer
// has seen gets one prompt telling the agent to review it, so the agent does
// not stop to ask the user whether to. Once per user message, and not while a
// review is under way.
async function nudgeReview($: $, e: Input<HookFor<'turn.complete'>>): Promise<void> {
  const message = state.message;
  if (message.nudged || e.reason !== 'answer') return;
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
  const tree = await worktreeTree(gitOf($), root.top);
  if (tree === since) return;
  const touched = new Set(await reviewablePaths(gitOf($), root.top, since, tree));
  const c = await coverageOf(
    gitOf($),
    root.top,
    await headOf(gitOf($), root.top),
    tree,
    state.reviews,
  );
  if (c === null) return;
  const rows = c.rows.filter((row) => touched.has(row.path));
  if (uncoveredOf(rows).length === 0) return;
  message.nudged = true;
  const text = `review-cycle: this turn left changes no reviewer has seen (${explain({ ...c, rows })}). Invoke /review-cycle:review via the Skill tool now, then report back. Skip it only if the user's latest message said not to review, or your last message asked them something they must answer first.`;
  // Not awaited: the prompt enters once this turn has ended. A hook's refusal
  // resolves with `drop` rather than rejecting.
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .then(
      (r) => {
        if (r.drop !== undefined) message.nudged = false;
      },
      () => {
        message.nudged = false;
      },
    );
}

function onSkill($: $, e: Input<SkillHook>, next: NextOf<SkillHook>): ReturnType<SkillHook> {
  if (!e.agentId && e.skill === 'review-cycle:review-pr') state.message.prWindow = true;
  if (!e.agentId && e.skill === 'review-cycle:review') {
    state.message.prWindow = false;
    // A review already under way needs no reminder to start one.
    state.message.nudged = true;
  }
  return next(e);
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
    if (spawnTree === null) state.dropped.push(`${e.subagentType}: ${why}`);
    const counts = !state.message.prWindow;
    const leg: Leg = {
      type: e.subagentType,
      counts,
      spawnTree,
      done: false,
      timer: null,
      capped: false,
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
  if (e.isAborted || e.reason !== 'answer') {
    state.dropped.push(`${leg.type}: it did not finish (${e.isAborted ? 'aborted' : e.reason})`);
    return next(e);
  }
  if (!hasReceipt(e.answer)) {
    state.dropped.push(`${leg.type}: its report did not open with the execution receipt`);
    return next(e);
  }
  try {
    const tree = await worktreeTree(gitOf($), root.top);
    const head = await headOf(gitOf($), root.top);
    const reviewedPaths = await reviewablePaths(gitOf($), root.top, head, tree);
    if (reviewedPaths === null) throw new Error('the paths it reviewed could not be listed');
    state.reviews.push({ type: leg.type, trees: [leg.spawnTree, tree], reviewedPaths });
    // Refusals explain the current state; older failures stay in the status tool.
    state.droppedSince = state.dropped.length;
  } catch (error) {
    state.dropped.push(`${leg.type}: ${error instanceof Error ? error.message : String(error)}`);
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
  // An edit the gate cannot replay passes only when neither the file nor the
  // edit names a switch.
  const touches =
    after === null
      ? touchesGate(before, '') || touchesGate(e.old_string, e.new_string)
      : touchesGate(before, after);
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
  const gh = await judgeGh($, shown, [action], state.message.grant);
  if ('deny' in gh) return deny(gh.deny);
  if (state.messages !== message) {
    return deny(
      'the user sent a new message while the gate was checking this call, so it did not run. Act on their message.',
    );
  }
  const r = await next(e);
  if (r.deny !== undefined) return r;
  const notes = gh.ran.map((step) => ranUnasked($, step));
  return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] };
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
  return deny(
    `the gate could not check this call (${why}), so it is refused. Tell the user; they can make the change on GitHub themselves.`,
  );
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
    const gh = await judgeGh($, quote(e.command), actions, granted);
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
    const r = await watch($, await ensureRoot($), e, next, 'unchecked', granted, since, gh.ran);
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

  if (cls.commit && !cls.commit.dryRun && !granted.commit) {
    const ladder = await ladderOf($);
    if (!permitted(granted, ladder).commit) return deny(commitRefusal(e.command, ladder));
  }
  const ran: Unasked[] = [];
  if (cls.push) {
    const verdict = await judgePush($, root.top, e.command, cls.commit !== null, cls.push, granted);
    if ('deny' in verdict) return deny(verdict.deny);
    if (verdict.ran !== null) ran.push(verdict.ran);
  }
  const checked = cls.commit ? 'commit' : cls.history !== null ? 'history' : 'push';
  return watch($, root, e, next, checked, granted, message, ran);
}

// The refusal when a reviewer has not seen all of what a real commit would
// record; null otherwise.
async function reviewed(
  $: $,
  top: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<string | null> {
  if (!cls.commit || cls.commit.dryRun) return null;
  const head = await headOf(gitOf($), top);
  // An amend replaces HEAD, so what it records is judged against HEAD's parent.
  const base = cls.commit.amend && head !== EMPTY_TREE ? await parentTree(gitOf($), top) : head;
  if (base === null)
    throw new Error("could not read the tree of HEAD's parent, which an amend replaces");
  const prospect = await prospectTree(gitOf($), top, cls);
  const c = await coverageOf(gitOf($), top, base, prospect, state.reviews);
  if (c === null) {
    const against =
      base === EMPTY_TREE ? 'the empty tree' : cls.commit.amend ? "HEAD's parent" : 'HEAD';
    throw new Error(`could not compare the tree this commit would record with ${against}`);
  }
  if (uncoveredOf(c.rows).length > 0) {
    return `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then commit.`;
  }
  return null;
}

// Longer than this, the refusal quotes only the start of the command.
const MAX_SHOWN = 300;

const LEASE = '`--force-with-lease --force-if-includes`';

const SUBAGENT =
  'subagents do not commit, push, open, merge, approve or comment on pull requests, or release, in this repository. Report back to the main session instead.';

// `unreadable` names the settings file that could not be read, and why.
type InForce = Ladder & { unreadable?: string };
// A step that runs without the user asking for it directly: by the ladder,
// noted; or a push a requested pull request needs (`forPr`), not noted.
type Unasked = { step: Step; ladder: Ladder; forPr?: true };

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
  return effective(state.stopBefore, rungs.project ?? null, rungs.local ?? null);
}

// What may run: what the user asked for, and what the ladder lets through.
// A hold stops every step but a commit.
type Allowed = Readonly<Record<Step, boolean>>;
function permitted(granted: Grant, ladder: Ladder): Allowed {
  const free = (step: Step) => !asks(ladder, step);
  return {
    commit: granted.commit || free('commit'),
    push: covers(granted, 'push') || (!state.held && free('push')),
    pr: granted.pr || (!state.held && free('pr')),
    merge: granted.merge || (!state.held && free('merge')),
    approve: granted.approve || (!state.held && free('approve')),
    release: granted.release || (!state.held && free('release')),
  };
}

// Shown to the user as a dim line, and to the agent, so the step is never
// silent. Worded as having run, not succeeded: the command may still fail.
const STEP_NAME: Record<Step, string> = {
  commit: 'a commit',
  push: 'a push',
  pr: 'a pull request',
  merge: 'a merge',
  approve: 'an approval',
  release: 'a release',
};

function ranUnasked($: $, { step, ladder }: Unasked): string {
  const line = `review-cycle: ran ${STEP_NAME[step]} without asking, since the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)}).`;
  $.ui.log(line);
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

// Why a push asks whatever the setting, or null. Off the ladder: a push that
// changes a remote's default branch, pushes a tag, deletes or force-updates a
// ref, and one the gate cannot see the targets of. Git itself names the refs
// a push updates, with its own push config applied, through a dry run.
async function alwaysAsks($: $, top: string, spec: PushSpec): Promise<string | null> {
  if (spec.deletes) return 'it deletes a remote branch';
  if (spec.every) return 'it pushes every branch';
  if (spec.tags) return 'it pushes tags';
  if (spec.argv === null) return 'its remote or branch is built at run time';
  if (spec.after !== null) {
    return `\`git ${spec.after}\` runs before it in the same command, which can change where it goes (run that step on its own first, and the push is judged after it)`;
  }
  const { config, args, end } = spec.argv;
  const probe = ['--dry-run', ...args.slice(0, end), ...DRY_RUN, ...args.slice(end)];
  const dry = await run($, ['git', ...config, 'push', ...probe], { cwd: top, env: NO_PROMPT });
  if (dry.exitCode !== 0) {
    return `a dry run of it, which shows what it would push, failed (${firstLine(dry.stderr) || `exit ${dry.exitCode}`})`;
  }
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
  return askingReason(refs, defaults);
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
): Promise<{ deny: string } | { ran: Unasked | null }> {
  const missing = unasked(spec, granted);
  if (missing === null) return { ran: null };
  const ladder = await ladderOf($);
  const forPr = granted.pr && !state.held;
  // Only a push something would let through is worth checking further.
  const loose = missing === 'push' && (forPr || permitted(granted, ladder).push);
  const always = loose ? await alwaysAsks($, top, spec) : null;
  if (loose && always === null) {
    return { ran: forPr ? { step: 'push', ladder, forPr: true } : { step: 'push', ladder } };
  }
  return { deny: pushRefusal(command, commits, missing, granted, ladder, always) };
}

function quote(command: string): string {
  const shown = shownCommand(command, state.shellAliases);
  return shown.length > MAX_SHOWN ? `${shown.slice(0, MAX_SHOWN)}…` : shown;
}

// The agent asks in its reply, naming the step and its target, and ends its turn.
// `shown` is the call as the refusal quotes it.
function askThem(naming: string, example: string, shown: string): string {
  return `stop and ask them in your reply, naming ${naming} with names in backticks (for example ${example}), and end your turn; their answer decides. The command: ${shown}`;
}

// Why the user's latest message does not cover the step, the setting
// included when its files could not be read.
function notAsked(what: string, ladder: InForce, holdable: boolean): string {
  const why =
    holdable && state.held
      ? `the user held off and hasn't asked for ${what} since`
      : `the user's latest message doesn't ask for ${what}`;
  return ladder.unreadable === undefined
    ? why
    : `could not read ${ladder.unreadable}, so the gate stops before every step, and ${why}`;
}

function commitRefusal(command: string, ladder: InForce): string {
  const setting =
    ladder.unreadable === undefined
      ? `, and the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)})`
      : '';
  return `${notAsked('a commit', ladder, false)}${setting}, so nothing ran. To commit, ${askThem('what it commits and on which branch', '"Commit the changes to `fix/x`?"', quote(command))}`;
}

function prRefusal(shown: string, ladder: InForce): string {
  return `${notAsked('a pull request', ladder, true)}, so nothing ran. To open one, ${askThem('the branch and the base it targets', '"Open a PR from `fix/x` into `main`?"', shown)}`;
}

// The branch oakum's version pull request comes from: merging it is the release.
const VERSION_BRANCH = 'oakum/version-packages';
// How long the user waits on a gh read before the step asks instead.
const LOOKUP_MS = 5000;

// What a gh read printed, or why it asks: "looking up <what> failed (…)" or
// "… printed nothing".
async function ghRead(
  $: $,
  args: string[],
  what: string,
): Promise<{ out: string } | { asks: string }> {
  try {
    const r = await $.process.run(['gh', ...args], {
      timeoutMs: LOOKUP_MS,
      env: { GH_PROMPT_DISABLED: '1' },
    });
    if (r.exitCode !== 0) {
      const why = firstLine(r.stderr) || `it ended with no output, exit ${r.exitCode}`;
      return { asks: `looking up ${what} failed (${why})` };
    }
    // A jq path that meets null prints an empty line and exits 0 (gh 2.102.0).
    const out = r.stdout.trim();
    if (out === '') return { asks: `looking up ${what} printed nothing` };
    return { out };
  } catch (error) {
    return { asks: `looking up ${what} failed (${messageOf(error)})` };
  }
}

const CANNOT: Record<'elsewhere' | 'unnamed', string> = {
  elsewhere:
    'something outside the words the gate looks up picks where it merges (a `--repo` built at run time, `GH_REPO=`, `GIT_DIR=`, `env -C`, `--hostname`, a URL on another host), so the gate cannot tell a release from a merge',
  unnamed:
    'it does not name the pull request by number and repository, so the gate cannot tell a release from a merge',
};

// Which step a merge is: a release when it merges the version pull request.
// A lookup that fails says why, and the merge asks.
async function mergeStep(
  $: $,
  lookup: readonly string[],
): Promise<{ step: 'merge' | 'release' } | { asks: string }> {
  const args = ['pr', 'view', ...lookup, '--json', 'headRefName', '--jq', '.headRefName'];
  const r = await ghRead($, args, 'the pull request it merges');
  return 'asks' in r ? r : { step: r.out === VERSION_BRANCH ? 'release' : 'merge' };
}

// Why a push the ladder lets through asks anyway, or null: one to the
// default branch, or one whose branch the gate cannot tell.
async function pushAsks($: $, ref: PushRef): Promise<string | null> {
  if ('asks' in ref) return ref.asks;
  let { branch, repo } = 'head' in ref ? { branch: '', repo: null as string | null } : ref;
  if ('head' in ref) {
    const head = await ghRead(
      $,
      [
        'pr',
        'view',
        ...ref.head,
        '--json',
        'url,isCrossRepository,headRefName',
        '--jq',
        String.raw`"\(.isCrossRepository) \(.url) \(.headRefName)"`,
      ],
      'the pull request it updates',
    );
    if ('asks' in head) return head.asks;
    const read = /^(true|false) https:\/\/([^/\s]+\/[^/\s]+\/[^/\s]+)\/pull\/\d+ (\S+)$/.exec(
      head.out,
    );
    if (read === null) return `looking up the pull request it updates printed \`${head.out}\``;
    if (read[1] === 'true') return "it updates a branch in the pull request's fork";
    // HOST/OWNER/NAME from the pull request's URL, so an Enterprise host survives.
    repo = read[2] ?? null;
    branch = read[3] ?? '';
  }
  const r = await ghRead(
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
  );
  if ('asks' in r) return r.asks;
  return r.out === branch ? `it pushes to \`${branch}\`, the default branch` : null;
}

// Each example is one the consent grammar grants on a yes (consent.spec.ts).
const GH_ASK: Record<
  'merge' | 'approve' | 'release' | 'comment' | 'push',
  [string, string, string]
> = {
  merge: ['a merge', 'the pull request', '"Merge #116?"'],
  approve: ['an approval', 'the pull request', '"Approve #116?"'],
  release: ['a release', 'the version it releases', '"Release `v0.25.0`?"'],
  comment: [
    'a comment on GitHub',
    'where it goes and what it says',
    '"Reply to the review on #116?"',
  ],
  push: ['a push', 'what it pushes and where', '"Push `fix/x` to `origin`?"'],
};

function ghRefusal(
  shown: string,
  kind: keyof typeof GH_ASK,
  ladder: InForce,
  always: string | null,
): string {
  const [what, naming, example] = GH_ASK[kind];
  const asksAnyway = always === null ? '' : ` This asks whatever the setting: ${always}.`;
  const unreviewed =
    kind === 'push' ? ' It writes to GitHub directly, so no review covers it.' : '';
  return `${notAsked(what, ladder, true)}, so nothing ran.${asksAnyway}${unreviewed} To go ahead, ${askThem(naming, example, shown)}`;
}

// What the GitHub writes in a call may run, or the refusal of the first one
// that may not. A comment is off the ladder: it needs the user's request.
// `shown` is the call as a refusal quotes it.
async function judgeGh(
  $: $,
  shown: string,
  actions: readonly GhAction[],
  granted: Grant,
): Promise<{ deny: string } | { ran: Unasked[] }> {
  const ran: Unasked[] = [];
  if (actions.length === 0) return { ran };
  const ladder = await ladderOf($);
  const may = permitted(granted, ladder);
  for (const action of actions) {
    switch (action.kind) {
      case 'pr': {
        if (!may.pr) return { deny: prRefusal(shown, ladder) };
        if (!granted.pr) ran.push({ step: 'pr', ladder });
        break;
      }
      case 'unread': {
        const remedy = action.remedy ?? 'Run the gh command itself, written out.';
        return {
          deny: `${action.why}, so the gate cannot tell which step it takes, and nothing ran. ${remedy} The command: ${shown}`,
        };
      }
      case 'comment': {
        if (!granted.comment) return { deny: ghRefusal(shown, 'comment', ladder, null) };
        break;
      }
      case 'approve': {
        if (!may.approve) return { deny: ghRefusal(shown, 'approve', ladder, null) };
        if (!granted.approve) ran.push({ step: 'approve', ladder });
        break;
      }
      case 'release': {
        if (!may.release) return { deny: ghRefusal(shown, 'release', ladder, null) };
        if (!granted.release) ran.push({ step: 'release', ladder });
        break;
      }
      case 'push': {
        if ('asks' in action.ref && action.ref.force && !covers(granted, 'bare')) {
          return {
            deny: `a forced ref update overwrites whatever the branch holds, with no lease, and the user's latest message doesn't ask for a bare force, so nothing ran. If they want one, ${askThem('what it overwrites and where', '"Force-push `fix/x` to `origin` without a lease?"', shown)}`,
          };
        }
        if (covers(granted, 'push')) break;
        if (!may.push) return { deny: ghRefusal(shown, 'push', ladder, null) };
        const always = await pushAsks($, action.ref);
        if (always !== null) return { deny: ghRefusal(shown, 'push', ladder, always) };
        ran.push({ step: 'push', ladder });
        break;
      }
      case 'merge': {
        if (action.admin) {
          return {
            deny: `--admin merges past branch protection, which the gate never lets an agent do, so nothing ran. Give the user the command to run themselves, and say why it needs --admin. The command: ${shown}`,
          };
        }
        // Allowed either way, a merge needs no lookup to tell which it is.
        if (may.merge && may.release) {
          if (!granted.merge && !granted.release) ran.push({ step: 'merge', ladder });
          break;
        }
        const { lookup } = action;
        let which: Awaited<ReturnType<typeof mergeStep>>;
        if (!('cannot' in lookup)) which = await mergeStep($, lookup);
        else if (lookup.cannot === 'beside') {
          return {
            deny: `other steps in the same command can change which pull request the merge reaches, so the gate cannot tell a release from a merge, and nothing ran. Run the merge as its own command. The command: ${shown}`,
          };
        } else which = { asks: CANNOT[lookup.cannot] };
        if ('asks' in which && may.merge) {
          return {
            deny: `the merge may be a release, which the user has not allowed: ${which.asks}. Nothing ran. To merge it, ${askThem('the pull request', '"Merge and release #62?"', shown)}`,
          };
        }
        if ('asks' in which) return { deny: ghRefusal(shown, 'merge', ladder, which.asks) };
        const step = which.step;
        if (!may[step]) return { deny: ghRefusal(shown, step, ladder, null) };
        if (!granted[step]) ran.push({ step, ladder });
        break;
      }
      default: {
        const unhandled: never = action;
        throw new Error(`no judgment for the gh action ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return { ran };
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
      return `a bare --force (or a \`+refspec\`) overwrites whatever the remote holds, and the user's latest message doesn't ask for one, so nothing ran.${alone} Use ${LEASE} instead${leaseToo}; if they want a bare --force, ${ask('"Force-push `fix/x` to `origin` without a lease?"')}`;
    }
    case 'lease': {
      return `the user's latest message doesn't ask for a force push, so nothing ran.${alone} To force-push, ${ask('"Force-push `fix/x` to `origin` with a lease?"')}`;
    }
    case 'push': {
      const asksAnyway = always === null ? '' : ` This push asks whatever the setting: ${always}.`;
      return `${notAsked('a push', ladder, true)}, so nothing ran.${asksAnyway}${alone} To push, ${ask('"Push `fix/x` to `origin`?"')}`;
    }
    default: {
      const unhandled: never = missing;
      throw new Error(`no refusal for the push level ${String(unhandled)}`);
    }
  }
}

type Checked = 'commit' | 'history' | 'push' | 'unchecked';
// HEAD's newest reflog entries and the log's length before a command, so the
// entries it added can be told apart afterwards.
type Start = { head: string; refs: Refs; log: Entry[]; count: number };

// More entries than this in one command are not read; the command is then
// reported as unchecked.
const MAX_ADDED = 200;

// Runs the command, then reports a commit the gate did not check (a script),
// one whose content changed after the check (a pre-commit hook restaging),
// and a push the user did not ask for. A history command records existing
// commits by design, so it is not judged on review. A commit made in another
// worktree is not seen: each worktree has its own HEAD.
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
  if (message !== null && state.messages !== message) {
    return deny(
      'the user sent a new message while the gate was checking this command, so it did not run. Act on their message.',
    );
  }
  // Past an abort the dispatch has moved on, so nothing would report what ran.
  if (message !== null && next.signal.aborted) {
    return deny('the call was interrupted while the gate was checking it, so it did not run.');
  }
  const r = await next(e);
  const notes: string[] = [];
  if (r.deny === undefined) {
    for (const step of ran) if (!step.forPr) notes.push(ranUnasked($, step));
  }
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
      const pushed = await pushedRefs(git, root.top, start.refs, await remoteRefs(git, root.top));
      // A push the gate judged was told already; one from a script was not.
      const judged = ran.some((step) => step.step === 'push');
      if (pushed.length > 0 && !covers(granted, 'push') && !judged) {
        const ladder = await ladderOf($);
        notes.push(
          permitted(granted, ladder).push
            ? ranUnasked($, { step: 'push', ladder })
            : `review-cycle: this command pushed to ${pushed.join(', ')} without the user asking for a push. Tell the user.`,
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
  if (notes.length === 0 || r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), ...notes] };
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
  const lineages = madeBy(entries, start.head);
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
    const why =
      checked === 'commit'
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
    droppedReviews: state.dropped,
    cappedReviews: state.capped,
    reviewerChanges: state.reviewerChanges,
    shellAliases: state.aliasError ?? state.shellAliases.size,
    pushRequested: covers(state.message.grant, 'push'),
    prRequested: state.message.grant.pr,
    error: null,
    worktreeTree: null,
  };
  const ladder = await ladderOf($);
  const may = permitted(state.message.grant, ladder);
  const from = ladder.unreadable === undefined ? where(ladder.source) : 'unreadable settings';
  status.stopBefore = { ...ladder, from, held: state.held };
  status.mayCommit = may.commit;
  status.mayPush = may.push;
  status.mayOpenPr = may.pr;
  status.mayMerge = may.merge;
  status.mayRelease = may.release;
  status.commentRequested = state.message.grant.comment;
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

// The ledger gates nothing, so its tools are served whether or not the gate is on.
async function registerLedger($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'ledger',
      description:
        'Findings earlier review cycles in this repository settled without fixing: deferred, rebutted, left alone on purpose, or raised as questions. Each entry has an id, path, line, kind, finding, reason, source, `date` (when a cycle last settled it), `blob` (the file as the last cycle to carry it reviewed it), `current` (the file now), `changed` (whether the two differ; null when the working tree could not be read), and `stale` (settled more than 90 days ago). `unreadable` counts stored entries this version cannot read; the next record drops them. Pass `paths` to get only the entries for those repository-relative paths. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' } } },
      },
    });
    await $.tool.register({
      name: 'ledger_record',
      description:
        "Records what a review cycle settled without fixing into this repository's findings ledger. `entries` adds findings, each stamped with its file's blob in the working tree and today's date, so every path must be a file there; text is collapsed to one line and clipped at 400 characters, and the same finding at the same path replaces its entry. `keep` carries entries by id: each gets its file's current blob and keeps its date, and one whose file is gone is dropped. `resolve` removes entries by id. The ledger keeps the newest 100 entries, and ledgers for the 10 most recently recorded repositories.",
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
  const paths = (e as { paths?: unknown }).paths;
  if (paths !== undefined && !(Array.isArray(paths) && paths.every((p) => typeof p === 'string'))) {
    return {
      result: 'review-cycle ledger: `paths` must be an array of repository-relative paths.',
    };
  }
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'review-cycle ledger: not in a git repository.' };
    const blobs = (ps: string[]) => blobsAt(gitOf($), root.top, ps);
    const status = await readLedger(storeOf($), blobs, root.common, paths, await $.clock.now());
    return { result: JSON.stringify(status, null, 2) };
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
  return next(e);
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
    `the gate failed while checking this command (${why}), so it is refused. The user can run it from their own terminal.`,
  );
}

export const register: Register = (on, options) => {
  state.gateOn = options.enabled !== false;
  state.stopBefore = stopBeforeOf(options.stopBefore);
  on('config.set', { key: 'review-cycle.enabled' }, onConfigSet);
  on('config.set', { key: 'review-cycle.stopBefore' }, onConfigSet);
  on('tool.call', { tool: 'Edit' }, onEditSlop);
  on('tool.call', { tool: 'Write' }, onWriteSlop);
  on('session.start', onSessionStart);
  on('tool.call', { tool: 'mcp__review-cycle__ledger' }, onLedger);
  on('tool.call', { tool: 'mcp__review-cycle__ledger_record' }, onLedgerRecord);
  on('tool.call', { tool: 'mcp__review-cycle__scratch' }, onScratch);
  on('tool.call', { tool: 'mcp__review-cycle__sweep' }, onSweep);
  if (options.enabled === false) {
    // The status tool stays registered from before the switch; say why it is idle.
    on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatusOff);
    return;
  }
  on('prompt.submit', onPromptSubmit);
  on('agent.spawn', onAgentSpawn);
  on('turn.complete', onTurnComplete);
  on('tool.call', { tool: 'Skill' }, onSkill);
  on('tool.call', { tool: 'Bash' }, onBash).catch(onBashError);
  on('tool.call', { tool: MCP_GITHUB }, onGithubTool).catch(onGithubToolError);
  on('tool.call', { tool: 'Bash' }, onBashEdits);
  on('tool.call', { tool: 'Edit' }, onEditContained);
  on('tool.call', { tool: 'Write' }, onWriteContained);
  on('tool.call', { tool: 'Edit' }, onEdit).catch(onEditError);
  on('tool.call', { tool: 'Write' }, onWrite).catch(onWriteError);
  on('tool.call', { tool: 'NotebookEdit' }, onNotebookEdit);
  on('tool.call', { tool: 'Monitor' }, onMonitor).catch(onMonitorError);
  on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatus);
};
