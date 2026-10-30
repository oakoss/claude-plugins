// What the band says about a pull request, and when to look again. Pure.
import type { Activity, Commit, Held, Job, Pull, Runs, Stack, Watch, Workflow } from '../types';
import type { Quota } from './github';

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const PR_URL = new RegExp(
  `^https://(${LABEL}(?:\\.${LABEL})*)/([\\w-][\\w.-]*/[\\w-][\\w.-]*)/pull/([1-9]\\d{0,9})\\s*$`,
  'gm',
);
// The start of a command: the line's, or after a shell separator, with any
// leading VAR=value assignments.
const START = String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*`;
const PR_CREATE = new RegExp(String.raw`${START}gh\s+pr\s+create\b`);
const STACK_SUBMIT = new RegExp(String.raw`${START}gh\s+stack\s+submit\b`);
// What can add, drop or merge a stack's layers.
const STACK_CHANGE = new RegExp(
  String.raw`${START}gh\s+stack\s+(?:init|add|submit|push|sync|merge|modify|unstack|delete|link)\b`,
);
// gh stack submit's line for each pull request it opened, after its success mark.
const SUBMIT_CREATED = /^(?:✓ )?Created PR #\d+ \((\S+)\) for \S+\s*$/gm;
// git's own options may come before the subcommand: -C dir, -c key=value, --flag.
const MOVES_PR = new RegExp(
  String.raw`${START}(?:git(?:\s+(?:-[Cc]\s+\S+|--\S+))*\s+push\b|gh\s+pr\s+merge\b|gh\s+run\s+rerun\b|gh\s+workflow\s+run\b|gh\s+stack\s+(?:submit|push|sync|merge)\b)`,
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

// How the band, toasts and errors name a watch: "release #259" tells a
// release tool's version pull request from the others.
export function labelOf(w: Pick<Watch, 'number' | 'push' | 'pull'>): string {
  if (w.push) return `push ${w.push.branch}`;
  return w.pull !== undefined && isReleasePull(w.pull) ? `release #${w.number}` : `#${w.number}`;
}

// GitHub refusing the token or hiding the repository; other hosts answer 404,
// 405 or a GraphQL schema error. GraphQL states an organization's or a token's
// refusal in its message, with no HTTP status.
const REFUSED = new RegExp(
  [
    String.raw`\bHTTP 40[13]\b`,
    'Could not resolve to a Repository',
    'Resource protected by organization SAML enforcement',
    'Resource not accessible by',
    'Although you appear to have the correct authorization credentials',
    'has not been granted the required scopes',
  ].join('|'),
);

// gh prints the same login prompt for every host, so only github.com's is GitHub's refusal.
export function isRefused(error: string, host: string): boolean {
  return REFUSED.test(error) || (host === 'github.com' && /\bgh auth login\b/.test(error));
}

