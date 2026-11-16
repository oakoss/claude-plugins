import { describe, expect, mock } from 'claude-code/testing';

import {
  band,
  create,
  type Gh,
  lineIn,
  mergedJson,
  OPEN_VIEW,
  prJson,
  PUSH_OUT,
  pushJson,
  pushLineIn,
  reads,
  RUNNING_CI,
  stackJson,
  start,
  T0,
  test,
  tool,
  URL,
  VIEW,
  world,
} from './world';

// A merged pull request into develop whose stacks lookup fails with `stackError`
// is asked once in half an hour and keeps its base.
async function askedOnceFor($: any, on: any, stackError: string): Promise<void> {
  const clock = mock.clock(on, { now: T0 });
  const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
  merged.data.repository.pullRequest.baseRefName = 'develop';
  const seen = world(on, { pr: JSON.stringify(merged), stackFails: 99, stackError });
  await start($);
  await create($);
  await clock.advance(1000);
  await clock.advance(30 * 60_000);
  expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(1);
  expect(await lineIn(await band($))).toMatch(/^#128 merged into develop · /);
}

// The same answer, with the quota the query left.
function withQuota(json: string, remaining: number, resetAt = '2026-10-03T23:00:00Z'): string {
  const body = JSON.parse(json);
  body.data.rateLimit = { cost: 1, remaining, limit: 5000, resetAt };
  return JSON.stringify(body);
}

const isMergedRead = (run: string) => run.includes('graphql') && run.includes('mergeCommit {');
const isTrunkRead = (run: string) => run.includes('history(first');

// A merged answer whose merge commit is `m`, with these suites when given.
function onMerge(json: string, suites?: unknown[]) {
  const body = JSON.parse(json);
  const commit = body.data.repository.pullRequest.mergeCommit;
  commit.oid = 'm';
  if (suites) commit.checkSuites.nodes = suites;
  return body;
}

// Release's run `n` on a later commit.
function releaseSuite(status: string, conclusion: string | null, n: number) {
  return {
    status,
    conclusion,
    workflowRun: {
      runAttempt: 1,
      createdAt: '2026-10-03T22:01:00Z',
      url: `https://github.com/o/r/actions/runs/${n}`,
      workflow: { databaseId: 9, name: 'Release' },
    },
    checkRuns: { nodes: [{ name: 'Publish', status, conclusion, detailsUrl: '' }] },
  };
}

// A linear trunk's commits, newest first, as `[oid, suites]`.
function trunkJson(commits: [string, unknown[]][]): string {
  const nodes = commits.map(([oid, suites], i) => ({
    oid,
    parents: { nodes: commits[i + 1] ? [{ oid: commits[i + 1]![0] }] : [] },
    checkSuites: { pageInfo: { hasNextPage: false }, nodes: suites },
  }));
  return JSON.stringify({ data: { repository: { ref: { target: { history: { nodes } } } } } });
}

// The trunk after a stack merge: the layer above's commit, with Release, over `m`.
function above(status: string, conclusion: string | null): string {
  return trunkJson([
    ['upper', [releaseSuite(status, conclusion, 12)]],
    ['m', []],
  ]);
}

describe('the query', () => {
  test('a pull request found merged is read again for its merge commit, and so on after', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: mergedJson('IN_PROGRESS', null) });
    await start($);
    await create($);
    await clock.advance(1000);
    // The first read cannot know; it finds the merge and reads its runs at once.
    expect(reads(seen.runs)).toBe(2);
    expect(seen.runs.filter(isMergedRead)).toHaveLength(1);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m11s');
    await clock.advance(10_000);
    expect(reads(seen.runs)).toBe(3);
    expect(seen.runs.filter(isMergedRead)).toHaveLength(2);
  });

  test("a merged stack layer names the stack's trunk, not the layer below it", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    const stack = JSON.stringify([{ number: 236, base: { ref: 'main' }, pull_requests: [] }]);
    const seen = world(on, { pr: JSON.stringify(merged), stack });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m11s');
    // Asked once, on the read that finds it merged, and kept by the reads after.
    await clock.advance(10_000);
    expect(seen.runs.filter(isMergedRead)).toHaveLength(2);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(1);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m21s');
  });

  test('a merged pull request in no stack keeps its base, and is asked once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'develop';
    const seen = world(on, { pr: JSON.stringify(merged), stack: '[]' });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into develop · ● Release 0m11s');
    await clock.advance(10_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(1);
  });

  test('a stacks lookup that fails keeps the base, and is asked again after a minute', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    const stack = stackJson(236, []);
    const seen = world(on, { pr: JSON.stringify(merged), stack, stackFails: 1 });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into docs/lower-layer · ● Release 0m11s');
    await clock.advance(10_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(1);
    await clock.advance(50_000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 1m11s');
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(2);
  });

  test('a host with no stacks API is asked once, and the base stands', async ($, on) => {
    await askedOnceFor($, on, 'gh: Not Found (HTTP 404)\n');
  });

  test('a token that may not read the stacks API is asked once, and the base stands', async ($, on) => {
    await askedOnceFor($, on, 'gh: Resource not accessible by integration (HTTP 403)\n');
  });

  test("a rate-limited stacks lookup pauses none of the host's reads", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'develop';
    const stackError = 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n';
    const seen = world(on, { pr: JSON.stringify(merged), stackFails: 9, stackError });
    await start($);
    await create($);
    await clock.advance(1000);
    const before = seen.runs.filter(isMergedRead).length;
    await clock.advance(30_000);
    expect(seen.runs.filter(isMergedRead).length).toBeGreaterThan(before);
    expect(await lineIn(await band($))).toBe('#128 merged into develop · ● Release 0m41s');
  });

  test('a stacks answer that is no list keeps the base and the runs', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'develop';
    world(on, { pr: JSON.stringify(merged), stack: '<html>' });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into develop · ● Release 0m11s');
  });

  test("a stack layer whose merge commit's runs cannot be read yet still finds its trunk", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    const stack = stackJson(236, []);
    world(on, { pr: JSON.stringify(merged), stack, mergedFails: 1 });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ○ waiting on checks');
    await clock.advance(10_000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m21s');
  });

  test('a pull request found merged whose runs cannot be read yet shows as merged', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), mergedFails: 1 };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ○ waiting on checks');
  });

  test('one merged long ago whose runs cannot be read says so, and stays', async ($, on) => {
    const clock = mock.clock(on, { now: T0 + 200_000 });
    world(on, { pr: mergedJson('COMPLETED', 'FAILURE'), mergedFails: 1 });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 gh failed: /);
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ✗ Release: Publish failed');
  });

  test('an open pull request is read without its merge commit', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) });
    await start($);
    await create($);
    await clock.advance(11_000);
    expect(reads(seen.runs)).toBe(2);
    expect(seen.runs.filter(isMergedRead)).toEqual([]);
  });

  test('low on quota, every watch is read once a minute, a push included', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: withQuota(prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), 400) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    await create($, 'gh pr merge 128 --auto');
    await clock.advance(50_000);
    expect(reads(seen.runs)).toBe(1);
    await clock.advance(10_000);
    expect(reads(seen.runs)).toBe(2);
    // A higher count in the same window is an older answer, and changes nothing.
    gh.pr = withQuota(prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), 4000);
    await clock.advance(60_000);
    const stale = reads(seen.runs);
    await clock.advance(10_000);
    expect(reads(seen.runs)).toBe(stale);
    // Once the quota resets, the running workflow is read every 10 s again.
    gh.pr = withQuota(
      prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      4999,
      '2026-10-04T00:00:00Z',
    );
    await clock.advance(60_000);
    const back = reads(seen.runs);
    await clock.advance(10_000);
    expect(reads(seen.runs)).toBe(back + 1);
  });
});

