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
  return pullAt(stdout);
}

// The pull request `gh pr view --json url,…` names, with the rest of its answer.
export function viewedPull(stdout: string): { target: Target; body: any } | null {
  let body: any;
  try {
    body = JSON.parse(stdout);
  } catch {
    return null;
  }
  const target = typeof body?.url === 'string' ? pullAt(body.url) : null;
  return target === null ? null : { target, body };
}

// How far GitHub's clock may run behind this machine's.
const MERGE_SKEW_MS = 2 * 60_000;

// 'stale' unless open (an --auto merge waits) or merged after the command
// started: a merge from before is not the one it ran, but a mention of it.
export function mergedPullOf(stdout: string, startedAt: number): Target | 'stale' | null {
  const viewed = viewedPull(stdout);
  if (viewed === null) return null;
  const { target, body } = viewed;
  if (body.state === 'OPEN') return target;
  const at = typeof body.mergedAt === 'string' ? Date.parse(body.mergedAt) : Number.NaN;
  return body.state === 'MERGED' && at >= startedAt - MERGE_SKEW_MS ? target : 'stale';
}

// The pull request a URL names: one line holding only the URL.
export function pullAt(text: string): Target | null {
  const m = [...text.matchAll(PR_URL)].at(-1);
  if (!m) return null;
  return { host: m[1]!.toLowerCase(), repo: m[2]!, number: Number(m[3]), url: m[0].trim() };
}

// gh pr merge's options that take a value, long and short.
const MERGE_VALUED = new Set([
  '--body',
  '--body-file',
  '--subject',
  '--author-email',
  '--match-head-commit',
  '--repo',
]);
const MERGE_VALUED_SHORT = new Set(['b', 'F', 't', 'A', 'R']);
// A command before the merge that moves it to another repository, where gh
// resolves the pull request it names; a checkout does not change that.
const MOVES_REPO = new RegExp(String.raw`${START}(?:cd|pushd|popd)\b`);

// The words of the command `text` starts, quotes removed, up to the first
// separator or comment outside them: enough for gh's arguments, not a shell
// parser.
function wordsOf(text: string): string[] {
  const words: string[] = [];
  const unbroken = text.replaceAll('\\\n', ' ');
  for (const m of unbroken.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|([;&|\n#])|([^\s;&|'"]+)/g)) {
    if (m[3] !== undefined) break;
    words.push(m[1] ?? m[2]?.replaceAll(/\\(.)/g, '$1') ?? m[4]!);
  }
  return words;
}

export type Merging = { pull: string; repo: string | null };

// Null for a bare merge: after --delete-branch, or on a fork's branch, nothing
// names its pull request. Null too where pr-watch cannot follow the merge:
// after a cd in the same line, or on another GH_HOST.
export function mergingPull(command: string): Merging | null {
  const at = new RegExp(String.raw`${START}gh\s+pr\s+merge\b`).exec(command);
  if (!at || MOVES_REPO.test(command.slice(0, at.index)) || /\bGH_HOST=/.test(at[0])) {
    return null;
  }
  const env = /\bGH_REPO=(\S+)/.exec(at[0])?.[1];
  let repo = env === undefined ? null : (wordsOf(env)[0] ?? null);
  let pull: string | null = null;
  const words = wordsOf(command.slice(at.index + at[0].length));
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (word === '--help' || word === '--disable-auto') return null;
    // A redirection, with its target when that is the next word.
    if (/^\d*(?:>>?|<)/.test(word)) {
      if (/^\d*(?:>>?|<)$/.test(word)) i += 1;
      continue;
    }
    let flag: string | null = null;
    let value: string | undefined;
    if (word.startsWith('--')) {
      const [name, inline] = word.split(/=(.*)/s, 2);
      if (MERGE_VALUED.has(name!)) [flag, value] = [name!, inline];
    } else if (/^-[A-Za-z]/.test(word)) {
      // Short options group, and a valued one takes the rest of the word:
      // -dR o/r, -Ro/r, -R=o/r.
      for (let j = 1; j < word.length; j += 1) {
        const letter = word[j]!;
        if (letter === 'h') return null;
        if (MERGE_VALUED_SHORT.has(letter)) {
          flag = `-${letter}`;
          value = word.slice(j + 1).replace(/^=/, '') || undefined;
          break;
        }
      }
    }
    if (flag !== null) {
      value ??= words[(i += 1)];
      if (flag === '-R' || flag === '--repo') repo = value ?? null;
      continue;
    }
    if (!word.startsWith('-') && pull === null) pull = word;
  }
  return pull === null ? null : { pull, repo };
}

// The 5,000 points an hour are shared with every gh call the user and Claude
// make, so pr-watch backs off before they run out.
export const LOW_QUOTA_MS = 60_000;
const LOW_QUOTA_SHARE = 0.1;

export function isQuotaLow(q: { remaining: number; limit: number } | undefined): boolean {
  return q !== undefined && q.remaining < q.limit * LOW_QUOTA_SHARE;
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

// Merged inside the grace in which its runs may not have started.
export function isMergeFresh(pull: Pick<Pull, 'mergedAt'>, now: number): boolean {
  return pull.mergedAt !== null && now - Date.parse(pull.mergedAt) < MERGE_GRACE_MS;
}

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
// say, and every failing run the line follows, gating or not, as soon as a job
// in it fails. A run is told once, by its first failed jobs: later ones, a
// summary job among them, are news Claude finds in the run it was sent to.
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
    const bad = w.jobs.filter((j) => j.status === 'done' && failed(j.conclusion));
    if (bad.length === 0) continue;
    const jobs = bad.map((j) => j.name).join(', ');
    const log = bad[0]!.url || w.url;
    const run = w.url && w.url !== log ? `; the run: ${w.url}` : '';
    const text = `${w.name}: ${jobs} failed${where} for ${name}: ${log}${run}`;
    found.push({ key: JSON.stringify([w.id, w.url, w.attempt]), text });
  }
  return found;
}

