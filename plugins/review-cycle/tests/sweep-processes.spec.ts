import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import { afterEach, describe, expect, test } from 'vitest';

import { sweep, type Run } from '../hooks/sweep';

const run: Run = (argv) => {
  const r = spawnSync(argv[0] ?? '', argv.slice(1), { encoding: 'utf8' });
  return Promise.resolve({
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  });
};
const sleep = async (ms: number) => {
  await wait(ms);
};
const noSleep = () => Promise.resolve();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const started: number[] = [];
const made: string[] = [];
// Each is started as its own process group, so its children go with it.
afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (const dir of made.splice(0)) spawnSync('rm', ['-rf', '--', dir]);
});

function start(command: string, cwd: string): number {
  const child = spawn('sh', ['-c', command], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error(`could not start ${command}`);
  started.push(child.pid);
  return child.pid;
}

function reply(exitCode: number, stdout = '', stderr = '') {
  return Promise.resolve({ exitCode, stdout, stderr });
}

// lsof always finds 4242, which survives TERM and KILL alike.
const stubborn = (calls: string[][]): Run => {
  return (argv) => {
    calls.push(argv);
    if (argv[0] === 'lsof') return reply(0, '4242\n');
    return reply(argv[0] === 'pgrep' ? 1 : 0);
  };
};
const findsCaller: Run = (argv) =>
  argv[0] === 'pgrep' ? reply(0, '777\n') : reply(argv[0] === 'lsof' ? 1 : 0);
const failing: Run = (argv) =>
  argv[0] === 'lsof'
    ? reply(2, '', 'lsof: not permitted')
    : argv[0] === 'pgrep'
      ? reply(2, '', 'pgrep: bad pattern')
      : argv[0] === 'rm'
        ? reply(1, '', 'rm: busy')
        : reply(0);

// Codex's macOS sandbox denies the process list. Any other pgrep failure,
// a missing pgrep included, still runs these tests, so a broken host fails.
const probe = spawnSync('pgrep', ['-x', 'review-cycle-no-such-process'], { encoding: 'utf8' });
const unlistable = probe.status === 3 && probe.stderr.includes('Cannot get process list');

// The leak that prompted the sweep: a reader blocked on a pipe nobody writes,
// and a process left working inside the directory. Real processes, so this
// runs on whatever OS runs the suite.
describe.skipIf(unlistable)(
  'sweep, against real processes (skipped where pgrep cannot list processes)',
  () => {
    test('ends a process working in the directory and a reader blocked on its pipe, then removes it', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'review-cycle-sweep-'));
      writeFileSync(join(dir, 'f'), 'x');
      spawnSync('mkfifo', [join(dir, 'p')]);
      const worker = start('exec sleep 300', dir);
      const reader = start(`exec cat ${JSON.stringify(join(dir, 'p'))}`, tmpdir());
      await sleep(300);
      expect(alive(worker) && alive(reader)).toBe(true);

      const r = await sweep(run, sleep, dir, process.pid);

      await sleep(200);
      expect(alive(worker)).toBe(false);
      expect(alive(reader)).toBe(false);
      expect(existsSync(dir)).toBe(false);
      expect(r.removed).toBe(true);
      expect(r.stopped).toBeGreaterThanOrEqual(2);
      expect(r.errors).toEqual([]);
    });

    test('leaves alone a process outside the directory, or naming a path that only shares its prefix', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'review-cycle-sweep-'));
      const other = start('exec sleep 300', tmpdir());
      const sibling = start(`sleep 300; : ${JSON.stringify(`${dir}.log`)}`, tmpdir());
      const older = start(`sleep 300; : ${JSON.stringify(`${dir}-old`)}`, tmpdir());
      await sleep(200);

      await sweep(run, sleep, dir, process.pid);

      expect(alive(other)).toBe(true);
      expect(alive(sibling)).toBe(true);
      expect(alive(older)).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });

    test('ends a process naming the directory in quotes from outside it', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'review-cycle-sweep-'));
      const watcher = start(`while test -d '${dir}'; do sleep 1; done; sleep 300`, tmpdir());
      await sleep(200);

      const r = await sweep(run, sleep, dir, process.pid);

      await sleep(200);
      expect(alive(watcher)).toBe(false);
      expect(r.stopped).toBe(1);
    });

    // Only pgrep finds the blocked reader, so the path's escaping is what finds it.
    test('finds a blocked reader under a path with regular-expression characters', async () => {
      const parent = mkdtempSync(join(tmpdir(), 'review-cycle-a+b(c)-'));
      made.push(parent);
      const dir = mkdtempSync(join(parent, 'x.'));
      spawnSync('mkfifo', [join(dir, 'p')]);
      const reader = start(`exec cat ${JSON.stringify(join(dir, 'p'))}`, tmpdir());
      await sleep(300);

      const r = await sweep(run, sleep, dir, process.pid);

      await sleep(200);
      expect(alive(reader)).toBe(false);
      expect(r.stopped).toBe(1);
    });
  },
);

describe('sweep, with a scripted runner', () => {
  test('a TERM that does not end a process is followed by KILL, and a survivor is reported', async () => {
    const calls: string[][] = [];
    const r = await sweep(stubborn(calls), noSleep, '/tmp/x', 1);
    expect(calls.filter((c) => c[0] === 'kill')).toEqual([
      ['kill', '-TERM', '4242'],
      ['kill', '-KILL', '4242'],
    ]);
    expect(r.stopped).toBe(0);
    expect(r.errors).toEqual(['still running after KILL: 4242']);
  });

  test('the caller is never a target', async () => {
    const r = await sweep(findsCaller, noSleep, '/tmp/x', 777);
    expect(r.stopped).toBe(0);
  });

  test('a failed lookup or removal is reported, not hidden', async () => {
    const r = await sweep(failing, noSleep, '/tmp/x', 1);
    expect(r.removed).toBe(false);
    expect(r.errors).toEqual([
      'lsof failed: lsof: not permitted',
      'pgrep failed: pgrep: bad pattern',
      'rm failed: rm: busy',
    ]);
  });
});
