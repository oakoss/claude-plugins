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

import { aliasCommits, classify, possibleAliases, type Classification } from './command';
import { grantOf, grantOfAnswers, NO_GRANT, type Grant } from './consent';
import { applyEdit, bashTouchesGate, isJsonPath, touchesGate } from './settings';
import { parseShellAliases } from './shell';
import { MAX_BYTES, skipsPath, slopDirective, slopFindings, type Written } from './slop';
import {
  CONFIG_PATH,
  EMPTY_TREE,
  EXCLUDES,
  coverage,
  describeUncovered,
  hasReceipt,
  ignoresOf,
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

// A repository by its working tree and by the object store its worktrees share.
type Repo = { top: string; common: string };

type Leg = { type: string; counts: boolean; spawnTree: string };

type GateState = {
  // undefined until resolved; null when the session is not in a repository.
  root: Repo | null | undefined;
  reviews: Review[];
  legs: Map<string, Leg>;
  // Legs spawned while review-pr runs review a PR worktree, not this tree.
  prWindow: boolean;
  grant: Grant;
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
  prWindow: false,
  grant: NO_GRANT,
  lastAnswer: '',
  shellAliases: new Map(),
  aliasError: null,
  aliasErrorShown: false,
  aliasesLoaded: false,
  dropped: [],
  droppedSince: 0,
};

type Run = { exitCode: number; stdout: string; stderr: string };

// Without `cwd`, $.process.run runs in the Bash tool's current directory,
// which is what a command's own relative paths resolve against.
async function run(
  $: $,
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Run> {
  // git's messages are matched in English, so its locale is pinned.
  const env = { LC_ALL: 'C', LANGUAGE: 'C', ...opts.env };
  return $.process.run(argv, { timeoutMs: 60_000, ...opts, env });
}

function sha(s: string): string | null {
  const t = s.trim();
  return /^[a-f0-9]{40}$/.test(t) ? t : null;
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0] ?? '';
}

// The repository at `dir` (or the given cwd), 'none' when there is none, and
// a throw when git could not say.
async function repoAt($: $, dir: string | null, cwd?: string): Promise<Repo | 'none'> {
  const argv = ['git', ...(dir === null ? [] : ['-C', dir])];
  const r = await run(
    $,
    [...argv, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
    cwd === undefined ? {} : { cwd },
  );
  if (r.exitCode === 0) {
    const [top, common] = r.stdout.trim().split('\n');
    if (top && common) return { top, common };
  }
  if (/not a git repository/i.test(r.stderr)) return 'none';
  throw new Error(`git rev-parse failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
}

// HEAD's commit, or EMPTY_TREE on an unborn branch; a throw when git failed.
async function headOf($: $, root: string): Promise<string> {
  const r = await run($, ['git', 'rev-parse', '--verify', '-q', 'HEAD'], { cwd: root });
  if (r.exitCode === 0) {
    const head = sha(r.stdout);
    if (head) return head;
  }
  if (r.exitCode === 1 && r.stdout.trim() === '') return EMPTY_TREE;
  throw new Error(`git rev-parse HEAD failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
}

async function treeOf($: $, root: string, commit: string): Promise<string | null> {
  if (commit === EMPTY_TREE) return EMPTY_TREE;
  const r = await run($, ['git', 'rev-parse', `${commit}^{tree}`], { cwd: root });
  return r.exitCode === 0 ? sha(r.stdout) : null;
}

// The config is read from the tree being judged, not the working tree: an
// `ignore` entry counts only once it is part of what gets reviewed.
async function pathspecs($: $, root: string, tree: string): Promise<string[]> {
  const r = await run($, ['git', 'show', `${tree}:${CONFIG_PATH}`], { cwd: root });
  return ['.', ...EXCLUDES, ...ignoresOf(r.exitCode === 0 ? r.stdout : null)];
}

function nulList(out: string): string[] {
  return out.split('\0').filter(Boolean);
}

// Paths that differ between two trees and need review: the excludes and
// `ignore` patterns applied, the config always included.
async function reviewablePaths(
  $: $,
  root: string,
  from: string,
  to: string,
): Promise<string[] | null> {
  const base = ['git', 'diff-tree', '-r', '-z', '--no-renames', '--name-only', from, to, '--'];
  const main = await run($, [...base, ...(await pathspecs($, root, to))], { cwd: root });
  const cfg = await run($, [...base, CONFIG_PATH], { cwd: root });
  if (main.exitCode !== 0 || cfg.exitCode !== 0) return null;
  return [...new Set([...nulList(main.stdout), ...nulList(cfg.stdout)])];
}

// A tree built in a scratch copy of the index, so the real index is never
// touched. `prepare` stages into it; its commands see GIT_INDEX_FILE.
async function scratchTree(
  $: $,
  root: string,
  prepare: (env: Record<string, string>) => Promise<boolean>,
): Promise<string | null> {
  const mk = await run($, ['mktemp'], { cwd: root });
  const scratch = mk.stdout.trim();
  if (mk.exitCode !== 0 || !scratch) return null;
  const env = { GIT_INDEX_FILE: scratch };
  try {
    const idx = await run(
      $,
      ['git', 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
      { cwd: root },
    );
    const cp = await run(
      $,
      [
        'sh',
        '-c',
        'if [ -f "$1" ]; then cp "$1" "$2"; else rm -f "$2"; fi',
        'sh',
        idx.stdout.trim(),
        scratch,
      ],
      { cwd: root },
    );
    if (idx.exitCode !== 0 || cp.exitCode !== 0) return null;
    if (!(await prepare(env))) return null;
    const wt = await run($, ['git', 'write-tree'], { cwd: root, env });
    return wt.exitCode === 0 ? sha(wt.stdout) : null;
  } finally {
    try {
      await run($, ['rm', '-f', scratch], { cwd: root });
    } catch {
      // A leftover temp file does not change the verdict.
    }
  }
}

async function worktreeTree($: $, root: string): Promise<string | null> {
  return scratchTree($, root, async (env) => {
    const add = await run($, ['git', 'add', '-A'], { cwd: root, env });
    return add.exitCode === 0;
  });
}

// The tree the command's commit would record: the index after replaying its
// `git add`s, plus `add -u` for `commit -a`.
async function prospectTree(
  $: $,
  root: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<string | null> {
  return scratchTree($, root, async (env) => {
    for (const argv of cls.adds) {
      const add = await run($, ['git', '-C', cls.dir, ...argv], { env });
      if (add.exitCode !== 0) return false;
    }
    if (!cls.commit?.all) return true;
    const update = await run($, ['git', ...cls.commit.config, 'add', '-u'], { cwd: root, env });
    return update.exitCode === 0;
  });
}

type Coverage = { rows: Row[]; unread: number };

// Coverage of the paths `to` changes against `from`. `unread` counts reviewed
// trees git could not compare, which then cover nothing.
async function coverageOf($: $, root: string, from: string, to: string): Promise<Coverage | null> {
  const changed = await reviewablePaths($, root, from, to);
  if (changed === null) return null;
  if (changed.length === 0) return { rows: [], unread: 0 };
  let unread = 0;
  const differing = new Map<string, Set<string>>();
  for (const tree of new Set(state.reviews.flatMap((r) => r.trees))) {
    // Changed paths are literal file names here, never pathspec magic.
    const d = await run(
      $,
      [
        'git',
        '--literal-pathspecs',
        'diff-tree',
        '-r',
        '-z',
        '--no-renames',
        '--name-only',
        tree,
        to,
        '--',
        ...changed,
      ],
      { cwd: root },
    );
    if (d.exitCode === 0) differing.set(tree, new Set(nulList(d.stdout)));
    else unread++;
  }
  return { rows: coverage(changed, state.reviews, differing), unread };
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
    const repo = await repoAt($, null, await $.session.cwd());
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

function onPromptSubmit(
  $: $,
  e: Input<HookFor<'prompt.submit'>>,
  next: NextOf<HookFor<'prompt.submit'>>,
): ReturnType<HookFor<'prompt.submit'>> {
  if (HUMAN.has(e.origin.kind)) {
    state.grant = grantOf(e.text, state.lastAnswer);
    // A prompt queued into a running turn does not end a review-pr run.
    if (e.turnId === undefined) state.prWindow = false;
  }
  return next(e);
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
    state.grant = grantOfAnswers(answers as Record<string, unknown>);
  }
  return r;
}

function onSkill($: $, e: Input<SkillHook>, next: NextOf<SkillHook>): ReturnType<SkillHook> {
  if (!e.agentId && e.skill === 'review-cycle:review-pr') state.prWindow = true;
  if (!e.agentId && e.skill === 'review-cycle:review') state.prWindow = false;
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
    if (isLeg && root !== null) spawnTree = await worktreeTree($, root.top);
  } catch (error) {
    isLeg = isReviewerType(e.subagentType) && !e.parentAgentId;
    why = `${why} (${error instanceof Error ? error.message : String(error)})`;
  }
  const r = await next(e);
  if (isLeg && 'agentId' in r && r.agentId) {
    if (spawnTree === null) {
      state.dropped.push(`${e.subagentType}: ${why}`);
    } else {
      state.legs.set(r.agentId, { type: e.subagentType, counts: !state.prWindow, spawnTree });
    }
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
    return next(e);
  }
  const leg = state.legs.get(e.agentId);
  const root = state.root;
  if (!leg?.counts || !root) return next(e);
  if (e.isAborted || e.reason !== 'answer') {
    state.dropped.push(`${leg.type}: it did not finish (${e.isAborted ? 'aborted' : e.reason})`);
    return next(e);
  }
  if (!hasReceipt(e.answer)) {
    state.dropped.push(`${leg.type}: its report did not open with the execution receipt`);
    return next(e);
  }
  try {
    const tree = await worktreeTree($, root.top);
    if (tree === null) throw new Error('the working tree could not be read when it finished');
    const head = await headOf($, root.top);
    const reviewedPaths = await reviewablePaths($, root.top, head, tree);
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
  const target = await repoAt($, cls.dir);
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
  if ((commits && !state.grant.commit) || (cls.push && !state.grant.push)) {
    const wants = [commits ? 'commit' : null, cls.push ? 'push' : null]
      .filter(Boolean)
      .join(' or ');
    return deny(
      `the user's latest message doesn't ask for a ${wants}. Ask them first; staging with git add needs no permission.`,
    );
  }

  if (cls.commit && !cls.commit.dryRun) {
    const head = await headOf($, root.top);
    // An amend replaces HEAD, so what it records is judged against HEAD's parent.
    const base = cls.commit.amend && head !== EMPTY_TREE ? await parentTree($, root.top) : head;
    const prospect = await prospectTree($, root.top, cls);
    const c = prospect && base ? await coverageOf($, root.top, base, prospect) : null;
    if (c === null) throw new Error('could not compute the tree this commit would record');
    if (uncoveredOf(c.rows).length > 0) {
      return deny(
        `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then commit.`,
      );
    }
  }
  return watch($, root, e, next, cls.commit ? 'commit' : cls.history !== null ? 'history' : 'push');
}

// HEAD's parent's tree; the caller has already resolved HEAD to a commit.
async function parentTree($: $, root: string): Promise<string | null> {
  const p = await run($, ['git', 'rev-parse', '--verify', '-q', 'HEAD^'], { cwd: root });
  return p.exitCode === 0 ? treeOf($, root, p.stdout.trim()) : EMPTY_TREE;
}

// Runs the command, then reports a commit the gate did not check (a script),
// or one whose content changed after the check (a pre-commit hook restaging).
// A history command records existing commits by design, so only consent
// matters for it.
async function watch(
  $: $,
  root: Repo | null,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
  checked: 'commit' | 'history' | 'push' | 'unchecked',
): Promise<Output<BashHook>> {
  if (root === null) return next(e);
  let before: string | null = null;
  try {
    before = await headOf($, root.top);
  } catch {
    // Reported below: without a starting HEAD nothing can be compared.
  }
  const r = await next(e);
  const notes: string[] = [];
  try {
    if (before === null) throw new Error('HEAD could not be read before the command ran');
    const after = await headOf($, root.top);
    if (after === EMPTY_TREE && before !== EMPTY_TREE) {
      notes.push(
        'review-cycle: HEAD no longer resolves to a commit after this command. Tell the user.',
      );
    } else if (after !== before) {
      const short = after.slice(0, 12);
      const tree = await treeOf($, root.top, after);
      const baseTree = await treeOf($, root.top, before);
      const c = tree && baseTree ? await coverageOf($, root.top, baseTree, tree) : null;
      if (c === null) notes.push(`review-cycle could not check commit ${short}. Tell the user.`);
      else if (checked !== 'history' && uncoveredOf(c.rows).length > 0) {
        const why =
          checked === 'commit'
            ? "A pre-commit hook may have changed it after the gate's check."
            : 'It did not go through the commit gate.';
        notes.push(
          `review-cycle: commit ${short} records content no reviewer saw (${explain(c)}). ${why} Tell the user.`,
        );
      }
      if (!state.grant.commit) {
        notes.push(
          `review-cycle: commit ${short} landed without the user asking for one. Tell the user.`,
        );
      }
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    notes.push(`review-cycle could not check whether this command committed (${why}).`);
  }
  if (notes.length === 0 || r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), ...notes] };
}

// A digest of HEAD and every reviewable change against it, blob ids included:
// equal digests mean nothing a reviewer should see has moved.
async function snapshotOf($: $, root: string, head: string, tree: string): Promise<string | null> {
  const base = ['git', 'diff-tree', '-r', '--no-renames', '--raw', head, tree, '--'];
  const main = await run($, [...base, ...(await pathspecs($, root, tree))], { cwd: root });
  const cfg = await run($, [...base, CONFIG_PATH], { cwd: root });
  if (main.exitCode !== 0 || cfg.exitCode !== 0) return null;
  const bytes = new TextEncoder().encode(`${head}\n${main.stdout}${cfg.stdout}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    consent: state.grant,
    error: null,
  };
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'Not in a git repository; review-cycle gates nothing here.' };
    const head = await headOf($, root.top);
    const tree = await worktreeTree($, root.top);
    const c = tree ? await coverageOf($, root.top, head, tree) : null;
    status.worktreeTree = tree;
    status.snapshot = tree ? await snapshotOf($, root.top, head, tree) : null;
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
