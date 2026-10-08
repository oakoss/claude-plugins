// What the band says about a pull request, and when to look again. Pure.
import type { Activity, Pull, Watch, Workflow } from '../types';

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const PR_URL = new RegExp(
  `^https://(${LABEL}(?:\\.${LABEL})*)/([\\w-][\\w.-]*/[\\w-][\\w.-]*)/pull/([1-9]\\d{0,9})\\s*$`,
  'gm',
);
// The start of a command: the line's, or after a shell separator, with any
// leading VAR=value assignments.
const START = String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*`;
const PR_CREATE = new RegExp(String.raw`${START}gh\s+pr\s+create\b`);
// git's own options may come before the subcommand: -C dir, -c key=value, --flag.
const MOVES_PR = new RegExp(
  String.raw`${START}(?:git(?:\s+(?:-[Cc]\s+\S+|--\S+))*\s+push\b|gh\s+pr\s+merge\b|gh\s+run\s+rerun\b|gh\s+workflow\s+run\b)`,
);

const GIT_PUSH = new RegExp(String.raw`${START}git(?:\s+(?:-[Cc]\s+\S+|--\S+))*\s+push\b`);
// git's "To <remote>" line: scp, https:// or ssh:// form.
const PUSH_TO =
  /^To\s+(?:\w+:\/\/)?(?:[^@\s/]+@)?([A-Za-z0-9.-]+)(?::\d+)?[:/]([\w-][\w.-]*\/[\w-][\w.-]*?)(?:\.git)?\/?\s*$/;
// A ref the push moved: "a..b  src -> dst", "+ a...b src -> dst (forced
// update)", "* [new branch]  src -> dst". Deleted, rejected, up-to-date and
// new-tag lines name none.
const PUSH_REF =
  /^\s*[+*]?\s*(?:[0-9a-f]{4,}\.{2,3}[0-9a-f]{4,}|\[new branch\])\s+\S+\s+->\s+(\S+)/;
// The same with --porcelain: "<flag>\t<src>:<dst>\t<summary>".
const PORCELAIN_REF = /^[ +*]\t\S*:(\S+)\t/;

export type PushTarget = Pick<Target, 'host' | 'repo' | 'url'> & { branch: string };

// The branches a `git push` moved, read from its output, which reaches the
// hook in stdout with stderr merged in. A forced tag reads like a branch
// here, and a --dry-run like a push; the read drops a branch that is not
// there, and an existing one shows its tip's runs.
export function pushedBranches(command: string, stdout: string): PushTarget[] {
  if (!GIT_PUSH.test(command)) return [];
  const found: PushTarget[] = [];
  let to: { host: string; repo: string } | null = null;
  for (const line of stdout.split('\n')) {
    if (/^To\s/.test(line)) {
      // A remote that is not on a host, such as a local path, names no repo.
      const remote = PUSH_TO.exec(line);
      to = remote ? { host: remote[1]!.toLowerCase(), repo: remote[2]! } : null;
      continue;
    }
    const dst = (PUSH_REF.exec(line) ?? PORCELAIN_REF.exec(line))?.[1];
    if (!dst || !to || (dst.startsWith('refs/') && !dst.startsWith('refs/heads/'))) continue;
    const branch = dst.replace(/^refs\/heads\//, '');
    const url = `https://${to.host}/${to.repo}/tree/${branch}`;
    if (!found.some((p) => p.host === to!.host && p.repo === to!.repo && p.branch === branch)) {
      found.push({ ...to, url, branch });
    }
  }
  return found;
}

// How toasts and errors name a watch.
export function labelOf(w: Pick<Watch, 'number' | 'push'>): string {
  return w.push ? `push ${w.push.branch}` : `#${w.number}`;
}

// A push whose branch could not be read once in the grace, such as one on a
// host gh does not know, leaves rather than staying an error.
export function isUnreadable(w: Watch, now: number): boolean {
  return w.push !== undefined && w.pull === undefined && now - w.push.pushedAt >= MERGE_GRACE_MS;
}

