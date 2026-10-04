import { atom, read, update, type EngineInterface, type Register, type Timer } from 'claude-code';

import type { Watch } from '../types';
import { estimateArgs, parseEstimate, parsePull, pullArgs } from './github';
import {
  createdPull,
  delayOf,
  errorLine,
  estimateKey,
  lineOf,
  movesPulls,
  isSettled,
  shownOf,
  toastOf,
  verdictOf,
  type Segment,
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
// After Claude pushes or merges, a watch last read before pushedAt is read at
// once, and every watch every BURST_MS until burstUntil: GitHub starts the new
// runs a few seconds after the push.
const BURST_MS = 5000;
const BURST_FOR_MS = 60_000;
let pushedAt = 0;
let burstUntil = 0;
let poller: Timer | undefined;
let isTickFailing = false;
let isSaveFailing = false;

const idOf = (w: Pick<Watch, 'host' | 'repo' | 'number'>) => `${w.host}/${w.repo}#${w.number}`;

function errorText(error: unknown): string {
  return errorLine(error instanceof Error ? error.message : String(error));
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
async function readPull($: $, w: Watch) {
  const r = await $.process.run(pullArgs(w.host, w.repo, w.number));
  try {
    return parsePull(r.stdout);
  } catch (error) {
    if (r.exitCode === 0) throw error;
    throw new Error(r.stderr.trim() || `gh exited ${r.exitCode}`, { cause: error });
  }
}

async function refresh($: $, target: Watch, now: number): Promise<void> {
  const id = idOf(target);
  busy.add(id);
  tried.set(id, now);
  try {
    let next: Watch;
    try {
      next = { ...target, pull: await readPull($, target), error: undefined, checkedAt: now };
    } catch (error) {
      // checkedAt stays the last good read's: settling is judged by it, and
      // `tried` already spaces the retries.
      next = { ...target, error: `gh failed: ${errorText(error)}` };
    }
    let toast: string | null = null;
    let isClosed = false;
    if (next.pull && next.error === undefined) {
      const verdict = verdictOf(next.pull, await read($, estimates), next.host, now);
      // A passed merge is said only once no later run can start: until then
      // it is not yet what the line has said.
      const isEarly = verdict.kind === 'merged-passed' && !isSettled(verdict, next.pull, now);
      if (!isEarly) {
        toast = toastOf(`#${next.number}`, verdict, target.shown);
        next.shown = shownOf(verdict);
      }
      isClosed = verdict.kind === 'closed';
    }
    await update($, watches, (all) =>
      isClosed ? all.filter((w) => idOf(w) !== id) : all.map((w) => (idOf(w) === id ? next : w)),
    );
    isSaveFailing = false;
    // Only once the line says it, so a lost save does not toast again.
    if (toast) $.ui.toast(toast);
    if (!isClosed && next.error === undefined) await learnEstimates($, next, now);
  } catch (error) {
    // Kept on the line so the band says why; said once when even that fails.
    // The read itself succeeded or was caught above, so this is pr-watch's own.
    const why = errorText(error);
    try {
      await update($, watches, (all) =>
        all.map((w) => (idOf(w) === id ? { ...w, error: `pr-watch failed: ${why}` } : w)),
      );
    } catch {
      if (!isSaveFailing) $.ui.toast(`pr-watch could not save #${target.number}: ${why}`);
      isSaveFailing = true;
    }
  } finally {
    busy.delete(id);
  }
}

async function tick($: $): Promise<void> {
  const list = await read($, watches);
  if (list.length === 0) return;
  const now = await $.clock.now();
  const known = await read($, estimates);
  let isMoving = false;
  for (const w of list) {
    // Settling and closing are judged at the last read, so a run that started
    // after it is not missed.
    const verdict = w.pull ? verdictOf(w.pull, known, w.host, w.checkedAt) : null;
    if (verdict?.kind === 'running' || verdict?.kind === 'merged-running') isMoving = true;
    // A merge that started no runs in its grace closes with time alone.
    if (verdict?.kind === 'closed') {
      await stop($, idOf(w));
      continue;
    }
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

  // A merge whose runs have settled stays until the person's next message; a
  // plugin's prompt or a task notification is not one.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e);
    const known = await read($, estimates);
    const isKept = (w: Watch) =>
      !w.pull || !isSettled(verdictOf(w.pull, known, w.host, w.checkedAt), w.pull, w.checkedAt);
    const list = await read($, watches);
    if (!list.every((w) => isKept(w))) {
      await update($, watches, (all) => all.filter((w) => isKept(w)));
    }
    return next(e);
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
    if (r.isError) return r;
    const stdout = (r.result as { stdout?: unknown } | undefined)?.stdout;
    const target = createdPull(e.command, typeof stdout === 'string' ? stdout : '');
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
