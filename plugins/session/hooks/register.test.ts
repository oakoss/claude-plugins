import { describe, expect, test } from 'claude-code/testing';

// git as the hooks see it: the current branch, the remote's default ref (unset
// when the clone never recorded one), init.defaultBranch, and failures.
type World = {
  branch: string;
  head?: string;
  configured?: string;
  fails?: boolean;
  reject?: boolean;
  // The one git call the engine refuses, by how its argv ends.
  refuse?: string;
  // The default-branch read exits 128, as an unreadable ref does.
  headBroken?: boolean;
  keysFail?: boolean;
};

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout: `${stdout}\n`, stderr: '', isStdoutTruncated: false },
});
// What a hook beneath this plugin returns, which its own result must keep.
const BELOW = ['from below'];

// git's exit for "no such ref" under --quiet, and for an unset config key.
const absent = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false } };
const failed = { value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false } };

function fakeWorld(on: any, w: World): { store: Map<string, unknown>; runs: string[] } {
  const store = new Map<string, unknown>();
  const runs: string[] = [];
  on('process.run', ($: unknown, e: { argv: string[] }) => {
    const argv = e.argv.join(' ');
    runs.push(argv);
    if (w.reject || (w.refuse !== undefined && argv.endsWith(w.refuse))) {
      return { deny: 'spawn failed' };
    }
    if (w.fails) return failed;
    if (argv.endsWith('branch --show-current')) return ok(w.branch);
    if (argv.endsWith('symbolic-ref --quiet refs/remotes/origin/HEAD')) {
      if (w.headBroken) return failed;
      return w.head === undefined ? absent : ok(w.head);
    }
    if (argv.endsWith('config --get init.defaultBranch')) {
      return w.configured === undefined ? absent : ok(w.configured);
    }
    return failed;
  });
  on('store.get', ($: unknown, e: { key: string }) => ({
    value: structuredClone(store.get(e.key)),
  }));
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, structuredClone(e.value));
    return { value: undefined };
  });
  on('store.keys', () => (w.keysFail ? { deny: 'store busy' } : { value: [...store.keys()] }));
  on('store.delete', ($: unknown, e: { key: string }) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on('clock.now', () => ({ value: 1000 }));
  on('classic.SessionStart', () => ({ additionalContext: BELOW }));
  on('classic.UserPromptSubmit', () => ({ additionalContext: BELOW }));
  return { store, runs };
}

const MAIN = 'refs/remotes/origin/main';

async function titled(
  $: any,
  opts: { title?: string; id?: string; cwd?: string } = {},
): Promise<string | undefined> {
  const r = await $.classic.UserPromptSubmit({
    prompt: 'next',
    session_id: opts.id ?? 's1',
    cwd: opts.cwd ?? '/repo',
    ...(opts.title === undefined ? {} : { session_title: opts.title }),
  });
  return r.sessionTitle;
}

