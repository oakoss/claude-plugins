import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { classify } from '../hooks/command';
import {
  coverageOf,
  headOf,
  parentTree,
  prospectTree,
  repoAt,
  reviewablePaths,
  snapshotOf,
  treeOf,
  worktreeTree,
  type Git,
} from '../hooks/git';
import { CONFIG_PATH, EMPTY_TREE } from '../hooks/witness';

// Real git in a scratch repository, so the trees and paths the gate compares
// are git's own. The user's config and global ignore file are kept out, and
// identity is set per call.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  XDG_CONFIG_HOME: '/dev/null',
  LC_ALL: 'C',
};
const IDENTITY = [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@t',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'init.defaultBranch=main',
];

let dir = '';
let repo = '';

function g(...args: string[]): string {
  const r = spawnSync('git', [...IDENTITY, ...args], { cwd: repo, env: ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const git: Git = async (argv, opts = {}) => {
  const r = spawnSync(argv[0] ?? '', argv.slice(1), {
    cwd: opts.cwd,
    env: { ...ENV, ...opts.env },
    input: opts.stdin,
    encoding: 'utf8',
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};

function write(path: string, text: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function commit(path: string, text: string): string {
  write(path, text);
  g('add', path);
  g('commit', '-q', '-m', path);
  return g('rev-parse', 'HEAD');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rc-git-trees-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  g('init', '-q');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the repository and its HEAD', () => {
  test('a repository names its top and common dir; outside one is none', async () => {
    const r = await repoAt(git, repo);
    expect(r).not.toBe('none');
    expect(r === 'none' ? '' : r.common).toMatch(/\.git$/);
    expect(await repoAt(git, dir)).toBe('none');
  });

  test('an unborn HEAD is the empty tree, and a commit its own id', async () => {
    expect(await headOf(git, repo)).toBe(EMPTY_TREE);
    const c = commit('a.ts', 'a');
    expect(await headOf(git, repo)).toBe(c);
  });

  test("a commit's tree, the empty tree as itself, and nothing for what is not a commit", async () => {
    const c = commit('a.ts', 'a');
    expect(await treeOf(git, repo, c)).toBe(g('rev-parse', `${c}^{tree}`));
    expect(await treeOf(git, repo, EMPTY_TREE)).toBe(EMPTY_TREE);
    expect(await treeOf(git, repo, 'f'.repeat(40))).toBeNull();
  });

  test("the first commit's parent tree is empty, and a later one's is its parent's", async () => {
    const first = commit('a.ts', 'a');
    expect(await parentTree(git, repo)).toBe(EMPTY_TREE);
    commit('b.ts', 'b');
    expect(await parentTree(git, repo)).toBe(g('rev-parse', `${first}^{tree}`));
  });
});

describe('the working tree as a tree', () => {
  test('includes untracked and modified files, and leaves the real index alone', async () => {
    commit('a.ts', 'a');
    write('a.ts', 'changed');
    write('new.ts', 'new');
    const tree = await worktreeTree(git, repo);
    const paths = g('ls-tree', '-r', '--name-only', tree).split('\n');
    expect(paths).toEqual(['a.ts', 'new.ts']);
    expect(g('show', `${tree}:a.ts`)).toBe('changed');
    expect(g('diff', '--cached', '--name-only')).toBe('');
  });

  test("a commit's tree is the index after its adds, plus tracked edits for commit -a", async () => {
    commit('a.ts', 'a');
    write('a.ts', 'edited');
    write('b.ts', 'b');
    const add = classify('git add b.ts && git commit -m x');
    const all = classify('git commit -am x');
    if (add.kind !== 'gated' || all.kind !== 'gated') throw new Error('not gated');
    const added = await prospectTree(git, repo, { ...add, dir: repo });
    expect(g('show', `${added}:a.ts`)).toBe('a');
    expect(g('show', `${added}:b.ts`)).toBe('b');
    const tracked = await prospectTree(git, repo, { ...all, dir: repo });
    expect(g('show', `${tracked}:a.ts`)).toBe('edited');
    expect(g('ls-tree', '-r', '--name-only', tracked)).toBe('a.ts');
  });

  test("a commit's adds run in the command's directory, not the repository root", async () => {
    commit('a.ts', 'a');
    write('sub/b.ts', 'b');
    const add = classify('git add b.ts && git commit -m x');
    if (add.kind !== 'gated') throw new Error('not gated');
    const added = await prospectTree(git, repo, { ...add, dir: join(repo, 'sub') });
    expect(g('show', `${added}:sub/b.ts`)).toBe('b');
  });
});

describe('the paths a review must cover', () => {
  test('are the changed ones, without editor and task state', async () => {
    const base = commit('a.ts', 'a');
    write('a.ts', 'changed');
    write('.beads/issues.jsonl', 'x');
    write('.vscode/settings.json', '{}');
    const tree = await worktreeTree(git, repo);
    expect(await reviewablePaths(git, repo, g('rev-parse', `${base}^{tree}`), tree)).toEqual([
      'a.ts',
    ]);
  });

  test('leave out what the config in the judged tree ignores, never the config itself', async () => {
    const base = g('rev-parse', `${commit('a.ts', 'a')}^{tree}`);
    write('gen/out.js', 'x');
    write(CONFIG_PATH, JSON.stringify({ ignore: ['gen/**', '.claude/**'] }));
    const ignoring = await worktreeTree(git, repo);
    write(CONFIG_PATH, '{}');
    const plain = await worktreeTree(git, repo);
    // Each tree is judged by its own config, whatever the working tree holds now.
    write(CONFIG_PATH, JSON.stringify({ ignore: ['gen/**'] }));
    expect(await reviewablePaths(git, repo, base, ignoring)).toEqual([CONFIG_PATH]);
    const paths = await reviewablePaths(git, repo, base, plain);
    expect(paths?.toSorted()).toEqual([CONFIG_PATH, 'gen/out.js'].toSorted());
  });

  test('a tree git cannot read gives no answer', async () => {
    commit('a.ts', 'a');
    expect(await reviewablePaths(git, repo, EMPTY_TREE, 'f'.repeat(40))).toBeNull();
  });
});

describe('coverage of a commit by reviews', () => {
  test('a reviewed path is covered, one edited since is not, and an unread tree counts', async () => {
    const base = g('rev-parse', `${commit('a.ts', 'a')}^{tree}`);
    write('a.ts', 'reviewed');
    write('b.ts', 'b');
    const seen = await worktreeTree(git, repo);
    const reviews = [
      { type: 'code-reviewer', trees: [seen, seen] as const, reviewedPaths: ['a.ts', 'b.ts'] },
    ];
    write('b.ts', 'edited after');
    const now = await worktreeTree(git, repo);
    const c = await coverageOf(git, repo, base, now, reviews);
    expect(c?.rows).toEqual([
      { path: 'a.ts', state: 'covered' },
      { path: 'b.ts', state: 'edited-after-review' },
    ]);
    expect(c?.unread).toBe(0);
    const lost = reviews.map((r) => ({ ...r, trees: ['f'.repeat(40), 'f'.repeat(40)] as const }));
    const unread = await coverageOf(git, repo, base, now, lost);
    expect(unread?.unread).toBe(1);
  });

  test('a path no review saw is never reviewed', async () => {
    const base = g('rev-parse', `${commit('a.ts', 'a')}^{tree}`);
    write('c.ts', 'c');
    const now = await worktreeTree(git, repo);
    const c = await coverageOf(git, repo, base, now, []);
    expect(c?.rows).toEqual([{ path: 'c.ts', state: 'never-reviewed' }]);
  });
});

describe('the snapshot digest', () => {
  test('moves with reviewable content and HEAD, and not with excluded state', async () => {
    const head = commit('a.ts', 'a');
    write('a.ts', 'one');
    const one = await snapshotOf(git, repo, head, await worktreeTree(git, repo));
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    write('.beads/issues.jsonl', 'x');
    expect(await snapshotOf(git, repo, head, await worktreeTree(git, repo))).toBe(one);
    write('a.ts', 'two');
    expect(await snapshotOf(git, repo, head, await worktreeTree(git, repo))).not.toBe(one);
    const moved = commit('b.ts', 'b');
    write('a.ts', 'one');
    expect(await snapshotOf(git, repo, moved, await worktreeTree(git, repo))).not.toBe(one);
  });
});
