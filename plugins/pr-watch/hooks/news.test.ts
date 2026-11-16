import { describe, expect, mock } from 'claude-code/testing';

import {
  band,
  ciSuite,
  create,
  draftJson,
  FAILING_CI,
  type Gh,
  ID,
  lineIn,
  PASSED_CI,
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

function failedJob(name: string, run = 1, job = 10) {
  const detailsUrl = `https://github.com/o/r/actions/runs/${run}/job/${job}`;
  return { name, status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl, isRequired: false };
}

// A running pull request with these comments, read by `me`.
function commentedJson(comments: unknown[], reviews: unknown[] = [], suites = [RUNNING_CI]) {
  const activity = { comments: { nodes: comments }, reviews: { nodes: reviews } };
  const body = JSON.parse(prJson(activity, suites));
  body.data.viewer = { login: 'me' };
  return JSON.stringify(body);
}

describe('news held through a turn', () => {
  const turn = { text: 'go', turnId: 't1' };
  const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' };
  const OPEN_VIEW = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
  const MERGED_VIEW = JSON.stringify({
    url: URL,
    state: 'MERGED',
    mergedAt: '2026-10-03T22:01:00Z',
  });

  for (const [what, view, wakes] of [
    ['a ready pull request merged during the turn is not called ready', MERGED_VIEW, 0],
    ['one still open after the turn is told then', OPEN_VIEW, 1],
    ['one that cannot be read again is told as held', undefined, 1],
  ] as const) {
    test(what, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: prJson(), view };
      const seen = world(on, gh);
      on('turn.start', () => ({ turnId: turn.turnId }));
      on('turn.complete', () => ({ text: done.answer }));
      await start($);
      await ($ as any).turn.start(turn);
      await create($);
      await clock.advance(1000);
      expect(seen.wakes).toEqual([]);
      await ($ as any).turn.complete(done);
      await clock.advance(1);
      expect(seen.order.filter((o) => o.startsWith(`gh pr view ${URL}`))).toHaveLength(1);
      expect(seen.wakes).toHaveLength(wakes);
      if (wakes) expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    });
  }

  const alice = { author: { login: 'alice' }, createdAt: '2026-10-03T22:02:00Z', url: 'c/1' };
  for (const [view, isReady] of [
    [OPEN_VIEW, true],
    [MERGED_VIEW, false],
  ] as const) {
    test(`news from two reads is told together, ready only while ${isReady ? 'open' : 'unmerged'}`, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: commentedJson([], [], []), view };
      const seen = world(on, gh);
      on('turn.start', () => ({ turnId: turn.turnId }));
      on('turn.complete', () => ({ text: done.answer }));
      await start($);
      await ($ as any).turn.start(turn);
      await create($);
      await clock.advance(1000);
      gh.pr = commentedJson([alice], [], []);
      await clock.advance(61_000);
      expect(seen.wakes).toEqual([]);
      await ($ as any).turn.complete(done);
      await clock.advance(1);
      expect(seen.wakes).toHaveLength(1);
      expect(seen.wakes[0]).toContain('@alice commented on o/r#128');
      if (isReady) expect(seen.wakes[0]).toMatch(/^pr-watch: GitHub reports o\/r#128 ready/);
      else expect(seen.wakes[0]).not.toContain('ready to merge');
    });
  }

  test('a ready pull request whose checks start again in the turn is not called ready', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await clock.advance(61_000);
    gh.pr = prJson();
    await clock.advance(61_000);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await clock.advance(61_000);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
  });

  test('ready twice in one turn is told once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await clock.advance(61_000);
    gh.pr = prJson();
    await clock.advance(61_000);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]!.split('ready to merge')).toHaveLength(2);
  });

  test('a turn that starts while the news is read again holds it until that turn ends', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    gh.holdView = true;
    await ($ as any).turn.complete(done);
    for (let i = 0; i < 50 && !gh.release; i += 1) await Promise.resolve();
    await ($ as any).turn.start(turn);
    gh.release!();
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('ready to merge');
  });

  test('two turn ends whose reads overlap tell the news once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    gh.holdView = true;
    await ($ as any).turn.complete(done);
    for (let i = 0; i < 50 && !gh.release; i += 1) await Promise.resolve();
    await ($ as any).turn.start(turn);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    gh.release!();
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
  });

  test('one slow read at the turn’s end holds back only its own news', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE'), view: OPEN_VIEW };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    await create($, 'git push');
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    gh.holdView = true;
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('failed for the push to');
    gh.release!();
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(2);
    expect(seen.wakes[1]).toContain('ready to merge');
  });

  test('a session start sends news a turn left held, once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    gh.holdView = true;
    await ($ as any).turn.complete(done);
    for (let i = 0; i < 50 && !gh.release; i += 1) await Promise.resolve();
    await start($);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    gh.release!();
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
  });

  test('a pull request unwatched during the turn is not called ready', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    await tool($, 'unwatch', { pull: '128' });
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
  });

  test('news it cannot send at the turn’s end is said in a toast', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    // Taking the held news out is refused: the store refuses undefined.
    on('state.set', ($: unknown, e: any, next: any) =>
      e.key === 'turn' && !e.value.isTurning && e.value.held.length === 0
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
    expect(seen.toasts.at(-1)).toMatch(/^pr-watch could not send the news it held/);
  });

  test('a turn whose end fails beneath pr-watch still ends the hold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => {
      throw new Error('beneath');
    });
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    await ($ as any).turn.complete(done).catch(() => null);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
  });

  test("a subagent's turn ending leaves the news held, and a later turn tells it no more", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: turn.turnId }));
    on('turn.complete', () => ({ text: done.answer }));
    await start($);
    await ($ as any).turn.start(turn);
    await create($);
    await clock.advance(1000);
    await ($ as any).turn.complete({ ...done, agentId: 'sub-1' });
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
    expect(seen.order.filter((o) => o.startsWith('gh pr view'))).toEqual([]);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    await ($ as any).turn.start(turn);
    await ($ as any).turn.complete(done);
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
  });
});

