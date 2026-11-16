import type { MatchedHook } from 'claude-code';

import { firstLine, messageOf } from '../gate/git';
import { run, type $, type Input, type NextOf, type Output } from '../state/engine';
import { state } from '../state/gate-state';
import { madeByAnother, ownerOf, scratchNamed, sweep } from './sweep';

type ScratchHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__scratch' }>;
type SweepHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__sweep' }>;

// review-pr never commits, so its Phase 7 sweep ends the hand-back. Not kept
// across a reload, after which a commit or the session's end ends it.
export const reviewPr = { open: false };

// A leg that stalls, is dropped or dies cleans up nothing, so the cycle gives
// every leg one parent directory and sweeps it when the cycle ends. Served
// whether or not the gate is on: it gates nothing.
export async function registerScratch($: $): Promise<void> {
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
        'Ends every process still running in, or naming a path inside, a scratch directory mcp__review-cycle__scratch made in this conversation, before a resume or fork included, then removes the directory. Call it once the cycle ends, after every leg reported, was dropped, or was stopped. Reports per directory how many processes it ended, whether it removed the directory, and any errors; a directory it could not remove stays listed for the next sweep.',
      inputSchema: { type: 'object', properties: {} },
    });
    state.sweepServed = true;
  } catch {
    // Without the sweep, scratch refuses, and legs fall back to their own mktemp -d.
  }
}

export async function onScratch(
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
    const r = await run($, ['mktemp', '-d', `${await tmpRoot($)}/review-cycle.XXXXXX`]);
    const dir = r.stdout.trim();
    if (r.exitCode !== 0 || dir === '') {
      return {
        result: `review-cycle could not make a scratch directory (${firstLine(r.stderr) || `exit ${r.exitCode}`}). ${fallback}`,
      };
    }
    state.scratch.push(dir);
    // So a sweep reading it back can tell whether its maker still runs; ps
    // prints the time in the caller's zone and language (measured), so pinned.
    await run($, [
      'sh',
      '-c',
      String.raw`printf "%s\t%s\n" "$PPID" "$(LC_ALL=C TZ=UTC0 ps -o lstart= -p "$PPID")" > "$1/.owner"`,
      'sh',
      dir,
    ]);
    return {
      result: `${dir}\nGive every reviewer leg this path: each makes its private directory with mktemp -d ${dir}/leg.XXXXXX. Call mcp__review-cycle__sweep when the cycle ends.`,
    };
  } catch (error) {
    return {
      result: `review-cycle could not make a scratch directory (${messageOf(error)}). ${fallback}`,
    };
  }
}

// An empty TMPDIR is as good as none.
async function tmpRoot($: $): Promise<string> {
  const tmpdir = (await $.env.get('TMPDIR')) ?? '';
  const trimmed = tmpdir.replace(/\/+$/, '');
  return trimmed === '' ? '/tmp' : trimmed;
}

// $.session.messages() answers at most this many (claude-code.d.ts).
const TRANSCRIPT_READ = 4096;

// A resumed or forked session starts with an empty `state.scratch`; its
// transcript keeps the scratch tool's answers, which name each directory.
export async function scratchFromTranscript($: $): Promise<{ dirs: string[]; why?: string }> {
  try {
    const messages = await $.session.messages();
    if ('deny' in messages) return { dirs: [], why: `the transcript could not be read` };
    // The read holds only the newest entries, so older answers may be missing.
    const cut =
      messages.length >= TRANSCRIPT_READ
        ? `only the newest ${TRANSCRIPT_READ} messages were read`
        : undefined;
    const texts = messages.flatMap((m) =>
      m.toolUses.flatMap((u) =>
        u.tool === 'mcp__review-cycle__scratch' && typeof u.text === 'string' ? [u.text] : [],
      ),
    );
    const named = scratchNamed(texts, await tmpRoot($)).filter((d) => !state.scratch.includes(d));
    const dirs: string[] = [];
    for (const dir of named) {
      const there = await run($, ['test', '-d', dir]);
      if (there.exitCode === 0) dirs.push(dir);
    }
    return cut === undefined ? { dirs } : { dirs, why: cut };
  } catch (error) {
    return { dirs: [], why: `reading the transcript failed (${messageOf(error)})` };
  }
}

export async function onSweep(
  $: $,
  e: Input<SweepHook>,
  _next: NextOf<SweepHook>,
): Promise<Output<SweepHook>> {
  if (reviewPr.open && e.agentId === undefined) {
    state.reviewing = null;
    reviewPr.open = false;
  }
  return { result: await sweepScratch($) };
}

// Why a directory read back must be left, or null to sweep it: its `.owner`
// names another Claude Code process that still runs. A directory without a
// readable mark is left to `spareInUse`.
async function ownerStillRunning($: $, dir: string): Promise<string | null> {
  const mark = await run($, ['cat', `${dir}/.owner`]);
  const owner = ownerOf(mark.stdout);
  if (owner === null) return null;
  const self = await run($, ['sh', '-c', 'echo "$PPID"']);
  const own = Number(self.stdout.trim());
  const now = await run($, [
    'env',
    'LC_ALL=C',
    'TZ=UTC0',
    'ps',
    '-o',
    'lstart=',
    '-p',
    String(owner.pid),
  ]);
  return madeByAnother(owner, own, now.stdout)
    ? `made by a session still running (pid ${owner.pid})`
    : null;
}

// Sweeps every scratch directory this conversation made, and says what it did.
async function sweepScratch($: $): Promise<string> {
  const earlier = await scratchFromTranscript($);
  const unread =
    earlier.why === undefined
      ? ''
      : ` Directories made before a resume or fork may not all have been looked for: ${earlier.why}.`;
  const dirs = [...state.scratch, ...earlier.dirs];
  if (dirs.length === 0) return `No scratch directory to sweep.${unread}`;
  const swept = [];
  for (const dir of dirs) {
    let r;
    try {
      const own = state.scratch.includes(dir);
      // A fork shares its parent's transcript, so the parent may still be
      // working in a directory read from it, between rounds as well as during.
      const runner = own ? null : await ownerStillRunning($, dir);
      r =
        runner === null
          ? await sweep(
              (argv) => run($, argv),
              (ms) => $.clock.sleep(ms),
              dir,
              0,
              { spareInUse: !own },
            )
          : { dir, stopped: 0, removed: false, errors: [`left: ${runner}`] };
    } catch (error) {
      r = { dir, stopped: 0, removed: false, errors: [messageOf(error)] };
    }
    // Kept until it is gone, so a failed sweep can be tried again.
    if (r.removed) state.scratch = state.scratch.filter((d) => d !== dir);
    swept.push(r);
  }
  return `${JSON.stringify(swept, null, 2)}${unread}`;
}
