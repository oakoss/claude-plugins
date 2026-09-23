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
import { aliasCommits, classify, possibleAliases } from './command';
import { grantOf, grantOfAnswers, NO_GRANT, type Grant } from './consent';
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
import { parseShellAliases } from './shell';
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
  lastAnswer: string;
  // The user's shell aliases, which the Bash tool expands.
  shellAliases: Map<string, string>;
  aliasError: string | null;
  // Whether the agent has been told the aliases could not be read.
  aliasErrorShown: boolean;
  aliasesLoaded: boolean;
  // Reviews that ran but could not be recorded, and why.
  dropped: string[];
  // How many of `dropped` predate the latest recorded review.
  droppedSince: number;
};

const state: GateState = {
  root: undefined,
  reviews: [],
  legs: new Map(),
  // No message yet, so nothing to nudge about.
  message: { grant: NO_GRANT, tree: null, nudged: true, prWindow: false },
  lastAnswer: '',
  shellAliases: new Map(),
  aliasError: null,
  aliasErrorShown: false,
  aliasesLoaded: false,
  dropped: [],
  droppedSince: 0,
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

// The aliases the Bash tool expands come from Claude Code's snapshot of the
// user's shell, the file it sources before each command; reading it spawns
// nothing. A read that fails leaves the aliases unknown, not empty: it is
// retried on the next Bash call, and the first unchecked command says so.
async function loadShellAliases($: $): Promise<void> {
  if (state.aliasesLoaded) return;
  try {
    const home = await $.env.get('HOME');
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null);
    if (!config) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set');
    const shell = basenameOf((await $.env.get('SHELL')) ?? '');
    const dir = `${config}/shell-snapshots`;
    const newest = newestSnapshot(await $.fs.list(dir), shell);
    if (newest === null) throw new Error(`no shell snapshot in ${dir} yet`);
    state.shellAliases = parseShellAliases(await $.fs.read(`${dir}/${newest}`));
    state.aliasError = null;
    state.aliasesLoaded = true;
  } catch (error) {
    state.aliasError = error instanceof Error ? error.message : String(error);
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
    const grant = grantOf(e.text, state.lastAnswer);
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

// The user's pick in the question dialog is their input as much as a typed
// prompt, and the engine, not the model, produces the result. The generated
// types list no AskUserQuestion tool for a matcher to name, so this hook sees
// every call and picks that one out itself.
async function onAsk(
  $: $,
  e: Input<HookFor<'tool.call'>>,
  next: NextOf<HookFor<'tool.call'>>,
): Promise<Output<HookFor<'tool.call'>>> {
  if ((e.tool as string) !== 'AskUserQuestion' || e.agentId) return next(e);
  // Only the model's own question counts: another plugin's `$.ui.ask` raises
  // the same dialog, asking about something else.
  if (next.origin.plugin !== 'engine') return next(e);
  // Answers the model supplied with the call are not the user's.
  const supplied = (e as { answers?: unknown }).answers;
  if (supplied !== undefined && supplied !== null) return next(e);
  const r = await next(e);
  if (r.deny !== undefined) return r;
  const answers = (r.result as { answers?: unknown } | undefined)?.answers;
  if (answers !== null && typeof answers === 'object') {
    state.message.grant = grantOfAnswers(answers as Record<string, unknown>);
  }
  return r;
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

async function onBash($: $, e: Input<BashHook>, next: NextOf<BashHook>): Promise<Output<BashHook>> {
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

  const commits = cls.commit !== null || cls.history !== null;
  if ((commits && !state.message.grant.commit) || (cls.push && !state.message.grant.push)) {
    const wants = [commits ? 'commit' : null, cls.push ? 'push' : null]
      .filter(Boolean)
      .join(' or ');
    return deny(
      `the user's latest message doesn't ask for a ${wants}. Ask them first; staging with git add needs no permission.`,
    );
  }

  if (cls.commit && !cls.commit.dryRun) {
    const head = await headOf(gitOf($), root.top);
    // An amend replaces HEAD, so what it records is judged against HEAD's parent.
    const base =
      cls.commit.amend && head !== EMPTY_TREE ? await parentTree(gitOf($), root.top) : head;
    const prospect = await prospectTree(gitOf($), root.top, cls);
    const c =
      prospect && base ? await coverageOf(gitOf($), root.top, base, prospect, state.reviews) : null;
    if (c === null) throw new Error('could not compute the tree this commit would record');
    if (uncoveredOf(c.rows).length > 0) {
      return deny(
        `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then commit.`,
      );
    }
  }
  return watch($, root, e, next, cls.commit ? 'commit' : cls.history !== null ? 'history' : 'push');
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
      if (pushed.length > 0 && !state.message.grant.push) {
        notes.push(
          `review-cycle: this command pushed to ${pushed.join(', ')} without the user asking for a push. Tell the user.`,
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
  if (!state.message.grant.commit) {
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
  const why = next.error.message ?? next.error.kind;
  const cls = classify(e.command, state.shellAliases);
  if (cls.kind === 'none' && possibleAliases(e.command, state.shellAliases).length === 0) {
    return withNote(
      next(e),
      `review-cycle could not watch this command (${why}); a commit it made would not be reported. Tell the user.`,
    );
  }
  return deny(
    `the gate failed while checking this command (${why}), so it is refused. The user can commit from their own terminal.`,
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
  on('tool.call', onAsk);
  on('tool.call', { tool: 'Bash' }, onBash).catch(onBashError);
  on('tool.call', { tool: 'Edit' }, onEdit).catch(onEditError);
  on('tool.call', { tool: 'Write' }, onWrite).catch(onWriteError);
  on('tool.call', { tool: 'Monitor' }, onMonitor).catch(onMonitorError);
  on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatus);
};