// A pull request Claude opened, read once.
async function readyIn($: any, on: any, gh: Gh) {
  const clock = mock.clock(on, { now: T0 });
  const seen = world(on, gh);
  await start($);
  await create($);
  await clock.advance(1000);
  return { clock, seen };
}

// News kept for the next prompt, standing in the host's state as a reload
// leaves it, until pr-watch first writes it; `writes` records what it wrote.
// `refuse` names why a read or write of a key is refused, if it is.
function keptBefore(
  on: any,
  held: unknown[],
  refuse: (op: 'get' | 'set', key: string) => string | null = () => null,
) {
  let seed: unknown[] | null = held;
  const writes: unknown[] = [];
  on('state.get', async ($: unknown, e: { key: string }, next: (e: unknown) => Promise<any>) => {
    const deny = refuse('get', e.key);
    if (deny) return { deny };
    const r = await next(e);
    return e.key === 'quiet' && seed !== null ? { value: { ...r.value, value: seed } } : r;
  });
  on(
    'state.set',
    ($: unknown, e: { key: string; value: unknown }, next: (e: unknown) => unknown) => {
      const deny = refuse('set', e.key);
      if (deny) return { deny };
      if (e.key === 'quiet') {
        seed = null;
        writes.push(e.value);
      }
      return next(e);
    },
  );
  return writes;
}

const kept = (news: string[], ready: string | null = null) => ({
  id: ID,
  label: '#128',
  url: URL,
  news,
  ready,
});

