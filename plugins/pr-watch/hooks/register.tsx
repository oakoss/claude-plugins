import { atom, read, update, type EngineInterface, type Register, type Timer } from 'claude-code';

import type { Pull, Watch } from '../types';
import {
  estimateArgs,
  parseEstimate,
  parsePull,
  parsePush,
  parseQuota,
  pullArgs,
  pushArgs,
  viewArgs,
  type Quota,
} from './github';
import {
  createdPull,
  mergedPullOf,
  mergingPull,
  viewedPull,
  pushedBranches,
  pushedPull,
  delayOf,
  errorLine,
  estimateKey,
  lineOf,
  movesPulls,
  isGone,
  isChecking,
  isMergeFresh,
  isQuotaLow,
  isRateLimited,
  GIVE_UP_AFTER,
  LOW_QUOTA_MS,
  pauseOf,
  retryDelayOf,
  untilText,
  isSettled,
  labelOf,
  shownOf,
  settingsOf,
  tellsOf,
  toastOf,
  toldAfter,
  verdictOf,
  wakeOf,
  type Merging,
  type Memory,
  type Pause,
  type Segment,
  type Target,
  type Wake,
} from './watch';

type $ = EngineInterface;

const watches = atom({ plugin: 'pr-watch', key: 'watches' } as const, []);
const estimates = atom({ plugin: 'pr-watch', key: 'estimates' } as const, {});
const clock = atom({ plugin: 'pr-watch', key: 'now' } as const, 0);

const TICK_MS = 1000;
const ESTIMATE_RETRY_MS = 60_000;
const VIEW_TIMEOUT_MS = 10_000;
const busy = new Set<string>();
// When each watch was last read, kept here too so a read whose result could
// not be saved still waits out its delay.
const tried = new Map<string, number>();
// When each unanswered length was last asked for, by estimate key.
const asked = new Map<string, number>();
// The GraphQL quota each host's latest read reported.
const quota = new Map<string, Quota>();
// Each rate-limited host's pause, kept after it ends until a read succeeds, so
// a limit hit again waits longer.
const paused = new Map<string, Pause>();
// Finished runs a length was learned after, so each one re-learns it once.
const learnedAfter = new Set<string>();
// After Claude pushes, merges or starts a run, a watch last read before
// pushedAt is read at once, and every watch every BURST_MS until burstUntil:
// GitHub starts the new runs a few seconds later.
const BURST_MS = 5000;
const BURST_FOR_MS = 60_000;
let pushedAt = 0;
let burstUntil = 0;
let poller: Timer | undefined;
let isTickFailing = false;
let isSaveFailing = false;
// From /config; a change there reloads the module with the new values.
let config = { isAwake: true, tells: tellsOf('checks and comments', 'never') };

const idOf = (w: Pick<Watch, 'host' | 'repo' | 'number' | 'push'>) =>
  `${w.host}/${w.repo}${w.push ? `@${w.push.branch}` : `#${w.number}`}`;

// The same watch, not a later push of the same branch that replaced it.
const isSame = (a: Watch, b: Watch) => idOf(a) === idOf(b) && a.push?.pushedAt === b.push?.pushedAt;

function errorText(error: unknown): string {
  return errorLine(error instanceof Error ? error.message : String(error));
}

// Not awaited: a plugin's prompt runs once the session is idle, so the news
// waits for any turn in progress rather than holding up the poll. A hook that
// drops it has its reason shown by the engine.
function wake($: $, text: string, label: string): void {
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .catch((error: unknown) => {
      $.ui.toast(`pr-watch could not tell Claude about ${label}: ${errorText(error)}`);
    })
    // A toast that throws leaves nowhere to say so.
    .catch(() => null);
}

