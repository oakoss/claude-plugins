import { describe, expect, mock } from 'claude-code/testing';

import {
  band,
  create,
  FAILING_CI,
  type Gh,
  lineIn,
  person,
  prJson,
  PUSH_OUT,
  pushJson,
  RUNNING_CI,
  start,
  T0,
  test,
  tool,
  URL,
  world,
} from './world';

// pr-watch's store as a session `id` left it, watching `pulls`.
const resumed = (id: string, pulls: unknown[]) =>
  new Map<string, unknown>([[`session:${id}`, { at: T0 - 60_000, pulls }]]);

const pullsIn = (gh: Gh, id: string) =>
  (gh.store!.get(`session:${id}`) as { pulls: { url: string }[] } | undefined)?.pulls;

const saved = (told: string[] = []) => ({
  host: 'github.com',
  repo: 'o/r',
  number: 128,
  url: URL,
  told,
});

describe('a resumed session', () => {
  const OPEN = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
  const FAILED_RUN = JSON.stringify([7, 'https://github.com/o/r/actions/runs/1', 1]);

  test('saves the pull requests it watches under the session id, and their removal', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), session: 'abc' };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(2000);
    expect(pullsIn(gh, 'abc')?.map((p) => p.url)).toEqual([URL]);
    await tool($, 'unwatch', { pull: '128' });
    await clock.advance(2000);
    expect(pullsIn(gh, 'abc')).toEqual([]);
  });

  test("leaves other sessions' saved watches alone, and writes only on a change", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const store = resumed('other', [saved()]);
    let writes = 0;
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      store,
      onStoreSet: () => void (writes += 1),
    };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(5000);
    expect(pullsIn(gh, 'other')?.map((p) => p.url)).toEqual([URL]);
    expect(pullsIn(gh, 's1')?.map((p) => p.url)).toEqual([URL]);
    expect(writes).toBe(1);
  });

  test('a store that refuses writes says so once, and tries again after a while', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    let refuse = true;
    let tries = 0;
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      view: JSON.stringify({ url: 'https://github.com/o/r/pull/77', state: 'OPEN' }),
      onStoreSet: () => {
        tries += 1;
        return refuse ? 'disk full' : undefined;
      },
    };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(5000);
    expect(tries).toBe(1);
    expect(seen.toasts.filter((t) => t.includes('could not save its watches'))).toHaveLength(1);
    refuse = false;
    await clock.advance(20_000);
    expect(tries).toBe(1);
    await clock.advance(10_000);
    expect(tries).toBe(2);
    expect(pullsIn(gh, 's1')?.map((p) => p.url)).toEqual([URL]);
  });

  test('a ready line still waiting for a message is saved as untold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: {} };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(3000);
    const told = (gh.store!.get('session:s1') as { pulls: { told: string[] }[] }).pulls[0]?.told;
    expect(told).toEqual([]);
    await $.prompt.submit(person());
    await clock.advance(2000);
    const after = (gh.store!.get('session:s1') as { pulls: { told: string[] }[] }).pulls[0]?.told;
    expect(after).toEqual([JSON.stringify(['o/r', 128, 'ready'])]);
  });

  test('a session that watches nothing saves nothing', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson() };
    world(on, gh);
    await start($);
    await clock.advance(5000);
    expect(gh.store!.size).toBe(0);
  });

  test('a push is not saved', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS') };
    world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(2000);
    expect(gh.store!.size).toBe(0);
  });

  test('watches again what it watched, and tells a failure that came meanwhile', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [FAILING_CI]),
      store: resumed('s1', [saved()]),
    };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 ✗ CI: Typecheck failed/);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('CI: Typecheck failed');
  });

  test('news told before the exit is not told again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [FAILING_CI]),
      store: resumed('s1', [saved([FAILED_RUN])]),
    };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 ✗ CI: Typecheck failed/);
    expect(seen.wakes).toEqual([]);
  });

  test('a ready pull request reaches the next message after the resume', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: {}, store: resumed('s1', [saved()]) };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]?.[0]).toContain('GitHub reports o/r#128 ready to merge.');
  });

  test('another session id finds nothing to restore', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), session: 'new', store: resumed('s1', [saved()]) };
    world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a branch carries the parent session’s watches to its new id', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), store: resumed('s1', [saved([FAILED_RUN])]) };
    world(on, gh);
    await start($);
    await clock.advance(1000);
    const r = await ($ as any).classic.SessionStart({ source: 'fork', session_id: 's2' });
    expect(r).toEqual({ additionalContext: ['below'] });
    expect(gh.store!.get('session:s2')).toEqual(gh.store!.get('session:s1'));
  });

  test('a refused carry says so and holds back no later save', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    let isRefused = true;
    const gh: Gh = {
      pr: prJson(),
      store: resumed('s1', [saved()]),
      onStoreSet: (key) => {
        if (!isRefused || key !== 'session:s2') return;
        isRefused = false;
        return 'disk full';
      },
    };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    await ($ as any).classic.SessionStart({ source: 'fork', session_id: 's2' });
    expect(seen.toasts).toContain(
      "pr-watch could not carry the session's watches into the branch: pr-watch: $.store.set: disk full",
    );
    // A fork runs no session.start, so nothing clears a back-off before the branch saves.
    gh.session = 's2';
    await clock.advance(2000);
    expect(gh.store!.has('session:s2')).toBe(true);
  });

  test('a branched session restores the watches carried to it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), session: 's1', store: resumed('s1', [saved()]) };
    world(on, gh);
    await ($ as any).classic.SessionStart({ source: 'fork', session_id: 's2' });
    gh.session = 's2';
    await start($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 /);
  });

  test('a /clear, a startup, or a session already saved carries nothing', async ($, on) => {
    mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), store: resumed('s1', [saved()]) };
    world(on, gh);
    await ($ as any).classic.SessionStart({ source: 'clear', session_id: 's2' });
    expect(gh.store!.has('session:s2')).toBe(false);
    await ($ as any).classic.SessionStart({ source: 'startup', session_id: 's4' });
    expect(gh.store!.has('session:s4')).toBe(false);
    gh.store!.set('session:s3', { at: T0, pulls: [] });
    await ($ as any).classic.SessionStart({ source: 'fork', session_id: 's3' });
    expect(gh.store!.get('session:s3')).toEqual({ at: T0, pulls: [] });
  });

  test('a store that cannot be read says so and restores nothing', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), store: resumed('s1', [saved()]), storeFails: true };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(seen.toasts).toEqual([
      "pr-watch could not restore the session's watches: pr-watch: $.store.get: store unreadable",
    ]);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a failed restore is tried again, and its saved watches are not overwritten', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      view: JSON.stringify({ url: 'https://github.com/o/r/pull/77', state: 'OPEN' }),
      store: resumed('s1', [saved()]),
      storeFails: true,
    };
    world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '77' });
    await clock.advance(2000);
    expect(pullsIn(gh, 's1')?.map((p) => p.url)).toEqual([URL]);
    gh.storeFails = false;
    await clock.advance(32_000);
    expect(
      pullsIn(gh, 's1')
        ?.map((p) => p.url)
        .toSorted(),
    ).toEqual(['https://github.com/o/r/pull/128', 'https://github.com/o/r/pull/77']);
  });

  test('a retried restore adds nothing already watched, and a later failure is said', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    let refuse = false;
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      store: resumed('s1', [saved()]),
      storeFails: true,
      onStoreSet: () => (refuse ? 'disk full' : undefined),
    };
    const seen = world(on, gh);
    await start($);
    await create($);
    gh.storeFails = false;
    refuse = true;
    await clock.advance(32_000);
    const listed = await tool($, 'watches');
    expect(listed.split('\n')).toHaveLength(1);
    expect(seen.toasts.filter((t) => t.includes('could not save its watches'))).toHaveLength(1);
  });

  test('a reload of the module brings back nothing the person unwatched', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      store: resumed('s1', [saved()]),
    };
    world(on, gh);
    await start($);
    await clock.advance(1000);
    await tool($, 'unwatch', { pull: '128' });
    await start($);
    await clock.advance(1000);
    expect(await tool($, 'watches')).toBe('pr-watch is watching nothing.');
  });

  test('a ready pull request that woke Claude before the exit does not wake it again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const READY = JSON.stringify(['o/r', 128, 'ready']);
    const gh: Gh = { pr: prJson(), store: resumed('s1', [saved([READY])]) };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
  });

  test('restores each pull request once, and says how many it could not read', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      store: resumed('s1', [saved(), saved(), { host: 'h' }, { ...saved(), told: 5 }]),
    };
    const seen = world(on, gh);
    await start($);
    await clock.advance(1000);
    const listed = await tool($, 'watches');
    expect(listed.split('\n')).toHaveLength(1);
    expect(seen.toasts).toContain(
      "pr-watch restored the session's watches but skipped 1 it could not read",
    );
    expect(seen.toasts.some((t) => t.includes('stopped updating'))).toBe(false);
  });
});
