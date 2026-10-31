import type { EngineInterface, Register } from 'claude-code';

import {
  defaultOf,
  lastSetOf,
  prunedOf,
  TITLE_PREFIX,
  titleFor,
  trunksOf,
  type Stored,
} from './title';

type $ = EngineInterface;

export const register: Register = (on) => {
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e);
    const title = await retitle($, e.cwd, e.session_id, e.session_title);
    return title === null ? r : { ...r, sessionTitle: title };
  });

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await next(e);
    const title = await retitle($, e.cwd, e.session_id, e.session_title);
    return title === null ? r : { ...r, sessionTitle: title };
  });
};

// The title to give the session now, or null. Fails open: when git or the
// store cannot answer, the session keeps the title it has, so a refused
// default-branch read never falls back to guessing main.
async function retitle(
  $: $,
  cwd: string,
  id: string,
  current: string | undefined,
): Promise<string | null> {
  try {
    const branch = await git($, cwd, ['branch', '--show-current']);
    if (branch === null) return null;
    const remote = defaultOf(
      (await gitOrAbsent($, cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])) ?? '',
    );
    const configured =
      remote === null ? await gitOrAbsent($, cwd, ['config', '--get', 'init.defaultBranch']) : null;
    const key = TITLE_PREFIX + id;
    const lastSet = lastSetOf(await $.store.get(key));
    const title = titleFor({ branch, trunks: trunksOf(remote, configured), current, lastSet });
    if (title === null) return null;
    const stored: Stored = { at: await $.clock.now(), title };
    await $.store.set(key, stored);
    // Pruning is housekeeping: its failure must not lose a title already stored as set.
    await prune($).catch(() => null);
    return title;
  } catch {
    return null;
  }
}

async function git($: $, cwd: string, args: string[]): Promise<string | null> {
  const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5000 });
  return r.exitCode === 0 ? r.stdout : null;
}

// A read whose exit 1 means "not set" (`symbolic-ref --quiet` on no ref,
// `config --get` on no key); any other failure throws, so an unreadable ref is
// never taken for an unrecorded one.
async function gitOrAbsent($: $, cwd: string, args: string[]): Promise<string | null> {
  const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5000 });
  if (r.exitCode === 0) return r.stdout;
  if (r.exitCode === 1) return null;
  throw new Error(`git ${args.join(' ')} exited ${r.exitCode}`);
}

async function prune($: $): Promise<void> {
  const all = await $.store.keys();
  const keys = all.filter((k) => k.startsWith(TITLE_PREFIX));
  const entries = await Promise.all(keys.map(async (k) => [k, await $.store.get(k)] as const));
  for (const key of prunedOf(entries)) await $.store.delete(key);
}
