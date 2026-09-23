import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { added, madeBy, MARK } from '../hooks/attribution';
import { headLog, headLogCount, pushedRefs, remoteRefs, type Git } from '../hooks/git';

// Real git in scratch repositories, so the reflog messages and formats the
// gate reads are git's own rather than a fake's. The user's config is kept
// out, and identity and signing are set per call.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
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

function g(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...IDENTITY, ...args], { cwd, env: ENV, encoding: 'utf8' });
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

function commit(cwd: string, file: string, text: string, message = file): string {
  writeFileSync(join(cwd, file), text);
  g(cwd, 'add', file);
  g(cwd, 'commit', '-q', '-m', message);
  return g(cwd, 'rev-parse', 'HEAD');
}

// A bare remote and two clones of it, `a` with one commit pushed.
function setup(): { a: string; b: string } {
  dir = mkdtempSync(join(tmpdir(), 'rc-attribution-'));
  g(dir, 'init', '-q', '--bare', 'remote.git');
  g(dir, 'clone', '-q', 'remote.git', 'a');
  g(dir, 'clone', '-q', 'remote.git', 'b');
  const a = join(dir, 'a');
  const b = join(dir, 'b');
  commit(a, 'f', '1');
  g(a, 'push', '-q', '-u', 'origin', 'HEAD:main');
  g(b, 'pull', '-q', 'origin', 'main');
  return { a, b };
}

// The lineages madeBy reports for `act`, read the way the gate reads them.
async function made(repo: string, act: () => void, unborn = false) {
  const head = unborn ? '' : g(repo, 'rev-parse', 'HEAD');
  const before = unborn ? [] : await headLog(git, repo, MARK);
  const count = await headLogCount(git, repo, unborn);
  act();
  const n = (await headLogCount(git, repo, false)) - count;
  const entries = added(await headLog(git, repo, n + MARK), before, n);
  if (entries === null) throw new Error('the reflog does not reach the start');
  return madeBy(entries, head);
}

async function pushed(repo: string, act: () => void): Promise<string[]> {
  const before = await remoteRefs(git, repo);
  act();
  return pushedRefs(git, repo, before, await remoteRefs(git, repo));
}