describe('ready to merge, while merges need asking', () => {
  const OPEN = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
  const MERGED = JSON.stringify({ url: URL, state: 'MERGED', mergedAt: '2026-10-03T22:01:00Z' });
  const ASKED = {};

  test("a draft's passed checks wake nothing and reach the next prompt once per commit", async ($, on) => {
    const gh: Gh = { pr: draftJson('a1', [RUNNING_CI]) };
    const { clock, seen } = await readyIn($, on, gh);
    gh.pr = draftJson('a1', [PASSED_CI]);
    await clock.advance(10_000);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toEqual([
      'pr-watch, since your last turn: The checks on o/r#128, a draft, passed.',
    ]);
    await clock.advance(60_000);
    await $.prompt.submit(person());
    expect(seen.contexts[1]).toBeUndefined();
    // A new commit whose checks passed between two reads is news again.
    gh.pr = draftJson('b2', [PASSED_CI]);
    await clock.advance(60_000);
    await $.prompt.submit(person());
    expect(seen.contexts[2]?.[0]).toContain('a draft, passed.');
    expect(seen.wakes).toEqual([]);
  });

  test("a draft's failing check wakes Claude at once, and its passing is never told", async ($, on) => {
    const { seen } = await readyIn($, on, { pr: draftJson('a1', [FAILING_CI]) });
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('CI: Typecheck failed for o/r#128');
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
  });

  test('wakes nothing, suggests the merge, and tells the next prompt once', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    expect(seen.wakes).toEqual([]);
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
    expect(seen.notified).toEqual(['#128 is ready to merge']);
    expect(seen.suggested).toEqual(['merge #128']);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toEqual([
      'pr-watch, since your last turn: GitHub reports o/r#128 ready to merge.\nMerging needs the user to ask for it; offer it if it fits.',
    ]);
    await $.prompt.submit(person());
    expect(seen.contexts[1]).toBeUndefined();
  });

  test('wakes Claude as before where review-cycle lets it merge unasked', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), stopBefore: { user: 'release' } });
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.suggested).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
  });

  test('keeps a release pull request from Claude even where merges run unasked', async ($, on) => {
    const release = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    const { seen } = await readyIn($, on, {
      pr: prJson(release),
      view: OPEN,
      stopBefore: { user: 'release' },
    });
    expect(seen.wakes).toEqual([]);
    expect(seen.toasts).toEqual(['release #128 is ready to merge']);
    expect(seen.suggested).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toEqual([
      'pr-watch, since your last turn: GitHub reports o/r#128, the release pull request, ready to merge. Merging it is the release: leave it for the user to ask.',
    ]);
  });

  for (const [what, stopBefore] of [
    ['the project file stops earlier than the user', { user: 'release', project: 'merge' }],
    ['a managed value, as its /config row shows it', { policy: 'push', user: 'release' }],
    ['a value outside the options', { user: 'releases' }],
  ] as const) {
    test(`keeps it from Claude under ${what}`, async ($, on) => {
      const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore });
      expect(seen.wakes).toEqual([]);
    });
  }

  test("the local file's value stands over the project's", async ($, on) => {
    const stopBefore = { project: 'merge', local: 'release' };
    const { seen } = await readyIn($, on, { pr: prJson(), stopBefore });
    expect(seen.wakes).toHaveLength(1);
  });

  for (const reviewCycle of ['absent', 'off'] as const) {
    test(`keeps it from Claude with review-cycle ${reviewCycle}, whatever its setting says`, async ($, on) => {
      const stopBefore = { user: 'release', local: 'release' };
      const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore, reviewCycle });
      expect(seen.wakes).toEqual([]);
      expect(seen.suggested).toEqual(['merge #128']);
    });
  }

  test('keeps it from Claude, and says so, when the /config rows cannot be read', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, configFails: true });
    expect(seen.wakes).toEqual([]);
    expect(seen.toasts.filter((t) => t.includes("could not read review-cycle's"))).toHaveLength(1);
  });

  test('keeps it from Claude when the settings cannot be read', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, settingsFail: true });
    expect(seen.wakes).toEqual([]);
    expect(seen.suggested).toEqual([]);
  });

  test('suggests nothing with prompt suggestions off', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, suggestions: false };
    const { seen } = await readyIn($, on, gh);
    expect(seen.suggested).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]?.[0]).toContain('ready to merge');
  });

  test('drops the ready line once the pull request has merged', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED };
    const { seen } = await readyIn($, on, gh);
    gh.view = MERGED;
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
  });

  test('a prompt pr-watch did not get from the person neither carries nor spends it', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    await $.prompt.submit(person('done', { origin: { kind: 'task-notification' } }));
    await $.prompt.submit(person('/clear', { command: { name: 'clear', kind: 'local' } }));
    expect(seen.contexts.slice(0, 2)).toEqual([undefined, undefined]);
    await $.prompt.submit(person());
    expect(seen.contexts[2]?.[0]).toContain('ready to merge');
  });

  test('held through a turn, it is kept at the turn end and suggested then', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    on('turn.start', () => ({ turnId: 't1' }));
    on('turn.complete', () => ({ text: '' }));
    await start($);
    await ($ as any).turn.start({ text: 'go', turnId: 't1' });
    await create($);
    await clock.advance(1000);
    expect(seen.suggested).toEqual([]);
    await ($ as any).turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    });
    await clock.advance(1);
    expect(seen.wakes).toEqual([]);
    expect(seen.suggested).toEqual(['merge #128']);
  });

  test('a prompt from the bridge carries it after the context already there', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    await $.prompt.submit(person('next', { origin: { kind: 'bridge' }, context: ['other'] }));
    expect(seen.contexts[0]).toHaveLength(2);
    expect(seen.contexts[0]?.[0]).toBe('other');
    expect(seen.contexts[0]?.[1]).toContain('ready to merge');
  });

  test('a prompt dropped beneath pr-watch leaves it for the next one', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, dropPerson: true };
    const { seen } = await readyIn($, on, gh);
    await $.prompt.submit(person());
    gh.dropPerson = false;
    await $.prompt.submit(person());
    expect(seen.contexts[1]?.[0]).toContain('ready to merge');
  });

  test('a prompt that fails beneath pr-watch leaves it for the next one', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, throwPerson: true };
    const { seen } = await readyIn($, on, gh);
    await $.prompt.submit(person()).catch(() => null);
    gh.throwPerson = false;
    await $.prompt.submit(person());
    expect(seen.contexts.at(-1)?.[0]).toContain('ready to merge');
  });

  test('a ready wake survives a kept ready line that cannot be cleared', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, quietFails: false };
    const { clock, seen } = await readyIn($, on, gh);
    expect(seen.suggested).toEqual(['merge #128']);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await clock.advance(61_000);
    gh.stopBefore = { user: 'release' };
    gh.quietFails = true;
    gh.pr = prJson();
    await clock.advance(11_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.toasts.some((t) => t.includes("could not clear #128's kept ready line"))).toBe(
      true,
    );
  });

  test('a ready line that cannot be kept wakes Claude instead, and says so', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, quietFails: true };
    const { seen } = await readyIn($, on, gh);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.toasts.some((t) => t.startsWith("pr-watch could not keep #128's news"))).toBe(true);
  });

  test('a release ready line that cannot be kept is dropped, not woken', async ($, on) => {
    const head = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    const gh: Gh = { pr: prJson(head), view: OPEN, stopBefore: ASKED, quietFails: true };
    const { seen } = await readyIn($, on, gh);
    expect(seen.wakes).toEqual([]);
    expect(
      seen.toasts.some((t) => t.startsWith("pr-watch could not keep release #128's news")),
    ).toBe(true);
  });

  test('held with a comment through a turn, the comment wakes and the ready line waits', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const alice = { author: { login: 'alice' }, createdAt: '2026-10-03T22:02:00Z', url: 'c/1' };
    const gh: Gh = { pr: commentedJson([], [], []), view: OPEN, stopBefore: ASKED };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: 't1' }));
    on('turn.complete', () => ({ text: '' }));
    await start($);
    await ($ as any).turn.start({ text: 'go', turnId: 't1' });
    await create($);
    await clock.advance(1000);
    gh.pr = commentedJson([alice], [], []);
    await clock.advance(61_000);
    await ($ as any).turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    });
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('@alice commented on o/r#128');
    expect(seen.wakes[0]).not.toContain('ready to merge');
    await $.prompt.submit(person());
    expect(seen.contexts[0]?.[0]).toContain('ready to merge');
    expect(seen.contexts[0]?.[0]).not.toContain('@alice');
  });

  test('a ready line for a pull request no longer watched is dropped', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    await tool($, 'unwatch', { pull: '128' });
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
  });

  test('once ready wakes Claude, the line kept before is not told again', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED };
    const { clock, seen } = await readyIn($, on, gh);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    await clock.advance(61_000);
    gh.stopBefore = { user: 'release' };
    gh.pr = prJson();
    await clock.advance(11_000);
    expect(seen.wakes).toHaveLength(1);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
  });

  test(
    'with waking off, keeps nothing for the next prompt',
    { options: { wake: 'off' } },
    async ($, on) => {
      const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
      expect(seen.suggested).toEqual([]);
      await $.prompt.submit(person());
      expect(seen.contexts[0]).toBeUndefined();
    },
  );

  test(
    'with waking off, news kept before is not told, and is let go at the start',
    { options: { wake: 'off' } },
    async ($, on) => {
      mock.clock(on, { now: T0 });
      const writes = keptBefore(on, [kept(['EARLIER'])]);
      const seen = world(on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
      await $.prompt.submit(person());
      expect(seen.contexts[0]).toBeUndefined();
      await start($);
      expect(writes).toContainEqual([]);
    },
  );

  test('says once that the settings could not be read', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, settingsFail: true });
    expect(seen.toasts.filter((t) => t.includes("could not read review-cycle's"))).toHaveLength(1);
  });

  test('says it again only after a read that worked', async ($, on) => {
    const gh: Gh = { pr: prJson(), view: OPEN, configFails: true };
    const { clock, seen } = await readyIn($, on, gh);
    const again = async () => {
      gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
      await clock.advance(61_000);
      gh.pr = prJson();
      await clock.advance(11_000);
    };
    const said = () => seen.toasts.filter((t) => t.includes("could not read review-cycle's"));
    await again();
    expect(said()).toHaveLength(1);
    gh.configFails = false;
    await again();
    gh.configFails = true;
    await again();
    expect(said()).toHaveLength(2);
  });

  test('a turn that starts while the settings are read holds the ready line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN };
    const seen = world(on, gh);
    on('turn.start', () => ({ turnId: 't1' }));
    on('turn.complete', () => ({ text: '' }));
    gh.onConfigList = async () => {
      await ($ as any).turn.start({ text: 'go', turnId: 't1' });
    };
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    await ($ as any).turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    });
    await clock.advance(1);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('ready to merge');
  });

  test('a prompt with nothing kept writes nothing, so a refusing store says nothing', async ($, on) => {
    mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN, quietFails: true });
    await start($);
    await $.prompt.submit(person());
    expect(seen.toasts).toEqual([]);
  });

  test('a prompt that cannot read again or put back says both', async ($, on) => {
    // The prompt's read of the watches fails, and from then on every write of kept news.
    let isBroken = false;
    let isWriteRefused = false;
    keptBefore(on, [kept(['EARLIER'], 'OLD READY')], (op, key) => {
      if (isBroken && op === 'get' && key === 'watches') {
        isWriteRefused = true;
        return 'watches unreadable';
      }
      return isWriteRefused && op === 'set' && key === 'quiet' ? 'store refused' : null;
    });
    mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN });
    await start($);
    isBroken = true;
    await $.prompt.submit(person());
    const lost = seen.toasts.filter((t) => t.startsWith('pr-watch lost the news it took'));
    expect(lost).toHaveLength(1);
    expect(lost[0]).toContain('store refused');
    expect(seen.toasts.find((t) => t.startsWith('pr-watch could not add'))).toContain(
      'watches unreadable',
    );
  });

  test('a prompt that cannot read again puts the news back for the next one', async ($, on) => {
    let isBroken = false;
    keptBefore(on, [kept(['EARLIER'], 'OLD READY')], (op, key) => {
      if (!isBroken || op !== 'get' || key !== 'watches') return null;
      isBroken = false;
      return 'watches unreadable';
    });
    mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), view: OPEN });
    await start($);
    isBroken = true;
    await $.prompt.submit(person());
    expect(seen.toasts).toEqual([
      'pr-watch could not add its news to your prompt: pr-watch: $.state.get: watches unreadable',
    ]);
    await $.prompt.submit(person());
    expect(seen.contexts.at(-1)?.[0]).toContain('EARLIER');
  });

  test('a prompt from the Agent SDK carries it', async ($, on) => {
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN, stopBefore: ASKED });
    await $.prompt.submit(person('next', { origin: { kind: 'sdk' } }));
    expect(seen.contexts[0]?.[0]).toContain('ready to merge');
  });

  test('a ready line Claude is woken for leaves the passed lines kept with it', async ($, on) => {
    keptBefore(on, [kept(['PASSED'], 'OLD READY')]);
    const { seen } = await readyIn($, on, { pr: prJson(), view: OPEN });
    expect(seen.wakes).toHaveLength(1);
    await $.prompt.submit(person());
    expect(seen.contexts[0]?.[0]).toContain('PASSED');
    expect(seen.contexts[0]?.[0]).not.toContain('OLD READY');
  });

  test('a dropped prompt puts back what it took under news kept since', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    keptBefore(on, [kept(['EARLIER'], 'OLD READY')]);
    const gh: Gh = { pr: prJson(), view: OPEN, stopBefore: ASKED, dropPerson: true };
    const seen = world(on, gh);
    await start($);
    gh.holdView = true;
    const dropped = $.prompt.submit(person());
    for (let i = 0; i < 50 && !gh.release; i += 1) await Promise.resolve();
    await create($);
    await clock.advance(1000);
    gh.release!();
    await dropped;
    gh.dropPerson = false;
    await $.prompt.submit(person());
    const text = seen.contexts.at(-1)?.[0];
    expect(text).toContain('EARLIER');
    expect(text).toContain('GitHub reports o/r#128 ready to merge.');
    expect(text).not.toContain('OLD READY');
  });

  test('a failed check still wakes Claude, and notifies', async ($, on) => {
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [FAILING_CI]), stopBefore: ASKED };
    const { seen } = await readyIn($, on, gh);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('CI: Typecheck failed');
    expect(seen.notified).toEqual(['#128 CI: Typecheck failed']);
  });
});