// An unknown length that cannot be learned or kept is asked again after the
// retry delay, the run drawing no bar meanwhile. A known one is asked again
// once per finished run, and kept when that answer is missing or says none.
async function learnEstimates($: $, w: Watch, now: number): Promise<void> {
  let known: Record<string, number>;
  try {
    known = await read($, estimates);
  } catch {
    return;
  }
  for (const flow of [...(w.pull?.workflows ?? []), ...(w.pull?.mergeRuns?.workflows ?? [])]) {
    const key = estimateKey(w.host, flow.id);
    const run = flow.status === 'done' ? JSON.stringify([key, flow.url, flow.attempt]) : null;
    const isKnown = known[key] !== undefined;
    if (isKnown) {
      if (run === null || learnedAfter.has(run)) continue;
      learnedAfter.add(run);
    } else if (now - (asked.get(key) ?? -Infinity) < ESTIMATE_RETRY_MS) {
      continue;
    }
    asked.set(key, now);
    try {
      const r = await $.process.run(estimateArgs(w.host, w.repo, flow.id));
      const ms = r.exitCode === 0 ? parseEstimate(r.stdout) : null;
      if (ms === null || (ms === 0 && isKnown)) continue;
      await update($, estimates, (all) => ({ ...all, [key]: ms }));
      asked.delete(key);
      if (run !== null) learnedAfter.add(run);
    } catch {
      continue;
    }
  }
}

class RateLimited extends Error {
  constructor(readonly until: number) {
    super(`rate limited until ${untilText(until)}`);
  }
}

// gh exits non-zero when GraphQL reports any error, even beside usable data.
async function readGh<T>(
  $: $,
  host: string,
  argv: string[],
  parse: (stdout: string) => T,
): Promise<T> {
  const before = paused.get(host);
  if (before && (await $.clock.now()) < before.until) {
    throw new RateLimited(before.until);
  }
  const r = await $.process.run(argv);
  const left = parseQuota(r.stdout);
  const was = quota.get(host);
  // Reads finish out of order: within one reset window, the lowest count is the latest.
  const isStale = was?.resetAt === left?.resetAt && (was?.remaining ?? 0) < (left?.remaining ?? 0);
  if (left && !isStale) quota.set(host, left);
  if (r.exitCode !== 0 && isRateLimited(r.stdout, r.stderr)) {
    const now = await $.clock.now();
    // Reads limited together pause once, rather than each doubling the wait.
    const current = paused.get(host);
    const pause = current && current !== before ? current : pauseOf(quota.get(host), current, now);
    paused.set(host, pause);
    throw new RateLimited(pause.until);
  }
  try {
    return parse(r.stdout);
  } catch (error) {
    if (r.exitCode === 0) throw error;
    throw new Error(r.stderr.trim() || `gh exited ${r.exitCode}`, { cause: error });
  }
}

type Read = { kind: 'pull'; pull: Pull } | { kind: 'handoff'; to: Watch } | { kind: 'gone' };

// A push whose branch heads an open pull request hands its line to that PR.
async function readWatch($: $, w: Watch): Promise<Read> {
  if (!w.push) {
    const read = (isMerged: boolean) =>
      readGh($, w.host, pullArgs(w.host, w.repo, w.number, isMerged), parsePull);
    // Until a read says it merged, read the open variant; on the read that
    // first finds it merged, read again for the merge commit's runs.
    const wasMerged = w.pull?.state === 'MERGED';
    const pull = await read(wasMerged);
    if (wasMerged || pull.state !== 'MERGED') return { kind: 'pull', pull };
    try {
      return { kind: 'pull', pull: await read(true) };
    } catch (error) {
      // Just merged, it shows as waiting on checks while the next read asks for
      // them. Older, it would read as closed and leave, so the failure is said.
      if (error instanceof RateLimited || !isMergeFresh(pull, await $.clock.now())) throw error;
      return { kind: 'pull', pull: { ...pull, workflows: [], mergeRuns: null } };
    }
  }
  const { branch, pushedAt } = w.push;
  const pushed = await readGh($, w.host, pushArgs(w.host, w.repo, branch), parsePush);
  if (pushed.kind === 'gone') return pushed;
  if (pushed.kind === 'pr') {
    const { repo, number } = pushed;
    const url = pushed.url ?? `https://${w.host}/${repo}/pull/${number}`;
    return { kind: 'handoff', to: { host: w.host, repo, number, url, checkedAt: 0 } };
  }
  return { kind: 'pull', pull: pushedPull(branch, pushedAt, pushed.runs) };
}

// What a read leaves for a caller that tells it itself: its news, whether it
// found the pull request closed, and why it could not finish.
type Kept = { news: string | null; isClosed?: boolean; error?: string };