// A push unread in the grace, such as one on a host gh does not know, leaves
// quietly; one GitHub refused gives up and says so, as a pull request does.
export function isUnreadable(w: Watch, now: number): boolean {
  return (
    w.push !== undefined &&
    w.pull === undefined &&
    !w.refused &&
    now - w.push.pushedAt >= MERGE_GRACE_MS
  );
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
export function pushedPull(branch: string, pushedAt: number, runs: Runs | null): Pull {
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

// The pull requests a `gh stack submit` opened, bottom layer first.
export function submittedPulls(command: string, stdout: string): Target[] {
  if (!STACK_SUBMIT.test(command)) return [];
  return [...stdout.matchAll(SUBMIT_CREATED)].flatMap((m) => pullAt(m[1]!) ?? []);
}

// After one, every watched pull request's stack is asked again.
export function changesStacks(command: string): boolean {
  return STACK_CHANGE.test(command);
}

export type Layered = Pick<Pull, 'stack' | 'stackAt' | 'stackMerged'>;

const STACK_STALE_MS = 10 * 60_000;

// Whether to ask GitHub's stacks API again, given the last answer and when a
// `gh stack` command last ran. A merged layer's trunk is fixed by an answer
// from a read that saw it merged, which no clock skew can fake; an open one's
// stack can change with any such command, or from elsewhere.
export function needsStack(
  was: Layered | undefined,
  isMerged: boolean,
  now: number,
  changedAt: number,
): boolean {
  if (was?.stack === undefined) return true;
  if (isMerged) return was.stackMerged !== true;
  const at = was.stackAt ?? 0;
  return at <= changedAt || now - at >= STACK_STALE_MS;
}

// The stack a read leaves. No answer keeps the last, to be asked again; no
// stacks API, or no access to it, answers as no stack, but leaves one known.
export function layeredOf(
  was: Layered | undefined,
  answer: Stack | null | 'unreadable' | undefined,
  isMerged: boolean,
  now: number,
): Layered {
  if (answer === undefined) {
    return { stack: was?.stack, stackAt: was?.stackAt, stackMerged: was?.stackMerged };
  }
  const stack = answer === 'unreadable' ? (was?.stack ?? null) : answer;
  return { stack, stackAt: now, stackMerged: isMerged };
}

// The nearest open layer below this one that is not ready, or null; `of` is 0
// when its place is not yet known. A stack merge of a layer merges the open
// layers below it, while GitHub reports each layer ready by itself. A layer
// whose base is the trunk has none open below; one not watched, and not
// reported merged, counts as not ready.
export function belowOf(
  w: Pick<Watch, 'host' | 'repo' | 'number'>,
  pull: Pull,
  all: readonly Watch[],
  estimates: Record<string, number>,
): { at: number; of: number } | null {
  const near = (x: Watch) => !x.push && x.host === w.host && x.repo === w.repo;
  const isReady = (x: Watch | undefined) =>
    x?.pull?.state === 'OPEN' && verdictOf(x.pull, estimates, x.host, x.checkedAt).kind === 'ready';
  const { stack } = pull;
  // Until the stacks API answers, a watched pull request this one is based on
  // stands for the layer below.
  if (stack === undefined) {
    const under = all.find(
      (x) => near(x) && x.pull?.head?.branch === pull.base && x.pull.head.repo === w.repo,
    );
    return under?.pull?.state === 'OPEN' && !isReady(under) ? { at: 0, of: 0 } : null;
  }
  if (stack === null || pull.base === stack.trunk) return null;
  const at = stack.layers.indexOf(w.number);
  for (let i = at - 1; i >= 0; i--) {
    const n = stack.layers[i];
    if (n === undefined || stack.merged?.includes(n)) continue;
    const lower = all.find((x) => near(x) && x.number === n);
    if (lower?.pull?.state === 'MERGED') continue;
    if (!isReady(lower)) return { at: i + 1, of: stack.layers.length };
    // A ready layer based on the trunk has every layer under it merged, even
    // where this one's stack list is older than that merge.
    if (lower?.pull?.base === stack.trunk) return null;
  }
  return null;
}

// A layer's place in its stack, numbered from the bottom as GitHub's badge is;
// null for a lane.
export function layerOf(watch: Watch): { stack: number; at: number; of: number } | null {
  const stack = watch.pull?.stack;
  const at = stack ? stack.layers.indexOf(watch.number) + 1 : 0;
  if (!stack || at === 0) return null;
  return { stack: stack.number, at, of: stack.layers.length };
}

function stackKeyOf(w: Watch): string | null {
  const layer = layerOf(w);
  return layer === null ? null : `${w.host}/${w.repo}#${layer.stack}`;
}

// Each stack's lines together, top layer first, where its first line was;
// lanes keep their place.
export function orderedOf(list: readonly Watch[]): Watch[] {
  const placed = new Set<string>();
  return list.flatMap((w) => {
    const key = stackKeyOf(w);
    if (key === null) return [w];
    if (placed.has(key)) return [];
    placed.add(key);
    return list
      .filter((other) => stackKeyOf(other) === key)
      .toSorted((a, b) => layerOf(b)!.at - layerOf(a)!.at);
  });
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

export function isQuotaLow(q: Pick<Quota, 'remaining' | 'limit'> | undefined): boolean {
  return q !== undefined && q.remaining < q.limit * LOW_QUOTA_SHARE;
}

// GitHub's words for a primary or secondary limit, and the status a secondary
// one may answer with; its docs name no exact wording.
const LIMITED = /rate limit (?:already )?exceeded|secondary rate limit|\bHTTP 429\b/i;

// gh prints a GraphQL answer's body on stdout and its first message on stderr.
export function isRateLimited(stdout: string, stderr: string): boolean {
  if (LIMITED.test(stderr)) return true;
  try {
    const errors: unknown = JSON.parse(stdout)?.errors;
    return (
      Array.isArray(errors) &&
      errors.some((e) => e?.type === 'RATE_LIMITED' || LIMITED.test(String(e?.message)))
    );
  } catch {
    return false;
  }
}

// GitHub asks for at least a minute's wait on a secondary limit, longer each time.
const PAUSE_FIRST_MS = 60_000;
const PAUSE_MAX_MS = 15 * 60_000;

export type Pause = { until: number; backoff: number };

// A spent quota waits for its reset; any other limit, a secondary one, waits
// longer each time it is hit again.
export function pauseOf(q: Quota | undefined, last: Pause | undefined, now: number): Pause {
  const backoff = last ? Math.min(last.backoff * 2, PAUSE_MAX_MS) : PAUSE_FIRST_MS;
  const reset = q && q.remaining <= 0 ? Date.parse(q.resetAt) : Number.NaN;
  return { until: reset > now ? reset : now + backoff, backoff };
}

export function untilText(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// gh exits 1 for these as for a 404, so only its words tell them apart.
const UNREACHABLE =
  /error connecting to |check your internet connection|TLS handshake timeout|i\/o timeout|connection (?:refused|reset)|no such host|network is unreachable|(?:unexpected|:) EOF\b|context deadline exceeded|Client\.Timeout|\bHTTP 50[234]\b/i;

export function isNetworkError(stderr: string): boolean {
  return UNREACHABLE.test(stderr);
}

// How long out of reach before someone is told: GIVE_UP_AFTER failed reads' worth.
export const OFFLINE_TELL_MS = 15 * 60_000;

// Soon enough to notice a laptop back online; never given up on.
const OFFLINE_FIRST_MS = 15_000;
const OFFLINE_MAX_MS = 60_000;

export function offlineDelayOf(count: number): number {
  return Math.min(OFFLINE_FIRST_MS * 2 ** Math.max(count - 1, 0), OFFLINE_MAX_MS);
}

// One unreachable read is a blip, kept quiet.
const OFFLINE_NOTE_AFTER = 2;

// Reads that fail for any other reason are retried less often each time, and
// after GIVE_UP_AFTER in a row, some 15 minutes, the watch ends.
export const GIVE_UP_AFTER = 8;
const RETRY_MAX_MS = 5 * 60_000;

export function retryDelayOf(failures: number): number {
  return Math.min(10_000 * 2 ** Math.max(failures - 1, 0), RETRY_MAX_MS);
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

type Gated = Pick<Pull, 'workflows' | 'isGated'>;

// Whether the merge waits on this workflow: one holding a required check, or
// any when nothing on the commit is required.
function counts(runs: Gated): (w: Workflow) => boolean {
  return (w) => !runs.isGated || gates(w);
}

// The job that failed, not the summary job that failed on it.
function failure(runs: Gated): Verdict | null {
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

export function rerunKey(host: string, runId: number, attempt: number): string {
  return `${host}/run/${runId}/${attempt}`;
}

const JOB_NAME_MAX = 24;

const isQueued = (j: Job) => j.status === 'queued';

const clip = (name: string) =>
  name.length > JOB_NAME_MAX ? `${name.slice(0, JOB_NAME_MAX - 1)}…` : name;

// A running gate's name, with what it still waits on once some of its jobs
// are done: up to two names, else a count. `queued` covers GitHub's queued,
// waiting and pending alike, since none of them has started.
function gateTextOf(gate: Workflow): string {
  const name = gate.isRerun ? `${gate.name} re-run` : gate.name;
  const left = gate.jobs.filter((j) => j.status !== 'done');
  const allQueued = left.length > 0 && left.every((j) => isQueued(j)) ? ' queued' : '';
  if (left.length === 0 || left.length === gate.jobs.length) return `${name}${allQueued}`;
  if (left.length > 2) return `${name}: ${left.length} jobs${allQueued}`;
  const names = left.map((j) => `${clip(j.name)}${isQueued(j) ? ' queued' : ''}`);
  return `${name}: ${names.join(', ')}`;
}

// Null once every counted workflow has passed.
function runsVerdict(runs: Gated, estimates: Record<string, number>, host: string): Verdict | null {
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

const isFailedRun = (w: Workflow) => w.status === 'done' && failed(w.conclusion);

// A push to the trunk runs CI on its newest commit only, so a merge commit
// landed beneath another, as a stack's lower layer is, never gets runs.
export function needsTrunk(pull: Pull, now: number): boolean {
  const runs = pull.mergeRuns;
  if (pull.state !== 'MERGED' || !runs || pull.mergeOid === undefined) return false;
  // Outside a stack, a merge commit with no runs was skipped on purpose, as by
  // a path filter, and a later commit's runs are someone else's.
  if (runs.workflows.length === 0)
    return typeof pull.stack?.trunk === 'string' && !isMergeFresh(pull, now);
  return runs.workflows.some(isFailedRun);
}

// `trunk` is newest first, in git log order, so a commit above the merge
// commit holds it only when the merge commit is among its ancestors there.
export function followTrunk(pull: Pull, trunk: readonly Commit[]): Pull {
  const at = trunk.findIndex((c) => c.oid === pull.mergeOid);
  if (at === -1) return pull;
  // The merge commit heads the chain with its own read's runs, which see 100
  // check suites to the trunk read's 20.
  const merge = { ...trunk[at]!, runs: pull.mergeRuns ?? { workflows: [], isTruncated: false } };
  const chain: Commit[] = [merge];
  const holds = new Set([merge.oid]);
  for (const c of trunk.slice(0, at).toReversed()) {
    if (!c.parents.some((p) => holds.has(p))) continue;
    holds.add(c.oid);
    chain.push(c);
  }
  const base = chain.findIndex((c) => c.runs.workflows.length > 0);
  if (base === -1) return pull;
  const { runs } = chain[base]!;
  const newer = chain.slice(base + 1).flatMap((c) => c.runs.workflows);
  const since: string[] = [];
  const workflows = runs.workflows.map((w) => {
    if (!isFailedRun(w)) return w;
    // A skipped run, as from an `if:` on every job, passed nothing.
    const last = newer.findLast(
      (n) => n.id === w.id && n.status === 'done' && n.conclusion !== 'SKIPPED',
    );
    if (!last || !PASSED.has(last.conclusion ?? '')) return w;
    since.push(w.name);
    return last;
  });
  if (base === 0 && since.length === 0) return pull;
  return { ...pull, mergeRuns: { ...runs, workflows }, followed: { isLater: base > 0, since } };
}

// What stops a merge on the pull request itself; a draft's line says it too.
function blockerOf(pull: Pull): string | null {
  if (pull.merge === 'DIRTY') return 'conflicts';
  if (pull.review === 'CHANGES_REQUESTED') return 'changes requested';
  if (pull.merge === 'BEHIND') return 'behind base';
  return null;
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
  const blocker = blockerOf(pull);
  if (blocker !== null) return { kind: 'blocked', reason: blocker };
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pull.merge)) {
    const { below } = pull;
    if (below) {
      const reason = below.of === 0 ? 'layer below' : `layer ${below.at}/${below.of}`;
      return { kind: 'waiting', reason };
    }
    return { kind: 'ready' };
  }
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
// A failed merge settles once a re-run, or a later run on the trunk, passes.
export function isSettled(verdict: Verdict, pull: Pull, now: number): boolean {
  if (verdict.kind !== 'merged-passed') return false;
  const isDone = pull.mergeRuns?.workflows.every((w) => w.status === 'done') ?? true;
  const since = pull.mergedAt ? now - Date.parse(pull.mergedAt) : Infinity;
  return isDone && since >= MERGE_GRACE_MS;
}

export function isCleared(verdict: Verdict, pull: Pull, checkedAt: number, now: number): boolean {
  return isSettled(verdict, pull, checkedAt) && now - checkedAt >= PASSED_STAYS_MS;
}

// A line that has waited on a person this long is read every STILL_MS.
const STILL_AFTER_MS = 30 * 60_000;
const STILL_MS = 5 * 60_000;

// Poll fast while something moves, slowly while it waits on a person, and
// slower once the line has said the same for half an hour. A workflow the
// merge does not wait on still moves the line's marks.
export function delayOf(verdict: Verdict, pull: Pull, now: number, shownAt = now): number | null {
  if (verdict.kind === 'closed' || isSettled(verdict, pull, now)) return null;
  const slow = now - shownAt >= STILL_AFTER_MS ? STILL_MS : 60_000;
  // A failed merge waits on someone to re-run it.
  if (verdict.kind === 'merged-failing') {
    return pull.mergeRuns?.workflows.every((w) => w.status === 'done') === false ? 10_000 : slow;
  }
  if (verdict.kind === 'running' || verdict.kind.startsWith('merged-')) return 10_000;
  if (pull.workflows.some((w) => w.status !== 'done')) return 10_000;
  // A layer waiting on one below changes when that one's read does.
  const isPerson = ['review', 'draft'].includes(verdict.kind === 'waiting' ? verdict.reason : '');
  if (verdict.kind === 'waiting' && !isPerson && !verdict.reason.startsWith('layer')) {
    return 10_000;
  }
  return slow;
}

// An open pull request takes the row of the push line of its head branch,
// with what Claude was told of that push, so the two lines do not stack. Only
// within one repository: a fork's push is handed over by its own read, which
// knows the fork's parent. One unwatched during its read takes nothing over.
export function takeOverPush(all: readonly Watch[], pr: Watch): Watch[] {
  const head = pr.pull?.head;
  if (pr.push || pr.pull?.state !== 'OPEN' || !head || !all.includes(pr)) return [...all];
  const repo = pr.repo.toLowerCase();
  const at = all.findIndex(
    (w) =>
      w.push?.branch === head.branch &&
      w.host === pr.host &&
      w.repo.toLowerCase() === repo &&
      head.repo.toLowerCase() === repo,
  );
  const push = all[at];
  if (!push) return [...all];
  const told = [...new Set([...(pr.told ?? []), ...(push.told ?? [])])];
  const moved = told.length === 0 ? pr : { ...pr, told };
  return all.flatMap((w, i) => (i === at ? [moved] : w === pr ? [] : [w]));
}

// What the line says, as a key: a new failure differs from an old one.
export function shownOf(verdict: Verdict): string {
  if (verdict.kind === 'failing' || verdict.kind === 'merged-failing') {
    return `${verdict.kind}:${JSON.stringify([verdict.workflow, verdict.job])}`;
  }
  return verdict.kind;
}

// The commit a merged line's runs came from.
const commitOf = (followed: Pull['followed']) =>
  followed?.isLater ? 'a later commit' : 'the merge commit';

function passedOn({ followed, base }: Pull): string {
  if (followed?.since.length) {
    return `${followed.since.join(', ')} failed on ${commitOf(followed)} and since passed on ${base}`;
  }
  return followed?.isLater
    ? `a later commit's checks on ${base} passed`
    : "the merge commit's checks passed";
}

// A release tool's version pull request (oakum's, Changesets'), whose merge is
// the release.
export function isReleasePull(pull: Pick<Pull, 'head'>): boolean {
  const branch = pull.head?.branch ?? '';
  return /(^|\/)version-packages$/.test(branch) || branch.startsWith('changeset-release/');
}

// The workflows still running on a ready pull request, which the merge does
// not wait on, since it is ready only once every one it waits on is done.
export function stillRunning(pull: Pick<Pull, 'workflows'>): string[] {
  return [...new Set(pull.workflows.filter((w) => w.status !== 'done').map((w) => w.name))];
}

export function toastOf(
  label: string,
  verdict: Verdict,
  shown?: string,
  after = ' merged',
  running: string[] = [],
): string | null {
  if (shownOf(verdict) === shown) return null;
  if (verdict.kind === 'ready') {
    const note = running.length === 0 ? '' : `; ${running.join(', ')} still running, not required`;
    return `${label} is ready to merge${note}`;
  }
  if (verdict.kind === 'failing') return `${label} ${verdict.workflow}: ${verdict.job} failed`;
  if (verdict.kind === 'merged-passed') return `${label}${after}: its checks passed`;
  if (verdict.kind === 'merged-failing') {
    return `${label}${after}: ${verdict.workflow}: ${verdict.job} failed`;
  }
  return null;
}

// Something Claude is told of once, for as long as it lasts. A passed one is
// news Claude cannot act on, so it never wakes Claude.
type Condition = { key: string; text: string; isPassed?: true };

type Who = Pick<Watch, 'repo' | 'number' | 'push'>;

// A watch's own conditions carry it, so watches on the host can share what
// they told; a push's carries the push, its number being 0.
const keyOf = (watch: Who, what: string) =>
  JSON.stringify([
    watch.repo,
    watch.push ? [watch.push.branch, watch.push.pushedAt] : watch.number,
    what,
  ]);

export const isToldReady = (watch: Who & Pick<Watch, 'told'>) =>
  (watch.told ?? []).includes(keyOf(watch, 'ready'));

// A pull request a session watched, as saved for its resume.
export type Saved = Pick<Watch, 'host' | 'repo' | 'number' | 'url' | 'heard'> & {
  told: string[];
};
// One session's entry in the store, under its own key, so sessions never
// write over each other.
export type Entry = { at: number; pulls: Saved[] };

export const SESSION_PREFIX = 'session:';
// The sessions a store keeps watches for; more than this drops the oldest.
export const SESSIONS_KEPT = 20;

// The ids of watches whose ready line, or passed checks, wait undelivered.
export type Pending = { ready: ReadonlySet<string>; passed: ReadonlySet<string> };

// The pull requests to watch again on a resume. A push is not: its line lasts
// only past its checks. A ready or passed line still waiting to be delivered
// is lost with the exit, so it counts as untold and the first read after the
// resume tells it again; one Claude was told stays told.
export function savedOf(
  watches: readonly Watch[],
  pending: Pending,
  idOf: (w: Watch) => string,
): Saved[] {
  return watches.flatMap((w) => {
    if (w.push) return [];
    const id = idOf(w);
    const quiet = new Set([
      ...(pending.ready.has(id) ? [keyOf(w, 'ready')] : []),
      ...(pending.passed.has(id) ? [keyOf(w, 'passed')] : []),
    ]);
    const told = (w.told ?? []).filter((k) => !quiet.has(k));
    const { host, repo, number, url, heard } = w;
    return [{ host, repo, number, url, told, ...(heard && { heard }) }];
  });
}

const strings = (xs: unknown): string[] =>
  Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [];

// One saved pull request rebuilt from what the store holds, or null when it
// does not name one: the store is a file on disk, so nothing else is trusted.
export function savedFrom(p: unknown): Saved | null {
  const { host, repo, number, told, heard } = (p ?? {}) as Record<string, unknown>;
  if (typeof host !== 'string' || typeof repo !== 'string') return null;
  if (!Number.isSafeInteger(number) || (number as number) <= 0) return null;
  const h: { since?: unknown; keys?: unknown; streak?: unknown } | null =
    typeof heard === 'object' ? heard : null;
  const isHeard =
    h !== null && Array.isArray(h.keys) && (h.since === null || typeof h.since === 'string');
  const streak = isHeard && Number.isSafeInteger(h.streak) && (h.streak as number) > 0;
  return {
    host,
    repo,
    number: number as number,
    url: `https://${host}/${repo}/pull/${number}`,
    told: strings(told),
    ...(isHeard && {
      heard: {
        since: h.since as string | null,
        keys: strings(h.keys),
        ...(streak && { streak: h.streak as number }),
      },
    }),
  };
}

// A session's entry as the store holds it: the pull requests it names, and
// how many entries could not be read.
export function entryOf(stored: unknown): { pulls: Saved[]; skipped: number } {
  const pulls = (stored as { pulls?: unknown } | null)?.pulls;
  if (!Array.isArray(pulls)) return { pulls: [], skipped: stored === undefined ? 0 : 1 };
  const read = pulls.map((p) => savedFrom(p));
  const found = read.filter((p): p is Saved => p !== null);
  return { pulls: found, skipped: read.length - found.length };
}

const atOf = (v: unknown) => {
  const t = (v as { at?: unknown } | null)?.at;
  return typeof t === 'number' && Number.isFinite(t) ? t : -Infinity;
};

// The session keys past the newest SESSIONS_KEPT, oldest first; an entry with
// no readable time counts as the oldest.
export function prunedOf(entries: readonly (readonly [string, unknown])[]): string[] {
  return entries
    .toSorted(([, a], [, b]) => atOf(b) - atOf(a))
    .slice(SESSIONS_KEPT)
    .map(([key]) => key);
}

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
    const running = stillRunning(pull);
    // Said as of this read, since held news may reach Claude after they finish.
    const note =
      running.length === 0
        ? ''
        : ` When pr-watch read it, ${running.join(', ')} ${running.length === 1 ? 'was' : 'were'} still running, not required to merge.`;
    const text = isReleasePull(pull)
      ? `GitHub reports ${name}, the release pull request, ready to merge.${note} Merging it is the release: leave it for the user to ask.`
      : `GitHub reports ${name} ready to merge.${note}`;
    found.push({ key: keyOf(watch, 'ready'), text });
  }
  if (verdict.kind === 'merged-passed' && !isEarly) {
    const text = watch.push
      ? `The checks on ${name} passed.`
      : `${name} merged into ${pull.base}, and ${passedOn(pull)}.`;
    found.push({ key: keyOf(watch, 'passed'), text, isPassed: true });
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
  const where = isMerged && !watch.push ? ` on ${commitOf(pull.followed)}` : '';
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
// `ready` is kept apart from the rest of the news, so a notice held past a
// merge can leave it out, and so can one whose merge would need asking; `passed`
// is news for the next prompt, never a wake. `text` is all of it, for a tool's answer.
export type Wake = {
  text: string | null;
  news: string[];
  ready: string | null;
  passed: string[];
  told: string[];
  heard: Watch['heard'];
};

export function heldWith(was: Held, next: Held): Held {
  const news = [...new Set([...was.news, ...next.news])];
  const isRelease = next.isRelease === true || was.isRelease === true;
  return { ...next, news, ready: next.ready ?? was.ready, ...(isRelease && { isRelease }) };
}

// The ready line leads: it is the news Claude acts on.
export function noticeOf(news: readonly string[], ready: string | null, url: string): string {
  return [
    `pr-watch: ${[...(ready === null ? [] : [ready]), ...news].join(' ')}`,
    `This is news from pr-watch, not a request to merge. ${url}`,
  ].join('\n');
}

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
// `isEarly` holds back a passed merge whose grace has not ended; `isOwnMerge`
// counts a passed merge Claude made as told, since only a failure is news then.
export function wakeOf(
  watch: Pick<Watch, 'repo' | 'number' | 'push' | 'url'>,
  pull: Pull,
  verdict: Verdict,
  last: Memory,
  { isEarly = false, isOwnMerge = false, tells = PEOPLE_ONLY } = {},
): Wake {
  const name = watch.push
    ? `the push to ${watch.push.branch} on ${watch.repo}`
    : `${watch.repo}#${watch.number}`;
  const told = last.told ?? [];
  const news: string[] = [];
  const passed: string[] = [];
  const kept: string[] = [];
  let ready: string | null = null;
  for (const c of conditionsOf(watch, pull, verdict, name, isEarly)) {
    const isQuiet = isOwnMerge && c.isPassed;
    const isNew = !told.includes(c.key) && !isQuiet;
    if (isNew && c.key === keyOf(watch, 'ready')) ready = c.text;
    else if (isNew && c.isPassed) passed.push(c.text);
    else if (isNew) news.push(c.text);
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
  const isOther = news.length > 0 || ready !== null || passed.length > 0;
  const streak = isOther ? 0 : lines.length > 0 ? before + 1 : before;
  if (streak <= QUIET_CAP) news.push(...lines);
  if (lines.length > 0 && streak === QUIET_CAP) {
    news.push(
      `pr-watch will tell you of no more comments or reviews on ${name} until other news comes.`,
    );
  }
  const heard = next && { since: next.since, keys: next.keys, ...(streak > 0 && { streak }) };
  const all = [...news, ...passed];
  const text = all.length === 0 && ready === null ? null : noticeOf(all, ready, watch.url);
  return { text, news, ready, passed, told: kept, heard };
}

// What the person's next prompt carries of the news held back from waking
// Claude: each line once, with what it may do about a ready pull request.
export function contextOf(quiet: readonly Held[]): string | null {
  const lines = quiet.flatMap((q) => [...(q.ready === null ? [] : [q.ready]), ...q.news]);
  if (lines.length === 0) return null;
  // A release pull request is not offered: its merge is the release. Beside
  // one, the offer names the pull requests it covers.
  const offerable = quiet.filter((q) => q.ready !== null && !q.isRelease);
  const isBeside = quiet.some((q) => q.ready !== null && q.isRelease);
  const what = isBeside ? offerable.map((q) => q.label).join(', ') : 'it';
  return [
    `pr-watch, since your last turn: ${lines.join(' ')}`,
    ...(offerable.length > 0
      ? [`Merging needs the user to ask for it; offer ${what} if it fits.`]
      : []),
  ].join('\n');
}

// The prompt-box suggestion for the latest pull request held ready.
export function suggestionOf(quiet: readonly Held[]): string | null {
  const ready = quiet.findLast((q) => q.ready !== null && !q.isRelease);
  return ready ? `merge ${ready.label}` : null;
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

// `isMark` is drawn whole: a row too wide for the band cuts its words first.
export type Segment = {
  text: string;
  color?: string;
  isDim?: boolean;
  url?: string;
  isMark?: true;
};

// A status colors its mark alone; the words beside it keep the plain text color.
const icon = (text: string, color: string | undefined): Segment => ({
  text,
  ...(color === undefined ? {} : { color }),
  isMark: true,
});

const BAR_MAX = 24;
const BAR_MIN = 8;

const MARK_COLOR: Record<string, string> = { '✓': 'green', '✗': 'red', '●': 'blue' };

function markSegments(w: Workflow): Segment[] {
  const mark = markOf(w);
  return [{ text: ` · ${w.name} ` }, icon(mark, MARK_COLOR[mark])];
}

// One line of the band. A running gate whose length is known draws a bar that
// stops short of full until the run ends.
// A stack layer's line carries its place after the label, as `≡ #236 1/2`.
export function lineOf(
  watch: Watch,
  now: number,
  estimates: Record<string, number>,
  columns: number,
): Segment[] {
  const layer = layerOf(watch);
  if (layer === null) return bodyOf(watch, now, estimates, columns);
  const badge = { text: ` ≡ #${layer.stack} ${layer.at}/${layer.of}`, isDim: true };
  const [label, ...rest] = bodyOf(watch, now, estimates, columns - badge.text.length);
  return [label!, badge, ...rest];
}

function bodyOf(
  watch: Watch,
  now: number,
  estimates: Record<string, number>,
  columns: number,
): Segment[] {
  const isPush = watch.push !== undefined;
  const title = isPush ? `⟳ ${labelOf(watch)}` : labelOf(watch);
  const label = { text: title, color: 'cyan', url: watch.url };
  const pull = watch.pull;
  // A failure and a pause are separate facts, so a line says both.
  const pause =
    watch.limitedUntil === undefined
      ? undefined
      : `rate limited until ${untilText(watch.limitedUntil)}`;
  const problem = [watch.error, pause].filter(Boolean).join(' · ') || undefined;
  const isOffline = (watch.offline ?? 0) >= OFFLINE_NOTE_AFTER;
  if (!pull) {
    const quiet = isOffline ? 'offline, retrying' : 'loading…';
    return [
      label,
      {
        text: ` ${problem ?? quiet}`,
        isDim: problem === undefined,
        color: problem === undefined ? undefined : 'red',
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
  // A draft is marked up front so its checks still show.
  const draft = { text: ' draft ·', isDim: true };
  const lead: Segment[] = isMerged ? [label, after] : pull.isDraft ? [label, draft] : [label];
  const tail: Segment[] = [];
  if (runs.isTruncated) tail.push({ text: ' · more checks not shown', isDim: true });
  if (problem !== undefined) tail.push({ text: ` · ${problem}`, color: 'red' });
  if (isOffline) tail.push({ text: ' · offline, retrying', isDim: true });
  const isRunning = v.kind === 'running' || v.kind === 'merged-running';
  // Other workflows, while they run or once they failed; on a running line,
  // every other workflow.
  const others = (skip: number | null) =>
    runs.workflows
      .filter((w) => w.id !== skip && (isRunning || markOf(w) !== '✓'))
      .flatMap((w) => markSegments(w));
  if (v.kind === 'ready') {
    const ready = [icon(' ✓', 'green'), { text: ' ready to merge' }];
    return [...lead, ...ready, ...others(null), ...tail];
  }
  if (v.kind === 'merged-passed') {
    const since = pull.followed?.since ?? [];
    const passed =
      since.length > 0
        ? ` ${since.join(', ')} failed, since passed`
        : pull.followed?.isLater
          ? ' checks passed on a later commit'
          : ' checks passed';
    return [...lead, icon(' ✓', 'green'), { text: passed }, ...tail];
  }
  if (v.kind === 'merged-waiting') {
    return [...lead, { text: ' ○ waiting on checks', isDim: true }, ...tail];
  }
  if (v.kind === 'failing' || v.kind === 'merged-failing') {
    const reason = { text: ` ${v.workflow}: ${v.job} failed`, url: v.url || undefined };
    return [...lead, icon(' ✗', 'red'), reason, ...others(v.workflowId), ...tail];
  }
  if (v.kind === 'blocked') {
    const blocked = [icon(' ⚠', 'yellow'), { text: ` ${v.reason}` }];
    return [...lead, ...blocked, ...others(null), ...tail];
  }
  if (v.kind === 'waiting' && v.reason === 'draft') {
    // Not ready to merge while a draft, whatever its checks say.
    if (runs.workflows.length === 0) return [label, { text: ' ○ draft', isDim: true }, ...tail];
    // A required GitHub App check outside the workflows may still be running.
    const checks: Segment[] = pull.isRequiredPending
      ? [{ text: ' ○ waiting on checks', isDim: true }]
      : [icon(' ✓', 'green'), { text: ' checks passed' }];
    const blocker = blockerOf(pull);
    const blocked =
      blocker === null ? [] : [{ text: ' ·' }, icon(' ⚠', 'yellow'), { text: ` ${blocker}` }];
    return [...lead, ...checks, ...blocked, ...others(null), ...tail];
  }
  if (v.kind === 'waiting') {
    return [...lead, { text: ` ○ waiting on ${v.reason}`, isDim: true }, ...others(null), ...tail];
  }
  const gate = v.gate;
  const elapsed = now - Date.parse(gate.startedAt);
  const estimate = estimates[estimateKey(watch.host, gate.id)] ?? 0;
  const url = gate.url || undefined;
  const mark = icon(' ●', 'blue');
  if (gate.isRerun) {
    // The bar's length is the whole workflow's, which a re-run of failed jobs undercuts.
    const start =
      gate.runId === undefined
        ? undefined
        : estimates[rerunKey(watch.host, gate.runId, gate.attempt)];
    const name = { text: ` ${gateTextOf(gate)}`, url };
    const clock = start === undefined ? [] : [{ text: ` ${clockText(now - start)}`, isDim: true }];
    return [...lead, mark, name, ...clock, ...others(gate.id), ...tail];
  }
  const head = [...lead, mark, { text: ` ${gateTextOf(gate)} `, url }];
  if (estimate <= 0) {
    return [...head, { text: clockText(elapsed), isDim: true }, ...others(gate.id), ...tail];
  }
  const times = ` ${clockText(elapsed)} / ~${clockText(estimate)}`;
  const used = head.reduce((n, s) => n + s.text.length, 0) + times.length;
  const width = Math.max(BAR_MIN, Math.min(BAR_MAX, columns - used - 2));
  const bar = barOf(Math.min(elapsed / estimate, 0.97), width);
  return [
    ...head,
    { text: bar.filled, color: 'blue' },
    { text: bar.rest, isDim: true },
    { text: times, isDim: true },
    ...others(gate.id),
    ...tail,
  ];
}