describe('a merged pull request', () => {
  test('follows its run on the base branch, says once it settles, and leaves 5 s later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ● Release 0m11s');
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    await clock.advance(10_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed');
    // A late run could still start, so passing is not said yet.
    expect(seen.toasts).toEqual([]);
    expect(seen.wakes).toEqual([]);
    // Read on through the 90 s after the merge, then settled: said once,
    // kept a few seconds, and read no more. The read 91 s after the merge,
    // at T0 + 81 s, is the first past the grace.
    await clock.advance(72_000);
    expect(seen.toasts).toEqual(['#128 merged: its checks passed']);
    // Nothing for Claude to do, so it waits for the person's next prompt.
    expect(seen.wakes).toEqual([]);
    expect(seen.notified).toEqual([]);
    const settled = reads(seen.runs);
    // A message does not clear it early.
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(seen.contexts.at(-1)?.[0]).toContain(
      "o/r#128 merged into main, and the merge commit's checks passed.",
    );
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed');
    await clock.advance(5000);
    expect(await lineIn(ui)).toBeUndefined();
    await clock.advance(120_000);
    expect(reads(seen.runs)).toBe(settled);
  });

  test('one Claude merges unwatched is followed onto its base branch, and its passed checks wake no one', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), view: VIEW };
    const seen = world(on, gh, '');
    await start($);
    await create($, 'gh pr merge 128 --squash -t "Ship it; now" --delete-branch');
    expect(seen.order).toEqual([
      'gh pr merge 128 --squash -t "Ship it; now" --delete-branch',
      'gh pr view 128 --json url,state,mergedAt',
    ]);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ● Release 0m11s');
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    // Past the 90 s after the merge in which a later run could still start.
    await clock.advance(92_000);
    expect(seen.wakes).toEqual([]);
  });
  test('a merge Claude made still wakes it when the merge commit fails', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), view: VIEW };
    const seen = world(on, gh, '');
    await start($);
    await create($, 'gh pr merge 128 --squash');
    await clock.advance(1000);
    gh.pr = mergedJson('COMPLETED', 'FAILURE');
    await clock.advance(92_000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('failed on the merge commit for o/r#128');
  });
  test('a merge GitHub makes later on --auto is news, its passed checks told', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const open = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), view: open };
    const seen = world(on, gh, '');
    await start($);
    await create($, 'gh pr merge 128 --squash --auto');
    await clock.advance(1000);
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    await clock.advance(92_000);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(seen.contexts.at(-1)?.[0]).toContain("merge commit's checks passed");
  });

  test('a merge names its repository to gh, and a bare merge runs nothing more', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: mergedJson('IN_PROGRESS', null), view: VIEW }, '');
    await start($);
    await create($, 'gh pr merge --squash --delete-branch');
    await create($, 'gh pr merge 128 -R o/r');
    expect(seen.order).toEqual([
      'gh pr merge --squash --delete-branch',
      'gh pr merge 128 -R o/r',
      'gh pr view 128 --repo o/r --json url,state,mergedAt',
    ]);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m11s');
  });

  test('a merge of one already watched keeps what its line has read', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: VIEW });
    await start($);
    await create($);
    await clock.advance(1000);
    await create($, 'gh pr merge 128 --squash');
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
  });

  test('a merge that failed, ran elsewhere, or asked for help adds no line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), view: VIEW };
    const seen = world(on, gh, '', (command) => command.includes('129'));
    await start($);
    await create($, 'gh pr merge 129');
    await create($, 'cd ../other && gh pr merge 5');
    await create($, 'gh pr merge --help');
    await clock.advance(1000);
    expect(seen.order.filter((c) => c.startsWith('gh pr view'))).toEqual([]);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a command naming a merge long done adds no line and says nothing', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const old = JSON.stringify({ url: URL, state: 'MERGED', mergedAt: '2026-08-18T01:41:03Z' });
    const seen = world(on, { pr: mergedJson('COMPLETED', 'SUCCESS'), view: old }, '');
    await start($);
    await create($, 'node -e "probe(); gh pr merge 128"');
    await clock.advance(1000);
    expect(seen.order).toContain('gh pr view 128 --json url,state,mergedAt');
    expect(seen.toasts).toEqual([]);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a merge whose pull request gh cannot find says so once, and adds no line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: mergedJson('IN_PROGRESS', null) }, '');
    await start($);
    await create($, 'gh pr merge 130');
    await clock.advance(1000);
    expect(seen.toasts).toEqual(['pr-watch could not follow the merge of 130: no PR']);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a failed run on the base branch stays past a message until a re-run passes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('COMPLETED', 'FAILURE') };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(90_000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    expect(seen.notified).toEqual(['#128 merged: Release: Publish failed']);
    const r = await $.prompt.submit({
      text: 'next',
      origin: { kind: 'composer' },
      wait: false,
    } as any);
    expect(r).toMatchObject({ text: 'next' });
    await clock.advance(600_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    // Read within the minute; stop on the read that sees it pass.
    for (let s = 0; s < 60 && seen.toasts.at(-1) !== '#128 merged: its checks passed'; s++) {
      await clock.advance(1000);
    }
    expect(seen.toasts.at(-1)).toBe('#128 merged: its checks passed');
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed');
    await clock.advance(5000);
    expect(await lineIn(ui)).toBeUndefined();
  });

  test("a stack's lower layer, whose merge commit gets no runs, follows the layer above's", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const lower = onMerge(mergedJson('IN_PROGRESS', null), []);
    const stack = stackJson(236, []);
    const gh: Gh = { pr: JSON.stringify(lower), stack, trunk: above('IN_PROGRESS', null) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ○ waiting on checks');
    // A merge commit's own runs may start late, so the trunk waits out the grace.
    expect(seen.runs.filter(isTrunkRead)).toEqual([]);
    await clock.advance(80_000);
    expect(await lineIn(ui)).toMatch(/^#128 merged into main · ● Release /);
    expect(seen.runs.filter(isTrunkRead).every((r) => r.includes('b=refs/heads/main'))).toBe(true);
    gh.trunk = above('COMPLETED', 'SUCCESS');
    await clock.advance(10_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed on a later commit');
    expect(seen.toasts.at(-1)).toBe('#128 merged: its checks passed');
    await clock.advance(5000);
    expect(await lineIn(ui)).toBeUndefined();
  });

  test('a failed merge run settles once a later run of it on the trunk passed', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = JSON.stringify(onMerge(mergedJson('COMPLETED', 'FAILURE')));
    const later = (conclusion: string) =>
      trunkJson([
        ['next', [releaseSuite('COMPLETED', conclusion, 12)]],
        ['m', []],
      ]);
    const gh: Gh = { pr, trunk: later('FAILURE') };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    expect(seen.runs.filter(isTrunkRead).length).toBeGreaterThan(0);
    // Its later run failed too, and then none has run yet: it stays failing.
    await clock.advance(600_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    // The failure told is still the merge commit's own run.
    expect(seen.wakes.join('\n')).toContain('actions/runs/9');
    expect(seen.wakes.join('\n')).not.toContain('actions/runs/12');
    gh.trunk = trunkJson([['m', []]]);
    await clock.advance(300_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    gh.trunk = later('SUCCESS');
    for (let s = 0; s < 300 && seen.toasts.at(-1) !== '#128 merged: its checks passed'; s++) {
      await clock.advance(1000);
    }
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ Release failed, since passed');
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(seen.contexts.at(-1)?.[0]).toContain(
      'o/r#128 merged into main, and Release failed on the merge commit and since passed on main.',
    );
    await clock.advance(5000);
    expect(await lineIn(ui)).toBeUndefined();
  });

  test("a stack layer's failed run waits for its trunk before reading the trunk", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = onMerge(mergedJson('COMPLETED', 'FAILURE'));
    pr.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    const stack = stackJson(236, []);
    const trunk = trunkJson([
      ['next', [releaseSuite('COMPLETED', 'SUCCESS', 12)]],
      ['m', []],
    ]);
    const seen = world(on, { pr: JSON.stringify(pr), stack, stackFails: 1, trunk });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe(
      '#128 merged into docs/lower-layer · ✗ Release: Publish failed',
    );
    expect(seen.runs.filter(isTrunkRead)).toEqual([]);
    await clock.advance(60_000);
    expect(seen.runs.filter(isTrunkRead).every((r) => r.includes('b=refs/heads/main'))).toBe(true);
    expect(await lineIn(await band($))).toBe(
      '#128 merged into main · ✓ Release failed, since passed',
    );
  });

  test('a merge outside a stack whose commit gets no runs leaves, whatever ran later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = JSON.stringify(onMerge(mergedJson('IN_PROGRESS', null), []));
    const seen = world(on, { pr, stack: '[]', trunk: above('COMPLETED', 'FAILURE') });
    await start($);
    await create($);
    await clock.advance(81_000);
    expect(await lineIn(await band($))).toBeUndefined();
    expect(seen.runs.filter(isTrunkRead)).toEqual([]);
    expect(seen.toasts).toEqual([]);
  });

  test('a stack layer with no runs whose trunk cannot be read says so, rather than leave', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = JSON.stringify(onMerge(mergedJson('IN_PROGRESS', null), []));
    const stack = stackJson(236, []);
    const trunk = JSON.stringify({ errors: [{ message: 'Something went wrong' }] });
    world(on, { pr, stack, trunk });
    await start($);
    await create($);
    await clock.advance(81_000);
    expect(await lineIn(await band($))).toMatch(/Something went wrong/);
  });

  test('a failed merge whose trunk cannot be read keeps its failure, and is not given up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = JSON.stringify(onMerge(mergedJson('COMPLETED', 'FAILURE')));
    const trunk = JSON.stringify({ errors: [{ message: 'Something went wrong' }] });
    const seen = world(on, { pr, trunk });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
    await clock.advance(1_800_000);
    expect(seen.runs.filter(isTrunkRead).length).toBeGreaterThan(8);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✗ Release: Publish failed');
  });

  test('a failed merge whose trunk read is rate limited still says its failure at once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = JSON.stringify(onMerge(mergedJson('COMPLETED', 'FAILURE')));
    const seen = world(on, { pr, trunkLimited: true });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.runs.filter(isTrunkRead)).toHaveLength(1);
    expect(seen.notified).toEqual(['#128 merged: Release: Publish failed']);
    expect(await lineIn(await band($))).toMatch(
      /^#128 merged into main · ✗ Release: Publish failed · rate limited until /,
    );
  });

  test('a merge whose commit starts no runs leaves once the 90 s are up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merge = { baseRefName: 'main', mergedAt: '2026-10-03T22:01:00Z', mergeCommit: null };
    world(on, { pr: prJson({ state: 'MERGED', ...merge }) });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ○ waiting on checks');
    const r = await $.prompt.submit({
      text: 'hi',
      origin: { kind: 'composer' },
      wait: false,
    } as any);
    expect(r).toMatchObject({ text: 'hi' });
    expect(await lineIn(ui)).toBe('#128 merged into main · ○ waiting on checks');
    await clock.advance(80_000);
    expect(await lineIn(ui)).toBeUndefined();
  });

  test('a run that starts in the last seconds of the 90 is still followed', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('COMPLETED', 'SUCCESS') };
    world(on, gh);
    await start($);
    await create($);
    // Merged at T0 - 10 s; reads at 11 s, 21 s, … 81 s after the merge.
    await clock.advance(75_000);
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(20_000);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 1m45s');
  });

  test('reads that fail past the 90 s neither settle nor drop it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('COMPLETED', 'SUCCESS') };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.fails = true;
    await clock.advance(100_000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed · gh failed: HTTP 401');
    const before = reads(seen.runs);
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(await lineIn(ui)).toMatch(/gh failed/);
    // Four failed reads in, the next waits 80 s.
    await clock.advance(70_000);
    expect(reads(seen.runs)).toBeGreaterThan(before);
    expect(seen.toasts).toEqual([]);
  });

  test('a merge with no runs yet, then failing reads, still follows the run once gh recovers', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merge = { baseRefName: 'main', mergedAt: '2026-10-03T22:01:00Z', mergeCommit: null };
    const gh: Gh = { pr: prJson({ state: 'MERGED', ...merge }) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.fails = true;
    await clock.advance(120_000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe(
      '#128 merged into main · ○ waiting on checks · gh failed: HTTP 401',
    );
    gh.fails = false;
    gh.pr = mergedJson('IN_PROGRESS', null);
    // Four failed reads in, the next waits 80 s.
    await clock.advance(50_000);
    expect(await lineIn(ui)).toMatch(/^#128 merged into main · ● Release /);
  });

  test('the clock keeps moving for a run on the base branch', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(10_000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ● Release 0m21s');
    await clock.advance(3000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ● Release 0m24s');
  });

  test('waits for the merge commit’s runs to start, then follows them', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({
        state: 'MERGED',
        baseRefName: 'main',
        mergedAt: '2026-10-03T22:01:00Z',
        mergeCommit: null,
      }),
    };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 merged into main · ○ waiting on checks');
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(10_000);
    expect(await lineIn(ui)).toBe('#128 merged into main · ● Release 0m21s');
  });

  test('a message while its run is still going leaves the line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: mergedJson('IN_PROGRESS', null) });
    await start($);
    await create($);
    await clock.advance(1000);
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release 0m11s');
  });
});

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MINUTE = 60_000;

