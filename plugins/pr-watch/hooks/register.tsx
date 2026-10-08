import { atom, read, update, type EngineInterface, type Register, type Timer } from 'claude-code';

import type { Pull, Watch } from '../types';
import { estimateArgs, parseEstimate, parsePull, parsePush, pullArgs, pushArgs } from './github';
import {
  createdPull,
  pushedBranches,
  pushedPull,
  delayOf,
  errorLine,
  estimateKey,
  lineOf,
  movesPulls,
  isGone,
  isSettled,
  labelOf,
  shownOf,
  toastOf,
  verdictOf,
  wakeOf,
  type Heard,
  type Segment,
  type Wake,
} from './watch';

type $ = EngineInterface;

const watches = atom({ plugin: 'pr-watch', key: 'watches' } as const, []);
const estimates = atom({ plugin: 'pr-watch', key: 'estimates' } as const, {});
const clock = atom({ plugin: 'pr-watch', key: 'now' } as const, 0);

const TICK_MS = 1000;
const ESTIMATE_RETRY_MS = 60_000;
const busy = new Set<string>();
// When each watch was last read, kept here too so a read whose result could
// not be saved still waits out its delay.
const tried = new Map<string, number>();
// When each unanswered length was last asked for, by estimate key.
const asked = new Map<string, number>();
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

// A length that cannot be learned or kept is left unknown, asked again after
// the retry delay; the run then draws no bar.
async function learnEstimates($: $, w: Watch, now: number): Promise<void> {
  let known: Record<string, number>;
  try {
    known = await read($, estimates);
  } catch {
    return;
  }
  for (const flow of [...(w.pull?.workflows ?? []), ...(w.pull?.mergeRuns?.workflows ?? [])]) {
    const key = estimateKey(w.host, flow.id);
    if (known[key] !== undefined || now - (asked.get(key) ?? -Infinity) < ESTIMATE_RETRY_MS) {
      continue;
    }
    asked.set(key, now);
    try {
      const r = await $.process.run(estimateArgs(w.host, w.repo, flow.id));
      const ms = r.exitCode === 0 ? parseEstimate(r.stdout) : null;
      if (ms === null) continue;
      await update($, estimates, (all) => ({ ...all, [key]: ms }));
      asked.delete(key);
    } catch {
      continue;
    }
  }
}

// gh exits non-zero when GraphQL reports any error, even beside usable data.
async function readGh<T>($: $, argv: string[], parse: (stdout: string) => T): Promise<T> {
  const r = await $.process.run(argv);
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
    return { kind: 'pull', pull: await readGh($, pullArgs(w.host, w.repo, w.number), parsePull) };
  }
  const { branch, pushedAt } = w.push;
  const pushed = await readGh($, pushArgs(w.host, w.repo, branch), parsePush);
  if (pushed.kind === 'gone') return pushed;
  if (pushed.kind === 'pr') {
    const { repo, number } = pushed;
    const url = pushed.url ?? `https://${w.host}/${repo}/pull/${number}`;
    return { kind: 'handoff', to: { host: w.host, repo, number, url, checkedAt: 0 } };
  }
  return { kind: 'pull', pull: pushedPull(branch, pushedAt, pushed.runs) };
}

async function refresh($: $, target: Watch, now: number): Promise<void> {
  const id = idOf(target);
  busy.add(id);
  tried.set(id, now);
  try {
    let next: Watch;
    try {
      const read = await readWatch($, target);
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
      next = { ...target, pull: read.pull, error: undefined, checkedAt: now };
    } catch (error) {
      // checkedAt stays the last good read's: settling is judged by it, and
      // `tried` already spaces the retries.
      next = { ...target, error: `gh failed: ${errorText(error)}` };
    }
    let toast: string | null = null;
    let news: string | null = null;
    let wakeFor: ((last: Heard) => Wake) | null = null;
    let isClosed = false;
    if (next.pull && next.error === undefined) {
      const pull = next.pull;
      const verdict = verdictOf(pull, await read($, estimates), next.host, now);
      isClosed = verdict.kind === 'closed';
      if (!isClosed) {
        // A passed merge is said only once no later run can start: until then
        // it is not yet what the line has said.
        const isEarly = verdict.kind === 'merged-passed' && !isSettled(verdict, pull, now);
        const shown = target.shown;
        wakeFor = (last) => wakeOf(next, pull, verdict, last, isEarly);
        // GitHub reports UNKNOWN while it recomputes the merge state, so a ready
        // pull request read as checking is not ready again afterwards.
        const isChecking = verdict.kind === 'waiting' && verdict.reason === 'checking';
        if (!isEarly && !isChecking) {
          toast = toastOf(labelOf(next), verdict, shown, next.push ? '' : ' merged');
          next.shown = shownOf(verdict);
        }
      }
    }
    let isSaved = false;
    await update($, watches, (all) => {
      isSaved = all.some((w) => isSame(w, target));
      if (isClosed) return all.filter((w) => !isSame(w, target));
      if (wakeFor) {
        // Judged against every watch on the host as saved now: a push and its
        // pull request read the same runs, and either may be read first.
        const known = all.filter((w) => w.host === next.host).flatMap((w) => w.told ?? []);
        const told = [...new Set([...(target.told ?? []), ...known])];
        const woke = wakeFor({ told, heard: target.heard });
        news = woke.text;
        next.told = woke.told;
        next.heard = woke.heard;
      }
      return all.map((w) => (isSame(w, target) ? next : w));
    });
    isSaveFailing = false;
    // Only once the line says it, so a lost save does not toast or wake again.
    if (toast && isSaved) $.ui.toast(toast);
    if (news && isSaved) wake($, news, labelOf(next));
    if (!isClosed && next.error === undefined) await learnEstimates($, next, now);
  } catch (error) {
    // Kept on the line so the band says why; said once when even that fails.
    // The read itself succeeded or was caught above, so this is pr-watch's own.
    const why = errorText(error);
    try {
      await update($, watches, (all) =>
        all.map((w) => (isSame(w, target) ? { ...w, error: `pr-watch failed: ${why}` } : w)),
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
    list = all.filter((w) => !isGone(w, known, now));
    return list.length === all.length ? all : list;
  });
  let isMoving = false;
  for (const w of list) {
    // Settling and closing are judged at the last read, so a run that started
    // after it is not missed.
    const verdict = w.pull ? verdictOf(w.pull, known, w.host, w.checkedAt) : null;
    if (verdict?.kind === 'running' || verdict?.kind === 'merged-running') isMoving = true;
    const usual = verdict && w.pull ? delayOf(verdict, w.pull, w.checkedAt) : 10_000;
    const delay = usual !== null && now < burstUntil ? Math.min(usual, BURST_MS) : usual;
    if (delay === null || busy.has(idOf(w))) continue;
    const last = Math.max(w.checkedAt, tried.get(idOf(w)) ?? 0);
    if (last <= pushedAt || now - last >= delay) void refresh($, w, now);
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

async function stop($: $, id: string): Promise<void> {
  await update($, watches, (all) => all.filter((w) => idOf(w) !== id));
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e);
    poller?.cancel();
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- a timer, not Array#every
    poller = $.clock.every(TICK_MS, () => void safeTick($));
    return r;
  });

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
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
    const target = createdPull(e.command, stdout);
    if (target) {
      const id = idOf(target);
      await update($, watches, (all) =>
        all.some((w) => idOf(w) === id) ? all : [...all, { ...target, checkedAt: 0 }],
      );
    }
    return r;
  });

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
