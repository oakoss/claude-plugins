// Git reads the gate makes, through a `Git` the hook supplies: `claude plugin
// validate` follows `$` only into functions declared in register.ts, so the
// runner is passed in rather than `$`.

import type { Classification } from './command';
import {
  CONFIG_PATH,
  EMPTY_TREE,
  EXCLUDES,
  coverage,
  ignoresOf,
  type Review,
  type Row,
} from './witness';

export type Run = { exitCode: number; stdout: string; stderr: string };
export type Git = (
  argv: string[],
  opts?: { cwd?: string; env?: Record<string, string>; stdin?: string },
) => Promise<Run>;

// A repository by its working tree and by the object store its worktrees share.
export type Repo = { top: string; common: string };

export function sha(s: string): string | null {
  const t = s.trim();
  return /^[a-f0-9]{40}$/.test(t) ? t : null;
}

export function firstLine(s: string): string {
  return s.trim().split('\n')[0] ?? '';
}

// The repository at `dir` (or the given cwd), 'none' when there is none, and
// a throw when git could not say.
export async function repoAt(git: Git, dir: string | null, cwd?: string): Promise<Repo | 'none'> {
  const argv = ['git', ...(dir === null ? [] : ['-C', dir])];
  const r = await git(
    [...argv, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
    cwd === undefined ? {} : { cwd },
  );
  if (r.exitCode === 0) {
    const [top, common] = r.stdout.trim().split('\n');
    if (top && common) return { top, common };
  }
  if (/not a git repository/i.test(r.stderr)) return 'none';
  throw new Error(`git rev-parse failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
}

// HEAD's commit, or EMPTY_TREE on an unborn branch or when HEAD names a
// missing object; a throw when git failed.
export async function headOf(git: Git, root: string): Promise<string> {
  const r = await git(['git', 'rev-parse', '--verify', '-q', 'HEAD^{commit}'], { cwd: root });
  if (r.exitCode === 0) {
    const head = sha(r.stdout);
    if (head) return head;
  }
  if (r.exitCode === 1 && r.stdout.trim() === '') return EMPTY_TREE;
  throw new Error(`git rev-parse HEAD failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
}

export async function treeOf(git: Git, root: string, commit: string): Promise<string | null> {
  if (commit === EMPTY_TREE) return EMPTY_TREE;
  const r = await git(['git', 'rev-parse', `${commit}^{tree}`], { cwd: root });
  return r.exitCode === 0 ? sha(r.stdout) : null;
}

// The config is read from the tree being judged, not the working tree: an
// `ignore` entry counts only once it is part of what gets reviewed.
async function pathspecs(git: Git, root: string, tree: string): Promise<string[]> {
  const r = await git(['git', 'show', `${tree}:${CONFIG_PATH}`], { cwd: root });
  return ['.', ...EXCLUDES, ...ignoresOf(r.exitCode === 0 ? r.stdout : null)];
}

function nulList(out: string): string[] {
  return out.split('\0').filter(Boolean);
}

// Paths that differ between two trees and need review: the excludes and
// `ignore` patterns applied, the config always included.
export async function reviewablePaths(
  git: Git,
  root: string,
  from: string,
  to: string,
): Promise<string[] | null> {
  const base = ['git', 'diff-tree', '-r', '-z', '--no-renames', '--name-only', from, to, '--'];
  const main = await git([...base, ...(await pathspecs(git, root, to))], { cwd: root });
  const cfg = await git([...base, CONFIG_PATH], { cwd: root });
  if (main.exitCode !== 0 || cfg.exitCode !== 0) return null;
  return [...new Set([...nulList(main.stdout), ...nulList(cfg.stdout)])];
}

// A tree built in a scratch copy of the index, so the real index is never
// touched. `prepare` stages into it; its commands see GIT_INDEX_FILE.
async function scratchTree(
  git: Git,
  root: string,
  prepare: (env: Record<string, string>) => Promise<boolean>,
): Promise<string | null> {
  const mk = await git(['mktemp'], { cwd: root });
  const scratch = mk.stdout.trim();
  if (mk.exitCode !== 0 || !scratch) return null;
  const env = { GIT_INDEX_FILE: scratch };
  try {
    const idx = await git(['git', 'rev-parse', '--path-format=absolute', '--git-path', 'index'], {
      cwd: root,
    });
    const cp = await git(
      [
        'sh',
        '-c',
        'if [ -f "$1" ]; then cp "$1" "$2"; else rm -f "$2"; fi',
        'sh',
        idx.stdout.trim(),
        scratch,
      ],
      { cwd: root },
    );
    if (idx.exitCode !== 0 || cp.exitCode !== 0) return null;
    if (!(await prepare(env))) return null;
    const wt = await git(['git', 'write-tree'], { cwd: root, env });
    return wt.exitCode === 0 ? sha(wt.stdout) : null;
  } finally {
    try {
      await git(['rm', '-f', scratch], { cwd: root });
    } catch {
      // A leftover temp file does not change the verdict.
    }
  }
}

export async function worktreeTree(git: Git, root: string): Promise<string | null> {
  return scratchTree(git, root, async (env) => {
    const add = await git(['git', 'add', '-A'], { cwd: root, env });
    return add.exitCode === 0;
  });
}

// The tree the command's commit would record: the index after replaying its
// `git add`s, plus `add -u` for `commit -a`.
export async function prospectTree(
  git: Git,
  root: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<string | null> {
  return scratchTree(git, root, async (env) => {
    for (const argv of cls.adds) {
      const add = await git(['git', '-C', cls.dir, ...argv], { env });
      if (add.exitCode !== 0) return false;
    }
    if (!cls.commit?.all) return true;
    const update = await git(['git', ...cls.commit.config, 'add', '-u'], { cwd: root, env });
    return update.exitCode === 0;
  });
}

export type Coverage = { rows: Row[]; unread: number };

// Coverage of the paths `to` changes against `from`. `unread` counts reviewed
// trees git could not compare, which then cover nothing.
export async function coverageOf(
  git: Git,
  root: string,
  from: string,
  to: string,
  reviews: readonly Review[],
): Promise<Coverage | null> {
  const changed = await reviewablePaths(git, root, from, to);
  if (changed === null) return null;
  if (changed.length === 0) return { rows: [], unread: 0 };
  let unread = 0;
  const differing = new Map<string, Set<string>>();
  for (const tree of new Set(reviews.flatMap((r) => r.trees))) {
    // Changed paths are literal file names here, never pathspec magic.
    const d = await git(
      [
        'git',
        '--literal-pathspecs',
        'diff-tree',
        '-r',
        '-z',
        '--no-renames',
        '--name-only',
        tree,
        to,
        '--',
        ...changed,
      ],
      { cwd: root },
    );
    if (d.exitCode === 0) differing.set(tree, new Set(nulList(d.stdout)));
    else unread++;
  }
  return { rows: coverage(changed, reviews, differing), unread };
}

// HEAD's parent's tree; the caller has already resolved HEAD to a commit.
export async function parentTree(git: Git, root: string): Promise<string | null> {
  const p = await git(['git', 'rev-parse', '--verify', '-q', 'HEAD^'], { cwd: root });
  return p.exitCode === 0 ? treeOf(git, root, p.stdout.trim()) : EMPTY_TREE;
}

export type Refs = Map<string, string>;

// Every ref that names a commit, directly or through a tag, by name. Symbolic
// refs are left out: their reflog does not follow the ref they point at.
export async function refsOf(git: Git, root: string): Promise<Refs> {
  const r = await git(
    [
      'git',
      'for-each-ref',
      '--format=%(objectname)%09%(objecttype)%09%(*objecttype)%09%(symref)%09%(refname)',
    ],
    { cwd: root },
  );
  if (r.exitCode !== 0) {
    throw new Error(`git for-each-ref failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
  }
  const refs: Refs = new Map();
  for (const line of r.stdout.split('\n')) {
    const [id, type, peeled, symref, name] = line.split('\t');
    if (!id || !name || symref) continue;
    if (type === 'commit' || peeled === 'commit') refs.set(name, id);
  }
  return refs;
}

// A digest of HEAD and every reviewable change against it, blob ids included:
// equal digests mean nothing a reviewer should see has moved.
export async function snapshotOf(
  git: Git,
  root: string,
  head: string,
  tree: string,
): Promise<string | null> {
  const base = ['git', 'diff-tree', '-r', '--no-renames', '--raw', head, tree, '--'];
  const main = await git([...base, ...(await pathspecs(git, root, tree))], { cwd: root });
  const cfg = await git([...base, CONFIG_PATH], { cwd: root });
  if (main.exitCode !== 0 || cfg.exitCode !== 0) return null;
  const bytes = new TextEncoder().encode(`${head}\n${main.stdout}${cfg.stdout}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
