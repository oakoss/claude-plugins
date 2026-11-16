import type { EngineInterface, Timer } from 'claude-code';

import type { Lookup } from '../gate/gh-verdict';
import { firstLine, messageOf, repoAt, type Git, type Repo, type Run } from '../gate/git';
import type { Store } from '../ledger/ledger-store';
import { state } from './gate-state';

export type $ = EngineInterface;

// A state call that never answers counts as failed, so one cannot stall every
// later save or the session's start.
const STATE_WAIT_MS = 5000;

export async function within<T>($: $, call: Promise<T>, what: string): Promise<T> {
  let timer: Timer | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = $.clock.after(STATE_WAIT_MS, () =>
      reject(new Error(`${what} did not answer within ${STATE_WAIT_MS / 1000} s`)),
    );
  });
  try {
    return await Promise.race([call, late]);
  } finally {
    timer?.cancel();
  }
}

// Without `cwd`, $.process.run runs in the Bash tool's current directory,
// which is what a command's own relative paths resolve against.
export async function run(
  $: $,
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number } = {},
): Promise<Run> {
  // git's messages are matched in English, so its locale is pinned.
  const env = { LC_ALL: 'C', LANGUAGE: 'C', ...opts.env };
  return $.process.run(argv, { timeoutMs: 60_000, ...opts, env });
}

export function gitOf($: $): Git {
  return (argv, opts) => run($, argv, opts);
}

export async function ensureRoot($: $): Promise<Repo | null> {
  if (state.root === undefined) {
    const repo = await repoAt(gitOf($), null, await $.session.cwd());
    state.root = repo === 'none' ? null : repo;
  }
  return state.root;
}

export async function currentText($: $, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : null;
}

// How long the user waits on a gh read before the step asks.
const LOOKUP_MS = [5000];
// A read confirming a merge the user asked for is tried once more for longer,
// since GitHub is slow at times and asking them again gains nothing.
export const MERGE_LOOKUP_MS = [5000, 10_000];

// A real host's timeout reads "aborted: still running after 5000ms" (measured
// on 2.1.319); the test kit's reads "timed out".
export const TIMED_OUT = /timed? ?out|still running after/i;

// What a gh read printed, or why it asks: "looking up <what> failed (…)" or
// "… printed nothing". `slow` only when every try timed out.
export async function ghRead(
  $: $,
  args: string[],
  what: string,
  schedule = LOOKUP_MS,
): Promise<Lookup> {
  let r: Awaited<ReturnType<typeof $.process.run>> | null = null;
  let failed = '';
  for (const timeoutMs of schedule) {
    try {
      r = await $.process.run(['gh', ...args], { timeoutMs, env: { GH_PROMPT_DISABLED: '1' } });
      break;
    } catch (error) {
      failed = messageOf(error);
      if (!TIMED_OUT.test(failed)) break;
    }
  }
  if (r === null) {
    const slow = TIMED_OUT.test(failed);
    return slow
      ? { asks: `looking up ${what} failed (${failed})`, slow }
      : { asks: `looking up ${what} failed (${failed})` };
  }
  if (r.exitCode !== 0) {
    const why = firstLine(r.stderr) || `it ended with no output, exit ${r.exitCode}`;
    return { asks: `looking up ${what} failed (${why})` };
  }
  // A jq path that meets null prints an empty line and exits 0 (gh 2.102.0).
  const out = r.stdout.trim();
  if (out === '') return { asks: `looking up ${what} printed nothing` };
  return { out };
}

// Keeps another session's store entry at the same moment apart.
export const STORE_TAG = Math.random().toString(36).slice(2, 10);

export function storeOf($: $): Store {
  return {
    get: (key) => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    keys: () => $.store.keys(),
    delete: (key) => $.store.delete(key),
  };
}
