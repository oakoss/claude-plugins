// What a session is titled from the git branch it works on. Pure: register.ts
// reads git and the store, and passes what they said here.

export const TITLE_PREFIX = 'title:';
export const TITLES_KEPT = 200;

const REMOTE_HEAD = 'refs/remotes/origin/';

// The branch's name past its first `/`: fix/force-choice-gaps is force-choice-gaps.
export function shortNameOf(branch: string): string {
  const at = branch.indexOf('/');
  return at === -1 ? branch : branch.slice(at + 1);
}

// The default branch from `git symbolic-ref refs/remotes/origin/HEAD`
// (`refs/remotes/origin/main`), or null when a clone never recorded it. The
// full ref, since `--short` prints `remotes/origin/main` when a local branch
// is named `origin/main`.
export function defaultOf(stdout: string): string | null {
  const ref = stdout.trim();
  return ref.startsWith(REMOTE_HEAD) && ref.length > REMOTE_HEAD.length
    ? ref.slice(REMOTE_HEAD.length)
    : null;
}

// The branches that leave the title: the remote's default when recorded, else
// `init.defaultBranch`, `main` and `master`.
export function trunksOf(remote: string | null, configured: string | null): string[] {
  if (remote !== null) return [remote];
  const name = configured?.trim() ?? '';
  return [...new Set([name, 'main', 'master'].filter((b) => b !== ''))];
}

export type Seen = {
  // `git branch --show-current`; empty on a detached HEAD.
  branch: string;
  trunks: readonly string[];
  // The session's custom title, from the hook's input.
  current: string | undefined;
  // The title this plugin last set on the session.
  lastSet: string | undefined;
};

// The title to set, or null to leave the session's own. A title this plugin
// did not set is the person's (/rename, /branch <name>) and stays: the hook
// sees both kinds as one custom title, so only the stored one tells them apart.
export function titleFor(s: Seen): string | null {
  const branch = s.branch.trim();
  if (branch === '' || s.trunks.includes(branch)) return null;
  if (s.current !== undefined && s.current !== s.lastSet) return null;
  const title = shortNameOf(branch);
  return title === s.current ? null : title;
}

export type Stored = { at: number; title: string };

export function lastSetOf(value: unknown): string | undefined {
  const title = (value as { title?: unknown } | null | undefined)?.title;
  return typeof title === 'string' ? title : undefined;
}

function atOf(value: unknown): number {
  const at = (value as { at?: unknown } | null | undefined)?.at;
  return typeof at === 'number' ? at : 0;
}

// The stored titles past the newest TITLES_KEPT, oldest first; an entry with no
// time reads as the oldest.
export function prunedOf(entries: readonly (readonly [string, unknown])[]): string[] {
  const sorted = entries.toSorted((a, b) => atOf(a[1]) - atOf(b[1]));
  return sorted.slice(0, Math.max(0, sorted.length - TITLES_KEPT)).map(([key]) => key);
}