// Whether a line leaves with time alone: a merge or push that started no runs
// in its grace, a passed one past its stay, or a push never read.
export function isGone(w: Watch, estimates: Record<string, number>, now: number): boolean {
  if (isUnreadable(w, now)) return true;
  if (!w.pull) return false;
  const verdict = verdictOf(w.pull, estimates, w.host, w.checkedAt);
  return verdict.kind === 'closed' || isCleared(verdict, w.pull, w.checkedAt, now);
}

// A push follows its branch's runs as a merge follows its merge commit's.
export function pushedPull(branch: string, pushedAt: number, runs: Pull['mergeRuns']): Pull {
  return {
    number: 0,
    title: '',
    url: '',
    state: 'MERGED',
    isDraft: false,
    merge: 'UNKNOWN',
    review: null,
    workflows: [],
    isGated: false,
    isRequiredPending: false,
    isTruncated: false,
    base: branch,
    mergedAt: new Date(pushedAt).toISOString(),
    mergeRuns: runs,
    activity: [],
    activityAt: null,
  };
}

// Whether a command can start new runs or close a pull request, so the
// band should look again soon rather than at its next slow poll.
export function movesPulls(command: string): boolean {
  return MOVES_PR.test(command);
}
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export type Target = Pick<Watch, 'host' | 'repo' | 'number' | 'url'>;

// The pull request a `gh pr create` printed: the URL on its last line of its own.
export function createdPull(command: string, stdout: string): Target | null {
  if (!PR_CREATE.test(command)) return null;
  const m = [...stdout.matchAll(PR_URL)].at(-1);
  if (!m) return null;
  return { host: m[1]!.toLowerCase(), repo: m[2]!, number: Number(m[3]), url: m[0].trim() };
}

export function errorLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.replace(/^gh: /, '') || 'no message';
}

export type Verdict =
  | { kind: 'running'; gate: Workflow }
  | { kind: 'failing'; workflowId: number; workflow: string; job: string; url: string }
  | { kind: 'ready' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'waiting'; reason: string }
  | { kind: 'merged-running'; gate: Workflow }
  | { kind: 'merged-failing'; workflowId: number; workflow: string; job: string; url: string }
  | { kind: 'merged-passed' }
  | { kind: 'merged-waiting' }
  | { kind: 'closed' };

// How long a merged pull request waits for its merge commit's runs to start.
const MERGE_GRACE_MS = 90_000;

const gates = (w: Workflow) => w.jobs.some((j) => j.isRequired);
const failed = (conclusion: string | null) => FAILED.has(conclusion ?? '');

type Runs = Pick<Pull, 'workflows' | 'isGated'>;

// Whether the merge waits on this workflow: one holding a required check, or
// any when nothing on the commit is required.
function counts(runs: Runs): (w: Workflow) => boolean {
  return (w) => !runs.isGated || gates(w);
}

// The job that failed, not the summary job that failed on it.
function failure(runs: Runs): Verdict | null {
  const isCounted = counts(runs);
  for (const w of runs.workflows) {
    if (!isCounted(w)) continue;
    const bad = w.jobs.filter((j) => j.status === 'done' && failed(j.conclusion));
    const job = bad.find((j) => !j.isRequired) ?? bad[0];
    if (job) {
      const url = job.url || w.url;
      return { kind: 'failing', workflowId: w.id, workflow: w.name, job: job.name, url };
    }
  }
  return null;
}

// The running workflow the merge waits on longest.
function gateOf(running: Workflow[], estimates: Record<string, number>, host: string): Workflow {
  let longest = running[0]!;
  for (const w of running) {
    if (
      (estimates[estimateKey(host, w.id)] ?? 0) > (estimates[estimateKey(host, longest.id)] ?? 0)
    ) {
      longest = w;
    }
  }
  return longest;
}

export function estimateKey(host: string, workflowId: number): string {
  return `${host}/${workflowId}`;
}

