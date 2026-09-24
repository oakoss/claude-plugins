// What a running reviewer is to leave as it found it, and what the gate tells
// it and the status tool when something moved. The reads take a `Git` the hook
// supplies, as git.ts does; the rest is pure.

import { firstLine, sha, worktreeTree, type Git } from './git';

// HEAD's commit and branch, the staged entries, the working tree and the local
// and worktree config. null marks a part git could not read.
export type RepoState = {
  head: string | null;
  index: string | null;
  work: string | null;
  config: string | null;
};

export const UNREAD: RepoState = { head: null, index: null, work: null, config: null };

// A state and, when a read threw, why.
export type Capture = { state: RepoState; why: string | null };

const PARTS: Record<keyof RepoState, string> = {
  head: 'HEAD',
  index: 'the staged content',
  work: 'the working tree',
  config: 'the local git config',
};

// Neither read takes the index lock that `write-tree` would. The listing is
// hashed inside git, so a large index is not cut at the output limit.
const INDEX_DIGEST =
  'list=$(git ls-files -s) || exit 2; printf %s "$list" | git hash-object --stdin';

export async function repoStateOf(git: Git, root: string): Promise<RepoState> {
  const opts = { cwd: root };
  // rev-parse exits 1 on an unborn branch, symbolic-ref on a detached HEAD;
  // both exiting 1 is a read that failed, since a killed child reads as 1.
  const commit = await git(['git', 'rev-parse', '--verify', '-q', 'HEAD'], opts);
  const branch = await git(['git', 'symbolic-ref', '-q', 'HEAD'], opts);
  const index = await git(['sh', '-c', INDEX_DIGEST], opts);
  const config = await git(['git', 'config', '--list', '--show-scope', '-z'], opts);
  const headRead =
    (commit.exitCode === 0 && branch.exitCode <= 1) ||
    (commit.exitCode === 1 && branch.exitCode === 0);
  return {
    head: headRead ? `${commit.stdout.trim()} ${branch.stdout.trim()}` : null,
    index: index.exitCode === 0 ? sha(index.stdout) : null,
    work: await worktreeTree(git, root),
    config: config.exitCode === 0 ? ownConfig(config.stdout) : null,
  };
}

// `-z` prints scope, then `key\nvalue`, each ended by NUL, so a value that
// spans lines stays whole.
export function ownConfig(z: string): string {
  const fields = z.split('\0');
  const own: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === 'local' || fields[i] === 'worktree')
      own.push(`${fields[i]}\0${fields[i + 1]}`);
  }
  return own.join('\0');
}

export function repoChanges(
  a: RepoState,
  b: RepoState,
): { changed: string[]; unreadable: string[] } {
  const changed: string[] = [];
  const unreadable: string[] = [];
  for (const [k, name] of Object.entries(PARTS) as [keyof RepoState, string][]) {
    if (a[k] === null || b[k] === null) unreadable.push(name);
    else if (a[k] !== b[k]) changed.push(name);
  }
  return { changed, unreadable };
}

export function insideRepo(path: string, top: string): boolean {
  return path === top || path.startsWith(`${top}/`);
}

// The notes for the reviewer and the records for the status tool.
export function containmentReport(r: {
  type: string;
  command: string;
  before: Capture;
  after: Capture;
  background: boolean;
}): { notes: string[]; records: string[] } {
  const shown = firstLine(r.command).slice(0, 80);
  const { changed, unreadable } = repoChanges(r.before.state, r.after.state);
  const notes: string[] = [];
  const records: string[] = [];
  if (changed.length > 0) {
    const what = changed.join(', ');
    records.push(`${r.type}: ${what} changed while \`${shown}\` ran`);
    notes.push(
      `review-cycle: ${what} of the repository under review changed while this command ran, by it or by another agent. If this command made the change, put it back; either way, say so in your report, and keep scratch work in a private directory from mktemp -d.`,
    );
  }
  if (unreadable.length > 0) {
    const whys = [...new Set([r.before.why, r.after.why])].filter((w) => w !== null);
    const what = `${unreadable.join(', ')}${whys.length === 0 ? '' : ` (${whys.join('; ')})`}`;
    records.push(`${r.type}: could not check ${what} while \`${shown}\` ran`);
    notes.push(
      `review-cycle could not check whether this command changed ${what} of the repository under review.`,
    );
  }
  if (r.background) {
    notes.push(
      'review-cycle: this command runs in the background, so what it changes in the repository under review after it returns is not checked.',
    );
  }
  return { notes, records };
}