async function refresh($: $, target: Watch, now: number, kept?: Kept): Promise<void> {
  const id = idOf(target);
  busy.add(id);
  tried.set(id, now);
  try {
    let next: Watch;
    let isLimited = false;
    const pause = paused.get(target.host);
    // A read that began before another read paused the host still waits it out.
    const pausedUntil = async () => {
      const until = paused.get(target.host)?.until;
      return until !== undefined && (await $.clock.now()) < until ? until : undefined;
    };
    try {
      const read = await readWatch($, target);
      // Only a whole read that began after the pause was set shows the limit
      // lifted: a merged pull request's second read may still be refused.
      if (paused.get(target.host) === pause) paused.delete(target.host);
      const limitedUntil = await pausedUntil();
      if (read.kind === 'gone') {
        await update($, watches, (all) => all.filter((w) => !isSame(w, target)));
        return;
      }
      if (read.kind === 'handoff') {
        // The PR's runs are the push's, so what Claude was told of carries over.
        const told = target.told ?? [];
        const to = { ...read.to, told };
        await update($, watches, (all) => {
          if (!all.some((w) => isSame(w, target))) return all;
          const rest = all.filter((w) => !isSame(w, target));
          if (!rest.some((w) => idOf(w) === idOf(to))) return [...rest, to];
          return rest.map((w) =>
            idOf(w) === idOf(to) ? { ...w, told: [...new Set([...(w.told ?? []), ...told])] } : w,
          );
        });
        return;
      }
      next = {
        ...target,
        pull: read.pull,
        error: undefined,
        failures: undefined,
        limitedUntil,
        checkedAt: now,
      };
    } catch (error) {
      // checkedAt stays the last good read's: settling is judged by it, and
      // `tried` already spaces the retries. A rate limit is GitHub's to lift,
      // so it does not count toward giving up.
      if (error instanceof RateLimited) {
        isLimited = true;
        next = { ...target, limitedUntil: error.until };
      } else {
        next = {
          ...target,
          error: `gh failed: ${errorText(error)}`,
          failures: (target.failures ?? 0) + 1,
          limitedUntil: await pausedUntil(),
        };
      }
    }
    const isGivenUp = !isLimited && (next.failures ?? 0) >= GIVE_UP_AFTER;
    // Only a read that answered is judged; a limited one keeps the last good state.
    const isFresh = !isLimited && next.error === undefined;
    let toast: string | null = null;
    let news: string | null = null;
    let wakeFor: ((last: Memory) => Wake) | null = null;
    let isClosed = false;
    if (next.pull && isFresh) {
      const pull = next.pull;
      const verdict = verdictOf(pull, await read($, estimates), next.host, now);
      isClosed = verdict.kind === 'closed';
      if (kept) kept.isClosed = isClosed;
      if (!isClosed) {
        // A passed merge is said only once no later run can start: until then
        // it is not yet what the line has said.
        const isEarly = verdict.kind === 'merged-passed' && !isSettled(verdict, pull, now);
        const shown = target.shown;
        wakeFor = (last) => wakeOf(next, pull, verdict, last, { isEarly, tells: config.tells });
        // A ready pull request read as checking is not ready again afterwards.
        if (!isEarly && !isChecking(verdict)) {
          toast = toastOf(labelOf(next), verdict, shown, next.push ? '' : ' merged');
          next.shown = shownOf(verdict);
          if (next.shown !== shown || next.shownAt === undefined) next.shownAt = now;
        }
      }
    }
    let isSaved = false;
    await update($, watches, (all) => {
      isSaved = all.some((w) => isSame(w, target));
      if (isClosed || isGivenUp) return all.filter((w) => !isSame(w, target));
      // Every watch on the host waits out the pause, so each line says so.
      if (isLimited) {
        const { limitedUntil } = next;
        return all.map((w) =>
          isSame(w, target) ? next : w.host === next.host ? { ...w, limitedUntil } : w,
        );
      }
      if (wakeFor) {
        // Judged against every watch on the host as saved now: a push and its
        // pull request read the same runs, and either may be read first.
        const known = all.filter((w) => w.host === next.host).flatMap((w) => w.told ?? []);
        const told = [...new Set([...(target.told ?? []), ...known])];
        const woke = wakeFor({ told, heard: target.heard });
        // With waking off, comments are still heard, so turning it on reports no
        // history of them.
        if (config.isAwake) news = woke.text;
        next.told = toldAfter(woke.told, target.told, config.isAwake);
        next.heard = woke.heard;
      }
      return all.map((w) => (isSame(w, target) ? next : w));
    });
    isSaveFailing = false;
    // Only once the line says it, so a lost save does not toast or wake again.
    if (toast && isSaved) $.ui.toast(toast);
    if (isGivenUp && isSaved) {
      $.ui.toast(`pr-watch stopped watching ${labelOf(next)}: ${next.error}`);
      news = [
        `pr-watch: ${GIVE_UP_AFTER} reads of ${nameOf(next)} in a row failed, so pr-watch stopped watching it. The last: ${next.error}`,
        `Watch it again with pr-watch's watch tool once gh can read it. ${next.url}`,
      ].join('\n');
      // A tool's caller is told in its answer, whatever /config says.
      if (!kept && !config.isAwake) news = null;
    }
    if (news && isSaved) {
      if (kept) kept.news = news;
      else wake($, news, labelOf(next));
    }
    if (!isClosed && isFresh) await learnEstimates($, next, now);
  } catch (error) {
    // Kept on the line so the band says why; said once when even that fails.
    // The read itself succeeded or was caught above, so this is pr-watch's own,
    // counted so that one failing every time is retried less often.
    const why = errorText(error);
    if (kept) kept.error = why;
    // The read ran, so the line says a pause only while its host is still in one.
    const until = paused.get(target.host)?.until;
    const limitedUntil = until !== undefined && (await $.clock.now()) < until ? until : undefined;
    try {
      await update($, watches, (all) =>
        all.map((w) =>
          isSame(w, target)
            ? {
                ...w,
                error: `pr-watch failed: ${why}`,
                failures: (w.failures ?? 0) + 1,
                limitedUntil,
              }
            : w,
        ),
      );
    } catch {
      if (!isSaveFailing) $.ui.toast(`pr-watch could not save ${labelOf(target)}: ${why}`);
      isSaveFailing = true;
    }
  } finally {
    busy.delete(id);
  }
}