// Null once every counted workflow has passed.
function runsVerdict(runs: Runs, estimates: Record<string, number>, host: string): Verdict | null {
  const fail = failure(runs);
  if (fail) return fail;
  const isCounted = counts(runs);
  const running = runs.workflows.filter((w) => w.status !== 'done' && isCounted(w));
  if (running.length > 0) return { kind: 'running', gate: gateOf(running, estimates, host) };
  return null;
}

// A merged pull request follows its merge commit's runs on the base branch,
// where nothing is required, so every workflow counts.
function mergedVerdict(
  pull: Pull,
  estimates: Record<string, number>,
  host: string,
  now: number,
): Verdict {
  const merged = pull.mergeRuns;
  if (!merged || merged.workflows.length === 0) {
    const since = pull.mergedAt ? now - Date.parse(pull.mergedAt) : Infinity;
    return since < MERGE_GRACE_MS ? { kind: 'merged-waiting' } : { kind: 'closed' };
  }
  const runs = runsVerdict({ workflows: merged.workflows, isGated: false }, estimates, host);
  if (runs?.kind === 'failing') return { ...runs, kind: 'merged-failing' };
  if (runs?.kind === 'running') return { ...runs, kind: 'merged-running' };
  return { kind: 'merged-passed' };
}

export function verdictOf(
  pull: Pull,
  estimates: Record<string, number>,
  host: string,
  now: number,
): Verdict {
  if (pull.state === 'MERGED') return mergedVerdict(pull, estimates, host, now);
  if (pull.state !== 'OPEN') return { kind: 'closed' };
  const runs = runsVerdict(pull, estimates, host);
  if (runs) return runs;
  if (pull.isDraft) return { kind: 'waiting', reason: 'draft' };
  if (pull.merge === 'DIRTY') return { kind: 'blocked', reason: 'conflicts' };
  if (pull.review === 'CHANGES_REQUESTED') return { kind: 'blocked', reason: 'changes requested' };
  if (pull.merge === 'BEHIND') return { kind: 'blocked', reason: 'behind base' };
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pull.merge)) return { kind: 'ready' };
  if (pull.merge === 'BLOCKED') {
    if (pull.review === 'REVIEW_REQUIRED') return { kind: 'waiting', reason: 'review' };
    // A required check outside any workflow, a GitHub App's, still running.
    if (pull.isRequiredPending) return { kind: 'waiting', reason: 'checks' };
    // Required checks GitHub has not yet started leave the merge blocked.
    if (pull.workflows.length === 0) return { kind: 'waiting', reason: 'checks to start' };
    return { kind: 'blocked', reason: 'blocked' };
  }
  // GitHub computes the merge state lazily and reports UNKNOWN until it has.
  return { kind: 'waiting', reason: 'checking' };
}

const PASSED_STAYS_MS = 5000;

// Every run on the merge commit passed, and the grace for a late one is over.
// A failed merge never settles: it is read until a re-run passes.
export function isSettled(verdict: Verdict, pull: Pull, now: number): boolean {
  if (verdict.kind !== 'merged-passed') return false;
  const isDone = pull.mergeRuns?.workflows.every((w) => w.status === 'done') ?? true;
  const since = pull.mergedAt ? now - Date.parse(pull.mergedAt) : Infinity;
  return isDone && since >= MERGE_GRACE_MS;
}

export function isCleared(verdict: Verdict, pull: Pull, checkedAt: number, now: number): boolean {
  return isSettled(verdict, pull, checkedAt) && now - checkedAt >= PASSED_STAYS_MS;
}

// Poll fast while something moves, slowly while it waits on a person. A
// workflow the merge does not wait on still moves the line's marks.
export function delayOf(verdict: Verdict, pull: Pull, now: number): number | null {
  if (verdict.kind === 'closed' || isSettled(verdict, pull, now)) return null;
  // A failed merge waits on someone to re-run it.
  if (verdict.kind === 'merged-failing') {
    return pull.mergeRuns?.workflows.every((w) => w.status === 'done') === false ? 10_000 : 60_000;
  }
  if (verdict.kind === 'running' || verdict.kind.startsWith('merged-')) return 10_000;
  if (pull.workflows.some((w) => w.status !== 'done')) return 10_000;
  if (verdict.kind === 'waiting' && verdict.reason !== 'review' && verdict.reason !== 'draft') {
    return 10_000;
  }
  return 60_000;
}

