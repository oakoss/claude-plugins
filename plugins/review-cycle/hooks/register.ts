import type {
  Caught,
  CatchHandler,
  EngineInterface,
  HookFor,
  MatchedHook,
  PromptOrigin,
  Register,
  ToolCallResult,
} from 'claude-code';

import { added, madeBy, MARK, type Entry } from './attribution';
import {
  aliasCommits,
  classify,
  possibleAliases,
  shownCommand,
  type Classification,
} from './command';
import { grantOf, NO_GRANT, type Grant, type Verb } from './consent';
import { containmentReport, insideRepo, repoStateOf, UNREAD, type Capture } from './containment';
import {
  coverageOf,
  firstLine,
  headOf,
  parentTree,
  prospectTree,
  headLog,
  headLogCount,
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
import { applyEdit, bashTouchesGate, isJsonPath, touchesGate } from './settings';
import { aliasScript, aliasShell, parseShellAliases, readAliases } from './shell';
import { MAX_BYTES, skipsPath, slopDirective, slopFindings, type Written } from './slop';
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
type SkillHook = MatchedHook<'tool.call', { tool: 'Skill' }>;
type StatusHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__status' }>;
type ConfigHook = MatchedHook<'config.set', { key: 'review-cycle.enabled' }>;
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
type Leg = { type: string; counts: boolean; spawnTree: string | null; done: boolean };

// What the user's latest message settled: a fresh message replaces it, a
// prompt queued into the running turn updates it.
type Message = {
  grant: Grant;
  // Verbs the user turned down when the gate asked, so it does not ask again.
  declined: Grant;
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
  // Whether the gate's question to the user is on screen.
  asking: boolean;
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
  // How many of `dropped` predate the latest recorded review.
  droppedSince: number;
  // What reviewers' commands changed in the repository under review.
  reviewerChanges: string[];
};

const state: GateState = {
  root: undefined,
  reviews: [],
  legs: new Map(),
  // No message yet, so nothing to nudge about.
  message: { grant: NO_GRANT, declined: NO_GRANT, tree: null, nudged: true, prWindow: false },
  messages: 0,
  asking: false,
  lastAnswer: '',
  shellAliases: new Map(),
  aliasError: null,
  aliasErrorShown: false,
  aliasesLoaded: false,
  ownRead: undefined,
  dropped: [],
  droppedSince: 0,
  reviewerChanges: [],
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
        "review-cycle's view of the working tree: which changed paths a reviewer has seen, which were edited after the last review or never reviewed, and whether the user's latest message asked for a commit or push. Read-only.",
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
    const grant = grantOf(e.text, state.lastAnswer);
    // A prompt queued into a running turn neither ends a review-pr run nor
    // replaces that turn's starting tree.
    if (e.turnId !== undefined) {
      // Updated in place: a pending nudge's rollback holds this record.
      state.message.grant = grant;
      state.message.declined = NO_GRANT;
      state.message.nudged = false;
    } else {
      let tree: string | null = null;
      try {
        const root = await ensureRoot($);
        if (root !== null) tree = await worktreeTree(gitOf($), root.top);
      } catch {
        // No starting tree means no nudge this message; the commit gate still holds.
      }
      state.message = { grant, declined: NO_GRANT, tree, nudged: false, prWindow: false };
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
  if (tree === null || tree === since) return;
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
  // Not awaited: the prompt enters once this turn has ended.
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .catch(() => {
      message.nudged = false;
    });
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
    state.legs.set(r.agentId, { type: e.subagentType, counts, spawnTree, done: false });
  }
  return r;
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
  if (leg) leg.done = true;
  const root = state.root;
  if (!leg?.counts || leg.spawnTree === null || !root) return next(e);
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
    if (tree === null) throw new Error('the working tree could not be read when it finished');
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
    possibleAliases(e.command, state.shellAliases).length > 0;
  if (!judged) return next(e);
  return deny(
    'Monitor runs commands the gate does not check. Run a command that commits, pushes, calls a git alias or writes settings with the Bash tool.',
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
      return { state: await repoStateOf(gitOf($), root.top), why: null };
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

async function judgeBash(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  // A newer message overtakes anything decided from this one.
  const message = state.messages;
  let granted = state.message.grant;
  if (bashTouchesGate(e.command)) return deny(SWITCHED_BY_USER);
  await loadShellAliases($);
  const cls = classify(e.command, state.shellAliases);
  if (cls.kind === 'refuse') return deny(cls.reason);
  if (cls.kind === 'none') {
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
    const r = await watch($, await ensureRoot($), e, next, 'unchecked');
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
  if (e.agentId) {
    return deny(
      'subagents do not commit or push in this repository. Report back to the main session instead.',
    );
  }

  // Reviewed first, so the user is never asked about a commit the gate refuses.
  const before = await reviewed($, root.top, cls);
  if (typeof before === 'string') return deny(before);

  const commits = cls.commit !== null || cls.history !== null;
  const verbs: Verb[] = [];
  if (commits && !granted.commit) verbs.push('commit');
  if (cls.push && !granted.push) verbs.push('push');
  if (verbs.length > 0) {
    const refusal = await ask($, e.command, verbs, before?.files ?? null, message, next.signal);
    if (refusal !== null) return deny(refusal);
    granted = withVerbs(granted, verbs);
    // The dialog waits on a person, and the tree can change meanwhile.
    const after = await reviewed($, root.top, cls);
    if (typeof after === 'string') return deny(after);
    if (verbs.includes('commit') && after?.tree !== before?.tree) {
      return deny(
        'what this commit records changed while the gate was asking the user, so the answer does not cover it. Run it again to ask about what it records now.',
      );
    }
  }
  const checked = cls.commit ? 'commit' : cls.history !== null ? 'history' : 'push';
  return watch($, root, e, next, checked, granted, message);
}

// The tree a real commit would record and how many paths it changes, or the
// refusal when a reviewer has not seen all of it; null for a command that
// records no new content.
async function reviewed(
  $: $,
  top: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<{ tree: string; files: number } | string | null> {
  if (!cls.commit || cls.commit.dryRun) return null;
  const head = await headOf(gitOf($), top);
  // An amend replaces HEAD, so what it records is judged against HEAD's parent.
  const base = cls.commit.amend && head !== EMPTY_TREE ? await parentTree(gitOf($), top) : head;
  const prospect = await prospectTree(gitOf($), top, cls);
  const c =
    prospect && base ? await coverageOf(gitOf($), top, base, prospect, state.reviews) : null;
  if (prospect === null || c === null) {
    throw new Error('could not compute the tree this commit would record');
  }
  if (uncoveredOf(c.rows).length > 0) {
    return `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then commit.`;
  }
  return { tree: prospect, files: c.rows.length };
}

function withVerbs(g: Grant, verbs: readonly Verb[]): Grant {
  return Object.freeze({
    commit: g.commit || verbs.includes('commit'),
    push: g.push || verbs.includes('push'),
  });
}

// Longer than this, a command is not shown in the dialog, so it is not asked about.
const MAX_SHOWN = 500;

// Fixed labels keep the agent's wording from deciding what a pick means. A second
// question is refused, not queued: waiting would count against its hook's time limit.
async function ask(
  $: $,
  command: string,
  verbs: Verb[],
  files: number | null,
  message: number,
  signal: AbortSignal,
): Promise<string | null> {
  const wants = verbs.join(' and ');
  const turned = verbs.filter((v) => state.message.declined[v]);
  if (turned.length > 0) {
    return `the user turned down the ${turned.join(' and ')} when the gate asked. Do not try it again unless their next message asks for it.`;
  }
  if (state.messages !== message) {
    return `the user sent a new message while the gate was checking this ${wants}, so it did not ask them. Act on their message.`;
  }
  if (state.asking) {
    return `the gate is already asking the user about another command, so it did not ask about this ${wants}. Wait for that answer, then run it again.`;
  }
  if (signal.aborted) {
    return `the call was interrupted before the gate asked about the ${wants}, so it did not ask them.`;
  }
  const shown = shownCommand(command, state.shellAliases);
  if (shown.length > MAX_SHOWN) {
    return `this command is too long for the gate to show the user (${shown.length} characters; ${MAX_SHOWN} at most), so it did not ask them. Run the ${wants} as a shorter command, with a short -m message, or ask the user to run it.`;
  }
  const yes = verbs.length === 2 ? 'Commit and push' : verbs[0] === 'commit' ? 'Commit' : 'Push';
  const no = verbs.length === 2 ? "Don't" : `Don't ${verbs[0]}`;
  const what =
    files === null || !verbs.includes('commit')
      ? ''
      : ` (${files} reviewed file${files === 1 ? '' : 's'})`;
  let answer: string;
  state.asking = true;
  try {
    const asked = $.ui.ask(`The agent wants to ${wants}${what}: ${shown}. Allow it?`, {
      options: [yes, no],
      header: 'review-cycle',
    });
    // The dialog outlives an abandoned call, and must not hold the next one off.
    const abandoned = new Promise<never>((_, reject) => {
      const stop = () => reject(new Error('the call was interrupted'));
      if (signal.aborted) stop();
      signal.addEventListener('abort', stop, { once: true });
    });
    void asked.catch(() => null);
    void abandoned.catch(() => null);
    answer = await Promise.race([asked, abandoned]);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `the user's latest message doesn't ask for a ${wants}, and the gate got no answer when it asked them (${why}). Ask them first; staging with git add needs no permission.`;
  } finally {
    state.asking = false;
  }
  // An answer to a question the user's newer message has overtaken settles nothing.
  if (state.messages !== message) {
    return `the user sent a new message while the gate was asking about the ${wants}, so nothing ran. Act on their message.`;
  }
  if (answer === yes) return null;
  if (answer === no) {
    state.message.declined = withVerbs(state.message.declined, verbs);
    return `the user turned down the ${wants} when the gate asked. Do not try it again unless their next message asks for it.`;
  }
  // Text typed under "Type something." is not a pick, so it grants nothing;
  // the agent reads it, and a retry asks again.
  return `the user answered the gate's question about the ${wants} with: ${JSON.stringify(answer)}. Nothing ran; act on what they said.`;
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
// commits by design, so only consent matters for it. A commit made in another
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
): Promise<Output<BashHook>> {
  if (root === null) return next(e);
  const git = gitOf($);
  let start: Start | null = null;
  let startError: unknown = null;
  try {
    const head = await headOf(git, root.top);
    const unborn = head === EMPTY_TREE;
    const log = unborn ? [] : await headLog(git, root.top, MARK);
    const count = await headLogCount(git, root.top, unborn);
    start = { head, refs: await remoteRefs(git, root.top), log, count };
  } catch (error) {
    startError = error;
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
      if (pushed.length > 0 && !granted.push) {
        notes.push(
          `review-cycle: this command pushed to ${pushed.join(', ')} without the user asking for a push. Tell the user.`,
        );
      }
    } catch (error) {
      failed('pushed', error);
    }
    try {
      notes.push(...(await commitNotes(git, root.top, start, checked, granted)));
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
  granted: Grant,
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
  if (!granted.commit) {
    notes.push(
      `review-cycle: commit ${short} landed without the user asking for one. Tell the user.`,
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
    reviewerChanges: state.reviewerChanges,
    shellAliases: state.aliasError ?? state.shellAliases.size,
    consent: state.message.grant,
    error: null,
  };
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'Not in a git repository; review-cycle gates nothing here.' };
    const head = await headOf(gitOf($), root.top);
    const tree = await worktreeTree(gitOf($), root.top);
    const c = tree ? await coverageOf(gitOf($), root.top, head, tree, state.reviews) : null;
    status.worktreeTree = tree;
    status.snapshot = tree ? await snapshotOf(gitOf($), root.top, head, tree) : null;
    status.changed = c?.rows.length ?? null;
    status.uncovered = c ? uncoveredOf(c.rows) : null;
    status.unreadReviews = c?.unread ?? null;
    if (tree === null) status.error = 'could not build the working tree';
    else if (c === null) status.error = 'could not diff the working tree';
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }
  return { result: JSON.stringify(status, null, 2) };
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
    return { deny: "review-cycle's gate is switched only by the user in /config." };
  }
  return next(e);
}

async function withNote(
  result: Promise<Output<BashHook>>,
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
  if (cls.kind === 'none' && possibleAliases(e.command, state.shellAliases).length === 0) {
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
  on('config.set', { key: 'review-cycle.enabled' }, onConfigSet);
  on('tool.call', { tool: 'Edit' }, onEditSlop);
  on('tool.call', { tool: 'Write' }, onWriteSlop);
  if (options.enabled === false) {
    // The status tool stays registered from before the switch; say why it is idle.
    on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatusOff);
    return;
  }
  on('session.start', onSessionStart);
  on('prompt.submit', onPromptSubmit);
  on('agent.spawn', onAgentSpawn);
  on('turn.complete', onTurnComplete);
  on('tool.call', { tool: 'Skill' }, onSkill);
  on('tool.call', { tool: 'Bash' }, onBash).catch(onBashError);
  on('tool.call', { tool: 'Edit' }, onEditContained);
  on('tool.call', { tool: 'Write' }, onWriteContained);
  on('tool.call', { tool: 'Edit' }, onEdit).catch(onEditError);
  on('tool.call', { tool: 'Write' }, onWrite).catch(onWriteError);
  on('tool.call', { tool: 'NotebookEdit' }, onNotebookEdit);
  on('tool.call', { tool: 'Monitor' }, onMonitor).catch(onMonitorError);
  on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatus);
};