let a = '';
let b = '';
beforeEach(() => {
  ({ a, b } = setup());
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('commits a command made, from HEAD reflog', () => {
  test('a commit', async () => {
    let tip = '';
    const start = g(a, 'rev-parse', 'HEAD');
    expect(await made(a, () => (tip = commit(a, 'x', 'x')))).toEqual([{ base: start, tip }]);
  });
  test('commits whose subjects look like moves', async () => {
    for (const subject of [
      'Fast-forward',
      'feat(start): add',
      'fix(abort): y',
      'wip (finish)',
      'initial pull',
    ]) {
      expect(await made(a, () => commit(a, 'x', subject, subject)), subject).toHaveLength(1);
    }
  });
  test('an amend', async () => {
    const start = g(a, 'rev-parse', 'HEAD');
    const m = await made(a, () => g(a, 'commit', '-q', '--amend', '-m', 'again'));
    expect(m).toEqual([{ base: start, tip: g(a, 'rev-parse', 'HEAD') }]);
  });
  test('a commit on another branch and one on this branch are judged apart', async () => {
    const start = g(a, 'rev-parse', 'HEAD');
    let side = '';
    let main = '';
    const m = await made(a, () => {
      g(a, 'checkout', '-q', '-b', 'side');
      side = commit(a, 's', 's');
      g(a, 'checkout', '-q', 'main');
      main = commit(a, 'm', 'm');
    });
    expect(m).toEqual([
      { base: start, tip: side },
      { base: start, tip: main },
    ]);
  });
  test('the recorded start is placed by count, not by matching lines', async () => {
    const pinned = { ...ENV, GIT_COMMITTER_DATE: '2001-01-01T00:00:00' };
    const run = (...args: string[]) =>
      spawnSync('git', [...IDENTITY, ...args], { cwd: a, env: pinned });
    run('checkout', '-q', '-b', 'side');
    run('checkout', '-q', 'main');
    const m = await made(a, () => {
      run('checkout', '-q', 'side');
      run('commit', '-q', '--allow-empty', '-m', 'on side');
      run('checkout', '-q', 'main');
    });
    expect(m).toHaveLength(1);
  });
  test('a checkout and a reset make none', async () => {
    commit(a, 'x', 'x');
    expect(
      await made(a, () => {
        g(a, 'checkout', '-q', '-b', 'other', 'HEAD~1');
        g(a, 'checkout', '-q', 'main');
        g(a, 'reset', '-q', '--hard', 'HEAD~1');
      }),
    ).toEqual([]);
  });
  test('fast-forward merges make none, with or without -m; a merge commit is one', async () => {
    g(a, 'checkout', '-q', '-b', 'side');
    commit(a, 's', 's');
    g(a, 'checkout', '-q', 'main');
    expect(await made(a, () => g(a, 'merge', '-q', '-m', 'msg', 'side'))).toEqual([]);
    g(a, 'checkout', '-q', '-b', 'side2', 'HEAD~1');
    commit(a, 't', 't');
    g(a, 'checkout', '-q', 'main');
    const m = await made(a, () => g(a, 'merge', '-q', '--no-ff', '--no-edit', 'side2'));
    expect(m).toHaveLength(1);
  });
  test('a fast-forward pull makes none; a merging pull is a commit', async () => {
    commit(b, 'u', 'u');
    g(b, 'push', '-q');
    expect(await made(a, () => g(a, 'pull', '-q', '--ff-only'))).toEqual([]);
    commit(b, 'v', 'v');
    g(b, 'push', '-q');
    commit(a, 'l', 'l');
    const m = await made(a, () => g(a, 'pull', '-q', '--no-rebase', '--no-edit'));
    expect(m).toHaveLength(1);
  });
  test('a rebasing pull is judged from the upstream tip', async () => {
    const up = commit(b, 'u', 'u');
    g(b, 'push', '-q');
    commit(a, 'l', 'l');
    const m = await made(a, () => g(a, 'pull', '-q', '--rebase'));
    expect(m).toEqual([{ base: up, tip: g(a, 'rev-parse', 'HEAD') }]);
  });
  test('a cherry-pick and a revert are commits', async () => {
    g(a, 'checkout', '-q', '-b', 'pick');
    const picked = commit(a, 'p', 'p');
    g(a, 'checkout', '-q', 'main');
    const m = await made(a, () => {
      g(a, 'cherry-pick', picked);
      g(a, 'revert', '--no-edit', 'HEAD');
    });
    expect(m).toHaveLength(1);
    expect(m[0]?.tip).toBe(g(a, 'rev-parse', 'HEAD'));
  });
  test('the first commit on an unborn branch', async () => {
    g(dir, 'init', '-q', 'fresh');
    const fresh = join(dir, 'fresh');
    let tip = '';
    expect(await made(fresh, () => (tip = commit(fresh, 'x', 'x')), true)).toEqual([
      { base: '', tip },
    ]);
  });
  test('an unborn start after the branch was deleted counts only real entries', async () => {
    g(a, 'update-ref', '-d', 'HEAD');
    let x = '';
    let y = '';
    const m = await made(
      a,
      () => {
        x = commit(a, 'x', 'x');
        g(a, 'checkout', '-q', '-b', 'side');
        y = commit(a, 'y', 'y');
      },
      true,
    );
    expect(m).toEqual([
      { base: '', tip: x },
      { base: x, tip: y },
    ]);
  });
  test('a rebase that only checks out the branch makes none', async () => {
    g(a, 'checkout', '-q', '-b', 'feat');
    commit(a, 'f', 'f');
    expect(await made(a, () => g(a, 'rebase', '-q', 'main', 'feat'))).toEqual([]);
  });
  test('an unborn start whose log cannot be read is not counted as empty', async () => {
    g(a, 'update-ref', '-d', 'HEAD');
    const log = join(a, '.git', 'logs', 'HEAD');
    chmodSync(log, 0o000);
    try {
      await expect(headLogCount(git, a, true)).rejects.toThrow('counting');
    } finally {
      chmodSync(log, 0o600);
    }
  });
  test('an unborn start in a reftable repository cannot be counted', async () => {
    g(dir, 'init', '-q', '--ref-format=reftable', 'rt');
    const rt = join(dir, 'rt');
    commit(rt, 'x', 'x');
    g(rt, 'checkout', '-q', '--orphan', 'o');
    await expect(headLogCount(git, rt, true)).rejects.toThrow(
      'cannot be read while HEAD is unborn',
    );
  });
  test('a plumbing commit reached by a reset is not seen', async () => {
    const tree = g(a, 'rev-parse', 'HEAD^{tree}');
    expect(
      await made(a, () => {
        const c = g(a, 'commit-tree', tree, '-p', 'HEAD', '-m', 'plumbing');
        g(a, 'reset', '-q', '--hard', c);
      }),
    ).toEqual([]);
  });
});

describe('pushes, from remote-tracking reflogs', () => {
  test('a push is seen, a fetch is not', async () => {
    expect(
      await pushed(a, () => {
        commit(a, 'x', 'x');
        g(a, 'push', '-q');
      }),
    ).toEqual(['origin/main']);
    commit(b, 'y', 'y');
    g(b, 'pull', '-q', '--no-rebase', '--no-edit');
    g(b, 'push', '-q');
    expect(await pushed(a, () => g(a, 'fetch', '-q'))).toEqual([]);
  });
  test('a push that creates a branch is seen', async () => {
    expect(
      await pushed(a, () => {
        g(a, 'checkout', '-q', '-b', 'nb');
        commit(a, 'n', 'n');
        g(a, 'push', '-q', '-u', 'origin', 'nb');
      }),
    ).toEqual(['origin/nb']);
  });
  test('a push from a fresh clone, whose tracking ref has no reflog yet, is seen', async () => {
    g(dir, 'clone', '-q', 'remote.git', 'c');
    const c = join(dir, 'c');
    expect(
      await pushed(c, () => {
        commit(c, 'x', 'x');
        g(c, 'push', '-q');
      }),
    ).toEqual(['origin/main']);
  });
  test('a push with a pinned committer date is seen', async () => {
    const pinned = { ...ENV, GIT_COMMITTER_DATE: '2001-01-01T00:00:00' };
    expect(
      await pushed(a, () => {
        commit(a, 'x', 'x');
        spawnSync('git', ['push', '-q'], { cwd: a, env: pinned });
      }),
    ).toEqual(['origin/main']);
  });
  test('a renamed remote is not a push', async () => {
    commit(a, 'x', 'x');
    g(a, 'push', '-q');
    expect(await pushed(a, () => g(a, 'remote', 'rename', 'origin', 'upstream'))).toEqual([]);
  });
});