// What the line says, as a key: a new failure differs from an old one.
export function shownOf(verdict: Verdict): string {
  if (verdict.kind === 'failing' || verdict.kind === 'merged-failing') {
    return `${verdict.kind}:${JSON.stringify([verdict.workflow, verdict.job])}`;
  }
  return verdict.kind;
}

export function toastOf(
  label: string,
  verdict: Verdict,
  shown?: string,
  after = ' merged',
): string | null {
  if (shownOf(verdict) === shown) return null;
  if (verdict.kind === 'ready') return `${label} is ready to merge`;
  if (verdict.kind === 'failing') return `${label} ${verdict.workflow}: ${verdict.job} failed`;
  if (verdict.kind === 'merged-passed') return `${label}${after}: its checks passed`;
  if (verdict.kind === 'merged-failing') {
    return `${label}${after}: ${verdict.workflow}: ${verdict.job} failed`;
  }
  return null;
}

// Something Claude is told of once, for as long as it lasts.
type Condition = { key: string; text: string };

type Who = Pick<Watch, 'repo' | 'number' | 'push'>;

// A watch's own conditions carry it, so watches on the host can share what
// they told; a push's carries the push, its number being 0.
const keyOf = (watch: Who, what: string) =>
  JSON.stringify([
    watch.repo,
    watch.push ? [watch.push.branch, watch.push.pushedAt] : watch.number,
    what,
  ]);

// A ready or passed state, conflicts and requested changes whatever the checks
// say, and every failed job on the runs the line follows, gating or not, each
// as soon as it fails. A failure's key is its run's and job's own.
function conditionsOf(
  watch: Who,
  pull: Pull,
  verdict: Verdict,
  name: string,
  isEarly: boolean,
): Condition[] {
  const found: Condition[] = [];
  if (verdict.kind === 'ready') {
    found.push({ key: keyOf(watch, 'ready'), text: `GitHub reports ${name} ready to merge.` });
  }
  if (verdict.kind === 'merged-passed' && !isEarly) {
    const text = watch.push
      ? `The checks on ${name} passed.`
      : `${name} merged into ${pull.base}, and the merge commit's checks passed.`;
    found.push({ key: keyOf(watch, 'passed'), text });
  }
  if (pull.state === 'OPEN' && pull.merge === 'DIRTY') {
    const text = `${name} has merge conflicts with ${pull.base}.`;
    found.push({ key: keyOf(watch, 'conflicts'), text });
  }
  if (pull.state === 'OPEN' && pull.review === 'CHANGES_REQUESTED') {
    const text = `A reviewer requested changes on ${name}.`;
    found.push({ key: keyOf(watch, 'changes requested'), text });
  }
  const isMerged = verdict.kind.startsWith('merged-');
  const workflows = isMerged ? (pull.mergeRuns?.workflows ?? []) : pull.workflows;
  const where = isMerged && !watch.push ? ' on the merge commit' : '';
  for (const w of workflows) {
    for (const j of w.jobs) {
      if (j.status !== 'done' || !failed(j.conclusion)) continue;
      const url = j.url || w.url;
      const text = `${w.name}: ${j.name} failed${where} for ${name}: ${url}`;
      found.push({ key: JSON.stringify([w.id, w.url, j.name, url]), text });
    }
  }
  return found;
}

export type Memory = Pick<Watch, 'told' | 'heard'>;
export type Wake = { text: string | null; told: string[]; heard: Watch['heard'] };

// GitHub reports UNKNOWN while it recomputes the merge state.
export const isChecking = (verdict: Verdict) =>
  verdict.kind === 'waiting' && verdict.reason === 'checking';

// A comment's or review's identity; its time alone ties at the second.
const heardKey = (a: Activity) => a.url || JSON.stringify([a.author, a.at, a.did]);