export type Memory = Pick<Watch, 'told' | 'heard'>;
export type Wake = { text: string | null; told: string[]; heard: Watch['heard'] };

// With waking off nothing new counts as told, so what lasts is told once it is
// on again, while what ends is let go, so its return is news.
export function toldAfter(now: string[], before: string[] | undefined, isAwake: boolean): string[] {
  return isAwake ? now : now.filter((key) => (before ?? []).includes(key));
}

// GitHub reports UNKNOWN while it recomputes the merge state.
export const isChecking = (verdict: Verdict) =>
  verdict.kind === 'waiting' && verdict.reason === 'checking';

// A comment's or review's identity; its time alone ties at the second.
const heardKey = (a: Activity) => a.url || JSON.stringify([a.author, a.at, a.did]);

// Enough to outlast an item leaving the 10-item window and coming back.
const HEARD_KEPT = 100;

// t3code stops a watch after 10 comment-only wakes in a row; this stops the
// comments alone.
export const QUIET_CAP = 10;

// The comments and reviews not heard before, and what is heard after them. The
// first read hears what is there without telling it; a read that cannot tell
// whose they are hears nothing.
function hearOf(
  pull: Pull,
  heard: Watch['heard'],
  name: string,
  tells: (a: Activity) => boolean,
): { heard: Watch['heard']; lines: string[] } {
  if (pull.activity === null) return { heard, lines: [] };
  const keys = pull.activity.map(heardKey);
  if (heard === undefined) return { heard: { since: pull.activityAt, keys }, lines: [] };
  // An unheard item older than the first read's newest slid into the window
  // when a newer one was deleted.
  const since = heard.since === null ? -Infinity : Date.parse(heard.since);
  const lines: string[] = [];
  for (const a of pull.activity) {
    if (heard.keys.includes(heardKey(a)) || Date.parse(a.at) < since || !tells(a)) continue;
    lines.push(`@${a.author} ${a.did} ${name}: ${a.url}`);
  }
  const kept = [...new Set([...heard.keys, ...keys])].slice(-HEARD_KEPT);
  return { heard: { since: heard.since, keys: kept }, lines };
}

const WAKE_SETTINGS = ['off', 'checks', 'checks and comments'] as const;
const BOT_SETTINGS = ['never', 'reviews', 'comments and reviews'] as const;
export type WakeSetting = (typeof WAKE_SETTINGS)[number];
export type BotSetting = (typeof BOT_SETTINGS)[number];

// The two /config settings as plugin.json declares them, each its default when unset.
export function settingsOf(options: Record<string, unknown>): {
  wake: WakeSetting;
  bots: BotSetting;
} {
  const wake = WAKE_SETTINGS.find((s) => s === options.wake) ?? 'checks and comments';
  const bots = BOT_SETTINGS.find((s) => s === options.botComments) ?? 'never';
  return { wake, bots };
}

// Which comments and reviews are told, by the two /config settings. Those not
// told are still heard, so a later change of setting reports no history.
export function tellsOf(wake: WakeSetting, bots: BotSetting): (a: Activity) => boolean {
  if (wake !== 'checks and comments') return () => false;
  if (bots === 'comments and reviews') return () => true;
  if (bots === 'reviews') return (a) => !a.isBot || a.isReview;
  return (a) => !a.isBot;
}

const PEOPLE_ONLY = tellsOf('checks and comments', 'never');

// What Claude is told unasked: each condition it has not been told of while it
// lasts, and each comment or review it has not heard that `tells` lets through.
// `isEarly` holds back a passed merge whose grace has not ended.
export function wakeOf(
  watch: Pick<Watch, 'repo' | 'number' | 'push' | 'url'>,
  pull: Pull,
  verdict: Verdict,
  last: Memory,
  { isEarly = false, tells = PEOPLE_ONLY } = {},
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
  const { heard: next, lines } = hearOf(pull, last.heard, name, tells);
  // So a chatty bot or thread cannot keep waking Claude, comments and reviews
  // stop after QUIET_CAP wakes in a row of nothing else, until other news comes.
  const before = last.heard?.streak ?? 0;
  const streak = news.length > 0 ? 0 : lines.length > 0 ? before + 1 : before;
  if (streak <= QUIET_CAP) news.push(...lines);
  if (lines.length > 0 && streak === QUIET_CAP) {
    news.push(
      `pr-watch will tell you of no more comments or reviews on ${name} until other news comes.`,
    );
  }
  const heard = next && { since: next.since, keys: next.keys, ...(streak > 0 && { streak }) };
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