// A pull request whose head commit `oid` ran these suites.
const headJson = (oid: string, suites: unknown[] = [PASSED_CI], over = {}) => {
  const checkSuites = { pageInfo: { hasNextPage: false }, nodes: suites };
  return prJson({ commits: { nodes: [{ commit: { oid, checkSuites } }] }, ...over });
};
const reviewing = (status: string, conclusion: string | null): any => ({
  status,
  conclusion,
  app: { databaseId: 7 },
  workflowRun: null,
  checkRuns: {
    nodes: [
      {
        name: 'pullfrog',
        status,
        conclusion,
        isRequired: false,
        detailsUrl: 'https://pullfrog.com/run/1',
        startedAt: '2026-10-03T22:00:00Z',
        ...(status === 'COMPLETED' && { completedAt: '2026-10-03T22:04:00Z' }),
      },
    ],
  },
});

const running = () => headJson('a1', [RUNNING_CI], { mergeStateStatus: 'BLOCKED' });

test("its rules for the wakes ride in the system prompt's last section", async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' }] }));
  const { sections } = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  });
  expect(sections.map((s) => s.id)).toEqual(['intro', 'pr-watch:wakes']);
  expect(sections.at(-1)?.scope).toBe('session');
  expect(sections.at(-1)?.text).toContain('Never merge it unasked');
});