// Enough to outlast an item leaving the 10-item window and coming back.
const HEARD_KEPT = 100;

// The comments and reviews not heard before, and what is heard after them. The
// first read hears what is there without telling it; a read that cannot tell
// whose they are hears nothing.
function hearOf(
  pull: Pull,
  heard: Watch['heard'],
  name: string,
): { heard: Watch['heard']; lines: string[] } {
  if (pull.activity === null) return { heard, lines: [] };
  const keys = pull.activity.map(heardKey);
  if (heard === undefined) return { heard: { since: pull.activityAt, keys }, lines: [] };
  // An unheard item older than the first read's newest slid into the window
  // when a newer one was deleted.
  const since = heard.since === null ? -Infinity : Date.parse(heard.since);
  const lines: string[] = [];
  for (const a of pull.activity) {
    if (heard.keys.includes(heardKey(a)) || Date.parse(a.at) < since) continue;
    lines.push(`@${a.author} ${a.did} ${name}: ${a.url}`);
  }
  const kept = [...new Set([...heard.keys, ...keys])].slice(-HEARD_KEPT);
  return { heard: { since: heard.since, keys: kept }, lines };
}

// What Claude is told unasked: each condition it has not been told of while it
// lasts, and each comment or review it has not heard. `isEarly` holds back a
// passed merge whose grace has not ended.
export function wakeOf(
  watch: Pick<Watch, 'repo' | 'number' | 'push' | 'url'>,
  pull: Pull,
  verdict: Verdict,
  last: Memory,
  isEarly = false,
): Wake {
  const name = watch.push
    ? `the push to ${watch.push.branch} on ${watch.repo}`
    : `${watch.repo}#${watch.number}`;
  const told = last.told ?? [];
  const news: string[] = [];
  const kept: string[] = [];
  for (const c of conditionsOf(watch, pull, verdict, name, isEarly)) {
    if (!told.includes(c.key)) news.push(c.text);
    kept.push(c.key);
  }
  // GitHub reports UNKNOWN while it recomputes the merge state; ready stands only
  // through a read that is otherwise ready, since a new run ends it.
  if (pull.state === 'OPEN' && pull.merge === 'UNKNOWN') {
    for (const what of isChecking(verdict) ? ['ready', 'conflicts'] : ['conflicts']) {
      const key = keyOf(watch, what);
      if (told.includes(key) && !kept.includes(key)) kept.push(key);
    }
  }
  const { heard, lines } = hearOf(pull, last.heard, name);
  news.push(...lines);
  if (news.length === 0) return { text: null, told: kept, heard };
  const text = [
    `pr-watch: ${news.join(' ')}`,
    `This is news from pr-watch, not a request to merge. ${watch.url}`,
  ].join('\n');
  return { text, told: kept, heard };
}

export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

// A bar `width` cells wide, filled to `fraction` in eighths of a cell.
export function barOf(fraction: number, width: number): { filled: string; rest: string } {
  const eighths = Math.round(Math.min(Math.max(fraction, 0), 1) * width * 8);
  const full = Math.floor(eighths / 8);
  const head = EIGHTHS[eighths % 8] ?? '';
  const filled = '█'.repeat(full) + head;
  return { filled, rest: '░'.repeat(width - full - (head ? 1 : 0)) };
}

export function markOf(w: Workflow): string {
  if (w.status !== 'done') return '●';
  return PASSED.has(w.conclusion ?? '') ? '✓' : '✗';
}

export type Segment = { text: string; color?: string; isDim?: boolean; url?: string };

const BAR_MAX = 24;
const BAR_MIN = 8;

function markSegment(w: Workflow): Segment {
  const mark = markOf(w);
  return {
    text: ` · ${w.name} ${mark}`,
    color: mark === '✗' ? 'red' : mark === '●' ? 'yellow' : undefined,
    isDim: mark === '✓',
  };
}