async function tick($: $): Promise<void> {
  const saved = await read($, watches);
  if (saved.length === 0) return;
  const now = await $.clock.now();
  const known = await read($, estimates);
  // Judged on the list as saved, so a push that replaced a watch since stays.
  let list: Watch[] = [];
  await update($, watches, (all) => {
    // A watch added while its host is paused waits it out like the rest, and
    // says so; a push not yet read stays while it waits.
    let isChanged = false;
    list = all.flatMap((w) => {
      const until = paused.get(w.host)?.until ?? 0;
      const held = now < until && w.limitedUntil === undefined ? { ...w, limitedUntil: until } : w;
      if (held !== w) isChanged = true;
      const isKept = !isGone(held, known, now) || (!held.pull && held.limitedUntil !== undefined);
      if (!isKept) isChanged = true;
      return isKept ? [held] : [];
    });
    return isChanged ? list : all;
  });
  let isMoving = false;
  for (const w of list) {
    // Settling and closing are judged at the last read, so a run that started
    // after it is not missed.
    const verdict = w.pull ? verdictOf(w.pull, known, w.host, w.checkedAt) : null;
    if (verdict?.kind === 'running' || verdict?.kind === 'merged-running') isMoving = true;
    const pauseEnd = paused.get(w.host)?.until ?? 0;
    if (now < pauseEnd) continue;
    const usual = verdict && w.pull ? delayOf(verdict, w.pull, w.checkedAt, w.shownAt) : 10_000;
    // A failing watch retries on its own schedule; low on quota, a watch waits
    // its slow delay. Neither bursts.
    const low = isQuotaLow(quota.get(w.host)) ? LOW_QUOTA_MS : 0;
    const isSlowed = low > 0 || Boolean(w.failures);
    const delay =
      usual === null
        ? null
        : w.failures
          ? Math.max(retryDelayOf(w.failures), low)
          : low > 0
            ? Math.max(usual, low)
            : now < burstUntil
              ? Math.min(usual, BURST_MS)
              : usual;
    if (delay === null || busy.has(idOf(w))) continue;
    const last = Math.max(w.checkedAt, tried.get(idOf(w)) ?? 0);
    // A line says the pause until a read of its own, so the end of one reads it at once.
    const isDue =
      w.limitedUntil !== undefined || (last <= pushedAt && !isSlowed) || now - last >= delay;
    if (isDue) void refresh($, w, now);
  }
  if (isMoving) await update($, clock, () => now);
}

