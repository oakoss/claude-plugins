import { describe, expect, mock } from 'claude-code/testing';

import {
  band,
  create,
  draftJson,
  type Gh,
  lineIn,
  mergedJson,
  OPEN_VIEW,
  PASSED_CI,
  prJson,
  pullUrl,
  PUSH_OUT,
  pushJson,
  pushLineIn,
  reads,
  RUNNING_CI,
  stackJson,
  start,
  submitOut,
  T0,
  test,
  tool,
  URL,
  VIEW,
  world,
} from './world';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((r) => {
    settle = r;
  });
  return { promise, resolve: () => settle?.() };
}

const blocked = (number: number, url: string) =>
  prJson({ number, url, mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);

const layer = (n: number, over: Record<string, unknown> = {}, suites: unknown[] = []) =>
  prJson({ number: n, url: pullUrl(n), ...over }, suites);

describe('the tools', () => {
  test('are registered when the session starts', async ($, on) => {
    const seen = world(on, { pr: prJson() });
    await start($);
    expect(seen.registered).toEqual(['watch', 'unwatch', 'watches']);
    expect(seen.toasts).toEqual([]);
    // Claude sends only what the schema offers.
    expect(seen.schemas.watch).toMatchObject({ properties: { wake: { type: 'boolean' } } });
    expect(seen.schemas.unwatch).not.toMatchObject({ properties: { wake: {} } });
  });

  test('one refused leaves the others, and says so once', async ($, on) => {
    const seen = world(on, { pr: prJson(), registerFails: 'unwatch' });
    await start($);
    expect(seen.registered).toEqual(['watch', 'watches']);
    expect(seen.toasts).toEqual([
      'pr-watch could not offer Claude its tools: unwatch (pr-watch: $.tool.register: registry closed)',
    ]);
  });

  test('watch reads a pull request at once and answers with its news, told no more', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN_VIEW });
    await start($);
    const answer = await tool($, 'watch', { pull: '128' });
    // One line names it; the band, not the answer, draws its progress.
    expect(answer.split('\n')[0]).toBe(
      'pr-watch is now watching o/r#128 on its line above the prompt. It tells you when that changes, at once or with the next message, so there is no need to poll gh.',
    );
    expect(answer).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.order).toContain('gh pr view 128 --json url,state,mergedAt');
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
    await clock.advance(70_000);
    // A prompt from a tool call's hook would wait on that turn; the host refuses it.
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
    expect(seen.wakes).toEqual([]);
    // Watching it again keeps what its line has read, and says nothing new.
    expect(await tool($, 'watch', { pull: URL })).toContain('was already watching o/r#128');
    await clock.advance(70_000);
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
    expect(await tool($, 'watches')).toBe(`${URL}: #128 ✓ ready to merge`);
  });

  for (const wake of [true, false]) {
    test(`watch with wake ${wake} ${wake ? 'wakes Claude once' : 'leaves for the next prompt'} when it turns ready, while merges need asking`, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = {
        pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
        view: OPEN_VIEW,
        stopBefore: {},
      };
      const seen = world(on, gh);
      await start($);
      const answer = await tool($, 'watch', { pull: '128', wake });
      expect(answer.includes('wakes you when it turns ready to merge')).toBe(wake);
      gh.pr = prJson();
      await clock.advance(70_000);
      expect(seen.wakes).toHaveLength(wake ? 1 : 0);
      if (wake) expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
      await clock.advance(70_000);
      expect(seen.wakes).toHaveLength(wake ? 1 : 0);
    });
  }

  test('watch with wake still wakes Claude for a release pull request, and suggests nothing', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const head = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    const gh: Gh = {
      pr: prJson({ ...head, mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      view: OPEN_VIEW,
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128', wake: true });
    gh.pr = prJson(head);
    await clock.advance(70_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('the release pull request, ready to merge');
    expect(seen.suggested).toEqual([]);
  });

  test('watch with wake wakes Claude for that pull request only', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const url129 = 'https://github.com/o/r/pull/129';
    const gh: Gh = {
      pr: blocked(128, URL),
      prs: { 129: blocked(129, url129) },
      view: OPEN_VIEW,
      views: { 129: JSON.stringify({ url: url129, state: 'OPEN', mergedAt: null }) },
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128', wake: true });
    await tool($, 'watch', { pull: '129' });
    gh.pr = prJson();
    gh.prs = { 129: prJson({ number: 129, url: url129 }) };
    await clock.advance(70_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('o/r#128 ready to merge');
    expect(seen.wakes[0]).not.toContain('#129');
  });

  test('watch with wake on a stack top layer wakes Claude once the whole stack is ready', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const stack = stackJson(236, [234, 235]);
    const gh: Gh = {
      pr: prJson(),
      prs: { 234: layer(234, { mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), 235: layer(235) },
      views: { 235: JSON.stringify({ url: pullUrl(235), state: 'OPEN', mergedAt: null }) },
      stacks: { 234: stack, 235: stack },
      stopBefore: {},
    };
    const seen = world(on, gh, submitOut([234, 235]));
    await start($);
    await create($, 'gh stack submit --auto');
    await tool($, 'watch', { pull: '235', wake: true });
    await clock.advance(3000);
    expect(seen.wakes).toEqual([]);
    gh.prs = { ...gh.prs, 234: layer(234) };
    await clock.advance(15_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('o/r#235 ready to merge');
  });

  test('watch with wake makes the passed checks of a merge Claude made wake it, once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), view: VIEW };
    const seen = world(on, gh, '');
    await start($);
    await create($, 'gh pr merge 128 --squash');
    await tool($, 'watch', { pull: '128', wake: true });
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    await clock.advance(92_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain("merge commit's checks passed");
    await clock.advance(200_000);
    expect(seen.wakes).toHaveLength(1);
  });

  test('watch with wake on one already ready says it is ready now', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN_VIEW, stopBefore: {} });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    const answer = await tool($, 'watch', { pull: '128', wake: true });
    expect(answer).toContain('It is ready to merge now.');
    expect(answer).not.toContain('wakes you when it turns ready');
  });

  test('watch with wake on a draft whose checks passed says so now', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: draftJson('a1', [PASSED_CI]), view: OPEN_VIEW });
    await start($);
    await create($);
    await clock.advance(1000);
    const answer = await tool($, 'watch', { pull: '128', wake: true });
    expect(answer).toContain('Its checks have passed now.');
    expect(answer).not.toContain('wakes you when it turns ready');
  });

  test('a wake asked while a tick saves the session is kept by its sweep', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const url129 = 'https://github.com/o/r/pull/129';
    const gh: Gh = {
      pr: blocked(128, URL),
      prs: { 129: blocked(129, url129) },
      view: OPEN_VIEW,
      views: { 129: JSON.stringify({ url: url129, state: 'OPEN', mergedAt: null }) },
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '129' });
    // The next tick saves the new list and waits on that write.
    const write = deferred();
    const held = deferred();
    gh.storeHold = () => {
      gh.storeHold = undefined;
      held.resolve();
      return write.promise;
    };
    const ticking = clock.advance(1000);
    await held.promise;
    await tool($, 'watch', { pull: '128', wake: true });
    write.resolve();
    await ticking;
    gh.pr = prJson();
    await clock.advance(70_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('o/r#128 ready to merge');
  });

  test('watch with wake on a merge whose checks passed says so once settled, and wakes only before', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('COMPLETED', 'SUCCESS'), view: VIEW };
    const seen = world(on, gh, '');
    await start($);
    const early = await tool($, 'watch', { pull: '128', wake: true });
    expect(early).toContain('wakes you when it turns ready to merge or its checks pass');
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
    const late = await tool($, 'watch', { pull: '128', wake: true });
    expect(late).toContain("Its merge's checks have passed now.");
  });

  test('a watch that closes takes its wake with it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      view: OPEN_VIEW,
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128', wake: true });
    gh.pr = prJson({ state: 'CLOSED' });
    await clock.advance(70_000);
    expect(await tool($, 'watches')).toBe('pr-watch is watching nothing.');
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await tool($, 'watch', { pull: '128' });
    gh.pr = prJson();
    await clock.advance(70_000);
    expect(seen.wakes).toEqual([]);
  });

  test(
    'watch with wake while waking is off says changes only show on the line',
    { options: { wake: 'off' } },
    async ($, on) => {
      mock.clock(on, { now: T0 });
      world(on, { pr: prJson(), view: OPEN_VIEW });
      await start($);
      const answer = await tool($, 'watch', { pull: '128', wake: true });
      expect(answer).toContain('Waking Claude is off');
      expect(answer).not.toContain('wakes you');
    },
  );

  test('a watch stopped and watched again without wake is quiet again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      view: OPEN_VIEW,
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128', wake: true });
    await tool($, 'unwatch', { pull: '128' });
    await tool($, 'watch', { pull: '128' });
    gh.pr = prJson();
    await clock.advance(70_000);
    expect(seen.wakes).toEqual([]);
  });

  test('watch refuses a wake that is not true or false', async ($, on) => {
    mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: OPEN_VIEW });
    await start($);
    expect(await tool($, 'watch', { pull: '128', wake: 'yes' })).toBe(
      'pr-watch: `wake` is true or false.',
    );
    const answer = await tool($, 'watch', { pull: '128', wake: null });
    expect(answer).toContain('pr-watch is now watching o/r#128');
    expect(answer).not.toContain('wakes you');
  });

  test('watch leaves a read already in flight to tell its own news', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW, holdFirst: true };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await tool($, 'watch', { pull: '128' })).toBe(
      'pr-watch was already watching o/r#128 on its line above the prompt. It tells you when that changes, at once or with the next message, so there is no need to poll gh.',
    );
    expect(reads(seen.runs)).toBe(1);
    gh.release!();
    await clock.advance(1000);
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
    expect(seen.wakes).toHaveLength(1);
  });

  test('watch names the repository to gh, and trims what it is given', async ($, on) => {
    mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN_VIEW });
    await start($);
    await tool($, 'watch', { pull: ' 128 ', repo: 'o/r' });
    await tool($, 'watch', { pull: '128', repo: '' });
    expect(seen.order).toEqual([
      'gh pr view 128 --repo o/r --json url,state,mergedAt',
      'gh pr view 128 --json url,state,mergedAt',
    ]);
  });

  test('watch says why when it cannot', async ($, on) => {
    mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ state: 'CLOSED' }), view: OPEN_VIEW };
    world(on, gh);
    await start($);
    expect(await tool($, 'watch', { pull: '128' })).toBe(
      'o/r#128 is closed, so pr-watch is not watching it.',
    );
    gh.view = 'not json';
    expect(await tool($, 'watch', { pull: '128' })).toBe(
      'pr-watch: gh pr view named no pull request for 128: not json',
    );
    gh.view = undefined;
    expect(await tool($, 'watch', { pull: '9' })).toBe(
      'pr-watch could not read 9 with gh pr view: no PR',
    );
    for (const input of [{}, { pull: '  ' }, { pull: '9', repo: 5 }]) {
      expect(await tool($, 'watch', input)).toMatch(/^pr-watch: `(pull|repo)`/);
    }
    expect(await tool($, 'watches')).toBe('pr-watch is watching nothing.');
  });

  test(
    'with waking off, watch says the line is where changes show',
    { options: { wake: 'off' } },
    async ($, on) => {
      mock.clock(on, { now: T0 });
      world(on, { pr: prJson(), view: OPEN_VIEW });
      await start($);
      const answer = await tool($, 'watch', { pull: '128' });
      expect(answer).toContain('Waking Claude is off in /config');
      expect(answer).not.toContain('no need to poll');
      // Nothing tells it later, so the answer carries what the line shows.
      expect(answer).toContain('it shows #128 ✓ ready to merge');
    },
  );

  test('watch says when its first read failed, and does not call polling needless', async ($, on) => {
    mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: OPEN_VIEW, readsFail: true });
    await start($);
    const answer = await tool($, 'watch', { pull: '128' });
    expect(answer).toMatch(/Its last read failed \(gh failed: .+\); pr-watch tries again\./);
    expect(answer.split('\n')).toHaveLength(1);
  });

  test(
    'with waking off, watch names a failed read once, in the line it quotes',
    { options: { wake: 'off' } },
    async ($, on) => {
      mock.clock(on, { now: T0 });
      world(on, { pr: prJson(), view: OPEN_VIEW, readsFail: true });
      await start($);
      const answer = await tool($, 'watch', { pull: '128' });
      expect(answer).toContain('it shows #128 gh failed: ');
      expect(answer.match(/gh failed/g)).toHaveLength(1);
    },
  );

  test('watch says a pull request unwatched during its read is not watched', async ($, on) => {
    mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW, holdFirst: true };
    world(on, gh);
    await start($);
    const answer = tool($, 'watch', { pull: '128' });
    // Until the first read is held.
    for (let i = 0; i < 50 && !gh.release; i += 1) await Promise.resolve();
    await tool($, 'unwatch', { pull: '128' });
    gh.release!();
    expect(await answer).toBe(
      'o/r#128 is no longer watched: its line was removed while pr-watch read it.',
    );
  });

  test('watch says when it could not finish its first read', async ($, on) => {
    mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: OPEN_VIEW });
    // The add saves; every save after it is refused.
    let saves = 0;
    on('state.set', ($: unknown, e: { key?: string }, next: any) => {
      if (e.key === 'watches' && (saves += 1) > 1) return next({ ...e, value: undefined });
      return next(e);
    });
    await start($);
    const answer = await tool($, 'watch', { pull: '128' });
    expect(answer).toContain('It could not finish its first read: ');
    expect(answer).not.toContain('no need to poll');
  });

  test('watch and unwatch take `pr` for `pull`', async ($, on) => {
    mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: OPEN_VIEW });
    await start($);
    expect(await tool($, 'watch', { pull: '', pr: '128' })).toContain(
      'pr-watch is now watching o/r#128',
    );
    expect(await tool($, 'unwatch', { pr: '128' })).toBe('pr-watch stopped watching o/r#128.');
    expect(await tool($, 'watch', {})).toContain('`pull` names a pull request');
  });

  test('unwatch stops a watch by number, URL, head branch or pushed branch', async ($, on) => {
    mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128' });
    expect(await tool($, 'unwatch', { pull: '7' })).toBe('pr-watch is not watching 7.');
    expect(await tool($, 'unwatch', { pull: '#128', repo: 'x/y' })).toBe(
      'pr-watch is not watching #128.',
    );
    expect(await tool($, 'unwatch', { pull: '#128' })).toBe('pr-watch stopped watching o/r#128.');
    expect(await lineIn(await band($))).toBeUndefined();
    await tool($, 'watch', { pull: '128' });
    expect(await tool($, 'unwatch', { pull: URL })).toBe('pr-watch stopped watching o/r#128.');
    // A head branch resolves through gh, the way watch found it.
    await tool($, 'watch', { pull: 'feat/x' });
    expect(await tool($, 'unwatch', { pull: 'feat/x' })).toBe('pr-watch stopped watching o/r#128.');
    gh.view = undefined;
    expect(await tool($, 'unwatch', { pull: 'feat/y' })).toBe(
      'pr-watch is not watching a push to feat/y, and pr-watch could not read feat/y with gh pr view: no PR',
    );
  });

  test('unwatch stops a pushed branch, within its repository', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), push: pushJson('IN_PROGRESS') }, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    expect(await tool($, 'unwatch', { pull: 'feat/x', repo: 'x/y' })).toBe(
      'pr-watch is not watching a push to feat/x, and pr-watch could not read feat/x with gh pr view: no PR',
    );
    expect(await tool($, 'unwatch', { pull: 'feat/x' })).toBe(
      'pr-watch stopped watching the push to feat/x on o/r.',
    );
    expect(await pushLineIn(await band($))).toBeUndefined();
  });

  test('unwatch refuses a number two repositories share', async ($, on) => {
    mock.clock(on, { now: T0 });
    const other = 'https://github.com/x/y/pull/128';
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128' });
    gh.view = JSON.stringify({ url: other, state: 'OPEN', mergedAt: null });
    await tool($, 'watch', { pull: '128', repo: 'x/y' });
    expect(await tool($, 'unwatch', { pull: '128' })).toBe(
      `128 matches ${URL}, ${other}; name one by its URL or repo.`,
    );
    expect(await tool($, 'unwatch', { pull: '128', repo: 'x/y' })).toBe(
      'pr-watch stopped watching x/y#128.',
    );
    const listed = await tool($, 'watches');
    expect(listed.split('\n')).toHaveLength(1);
  });
});

describe('what is not watched', () => {
  test('a PR URL printed by a command other than gh pr create', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    await start($);
    await create($, 'gh pr view 128');
    await clock.advance(1000);
    expect(seen.runs).toEqual([]);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a gh pr create that failed', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() }, `${URL}\n`, true);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.runs).toEqual([]);
    expect(await lineIn(await band($))).toBeUndefined();
  });
});