// One line of the band. A running gate whose length is known draws a bar that
// stops short of full until the run ends.
export function lineOf(
  watch: Watch,
  now: number,
  estimates: Record<string, number>,
  columns: number,
): Segment[] {
  const isPush = watch.push !== undefined;
  const title = isPush ? `⟳ ${labelOf(watch)}` : labelOf(watch);
  const label = { text: title, color: 'cyan', url: watch.url };
  const pull = watch.pull;
  if (!pull) {
    const why = watch.error ?? 'loading…';
    return [
      label,
      {
        text: ` ${why}`,
        isDim: watch.error === undefined,
        color: watch.error === undefined ? undefined : 'red',
      },
    ];
  }
  // The state is the last good read's; `now` only times the running clock.
  const v = verdictOf(pull, estimates, watch.host, watch.checkedAt);
  if (v.kind === 'closed') return [label, { text: ` ${pull.state.toLowerCase()}`, isDim: true }];
  // After a merge the line follows the merge commit's runs on the base branch.
  const isMerged = v.kind.startsWith('merged-');
  const none = { workflows: [], isTruncated: false };
  const runs = isMerged ? (pull.mergeRuns ?? none) : pull;
  // The branch is named up front, so a running line is not read as the PR's own CI.
  const after = { text: isPush ? ' ·' : ` merged into ${pull.base} ·`, isDim: true };
  const lead: Segment[] = isMerged ? [label, after] : [label];
  const tail: Segment[] = [];
  if (runs.isTruncated) tail.push({ text: ' · more checks not shown', isDim: true });
  if (watch.error !== undefined) tail.push({ text: ` · ${watch.error}`, color: 'red' });
  const isRunning = v.kind === 'running' || v.kind === 'merged-running';
  // Other workflows, while they run or once they failed; on a running line,
  // every other workflow.
  const others = (skip: number | null) =>
    runs.workflows
      .filter((w) => w.id !== skip && (isRunning || markOf(w) !== '✓'))
      .map((w) => markSegment(w));
  if (v.kind === 'ready') {
    return [...lead, { text: ' ✓ ready to merge', color: 'green' }, ...others(null), ...tail];
  }
  if (v.kind === 'merged-passed') {
    return [...lead, { text: ' ✓ checks passed', color: 'green' }, ...tail];
  }
  if (v.kind === 'merged-waiting') {
    return [...lead, { text: ' ○ waiting on checks', isDim: true }, ...tail];
  }
  if (v.kind === 'failing' || v.kind === 'merged-failing') {
    const text = ` ✗ ${v.workflow}: ${v.job} failed`;
    const reason = { text, color: 'red', url: v.url || undefined };
    return [...lead, reason, ...others(v.workflowId), ...tail];
  }
  if (v.kind === 'blocked') {
    return [...lead, { text: ` ⚠ ${v.reason}`, color: 'yellow' }, ...others(null), ...tail];
  }
  if (v.kind === 'waiting') {
    return [...lead, { text: ` ○ waiting on ${v.reason}`, isDim: true }, ...others(null), ...tail];
  }
  const gate = v.gate;
  const elapsed = now - Date.parse(gate.startedAt);
  const estimate = estimates[estimateKey(watch.host, gate.id)] ?? 0;
  const name = { text: ` ● ${gate.name} `, color: 'yellow', url: gate.url || undefined };
  const head = [...lead, name];
  if (gate.isRerun) return [...head, { text: 're-run', isDim: true }, ...others(gate.id), ...tail];
  if (estimate <= 0) {
    return [...head, { text: clockText(elapsed), isDim: true }, ...others(gate.id), ...tail];
  }
  const times = ` ${clockText(elapsed)} / ~${clockText(estimate)}`;
  const used = head.reduce((n, s) => n + s.text.length, 0) + times.length;
  const width = Math.max(BAR_MIN, Math.min(BAR_MAX, columns - used - 2));
  const bar = barOf(Math.min(elapsed / estimate, 0.97), width);
  return [
    ...head,
    { text: bar.filled, color: 'yellow' },
    { text: bar.rest, isDim: true },
    { text: times, isDim: true },
    ...others(gate.id),
    ...tail,
  ];
}