describe('asking about a merge', () => {
  const OPEN = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
  const ASK = 'nothing is still running on it';

  test('wakes Claude once to ask, for a pull request it opened, in place of the ready line', async ($, on) => {
    const gh: Gh = { pr: headJson('a1'), view: OPEN, stopBefore: {} };
    const { seen, clock } = await readyIn($, on, gh);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(
      `o/r#128 is ready to merge and nothing is still running on it.`,
    );
    expect(seen.wakes[0]).toContain(ASK);
    expect(seen.wakes[0]).not.toContain('GitHub reports');
    expect(seen.suggested).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toBeUndefined();
    // Once per head commit, whatever GitHub recomputes.
    gh.pr = headJson('a1', [PASSED_CI], { mergeStateStatus: 'UNKNOWN' });
    await clock.advance(120_000);
    gh.pr = headJson('a1');
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
    gh.pr = headJson('b2');
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(2);
  });

  test('asks nothing while a check the merge does not wait on has failed, then asks', async ($, on) => {
    const gh: Gh = { pr: headJson('a1', [PASSED_CI, FAILING_CI]), view: OPEN, stopBefore: {} };
    const { seen, clock } = await readyIn($, on, gh);
    expect(seen.wakes.join('\n')).not.toContain(ASK);
    gh.pr = headJson('a1');
    await clock.advance(120_000);
    expect(seen.wakes.at(-1)).toContain(ASK);
  });

  test('an ask that cannot wait wakes Claude once, with no ready line beside it', async ($, on) => {
    const gh: Gh = { pr: headJson('a1'), view: OPEN, stopBefore: {}, quietFails: true };
    const { seen } = await readyIn($, on, gh);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(ASK);
    expect(seen.wakes[0]).not.toContain('GitHub reports');
  });

  for (const [what, state, wakes, last] of [
    ['asks at the end of a turn, in place of a ready line held earlier in it', 'OPEN', 1, null],
    ['asks nothing of a pull request merged during the turn', 'MERGED', 0, null],
    ['asks nothing when its reviewer started again during the turn', 'OPEN', 0, 'IN_PROGRESS'],
    ['asks nothing when its reviewer failed during the turn', 'OPEN', 0, 'FAILURE'],
  ] as const) {
    test(what, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = {
        pr: headJson('a1', [PASSED_CI, reviewing('IN_PROGRESS', null)]),
        view: OPEN,
        stopBefore: {},
      };
      const seen = world(on, gh);
      on('turn.start', () => ({ turnId: 't1' }));
      on('turn.complete', () => ({ text: '' }));
      await start($);
      await ($ as any).turn.start({ text: 'go', turnId: 't1' });
      await create($);
      await clock.advance(1000);
      gh.pr = headJson('a1', [PASSED_CI, reviewing('COMPLETED', 'SUCCESS')]);
      await clock.advance(120_000);
      expect(seen.wakes).toEqual([]);
      if (last) {
        const again = last === 'IN_PROGRESS' ? reviewing(last, null) : reviewing('COMPLETED', last);
        gh.pr = headJson('a1', [PASSED_CI, again]);
        await clock.advance(120_000);
      }
      gh.view = JSON.stringify({ url: URL, state, mergedAt: null });
      await ($ as any).turn.complete({
        answer: '',
        durationMs: 1,
        isAborted: false,
        turnId: 't1',
        reason: 'answer',
      });
      await clock.advance(1);
      expect(seen.wakes.filter((w) => w.includes(ASK))).toHaveLength(wakes);
      expect(seen.wakes.join('\n')).not.toContain('GitHub reports');
      await $.prompt.submit(person());
      expect(seen.contexts[0]?.join('\n') ?? '').not.toContain('ready to merge');
    });
  }

  test('waits for a reviewer still at work, then asks and drops the ready line it kept', async ($, on) => {
    const gh: Gh = {
      pr: headJson('a1', [PASSED_CI, reviewing('IN_PROGRESS', null)]),
      view: OPEN,
      stopBefore: {},
    };
    const { seen, clock } = await readyIn($, on, gh);
    expect(seen.wakes).toEqual([]);
    gh.pr = headJson('a1', [PASSED_CI, reviewing('COMPLETED', 'SUCCESS')]);
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(ASK);
    await $.prompt.submit(person());
    expect(seen.contexts[0]).toEqual([
      'pr-watch, since your last turn: pullfrog, not required to merge, finished (success) for o/r#128: https://pullfrog.com/run/1',
    ]);
  });

  test('asks nothing of a pull request Claude did not open', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: headJson('a1', [RUNNING_CI], { mergeStateStatus: 'BLOCKED' }),
      view: OPEN,
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128' });
    gh.pr = headJson('a1');
    await clock.advance(120_000);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit(person());
    expect(seen.contexts[0]?.[0]).toContain('GitHub reports o/r#128 ready to merge.');
  });

  test('asks nothing where ready already wakes Claude: an asked wake, or merges unasked', async ($, on) => {
    const gh: Gh = {
      pr: headJson('a1', [RUNNING_CI], { mergeStateStatus: 'BLOCKED' }),
      view: OPEN,
      stopBefore: {},
    };
    const { seen, clock } = await readyIn($, on, gh);
    await tool($, 'watch', { pull: '128', wake: true });
    gh.pr = headJson('a1');
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.wakes[0]).not.toContain(ASK);
  });

  test('asks of a pull request watched before Claude opened it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: headJson('a1', [RUNNING_CI], { mergeStateStatus: 'BLOCKED' }),
      view: OPEN,
      stopBefore: {},
    };
    const seen = world(on, gh);
    await start($);
    await tool($, 'watch', { pull: '128' });
    await create($);
    gh.pr = headJson('a1');
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(ASK);
  });

  const WILL_ASK = 'pr-watch wakes you to ask about its merge';

  test('the watches tool says which pull request it will ask about', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const url129 = 'https://github.com/o/r/pull/129';
    const gh: Gh = {
      pr: running(),
      prs: { 129: prJson({ number: 129, url: url129, mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) },
      view: OPEN,
      views: { 129: JSON.stringify({ url: url129, state: 'OPEN', mergedAt: null }) },
      stopBefore: {},
    };
    world(on, gh);
    await start($);
    await create($);
    await tool($, 'watch', { pull: '129' });
    await clock.advance(1000);
    const listed = await tool($, 'watches');
    const lines = listed.split('\n');
    expect(lines.find((l) => l.startsWith(URL))).toContain(WILL_ASK);
    expect(lines.find((l) => l.startsWith(url129))).not.toContain(WILL_ASK);
    await tool($, 'watch', { pull: '128', wake: true });
    expect(await tool($, 'watches')).not.toContain(WILL_ASK);
  });

  test(
    'the watches tool promises no ask with waking off',
    { options: { wake: 'off' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      world(on, { pr: running(), view: OPEN, stopBefore: {} });
      await start($);
      await create($);
      await clock.advance(1000);
      expect(await tool($, 'watches')).toContain(URL);
      expect(await tool($, 'watches')).not.toContain(WILL_ASK);
    },
  );

  test('the watches tool promises no ask where Claude merges unasked, or of a release', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: running(), view: OPEN, stopBefore: { user: 'release' } };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await tool($, 'watches')).not.toContain(WILL_ASK);
    gh.stopBefore = {};
    expect(await tool($, 'watches')).toContain(WILL_ASK);
    const release = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    gh.pr = headJson('a1', [RUNNING_CI], { mergeStateStatus: 'BLOCKED', ...release });
    await clock.advance(120_000);
    expect(await tool($, 'watches')).not.toContain(WILL_ASK);
  });

  test('asks nothing where review-cycle lets Claude merge unasked', async ($, on) => {
    const gh: Gh = { pr: headJson('a1'), view: OPEN, stopBefore: { user: 'release' } };
    const { seen } = await readyIn($, on, gh);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.wakes[0]).not.toContain(ASK);
  });

  test('asks nothing of a release pull request', async ($, on) => {
    const release = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    const { seen } = await readyIn($, on, {
      pr: headJson('a1', [PASSED_CI], release),
      view: OPEN,
      stopBefore: {},
    });
    expect(seen.wakes).toEqual([]);
  });

  test('asks nothing with waking off', { options: { wake: 'off' } }, async ($, on) => {
    const { seen } = await readyIn($, on, { pr: headJson('a1'), view: OPEN, stopBefore: {} });
    expect(seen.wakes).toEqual([]);
  });
});