// A poll that fails is said once, until one succeeds.
async function safeTick($: $): Promise<void> {
  try {
    await tick($);
    isTickFailing = false;
  } catch (error) {
    if (!isTickFailing) $.ui.toast(`pr-watch stopped updating: ${errorText(error)}`);
    isTickFailing = true;
  }
}

// Watches the pull request a merge named, unless something already does.
async function followMerge($: $, m: Merging, startedAt: number): Promise<void> {
  try {
    const r = await $.process.run(viewArgs(m.pull, m.repo), { timeoutMs: VIEW_TIMEOUT_MS });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.exitCode}`);
    const target = mergedPullOf(r.stdout, startedAt);
    if (target === 'stale') return;
    if (target === null) {
      throw new Error(
        `gh pr view named no pull request: ${r.stdout.trim().slice(0, 80) || '(empty)'}`,
      );
    }
    const id = idOf(target);
    await update($, watches, (all) =>
      all.some((w) => idOf(w) === id) ? all : [...all, { ...target, checkedAt: 0 }],
    );
  } catch (error) {
    $.ui.toast(`pr-watch could not follow the merge of ${m.pull}: ${errorText(error)}`);
  }
}

async function stop($: $, id: string): Promise<void> {
  await update($, watches, (all) => all.filter((w) => idOf(w) !== id));
}

const TOOL_COLUMNS = 80;

// A watch's line as text, for a tool's answer.
function textOf(w: Watch, now: number, known: Record<string, number>): string {
  return lineOf(w, now, known, TOOL_COLUMNS)
    .map((s) => s.text)
    .join('');
}

const nameOf = (w: Pick<Watch, 'repo' | 'number' | 'push'>) =>
  w.push ? `the push to ${w.push.branch} on ${w.repo}` : `${w.repo}#${w.number}`;

type ToolInput = { pull: string; repo: string | null };

function toolInputOf(e: unknown): ToolInput | string {
  const { pull, repo } = e as { pull?: unknown; repo?: unknown };
  if (typeof pull !== 'string' || pull.trim() === '') {
    return 'pr-watch: `pull` names a pull request: its number, URL or head branch.';
  }
  if (repo !== undefined && repo !== null && typeof repo !== 'string') {
    return 'pr-watch: `repo` is the repository as owner/name.';
  }
  return { pull: pull.trim(), repo: typeof repo === 'string' && repo !== '' ? repo : null };
}

// The pull request gh resolves a tool's input to, or why it cannot.
async function viewedTarget($: $, input: ToolInput): Promise<Target | string> {
  const r = await $.process.run(viewArgs(input.pull, input.repo), {
    timeoutMs: VIEW_TIMEOUT_MS,
  });
  if (r.exitCode !== 0) {
    const why = r.stderr.trim() ? errorText(r.stderr) : `gh exited ${r.exitCode}`;
    return `pr-watch could not read ${input.pull} with gh pr view: ${why}`;
  }
  const printed = r.stdout.trim().slice(0, 80) || '(empty)';
  return (
    viewedPull(r.stdout)?.target ??
    `pr-watch: gh pr view named no pull request for ${input.pull}: ${printed}`
  );
}

// Watches a pull request and answers with what it shows now. The news a first
// read finds goes in the answer: the host refuses a prompt from a tool call's
// hook, since it would wait on the turn the hook holds.
async function onWatchTool($: $, e: unknown): Promise<{ result: string }> {
  const input = toolInputOf(e);
  if (typeof input === 'string') return { result: input };
  let name = input.pull;
  let isAdded = false;
  try {
    const target = await viewedTarget($, input);
    if (typeof target === 'string') return { result: target };
    const id = idOf(target);
    name = nameOf(target);
    let isNew = false;
    await update($, watches, (all) => {
      if (all.some((w) => idOf(w) === id)) return all;
      isNew = true;
      return [...all, { ...target, checkedAt: 0 }];
    });
    isAdded = true;
    const now = await $.clock.now();
    const kept: Kept = { news: null };
    const before = await read($, watches);
    const watch = before.find((w) => idOf(w) === id);
    // A read already in flight tells its own news; a second would toast it again.
    if (watch && !busy.has(id)) await refresh($, watch, now, kept);
    const saved = await read($, watches);
    const after = saved.find((w) => idOf(w) === id);
    if (!after) {
      if (kept.isClosed) return { result: `${name} is closed, so pr-watch is not watching it.` };
      return {
        result:
          kept.news ?? `${name} is no longer watched: its line was removed while pr-watch read it.`,
      };
    }
    const line = textOf(after, now, await read($, estimates));
    const head = `pr-watch ${isNew ? 'is now watching' : 'was already watching'} ${name}: ${line}`;
    if (kept.error !== undefined) {
      return { result: `${head}\npr-watch could not finish its first read: ${kept.error}` };
    }
    const closing = config.isAwake
      ? 'pr-watch tells you in this conversation when that changes, so there is no need to poll gh.'
      : 'Waking Claude is off in /config: changes show on the line, and the watches tool reads them.';
    return { result: [head, kept.news, closing].filter(Boolean).join('\n') };
  } catch (error) {
    const why = errorText(error);
    return {
      result: isAdded
        ? `pr-watch is watching ${name} but could not read it yet: ${why}`
        : `pr-watch could not watch ${input.pull}: ${why}`,
    };
  }
}

async function onUnwatchTool($: $, e: unknown): Promise<{ result: string }> {
  const input = toolInputOf(e);
  if (typeof input === 'string') return { result: input };
  try {
    const list = await read($, watches);
    const number = /^#?(\d+)$/.exec(input.pull)?.[1];
    const inRepo = (w: Watch) => input.repo === null || w.repo === input.repo;
    let found = list.filter(
      (w) =>
        w.url === input.pull ||
        (!w.push && number !== undefined && w.number === Number(number) && inRepo(w)) ||
        (w.push?.branch === input.pull && inRepo(w)),
    );
    // A head branch names its pull request only through gh.
    if (found.length === 0 && number === undefined && !input.pull.includes('://')) {
      const target = await viewedTarget($, input);
      if (typeof target === 'string') {
        return { result: `pr-watch is not watching a push to ${input.pull}, and ${target}` };
      }
      found = list.filter((w) => idOf(w) === idOf(target));
    }
    if (found.length === 0) return { result: `pr-watch is not watching ${input.pull}.` };
    if (found.length > 1) {
      const names = found.map((w) => w.url).join(', ');
      return { result: `${input.pull} matches ${names}; name one by its URL or repo.` };
    }
    await stop($, idOf(found[0]!));
    return { result: `pr-watch stopped watching ${nameOf(found[0]!)}.` };
  } catch (error) {
    return { result: `pr-watch could not stop watching ${input.pull}: ${errorText(error)}` };
  }
}

async function onWatchesTool($: $): Promise<{ result: string }> {
  try {
    const list = await read($, watches);
    if (list.length === 0) return { result: 'pr-watch is watching nothing.' };
    const now = await $.clock.now();
    const known = await read($, estimates);
    return { result: list.map((w) => `${w.url}: ${textOf(w, now, known)}`).join('\n') };
  } catch (error) {
    return { result: `pr-watch could not list its watches: ${errorText(error)}` };
  }
}

const PULL_INPUT = {
  type: 'object',
  properties: {
    pull: { type: 'string', description: 'The pull request: its number, URL or head branch.' },
    repo: {
      type: 'string',
      description: "owner/name, when it is not the current directory's repository.",
    },
  },
  required: ['pull'],
};

const TOOLS = [
  {
    name: 'watch',
    description:
      "Watches a GitHub pull request in pr-watch and returns what it shows now. Its line above the prompt follows its checks, and pr-watch tells you in this conversation, as /config allows, when it turns ready to merge, a check fails, it has conflicts or requested changes, someone comments or reviews, or its merge's checks finish. Pull requests you open with gh pr create, or merge with gh pr merge and a number, URL or branch, are watched already; use this for any other you are waiting on, instead of polling gh pr checks or sleeping.",
    inputSchema: PULL_INPUT,
  },
  {
    name: 'unwatch',
    description:
      'Stops pr-watch watching a pull request (its number, URL or head branch) or a pushed branch, once you no longer need its news.',
    inputSchema: PULL_INPUT,
  },
  {
    name: 'watches',
    description: 'Lists what pr-watch is watching, each with what its line shows now. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Each on its own, so one refused leaves the others; without them Claude falls
// back to gh, and the band and its news stay.
async function registerTools($: $): Promise<void> {
  const failed: string[] = [];
  for (const tool of TOOLS) {
    try {
      await $.tool.register(tool);
    } catch (error) {
      failed.push(`${tool.name} (${errorText(error)})`);
    }
  }
  if (failed.length > 0) {
    $.ui.toast(`pr-watch could not offer Claude its tools: ${failed.join(', ')}`);
  }
}

export const register: Register = (on, options) => {
  const { wake, bots } = settingsOf(options);
  config = { isAwake: wake !== 'off', tells: tellsOf(wake, bots) };
  on('session.start', async ($, e, next) => {
    // Registered before next, so the tools are listed by the first turn.
    await registerTools($);
    const r = await next(e);
    poller?.cancel();
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- a timer, not Array#every
    poller = $.clock.every(TICK_MS, () => void safeTick($));
    return r;
  });

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const merging = mergingPull(e.command);
    const startedAt = merging ? await $.clock.now() : 0;
    const r = await next(e);
    if ('deny' in r) return r;
    // A failed push still bursts: the exit status is the whole shell line's, so
    // `git push; false` pushed and failed, and `git push || true` the reverse.
    if (movesPulls(e.command)) {
      pushedAt = await $.clock.now();
      burstUntil = pushedAt + BURST_FOR_MS;
    }
    const raw = (r.result as { stdout?: unknown } | undefined)?.stdout;
    const stdout = typeof raw === 'string' ? raw : '';
    // Read even when the line failed: a push that moved one branch and had
    // another rejected exits non-zero.
    const pushes = pushedBranches(e.command, stdout);
    if (pushes.length > 0) {
      // Pushing a branch again starts its line over.
      const now = await $.clock.now();
      const fresh: Watch[] = pushes.map(({ branch, ...p }) => ({
        ...p,
        number: 0,
        push: { branch, pushedAt: now },
        checkedAt: 0,
      }));
      const ids = new Set(fresh.map((p) => idOf(p)));
      await update($, watches, (all) => [...all.filter((w) => !ids.has(idOf(w))), ...fresh]);
    }
    if (r.isError) return r;
    // A merged pull request nothing watched yet is followed onto its base
    // branch. Not awaited, so the merge's result waits on no gh call.
    if (merging) void followMerge($, merging, startedAt).catch(() => null);
    const target = createdPull(e.command, stdout);
    if (target) {
      const id = idOf(target);
      await update($, watches, (all) =>
        all.some((w) => idOf(w) === id) ? all : [...all, { ...target, checkedAt: 0 }],
      );
    }
    return r;
  });

  on('tool.call', { tool: 'mcp__pr-watch__watch' }, ($, e) => onWatchTool($, e));
  on('tool.call', { tool: 'mcp__pr-watch__unwatch' }, ($, e) => onUnwatchTool($, e));
  on('tool.call', { tool: 'mcp__pr-watch__watches' }, ($) => onWatchesTool($));

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, watches);
    if (e.props.hasSurvey || list.length === 0) return next(e);
    const now = (await read($, clock)) || (await $.clock.now());
    const known = await read($, estimates);
    const { Box, Text, Link, Button } = $.ui.resolve(e);
    const beneath = await next(e);
    // A segment with a URL is a link; the text between links truncates.
    return (
      <Box flexDirection="column" marginTop={1}>
        {list.map((w) => (
          <Box key={`row-${idOf(w)}`} flexDirection="row">
            {lineOf(w, now, known, e.props.bodyColumns).map((s: Segment, i) =>
              s.url ? (
                <Box key={`l${i}`} flexShrink={0}>
                  {s.text.startsWith(' ') ? <Text> </Text> : <Box />}
                  <Link href={s.url} label={s.text.trim()} />
                  {s.text.endsWith(' ') ? <Text> </Text> : <Box />}
                </Box>
              ) : (
                <Text key={`t${i}`} wrap="truncate-end" color={s.color} dimColor={s.isDim}>
                  {s.text}
                </Text>
              ),
            )}
            <Box display="none" hover={{ display: 'flex' }} flexShrink={0}>
              <Text> </Text>
              <Button key={`stop-${idOf(w)}`} label="×" plain onPress={() => stop($, idOf(w))} />
            </Box>
          </Box>
        ))}
        {beneath}
      </Box>
    );
  });
};