describe('GitHub out of reach', () => {
  test('one failed read is quiet, the next says so dim, and none gives up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    gh.offline = true;
    await clock.advance(10_000);
    expect(await lineIn(ui)).toMatch(/^#128 ● CI \dm\d\ds$/);
    await clock.advance(16_000);
    expect(await lineIn(ui)).toMatch(/^#128 ● CI \dm\d\ds · offline, retrying$/);
    await clock.advance(30 * 60_000);
    expect(await lineIn(ui)).toMatch(/ · offline, retrying$/);
    // Told once, some 15 minutes in, that it keeps trying; never given up on.
    expect(seen.toasts).toEqual([
      'pr-watch cannot reach github.com: Post "https://api.github.com/graphql": net/http: TLS handshake timeout. It keeps trying; unwatch a line with its × if the host or proxy is wrong.',
    ]);
    expect(seen.wakes).toEqual([]);
    gh.offline = false;
    await clock.advance(61_000);
    expect(await lineIn(ui)).toMatch(/^#128 ● CI \d+m\d\ds$/);
    // Back online, a running line is read every 10 s again, no more often.
    const before = reads(seen.runs);
    await clock.advance(30_000);
    expect(reads(seen.runs) - before).toBe(3);
  });

  test('one read at a time tries the host, and every line on it says so', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    await clock.advance(11_000);
    const before = reads(seen.runs);
    // Probes 15, 30 and 60 s apart: three reads in the next 110 s, not three per line.
    await clock.advance(110_000);
    expect(reads(seen.runs) - before).toBe(3);
    const ui = await band($);
    expect(await lineIn(ui)).toMatch(/ · offline, retrying$/);
    expect(await pushLineIn(ui)).toMatch(/ · offline, retrying$/);
  });

  test('one answer clears every line on the host, and a refusal after it backs off as before', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    await clock.advance(30_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toMatch(/ · offline, retrying$/);
    gh.offline = false;
    gh.readsFail = true;
    // The next probe is answered, if only with a refusal, and the line it did
    // not read loses its note in the same moment.
    for (let s = 0; s < 60; s++) {
      const pushLine = await pushLineIn(ui);
      if (!pushLine?.includes('offline')) break;
      await clock.advance(1000);
    }
    expect(await pushLineIn(ui)).not.toContain('offline');
    expect(await lineIn(ui)).not.toContain('offline');
    const before = reads(seen.runs);
    await clock.advance(60_000);
    // Retried 10, 20, 40 s apart per line, not every second.
    expect(reads(seen.runs) - before).toBeLessThanOrEqual(6);
    expect(seen.toasts.filter((t) => t.includes('stopped watching'))).toEqual([]);
  });

  test('a rate limit is an answer too: every line drops the note on it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    await clock.advance(30_000);
    const ui = await band($);
    expect(await lineIn(ui)).toMatch(/ · offline, retrying$/);
    gh.offline = false;
    gh.limited = true;
    for (let s = 0; s < 60; s++) {
      const line = await lineIn(ui);
      if (line?.includes('rate limited')) break;
      await clock.advance(1000);
    }
    expect(await lineIn(ui)).not.toContain('offline');
    expect(await pushLineIn(ui)).not.toContain('offline');
  });

  test('a push not yet read waits for a read of its own after GitHub answers', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    gh.push = pushJson('IN_PROGRESS');
    await create($, 'git push -u origin feat/x');
    await clock.advance(200_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x offline, retrying');
    gh.offline = false;
    await clock.advance(61_000);
    expect(await pushLineIn(ui)).toMatch(/^⟳ push feat\/x · ● Release /);
  });

  test('a push made late in an outage gets its own 15 minutes, and its read after', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    await clock.advance(14 * 60_000);
    gh.push = pushJson('IN_PROGRESS');
    await create($, 'git push -u origin feat/x');
    await clock.advance(5 * 60_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBeDefined();
    gh.offline = false;
    await clock.advance(61_000);
    expect(await pushLineIn(ui)).toMatch(/^⟳ push feat\/x · ● Release /);
  });

  test('a later outage starts afresh once an earlier one’s lines have left', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), offline: true };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(16 * 60_000);
    expect(await pushLineIn(await band($))).toBeUndefined();
    gh.offline = false;
    await clock.advance(60 * 60_000);
    gh.offline = true;
    await create($, 'git push -u origin feat/x');
    await clock.advance(125_000);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x offline, retrying');
    await clock.advance(15 * 60_000);
    expect(
      seen.toasts.filter((t) => t.startsWith('pr-watch cannot reach github.com')),
    ).toHaveLength(2);
  });

  test('a slow probe is not joined by another line’s', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.offline = true;
    gh.holdPush = true;
    await clock.advance(11_000);
    const before = reads(seen.runs);
    await clock.advance(40_000);
    expect(reads(seen.runs)).toBe(before);
    gh.release?.();
  });

  test('the watch tool says when its first read could not reach GitHub', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), view: OPEN_VIEW, offline: true });
    await start($);
    await clock.advance(1000);
    const answer = await tool($, 'watch', { pull: '128' });
    expect(answer).toContain('GitHub could not be reached');
    expect(answer).toContain('pr-watch keeps trying');
  });

  test('a push GitHub could not be asked about for 15 minutes leaves, said once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), offline: true };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(16 * 60_000);
    expect(await pushLineIn(await band($))).toBeUndefined();
    expect(
      seen.toasts.filter((t) => t.startsWith('pr-watch cannot reach github.com')),
    ).toHaveLength(1);
  });

  test('a push GitHub could not be asked about stays past 90 s', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), offline: true };
    world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(200_000);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x offline, retrying');
  });

  test('a push GitHub refused stays past 90 s, then gives up after 8 reads and says so', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), pushError: 'gh: Bad credentials (HTTP 401)' };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(200_000);
    expect(await pushLineIn(await band($))).toBe(
      '⟳ push feat/x gh failed: Bad credentials (HTTP 401)',
    );
    await clock.advance(16 * MINUTE);
    expect(await pushLineIn(await band($))).toBeUndefined();
    expect(seen.toasts).toContain(
      'pr-watch stopped watching push feat/x: gh failed: Bad credentials (HTTP 401)',
    );
    expect(seen.wakes).toEqual([
      [
        'pr-watch: 8 reads of the push to feat/x on o/r in a row failed, so pr-watch stopped watching it. The last: gh failed: Bad credentials (HTTP 401)',
        'pr-watch follows the branch again on its next push once gh can read it. https://github.com/o/r/tree/feat/x',
      ].join('\n'),
    ]);
  });

  test('a refused push stays though a later read fails another way, and still gives up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), pushError: 'gh: Bad credentials (HTTP 401)' };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    gh.pushError = 'gh: Something went wrong while executing your query.';
    await clock.advance(200_000);
    expect(await pushLineIn(await band($))).toBe(
      '⟳ push feat/x gh failed: Something went wrong while executing your query.',
    );
    await clock.advance(16 * MINUTE);
    expect(await pushLineIn(await band($))).toBeUndefined();
    expect(seen.toasts).toHaveLength(1);
    expect(seen.wakes).toHaveLength(1);
  });

  test('a push to a host that is not GitHub leaves quietly once the grace is over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), pushError: 'gh: HTTP 404' }, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x gh failed: HTTP 404');
    await clock.advance(90_000);
    expect(await pushLineIn(await band($))).toBeUndefined();
    expect(seen.toasts).toEqual([]);
    expect(seen.wakes).toEqual([]);
  });

  test('a merged line waits out the outage past its 90 s', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: mergedJson('IN_PROGRESS', null), view: VIEW };
    const seen = world(on, gh, '');
    await start($);
    await create($, 'gh pr merge 128 --squash');
    await clock.advance(1000);
    gh.offline = true;
    await clock.advance(200_000);
    expect(await lineIn(await band($))).toMatch(
      /^#128 merged into main · ● Release .* · offline, retrying$/,
    );
    gh.offline = false;
    gh.pr = mergedJson('COMPLETED', 'SUCCESS');
    await clock.advance(61_000);
    expect(seen.toasts).toContain('#128 merged: its checks passed');
  });

  test('a refusal still reads red', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.readsFail = true;
    await clock.advance(11_000);
    expect(await lineIn(await band($))).toMatch(/ · gh failed: HTTP 401$/);
  });
});