describe('telling Claude', () => {
  test('wakes it once when the pull request becomes ready to merge', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    gh.pr = prJson();
    await clock.advance(70_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
    expect(seen.wakes[0]).toBe('pr-watch: GitHub reports o/r#128 ready to merge.');
    // GitHub recomputing the merge state is not a new ready.
    gh.pr = prJson({ mergeStateStatus: 'UNKNOWN' });
    await clock.advance(70_000);
    expect(await lineIn(await band($))).toBe('#128 ○ waiting on checking');
    gh.pr = prJson();
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
  });

  test('wakes it once per failing run, and again for a new run', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [FAILING_CI]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(
      'CI: Typecheck failed for o/r#128: https://github.com/o/r/actions/runs/1/job/9',
    );
    const typecheck = FAILING_CI.checkRuns.nodes[0];
    const running = { status: 'QUEUED', conclusion: null };
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [
      ciSuite(running, [typecheck, failedJob('Lint')]),
    ]);
    // A second job failing in the same run is not news.
    await clock.advance(20_000);
    expect(seen.wakes).toHaveLength(1);
    const run2 = ciSuite(running, [failedJob('Lint', 2, 20)]);
    run2.workflowRun = { ...run2.workflowRun, url: 'https://github.com/o/r/actions/runs/2' };
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [run2]);
    await clock.advance(60_000);
    expect(seen.wakes).toHaveLength(2);
    expect(seen.wakes[1]).toContain('runs/2/job/20');
  });

  const HELD = { DIRTY: 'o/r#128 has merge conflicts with', BEHIND: 'o/r#128 is behind' };
  for (const [what, from, after, wakes, last] of [
    [
      'tells no conflicts a turn held once a later read shows them cleared',
      'DIRTY',
      'BLOCKED',
      0,
      null,
    ],
    [
      'tells none cleared in the turn though GitHub then recomputes',
      'DIRTY',
      'BLOCKED',
      0,
      'UNKNOWN',
    ],
    ['tells conflicts a turn held when they are still there at its end', 'DIRTY', 'DIRTY', 1, null],
    ['tells conflicts a turn held while GitHub recomputes them', 'DIRTY', 'DIRTY', 1, 'UNKNOWN'],
    ['tells no behind a turn held once the branch is up to date', 'BEHIND', 'CLEAN', 0, null],
    [
      'tells no behind a turn held though GitHub then recomputes',
      'BEHIND',
      'BLOCKED',
      0,
      'UNKNOWN',
    ],
    ['tells behind a turn held when it is still behind at its end', 'BEHIND', 'BEHIND', 1, null],
  ] as const) {
    test(what, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: prJson({ mergeStateStatus: from }, [RUNNING_CI]) };
      const seen = world(on, gh);
      on('turn.start', () => ({ turnId: 't1' }));
      on('turn.complete', () => ({ text: '' }));
      await start($);
      await ($ as any).turn.start({ text: 'go', turnId: 't1' });
      await create($);
      await clock.advance(1000);
      gh.pr = prJson({ mergeStateStatus: after }, [RUNNING_CI]);
      await clock.advance(60_000);
      if (last) {
        gh.pr = prJson({ mergeStateStatus: last }, [RUNNING_CI]);
        await clock.advance(60_000);
      }
      expect(seen.wakes).toEqual([]);
      await ($ as any).turn.complete({
        answer: '',
        durationMs: 1,
        isAborted: false,
        turnId: 't1',
        reason: 'answer',
      });
      await clock.advance(1);
      expect(seen.wakes).toHaveLength(wakes);
      if (wakes) expect(seen.wakes[0]).toContain(HELD[from]);
      // Cleared ones that come back are news again.
      gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
      await clock.advance(60_000);
      gh.pr = prJson({ mergeStateStatus: from }, [RUNNING_CI]);
      await clock.advance(60_000);
      expect(seen.wakes).toHaveLength(wakes + 1);
    });
  }

  for (const [from, state, merge] of [
    ['DIRTY', 'MERGED', 'UNKNOWN'],
    ['DIRTY', 'MERGED', 'CLEAN'],
    ['DIRTY', 'CLOSED', 'DIRTY'],
    ['BEHIND', 'MERGED', 'CLEAN'],
  ] as const) {
    test(`tells no ${from} line a turn held of a pull request ${state} in it (${merge})`, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: prJson({ mergeStateStatus: from }, [FAILING_CI]) };
      const seen = world(on, gh);
      on('turn.start', () => ({ turnId: 't1' }));
      on('turn.complete', () => ({ text: '' }));
      await start($);
      await ($ as any).turn.start({ text: 'go', turnId: 't1' });
      await create($);
      await clock.advance(1000);
      gh.pr = prJson({ state, mergeStateStatus: merge }, [RUNNING_CI]);
      await clock.advance(60_000);
      await ($ as any).turn.complete({
        answer: '',
        durationMs: 1,
        isAborted: false,
        turnId: 't1',
        reason: 'answer',
      });
      await clock.advance(1);
      expect(seen.wakes.join('\n')).not.toContain(HELD[from]);
      // The rest of what the turn held for it is still told.
      expect(seen.wakes.join('\n')).toContain('CI: Typecheck failed for o/r#128');
    });
  }

  test('a release pull request’s conflicts do not wake it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const release = {
      headRefName: 'oakum/version-packages',
      headRepository: { nameWithOwner: 'o/r' },
    };
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'DIRTY', ...release }, [RUNNING_CI]) });
    await start($);
    await create($);
    await clock.advance(60_000);
    expect(seen.wakes).toEqual([]);
  });

  test('wakes it once for conflicts, though its checks are failing', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'DIRTY' }, [FAILING_CI]) });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('o/r#128 has merge conflicts with');
    expect(seen.wakes[0]).toContain('CI: Typecheck failed');
    await clock.advance(180_000);
    expect(seen.wakes).toHaveLength(1);
  });

  test(
    'does not wake it when /config turns waking off, and keeps the line',
    { options: { wake: 'off' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const theirs = { author: { login: 'alice' }, createdAt: '2026-10-03T22:03:00Z', url: 'c/2' };
      const gh: Gh = { pr: commentedJson([]) };
      const seen = world(on, gh);
      let saved: any[] = [];
      on('state.set', ($: unknown, e: any, next: any) => {
        if (e.key === 'watches') saved = e.value;
        return next(e);
      });
      await start($);
      await create($);
      await clock.advance(1000);
      gh.pr = commentedJson([theirs]);
      gh.pr = gh.pr.replace('"CLEAN"', '"DIRTY"');
      await clock.advance(20_000);
      expect(await lineIn(await band($))).toMatch(/^#128 ● CI \dm\d\ds$/);
      expect(seen.wakes).toEqual([]);
      // Heard, so turning waking on reports no history; not told, so the
      // conflicts still there are told then.
      expect(saved[0].heard.keys).toEqual(['c/2']);
      expect(saved[0].told ?? []).toEqual([]);
    },
  );

  test('a person’s comment wakes it and a bot’s does not, by default', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const human = { author: { login: 'alice' }, createdAt: '2026-10-03T22:03:00Z', url: 'c/h' };
    const bot = {
      author: { login: 'oakum', __typename: 'Bot' },
      createdAt: '2026-10-03T22:04:00Z',
      url: 'c/bot',
    };
    const gh: Gh = { pr: commentedJson([]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.pr = commentedJson([human, bot]);
    await clock.advance(20_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('@alice');
    expect(seen.wakes[0]).not.toContain('@oakum');
  });

  test(
    'wakes it for checks and not comments when /config says checks',
    { options: { wake: 'checks' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const person = { author: { login: 'alice' }, createdAt: '2026-10-03T22:02:00Z', url: 'c/1' };
      const gh: Gh = { pr: commentedJson([]) };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      gh.pr = commentedJson([person], [], []);
      await clock.advance(20_000);
      expect(seen.wakes).toHaveLength(1);
      expect(seen.wakes[0]).toContain('ready to merge');
      expect(seen.wakes[0]).not.toContain('@alice');
    },
  );

  // Who wakes Claude among a person's comment, a bot's comment, a bot's
  // review and a release plan comment, by setting.
  const settings = [
    [{}, ['@alice']],
    [{ botComments: 'reviews' }, ['@alice', '@rabbit[bot]']],
    [{ botComments: 'comments and reviews' }, ['@alice', '@oakum[bot]', '@rabbit[bot]']],
    [{ wake: 'checks', botComments: 'comments and reviews' }, []],
  ] as const;
  for (const [options, woken] of settings) {
    test(
      `comments wake it as /config says (${JSON.stringify(options)})`,
      { options },
      async ($, on) => {
        const clock = mock.clock(on, { now: T0 });
        const person = {
          author: { login: 'alice' },
          createdAt: '2026-10-03T22:02:00Z',
          url: 'c/1',
        };
        const bot = {
          author: { login: 'oakum', __typename: 'Bot' },
          createdAt: '2026-10-03T22:03:00Z',
          url: 'c/bot',
        };
        const gh: Gh = { pr: commentedJson([]) };
        const seen = world(on, gh);
        await start($);
        await create($);
        await clock.advance(1000);
        const review = {
          author: { login: 'rabbit', __typename: 'Bot' },
          submittedAt: '2026-10-03T22:04:00Z',
          state: 'COMMENTED',
          url: 'r/bot',
        };
        const plan = {
          author: { login: 'planner', __typename: 'Bot' },
          createdAt: '2026-10-03T22:05:00Z',
          url: 'c/plan',
          body: '<!-- oakum:pr-plan -->\n## Release plan',
        };
        const quoted = { ...plan, author: { login: 'carol', __typename: 'User' }, url: 'c/quoted' };
        gh.pr = commentedJson([person, bot, plan, quoted], [review]);
        await clock.advance(20_000);
        const text = seen.wakes.join('\n');
        for (const who of ['@alice', '@oakum[bot]', '@rabbit[bot]', '@planner']) {
          expect(text.includes(who)).toBe((woken as readonly string[]).includes(who));
        }
        expect(text.includes('@carol commented on')).toBe(woken.length > 0);
      },
    );
  }

  test(
    'a bot’s start notice says nothing, and its review that found nothing waits for the next prompt',
    { options: { botComments: 'comments and reviews' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: commentedJson([]) };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      const frog = { login: 'pullfrog', __typename: 'Bot' };
      const starting = {
        author: frog,
        createdAt: '2026-10-03T22:02:00Z',
        url: 'c/start',
        body: 'New pull request. Leaping into action...\n\n<!-- PULLFROG_DIVIDER_DO_NOT_REMOVE_PLZ -->\n<sup>Pullfrog</sup>',
      };
      const review = {
        author: frog,
        submittedAt: '2026-10-03T22:04:00Z',
        state: 'COMMENTED',
        url: 'r/clean',
        body: '> ✅ No new issues found.\n\n**Reviewed changes**',
      };
      gh.pr = commentedJson([starting]);
      await clock.advance(20_000);
      gh.pr = commentedJson([], [review]);
      await clock.advance(20_000);
      expect(seen.wakes).toEqual([]);
      await $.prompt.submit(person('next'));
      expect(seen.contexts[0]).toEqual([
        'pr-watch, since your last turn: @pullfrog[bot] reviewed o/r#128 and found no issues: r/clean',
      ]);
      gh.pr = commentedJson([], [review, { ...review, url: 'r/found', body: '> 1 finding.' }]);
      await clock.advance(20_000);
      expect(seen.wakes).toHaveLength(1);
      expect(seen.wakes[0]).toContain('@pullfrog[bot] reviewed o/r#128: r/found');
    },
  );

  const CLEAN_REVIEW = {
    author: { login: 'pullfrog', __typename: 'Bot' },
    submittedAt: '2026-10-03T22:04:00Z',
    state: 'COMMENTED',
    url: 'r/clean',
    body: '> ✅ No new issues found.',
  };
  const bots = { botComments: 'reviews' };

  test(
    'a review that found nothing does not wake it where the watch tool asked for a wake',
    { options: bots },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const view = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
      const gh: Gh = { pr: commentedJson([]), view, stopBefore: {} };
      const seen = world(on, gh);
      await start($);
      expect(await tool($, 'watch', { pull: '128', wake: true })).toContain('o/r#128');
      await clock.advance(1000);
      gh.pr = commentedJson([], [CLEAN_REVIEW]);
      await clock.advance(20_000);
      expect(seen.wakes).toEqual([]);
      await $.prompt.submit(person('next'));
      expect(seen.contexts[0]?.[0]).toContain(
        '@pullfrog[bot] reviewed o/r#128 and found no issues',
      );
    },
  );

  test(
    'a kept review that found nothing outlasts a wake for the ready line',
    { options: bots },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const view = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
      const gh: Gh = { pr: commentedJson([]), view, stopBefore: {} };
      const seen = world(on, gh);
      await start($);
      await tool($, 'watch', { pull: '128', wake: true });
      await clock.advance(1000);
      gh.pr = commentedJson([], [CLEAN_REVIEW]);
      await clock.advance(20_000);
      gh.pr = commentedJson([], [CLEAN_REVIEW], [PASSED_CI]);
      await clock.advance(70_000);
      expect(seen.wakes).toHaveLength(1);
      expect(seen.wakes[0]).toContain('ready to merge');
      await $.prompt.submit(person('next'));
      expect(seen.contexts[0]?.[0]).toContain('found no issues');
    },
  );

  test(
    'a review that found nothing wakes it when it cannot be kept',
    { options: bots },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: commentedJson([]), quietFails: false };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      gh.quietFails = true;
      gh.pr = commentedJson([], [CLEAN_REVIEW]);
      await clock.advance(20_000);
      expect(seen.wakes).toHaveLength(1);
      expect(seen.wakes[0]).toContain('@pullfrog[bot] reviewed o/r#128 and found no issues');
    },
  );

  test('a reviewer’s check that passed waits for the next prompt', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const conclusion = 'SUCCESS';
    const app: any = {
      status: 'COMPLETED',
      conclusion,
      app: { databaseId: 7 },
      workflowRun: null,
      checkRuns: {
        nodes: [
          {
            name: 'pullfrog',
            status: 'COMPLETED',
            conclusion,
            isRequired: false,
            detailsUrl: 'https://pullfrog.com/run/1',
            startedAt: '2026-10-03T22:00:00Z',
            completedAt: '2026-10-03T22:04:00Z',
          },
        ],
      },
    };
    const gh: Gh = { pr: commentedJson([], [], [RUNNING_CI, app]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit(person('next'));
    expect(seen.contexts[0]).toEqual([
      'pr-watch, since your last turn: pullfrog, not required to merge, finished (success) for o/r#128: https://pullfrog.com/run/1',
    ]);
  });

  test('wakes it for a comment from someone else, not for the viewer’s own', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const own = { author: { login: 'me' }, createdAt: '2026-10-03T22:02:00Z', url: 'c/1' };
    const theirs = { author: { login: 'alice' }, createdAt: '2026-10-03T22:03:00Z', url: 'c/2' };
    const gh: Gh = { pr: commentedJson([]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.pr = commentedJson([own]);
    await clock.advance(20_000);
    expect(seen.wakes).toEqual([]);
    gh.pr = commentedJson([own, theirs]);
    await clock.advance(20_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('@alice commented on o/r#128: c/2');
    await clock.advance(60_000);
    expect(seen.wakes).toHaveLength(1);
  });

  test('stops waking it for comments after ten in a row', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: commentedJson([]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const comments = [];
    for (let i = 1; i <= 12; i++) {
      const at = new Date(T0 + i * 1000).toISOString().replace('.000', '');
      comments.push({ author: { login: `u${i}` }, createdAt: at, url: `c/${i}` });
      gh.pr = commentedJson(comments);
      // A read with the comment, then one with nothing new.
      await clock.advance(20_000);
    }
    expect(seen.wakes).toHaveLength(10);
    expect(seen.wakes[9]).toContain('c/10');
    expect(seen.wakes[9]).toContain('no more comments or reviews');
  });

  test('wakes the session for a pull request a subagent opened', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    await start($);
    await ($ as any).tool.call({ tool: 'Bash', command: 'gh pr create --fill', agentId: 'sub-1' });
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('GitHub reports o/r#128 ready to merge.');
  });

  test('says nothing of a pull request closed with a failed job', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ state: 'CLOSED' }, [FAILING_CI]) });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
  });

  test('says nothing of a read whose line was removed while it ran', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), holdFirst: true };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    await ui.press({ key: `stop-${ID}` });
    gh.release?.();
    await clock.advance(1000);
    expect(seen.toasts).toEqual([]);
    expect(seen.wakes).toEqual([]);
  });

  test('says so when the session refuses the news', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), wakeRejects: true });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.wakes).toEqual([]);
    expect(
      seen.toasts.some((t) => t.startsWith('pr-watch could not tell Claude about #128: ')),
    ).toBe(true);
  });
});