describe('the session title', () => {
  test('a prompt on a work branch titles the session after it, keeping what runs below', async ($, on) => {
    const w = fakeWorld(on, { branch: 'feat/session-title', head: MAIN });
    const r = await ($ as any).classic.UserPromptSubmit({
      prompt: 'next',
      session_id: 's1',
      cwd: '/work/other',
    });
    expect(r).toEqual({ additionalContext: BELOW, sessionTitle: 'session-title' });
    expect(w.runs).toContain('git -C /work/other branch --show-current');
    expect(w.store.get('title:s1')).toEqual({ at: 1000, title: 'session-title' });
  });

  test('a session start on a work branch titles it before the first prompt', async ($, on) => {
    fakeWorld(on, { branch: 'fix/x', head: MAIN });
    const r = await ($ as any).classic.SessionStart({
      source: 'startup',
      session_id: 's1',
      cwd: '/repo',
    });
    expect(r).toEqual({ additionalContext: BELOW, sessionTitle: 'x' });
  });

  test('the title follows a branch change it set, and leaves a name it did not', async ($, on) => {
    const world: World = { branch: 'fix/one', head: MAIN };
    const w = fakeWorld(on, world);
    expect(await titled($)).toBe('one');
    world.branch = 'feat/two';
    expect(await titled($, { title: 'one' })).toBe('two');
    expect(w.store.get('title:s1')).toEqual({ at: 1000, title: 'two' });
    world.branch = 'feat/three';
    expect(await titled($, { title: 'my-name' })).toBeUndefined();
    expect(await titled($, { title: 'one' })).toBeUndefined();
  });

  test('each session keeps its own title', async ($, on) => {
    const world: World = { branch: 'fix/one', head: MAIN };
    const w = fakeWorld(on, world);
    expect(await titled($, { id: 's1' })).toBe('one');
    world.branch = 'feat/two';
    expect(await titled($, { id: 's2' })).toBe('two');
    expect(w.store.get('title:s1')).toEqual({ at: 1000, title: 'one' });
    world.branch = 'feat/three';
    expect(await titled($, { id: 's1', title: 'one' })).toBe('three');
  });

  test('a failed prune keeps the title it stored', async ($, on) => {
    const world: World = { branch: 'fix/one', head: MAIN, keysFail: true };
    const w = fakeWorld(on, world);
    expect(await titled($)).toBe('one');
    world.branch = 'feat/two';
    expect(await titled($, { title: 'one' })).toBe('two');
    expect(w.store.get('title:s1')).toEqual({ at: 1000, title: 'two' });
  });

  test('the store keeps the newest 200 titles and nothing else of the plugin’s', async ($, on) => {
    const w = fakeWorld(on, { branch: 'fix/one', head: MAIN });
    for (let i = 0; i < 200; i++) w.store.set(`title:old-${i}`, { at: i, title: 't' });
    w.store.set('other:x', { kept: true });
    expect(await titled($)).toBe('one');
    const titles = [...w.store.keys()].filter((k) => k.startsWith('title:'));
    expect(titles).toHaveLength(200);
    expect(w.store.has('title:old-0')).toBe(false);
    expect(w.store.has('title:old-1')).toBe(true);
    expect(w.store.has('title:s1')).toBe(true);
    expect(w.store.has('other:x')).toBe(true);
  });

  test('a branched session keeps the name /branch gave it', async ($, on) => {
    fakeWorld(on, { branch: 'feat/session-title', head: MAIN });
    const r = await ($ as any).classic.SessionStart({
      source: 'fork',
      session_id: 's2',
      cwd: '/repo',
      session_title: 'my-branch',
    });
    expect(r).toEqual({ additionalContext: BELOW });
  });

  test('a resumed session is retitled when the title is the plugin’s, and kept when it is not', async ($, on) => {
    const w = fakeWorld(on, { branch: 'feat/next', head: MAIN });
    w.store.set('title:s1', { at: 500, title: 'old' });
    const resume = async (session_title: string): Promise<string | undefined> => {
      const r = await ($ as any).classic.SessionStart({
        source: 'resume',
        session_id: 's1',
        cwd: '/repo',
        session_title,
      });
      return r.sessionTitle;
    };
    expect(await resume('renamed')).toBeUndefined();
    expect(w.store.get('title:s1')).toEqual({ at: 500, title: 'old' });
    expect(await resume('old')).toBe('next');
  });

  test('a trunk leaves the title: the recorded default, or else the configured one', async ($, on) => {
    const world: World = { branch: 'develop', head: 'refs/remotes/origin/develop' };
    const w = fakeWorld(on, world);
    expect(await titled($)).toBeUndefined();
    expect(w.runs).not.toContain('git -C /repo config --get init.defaultBranch');
    world.branch = 'trunk';
    world.head = undefined;
    world.configured = 'trunk';
    expect(await titled($)).toBeUndefined();
    world.branch = 'main';
    world.configured = undefined;
    expect(await titled($)).toBeUndefined();
  });

  test('a refused default-branch read leaves the title, never guessing main', async ($, on) => {
    const world: World = {
      branch: 'develop',
      head: 'refs/remotes/origin/develop',
      refuse: 'symbolic-ref --quiet refs/remotes/origin/HEAD',
    };
    fakeWorld(on, world);
    expect(await titled($)).toBeUndefined();
    world.refuse = undefined;
    world.headBroken = true;
    expect(await titled($)).toBeUndefined();
    world.headBroken = false;
    world.branch = 'fix/x';
    world.head = undefined;
    world.refuse = 'config --get init.defaultBranch';
    expect(await titled($)).toBeUndefined();
  });

  test('git failing or refused leaves the title', async ($, on) => {
    const world: World = { branch: 'fix/x', fails: true };
    fakeWorld(on, world);
    expect(await titled($)).toBeUndefined();
    world.fails = false;
    world.reject = true;
    expect(await titled($)).toBeUndefined();
  });
});