const GIVE_UP = 8;

describe('reads that fail', () => {
  test('a spent quota pauses every watch on the host until it resets', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const reset = '2026-10-03T22:30:00Z';
    const gh: Gh = {
      pr: withQuota(prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), 0, reset),
      push: pushJson('IN_PROGRESS'),
      view: OPEN_VIEW,
    };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($);
    await create($, 'git push');
    await clock.advance(1000);
    gh.limited = true;
    // Only the pull request is read; the push's line says the pause too.
    await tool($, 'watch', { pull: '128' });
    const ui = await band($);
    const said = `rate limited until ${hhmm(Date.parse(reset))}`;
    expect(await lineIn(ui)).toMatch(said);
    expect(await pushLineIn(ui)).toMatch(said);
    const before = reads(seen.runs);
    await clock.advance(Date.parse(reset) - T0 - 2 * MINUTE);
    expect(reads(seen.runs)).toBe(before);
    gh.limited = false;
    await clock.advance(2 * MINUTE);
    expect(reads(seen.runs)).toBeGreaterThan(before);
    expect(await lineIn(ui)).not.toMatch('rate limited');
  });

  // Over an hour of 1 s ticks, longer than TIMEOUT_MS allows on CI's runners.
  test(
    'another limit waits a minute, longer each time, and never ends the watch',
    { timeoutMs: 20_000 },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      gh.limited = true;
      await clock.advance(10_000);
      const first = reads(seen.runs);
      expect(await lineIn(await band($))).toMatch(/rate limited until \d\d:\d\d$/);
      await clock.advance(59_000);
      expect(reads(seen.runs)).toBe(first);
      await clock.advance(2000);
      expect(reads(seen.runs)).toBe(first + 1);
      await clock.advance(118_000);
      expect(reads(seen.runs)).toBe(first + 1);
      await clock.advance(2000);
      expect(reads(seen.runs)).toBe(first + 2);
      // The ninth limited read is at 4511 s, after pauses of 60, 120, 240, 480
      // and then 900 s; the watch stays.
      await clock.advance(73 * MINUTE);
      expect(reads(seen.runs) - 1).toBe(GIVE_UP + 1);
      expect(await lineIn(await band($))).toMatch(/rate limited until/);
      expect(seen.toasts.filter((t) => t.includes('stopped watching'))).toEqual([]);
    },
  );

  test('a read that fails waits longer each time, and after 8 in a row the watch ends', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.fails = true;
    // Failed reads at 11 s, then 10, 20, 40, 80, 160, 300 and 300 s apart.
    await clock.advance(15 * MINUTE);
    expect(reads(seen.runs)).toBe(1 + GIVE_UP - 1);
    expect(await lineIn(await band($))).toMatch(/ · gh failed: HTTP 401$/);
    await clock.advance(MINUTE);
    expect(reads(seen.runs)).toBe(1 + GIVE_UP);
    expect(await lineIn(await band($))).toBeUndefined();
    expect(seen.toasts).toContain('pr-watch stopped watching #128: gh failed: HTTP 401');
    expect(seen.wakes).toEqual([
      [
        'pr-watch: 8 reads of o/r#128 in a row failed, so pr-watch stopped watching it. The last: gh failed: HTTP 401',
        `Watch it again with pr-watch's watch tool once gh can read it. ${URL}`,
      ].join('\n'),
    ]);
  });

  test('a read that succeeds starts the count over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.fails = true;
    // The seventh failed read is at 621 s; the next waits 300 s.
    await clock.advance(11 * MINUTE);
    gh.fails = false;
    await clock.advance(5 * MINUTE);
    gh.fails = true;
    await clock.advance(10 * MINUTE);
    expect(await lineIn(await band($))).toMatch(/ · gh failed: HTTP 401$/);
  });

  test('the watch tool reads nothing while its host is paused, and says why', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), view: OPEN_VIEW };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.limited = true;
    await clock.advance(10_000);
    const before = reads(seen.runs);
    expect(await tool($, 'watch', { pull: '128' })).toMatch(
      /GitHub's rate limit pauses its reads until \d\d:\d\d\./,
    );
    expect(reads(seen.runs)).toBe(before);
  });

  test('reads limited together pause once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($);
    await create($, 'git push');
    await clock.advance(1000);
    gh.limited = true;
    // Both are read at 6 s, in the push's burst, and limited together.
    await clock.advance(5000);
    const first = reads(seen.runs);
    await clock.advance(59_000);
    expect(reads(seen.runs)).toBe(first);
    await clock.advance(2000);
    expect(reads(seen.runs)).toBe(first + 2);
  });

  test('a read that began before the pause does not end it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), holdFirst: true };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($);
    // The pull request's read starts at 1 s and is held; the push's is limited.
    await clock.advance(1000);
    gh.limited = true;
    await create($, 'git push');
    await clock.advance(1000);
    const before = reads(seen.runs);
    gh.release?.();
    await clock.advance(30_000);
    expect(reads(seen.runs)).toBe(before);
    // Its own line still says the pause it ended inside.
    expect(await lineIn(await band($))).toMatch(/ · rate limited until \d\d:\d\d$/);
  });

  test('a push made while its host is paused waits it out, then is read', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), limited: true };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($);
    // Limited at 1 s and 61 s; the second pause ends at 181 s.
    await clock.advance(70_000);
    await create($, 'git push');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toMatch(/^⟳ push feat\/x rate limited until/);
    gh.limited = false;
    await clock.advance(112_000);
    expect(await pushLineIn(ui)).toMatch(/^⟳ push feat\/x · ● Release/);
  });

  test('a limited read judges nothing on the last good state', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merge = { baseRefName: 'main', mergedAt: '2026-10-03T22:01:00Z', mergeCommit: null };
    const gh: Gh = { pr: prJson({ state: 'MERGED', ...merge }) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    // Limited at 11 s, 71 s and 191 s, the last past the merge's 90 s grace.
    gh.limited = true;
    await clock.advance(4 * MINUTE);
    const ui = await band($);
    expect(await lineIn(ui)).toMatch(/^#128 merged into main · ○ waiting on checks · rate limited/);
    gh.limited = false;
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(5 * MINUTE);
    expect(await lineIn(ui)).toMatch(/^#128 merged into main · ● Release /);
  });

  test('a failure of its own after a pause says so and backs off', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), limited: true };
    const seen = world(on, gh);
    let isRefusing = false;
    on('state.set', ($: unknown, e: any, next: any) =>
      isRefusing &&
      e.key === 'watches' &&
      Array.isArray(e.value) &&
      e.value.some((w: any) => w.pull !== undefined)
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await create($);
    await clock.advance(1000);
    // Paused until 61 s; then reads answer but their saves are refused.
    gh.limited = false;
    isRefusing = true;
    await clock.advance(MINUTE);
    const before = reads(seen.runs);
    await clock.advance(10 * MINUTE);
    expect(await lineIn(await band($))).toMatch(/^#128 pr-watch failed: /);
    expect(reads(seen.runs) - before).toBeLessThanOrEqual(10);
  });

  test('a rate limit never ends a watch, whatever failed before it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    const seen = world(on, gh);
    let isRefusing = true;
    // Saves of a read are refused, so pr-watch's own failures pass 8.
    on('state.set', ($: unknown, e: any, next: any) =>
      isRefusing &&
      e.key === 'watches' &&
      Array.isArray(e.value) &&
      e.value.some((w: any) => w.pull !== undefined)
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await create($);
    await clock.advance(20 * MINUTE);
    isRefusing = false;
    gh.limited = true;
    await clock.advance(6 * MINUTE);
    expect(await lineIn(await band($))).toMatch(/^#128 pr-watch failed: .* · rate limited until/);
    expect(seen.toasts.filter((t) => t.includes('stopped watching'))).toEqual([]);
  });

  test('after a read succeeds, the next limit waits a minute again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.limited = true;
    // Limited at 11 s and 71 s, the second pause lasting until 191 s.
    await clock.advance(61_000);
    gh.limited = false;
    await clock.advance(121_000);
    gh.limited = true;
    // Up to the next read, which is limited.
    const read = reads(seen.runs);
    while (reads(seen.runs) === read) await clock.advance(1000);
    const limited = reads(seen.runs);
    await clock.advance(58_000);
    expect(reads(seen.runs)).toBe(limited);
    await clock.advance(3000);
    expect(reads(seen.runs)).toBe(limited + 1);
  });

  test('a push not yet read stays while its host is rate-limited', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), limited: true };
    world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(100_000);
    expect(await pushLineIn(await band($))).toMatch(/^⟳ push feat\/x rate limited until/);
  });

  test('a push not yet read stays though another read on the host ends the pause first', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS'), limited: true };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($);
    await create($, 'git push');
    // Limited at 1 s and 61 s; the pause ends at 181 s, past the push's 90 s grace.
    await clock.advance(100_000);
    gh.limited = false;
    gh.holdPush = true;
    await clock.advance(90_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toMatch(/rate limited until/);
    gh.release?.();
    await clock.advance(1000);
    expect(await pushLineIn(ui)).toMatch(/^⟳ push feat\/x · ● Release/);
  });

  test('a merge whose second read stays limited waits longer each time', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: mergedJson('IN_PROGRESS', null), mergedLimited: true });
    await start($);
    await create($);
    await clock.advance(1000);
    const first = reads(seen.runs);
    await clock.advance(61_000);
    expect(reads(seen.runs)).toBe(first + 2);
    await clock.advance(118_000);
    expect(reads(seen.runs)).toBe(first + 2);
    await clock.advance(2000);
    expect(reads(seen.runs)).toBe(first + 4);
  });

  test('a line on a slow poll is read as its pause ends', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const review = { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' };
    const gh: Gh = { pr: prJson(review), view: OPEN_VIEW };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(31 * MINUTE);
    gh.limited = true;
    await tool($, 'watch', { pull: '128' });
    gh.limited = false;
    await clock.advance(62_000);
    expect(await lineIn(await band($))).toBe('#128 ○ waiting on review');
  });

  test('a failing line on a slow poll retries on the failure schedule', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const review = { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' };
    const gh: Gh = { pr: prJson(review) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(31 * MINUTE);
    gh.fails = true;
    await clock.advance(21 * MINUTE);
    expect(await lineIn(await band($))).toBeUndefined();
  });

  test('a failure of its own backs a watch off too', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) });
    // Every save of a read is refused; the save of the failure itself goes through.
    on('state.set', ($: unknown, e: any, next: any) =>
      e.key === 'watches' &&
      Array.isArray(e.value) &&
      e.value.some((w: any) => w.pull !== undefined)
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await create($);
    await clock.advance(10 * MINUTE);
    expect(await lineIn(await band($))).toMatch(/^#128 pr-watch failed: /);
    expect(reads(seen.runs)).toBeLessThanOrEqual(10);
  });

  test('a fresh merge whose runs are rate-limited says so, not waiting on checks', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: mergedJson('IN_PROGRESS', null), mergedLimited: true });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 rate limited until/);
  });

  test(
    'with waking off, a watch that gives up is toasted but Claude is not woken',
    { options: { wake: 'off' } },
    async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      gh.fails = true;
      await clock.advance(16 * MINUTE);
      expect(seen.toasts).toContain('pr-watch stopped watching #128: gh failed: HTTP 401');
      expect(seen.wakes).toEqual([]);
    },
  );

  test('the watch tool whose read is the eighth failure answers why it gave up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), view: OPEN_VIEW };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.readsFail = true;
    // The seventh failed read is at 621 s; the next is not due until 921 s.
    await clock.advance(11 * MINUTE);
    expect(await tool($, 'watch', { pull: '128' })).toMatch(
      /^pr-watch: 8 reads of o\/r#128 in a row failed/,
    );
    expect(seen.wakes).toEqual([]);
  });

  test('a line whose state changes after half an hour is read every minute again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }),
    };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(31 * MINUTE);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' });
    await clock.advance(5 * MINUTE);
    const before = reads(seen.runs);
    await clock.advance(3 * MINUTE);
    expect(reads(seen.runs) - before).toBe(3);
  });

  test('a line that waits on review for half an hour is read every 5 minutes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const review = { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' };
    const seen = world(on, { pr: prJson(review) });
    await start($);
    await create($);
    await clock.advance(31 * MINUTE);
    const before = reads(seen.runs);
    await clock.advance(10 * MINUTE);
    expect(reads(seen.runs) - before).toBe(2);
    expect(await lineIn(await band($))).toBe('#128 ○ waiting on review');
  });
});
