// A reviewer leg runs the project's checks in this copy, so the copy has to
// match the working tree and nothing done in it may reach the repository.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

const SCRIPT = path.join(import.meta.dirname, 'copy-tree.sh');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgSign=false', ...args],
    { cwd, env: ENV, encoding: 'utf8' },
  );
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function copy(...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [SCRIPT, ...args], { env: ENV, encoding: 'utf8' });
}

// A repository with every kind of change git reports, and node_modules at the
// root and in a workspace package, holding a relative link as pnpm's do.
function repo(): { root: string; repo: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'copy-tree-')));
  dirs.push(root);
  const r = path.join(root, 'repo');
  mkdirSync(r);
  git(r, 'init', '-q', '-b', 'main');
  write(path.join(r, 'a.txt'), 'a\n');
  write(path.join(r, 'b.txt'), 'b\n');
  write(path.join(r, '.gitignore'), 'ignored.txt\nnode_modules\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'init');
  write(path.join(r, 'a.txt'), 'changed\n');
  write(path.join(r, 'c.txt'), 'staged\n');
  git(r, 'add', 'c.txt');
  unlinkSync(path.join(r, 'b.txt'));
  write(path.join(r, 'd.txt'), 'untracked\n');
  write(path.join(r, 'ignored.txt'), 'ignored\n');
  write(path.join(r, 'node_modules/pkg/index.js'), 'root\n');
  mkdirSync(path.join(r, 'node_modules/.bin'));
  symlinkSync('../pkg/index.js', path.join(r, 'node_modules/.bin/pkg'));
  write(path.join(r, 'packages/x/node_modules/y/index.js'), 'nested\n');
  // An embedded repository, as a submodule's checkout is.
  git(r, 'init', '-q', 'sub');
  write(path.join(r, 'sub/s.txt'), 'sub\n');
  symlinkSync('does-not-exist', path.join(r, 'dangling'));
  write(path.join(r, '.probe'), 'a project file\n');
  // A listed name tar could read as an option; CI runs this against GNU tar.
  write(path.join(r, '-dash.txt'), 'dash\n');
  git(r, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, repo: r };
}

// Every path under dir whose link points outside it.
function linksOut(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const p = path.join(dir, e);
    if (!lstatSync(p).isSymbolicLink()) continue;
    const target = path.resolve(path.dirname(p), readlinkSync(p));
    if (!target.startsWith(dir + path.sep)) out.push(e);
  }
  return out;
}

test('the copy holds the working tree as git reports it, with no remote', () => {
  const { root, repo: r } = repo();
  const dest = path.join(root, 'copy');
  const run = copy(r, dest);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(git(dest, 'status', '--porcelain')).toBe(git(r, 'status', '--porcelain'));
  expect(git(dest, 'rev-parse', 'HEAD')).toBe(git(r, 'rev-parse', 'HEAD'));
  expect(existsSync(path.join(dest, 'ignored.txt'))).toBe(false);
  expect(existsSync(path.join(dest, 'sub/s.txt'))).toBe(true);
  expect(existsSync(path.join(dest, 'sub/.git'))).toBe(false);
  expect(readFileSync(path.join(dest, '.probe'), 'utf8')).toBe('a project file\n');
  expect(readFileSync(path.join(dest, '-dash.txt'), 'utf8')).toBe('dash\n');
  expect(git(dest, 'remote')).toBe('');
  // A base a check diffs against still resolves.
  expect(git(dest, 'rev-parse', 'main', 'origin/main')).toBe(git(r, 'rev-parse', 'main', 'main'));
});

test('a split index comes with its shared index', () => {
  const { root, repo: r } = repo();
  git(r, 'update-index', '--split-index');
  const dest = path.join(root, 'copy');
  expect(copy(r, dest).status).toBe(0);
  expect(git(dest, 'status', '--porcelain')).toBe(git(r, 'status', '--porcelain'));
});

test.skipIf(process.getuid?.() === 0)('a copy that fails is removed, not left partial', () => {
  const { root, repo: r } = repo();
  chmodSync(path.join(r, 'd.txt'), 0o000);
  const dest = path.join(root, 'copy');
  const run = copy(r, dest);
  expect(run.status).not.toBe(0);
  expect(existsSync(dest)).toBe(false);
});

test('a JavaScript project with no node_modules to copy says so', () => {
  const { root, repo: r } = repo();
  write(path.join(r, 'package.json'), '{}\n');
  const empty = path.join(root, 'empty');
  mkdirSync(empty);
  write(path.join(empty, 'package.json'), '{}\n');
  const run = copy(r, path.join(root, 'copy'), empty);
  expect(run.status).toBe(0);
  expect(run.stderr).toContain('copy-tree: no node_modules under');
});

test('a submodule is named as copied without its git directory', () => {
  const { root, repo: r } = repo();
  const lib = path.join(root, 'lib');
  mkdirSync(lib);
  git(lib, 'init', '-q');
  write(path.join(lib, 'l.txt'), 'lib\n');
  git(lib, 'add', '-A');
  git(lib, 'commit', '-qm', 'lib');
  git(r, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib');
  const run = copy(r, path.join(root, 'copy'));
  expect(run.status).toBe(0);
  expect(run.stderr).toContain('copy-tree: lib is a submodule');
});

test('node_modules are copied, none linked back into the repository', () => {
  const { root, repo: r } = repo();
  const dest = path.join(root, 'copy');
  expect(copy(r, dest).status).toBe(0);
  expect(existsSync(path.join(dest, 'node_modules/.bin/pkg'))).toBe(true);
  expect(existsSync(path.join(dest, 'packages/x/node_modules/y/index.js'))).toBe(true);
  expect(linksOut(dest)).toEqual([]);
});

test("a commit in a worktree's copy leaves the worktree and its repository alone", () => {
  const { root, repo: r } = repo();
  const wt = path.join(root, 'wt');
  git(r, 'worktree', 'add', '-q', '--detach', wt, 'HEAD');
  write(path.join(wt, 'e.txt'), 'staged in the worktree\n');
  git(wt, 'add', 'e.txt');
  const dest = path.join(root, 'copy');
  expect(copy(wt, dest, r).status).toBe(0);
  expect(lstatSync(path.join(dest, '.git')).isDirectory()).toBe(true);
  expect(git(dest, 'status', '--porcelain')).toBe(git(wt, 'status', '--porcelain'));
  // The worktree has no node_modules; the third argument names whose to take.
  expect(existsSync(path.join(dest, 'node_modules/pkg/index.js'))).toBe(true);
  expect(linksOut(dest)).toEqual([]);

  const before = [git(wt, 'status', '--porcelain'), git(wt, 'rev-parse', 'HEAD')];
  git(dest, 'add', '-A');
  git(dest, 'commit', '-qm', 'in the copy');
  const made = git(dest, 'rev-parse', 'HEAD').trim();
  expect([git(wt, 'status', '--porcelain'), git(wt, 'rev-parse', 'HEAD')]).toEqual(before);
  expect(spawnSync('git', ['cat-file', '-e', made], { cwd: r, env: ENV }).status).not.toBe(0);
});

// Bash writes a here-document or here-string to a temporary file outside
// TMPDIR, which Codex's sandbox refuses: the loop it fed then read nothing
// and the copy came out with no node_modules, at exit 0.
test('the script feeds no loop from a here-document', () => {
  expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/<</);
});

test('an existing destination is refused, not written into', () => {
  const { root, repo: r } = repo();
  const dest = path.join(root, 'copy');
  mkdirSync(dest);
  expect(copy(r, dest).status).not.toBe(0);
  expect(readdirSync(dest)).toEqual([]);
});
