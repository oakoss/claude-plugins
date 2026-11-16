import { describe, expect, mock } from 'claude-code/testing';

import {
  band,
  ciSuite,
  create,
  FAILING_CI,
  type Gh,
  ID,
  lineIn,
  mergedJson,
  prJson,
  PROPS,
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

// The first line the band draws.
async function firstRow($: any): Promise<string | undefined> {
  const rows = await rowsIn(await band($));
  return rows[0];
}

// CI's run number `n`.
function runOf(n: number, summary: Record<string, unknown>) {
  const suite = ciSuite(summary);
  suite.workflowRun = { ...suite.workflowRun, url: `https://github.com/o/r/actions/runs/${n}` };
  return suite;
}

// Docs, a workflow nothing requires, on its second attempt.
function docsRerun(status: string) {
  const conclusion = status === 'COMPLETED' ? 'SUCCESS' : null;
  return {
    status,
    conclusion,
    workflowRun: {
      runAttempt: 2,
      databaseId: 6,
      createdAt: '2026-10-03T22:00:00Z',
      url: 'https://github.com/o/r/actions/runs/6',
      workflow: { databaseId: 8, name: 'Docs' },
    },
    checkRuns: {
      nodes: [{ name: 'Build', status, conclusion, detailsUrl: '', isRequired: false }],
    },
  };
}

// CI's last successful run took 2m20s.
const CI_RUN = JSON.stringify({
  workflow_runs: [{ run_started_at: '2026-10-03T21:00:00Z', updated_at: '2026-10-03T21:02:20Z' }],
});

// Every line the band draws, top to bottom, their × left off.
async function rowsIn(ui: any): Promise<string[]> {
  const boxes: any[] = await ui.findAll({ type: 'Box' });
  return boxes
    .filter((b) => String(b.key ?? b.props?.key ?? '').startsWith('row-'))
    .map((b) => b.text.replace(/ ×$/, ''));
}

// The color the band draws a Text of this text in; undefined when it has none.
async function colorIn(ui: any, text: string): Promise<string | undefined> {
  const found = await ui.find({ type: 'Text', text });
  return found?.props.color;
}

const ESTIMATE_CALL = 'actions/workflows/7/runs';

const plainLayer = (n: number, over: Record<string, unknown> = {}, suites: unknown[] = []) =>
  prJson({ number: n, url: pullUrl(n), ...over }, suites);

const layerOnBranch = (n: number, over: Record<string, unknown> = {}, suites: unknown[] = []) =>
  prJson(
    {
      number: n,
      url: pullUrl(n),
      headRefName: `feat/l${n}`,
      headRepository: { nameWithOwner: 'o/r' },
      ...over,
    },
    suites,
  );

describe('a pull request Claude opens', () => {
  test('a ready pull request names the workflows still running as not required', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const green = ciSuite({ status: 'COMPLETED', conclusion: 'SUCCESS' });
    const seen = world(on, { pr: prJson({}, [green, docsRerun('IN_PROGRESS')]) });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(seen.toasts).toEqual(['#128 is ready to merge; Docs still running, not required']);
  });

  test('is watched, read, and drawn ready to merge, with one toast', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await lineIn(await band($, surface))).toBe('#128 ✓ ready to merge');
    }
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
    const reads = seen.runs.length;
    await clock.advance(70_000);
    expect(seen.runs.length).toBeGreaterThan(reads);
    expect(seen.toasts).toHaveLength(1);
  });

  test('draws each mark in its color and its words plain, on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), estimate: CI_RUN };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface);
      expect(await colorIn(ui, ' ●')).toBe('blue');
      expect(await ui.find({ type: 'Link', label: 'CI' })).toBeDefined();
    }
    gh.pr = prJson();
    await clock.advance(11_000);
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface);
      expect(await colorIn(ui, ' ✓')).toBe('green');
      expect(await ui.find({ type: 'Text', text: ' ready to merge' })).toBeDefined();
      expect(await colorIn(ui, ' ready to merge')).toBeUndefined();
    }
  });

  test('draws a re-run’s clock once GitHub says when its attempt started', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const rerun = {
      ...RUNNING_CI,
      workflowRun: { ...RUNNING_CI.workflowRun, runAttempt: 2, databaseId: 5 },
    };
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [rerun]), estimate: CI_RUN };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 ● CI re-run');
    const asks = () => seen.runs.filter((r) => r.includes('actions/runs/5/attempts/2')).length;
    expect(asks()).toBe(1);
    gh.attempt = JSON.stringify({ run_attempt: 2, run_started_at: '2026-10-03T22:00:30Z' });
    await clock.advance(30_000);
    expect(asks()).toBe(1);
    await clock.advance(31_000);
    expect(await lineIn(ui)).toBe('#128 ● CI re-run 1m42s');
    await clock.advance(60_000);
    expect(asks()).toBe(2);
  });

  for (const [what, attemptError, asks] of [
    ['a missing run', 'gh: Not Found (HTTP 404)\n', 1],
    ['a token without Actions', 'gh: Resource not accessible by integration (HTTP 403)\n', 1],
    ['a rate limit', 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n', 4],
    ['a server error', 'gh: Server Error (HTTP 502)\n', 4],
  ] as const) {
    test(`asks for a re-run’s start again after ${what} only if it may pass`, async ($, on) => {
      const clock = mock.clock(on, { now: T0 });
      const rerun = {
        ...RUNNING_CI,
        workflowRun: { ...RUNNING_CI.workflowRun, runAttempt: 2, databaseId: 5 },
      };
      const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [rerun]), attemptError };
      const seen = world(on, gh);
      await start($);
      await create($);
      await clock.advance(1000);
      await clock.advance(180_000);
      expect(seen.runs.filter((r) => r.includes('/attempts/'))).toHaveLength(asks);
      expect(await lineIn(await band($))).toBe('#128 ● CI re-run');
    });
  }

  test('gives a length or start lookup 10 s', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const rerun = {
      ...RUNNING_CI,
      workflowRun: { ...RUNNING_CI.workflowRun, runAttempt: 2, databaseId: 5 },
    };
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [rerun]) });
    await start($);
    await create($);
    await clock.advance(1000);
    const limits = seen.runs.flatMap((r, i) =>
      r.includes('/attempts/') || r.includes(ESTIMATE_CALL) ? [seen.timeouts[i]] : [],
    );
    expect(limits).toEqual([10_000, 10_000]);
  });

  test('asks only for the re-run the line draws, and none that finished', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI, docsRerun('IN_PROGRESS')]),
    };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.pr = prJson({}, [docsRerun('COMPLETED')]);
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes('/attempts/'))).toEqual([]);
  });

  test('learns a re-run’s start on a merged line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const body = JSON.parse(mergedJson('IN_PROGRESS', null));
    const [release] = body.data.repository.pullRequest.mergeCommit.checkSuites.nodes;
    release.workflowRun = { ...release.workflowRun, runAttempt: 2, databaseId: 9 };
    const attempt = JSON.stringify({ run_started_at: '2026-10-03T22:01:05Z' });
    const seen = world(on, { pr: JSON.stringify(body), view: VIEW, attempt }, '');
    await start($);
    await create($, 'gh pr merge 128 --squash');
    await clock.advance(1000);
    await clock.advance(10_000);
    expect(seen.runs.some((r) => r.includes('actions/runs/9/attempts/2'))).toBe(true);
    expect(await lineIn(await band($))).toBe('#128 merged into main · ● Release re-run 0m16s');
  });

  test('draws a running workflow with its bar and times, asking its length once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, {
      pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
      estimate: CI_RUN,
    });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toMatch(/^#128 ● CI █+.*░+ 1m11s \/ ~2m20s$/);
    await clock.advance(1000);
    expect(await lineIn(ui)).toMatch(/ 1m12s \/ ~2m20s$/);
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes(ESTIMATE_CALL))).toHaveLength(1);
  });

  test('learns a workflow’s length again once each run of it finishes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), estimate: CI_RUN };
    const seen = world(on, gh);
    const asks = () => seen.runs.filter((r) => r.includes(ESTIMATE_CALL)).length;
    await start($);
    await create($);
    await clock.advance(1000);
    expect(asks()).toBe(1);
    gh.pr = prJson({}, [ciSuite({ status: 'COMPLETED', conclusion: 'SUCCESS' })]);
    await clock.advance(11_000);
    expect(asks()).toBe(2);
    await clock.advance(130_000);
    expect(asks()).toBe(2);
  });

  test('keeps a known length when learning it again fails or finds none', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), estimate: CI_RUN };
    const seen = world(on, gh);
    const asks = () => seen.runs.filter((r) => r.includes(ESTIMATE_CALL)).length;
    const passed = { status: 'COMPLETED', conclusion: 'SUCCESS' };
    const running = { status: 'QUEUED', conclusion: null };
    await start($);
    await create($);
    await clock.advance(1000);
    gh.estimateFails = 1;
    gh.pr = prJson({}, [runOf(1, passed)]);
    await clock.advance(11_000);
    expect(asks()).toBe(2);
    await clock.advance(130_000);
    expect(asks()).toBe(2);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [runOf(2, running)]);
    await clock.advance(61_000);
    const ui = await band($);
    expect(await lineIn(ui)).toMatch(/ \/ ~2m20s$/);
    gh.estimate = JSON.stringify({
      workflow_runs: [{ ...JSON.parse(CI_RUN).workflow_runs[0], run_attempt: 2 }],
    });
    gh.pr = prJson({}, [runOf(2, passed)]);
    await clock.advance(11_000);
    expect(asks()).toBe(3);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [runOf(3, running)]);
    await clock.advance(61_000);
    expect(await lineIn(ui)).toMatch(/ \/ ~2m20s$/);
  });

  test('asks again for a workflow’s length a minute after the call fails', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh = { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]), estimate: CI_RUN };
    const seen = world(on, { ...gh, estimateFails: 1 });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 ● CI 1m11s');
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes(ESTIMATE_CALL))).toHaveLength(1);
    await clock.advance(40_000);
    expect(await lineIn(ui)).toMatch(/^#128 ● CI █+[▏▎▍▌▋▊▉]?░* 2m21s \/ ~2m20s$/);
  });

  test('keeps the data gh printed beside a GraphQL error', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson(), partial: true });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
    expect(seen.toasts).toEqual(['#128 is ready to merge']);
  });

  test('a length lookup that answers with a web page leaves the line alone', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = prJson({ mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]);
    world(on, { pr, estimate: '<html>502 Bad Gateway</html>' });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    for (let i = 0; i < 4; i += 1) {
      expect(await lineIn(ui)).toMatch(/^#128 ● CI \dm\d\ds$/);
      await clock.advance(5000);
    }
  });

  test('links a failing job to its log, and toasts it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ mergeStateStatus: 'BLOCKED' }, [FAILING_CI]) });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 ✗ CI: Typecheck failed');
    const link = await ui.find({ type: 'Link', text: 'CI: Typecheck failed' });
    expect(link?.props.href).toBe('https://github.com/o/r/actions/runs/1/job/9');
    expect(seen.toasts).toEqual(['#128 CI: Typecheck failed']);
  });

  test('says why gh failed, tries again on the poll, and clears it once it works', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), fails: true };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 gh failed: HTTP 401');
    const tries = seen.runs.length;
    await clock.advance(5000);
    expect(seen.runs.length).toBe(tries);
    gh.fails = false;
    await clock.advance(5000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
    gh.fails = true;
    await clock.advance(60_000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge · gh failed: HTTP 401');
    gh.fails = false;
    await clock.advance(60_000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
  });

  test('a read it cannot save still waits out its delay, and says so once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    // A watches save after the first read is rejected: the store refuses undefined.
    on('state.set', ($: unknown, e: any, next: any) =>
      e.key === 'watches' &&
      Array.isArray(e.value) &&
      e.value.some((w: any) => w.pull !== undefined || w.error !== undefined)
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await create($);
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes('graphql')).length).toBeLessThanOrEqual(4);
    expect(seen.toasts).toHaveLength(1);
    expect(seen.toasts[0]).toMatch(/^pr-watch could not save #128: /);
    expect(seen.wakes).toEqual([]);
  });

  test('leaves the band when it closes without merging', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ state: 'CLOSED' }) });
    await start($);
    await create($);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 loading…');
    await clock.advance(1000);
    expect(seen.runs.some((r) => r.includes('graphql'))).toBe(true);
    expect(await lineIn(ui)).toBeUndefined();
  });

  test('leaves the band when the person presses its ×', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
    // The terminal draws a plain Button without its brackets.
    const close = await ui.find({ key: `stop-${ID}` });
    expect(close?.props.plain).toBe(true);
    await ui.press({ key: `stop-${ID}` });
    expect(await lineIn(ui)).toBeUndefined();
  });

  test('is watched once when gh pr create prints it twice', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() });
    await start($);
    await create($);
    await create($);
    await clock.advance(1000);
    const ui = await band($);
    expect(await ui.findAll({ key: `row-${ID}` })).toHaveLength(1);
  });

  test('watches every pull request gh stack submit opened, with no watch call', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const printed = submitOut([234, 235], ['⚠ failed to create PR for feat/two']);
    const seen = world(on, { pr: prJson() }, printed);
    await start($);
    await create($, 'gh stack submit --auto --open');
    await clock.advance(1000);
    expect(await rowsIn(await band($))).toEqual(['#234 ✓ ready to merge', '#235 ✓ ready to merge']);
    expect(seen.runs.filter((r) => r.includes('graphql'))).toHaveLength(2);
  });

  test('a submit adds none twice, and none already watched', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const printed = `${pullUrl(234)}\n${submitOut([234, 235, 235])}`;
    world(on, { pr: prJson() }, printed);
    await start($);
    await create($, 'gh pr create --fill');
    await create($, 'gh stack submit --auto');
    await clock.advance(1000);
    expect(await rowsIn(await band($))).toEqual(['#234 ✓ ready to merge', '#235 ✓ ready to merge']);
  });

  test('a submit that failed after opening some pull requests still watches them', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() }, submitOut([234]), (command) => command.includes('submit'));
    await start($);
    await create($, 'gh stack submit --auto');
    await clock.advance(1000);
    expect(await rowsIn(await band($))).toEqual(['#234 ✓ ready to merge']);
  });

  test("a three-layer stack's lines carry their places, top layer first", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const printed = submitOut([234, 235, 237]);
    const stack = stackJson(236, [234, 235, 237]);
    world(on, { pr: prJson(), stacks: { 234: stack, 235: stack, 237: stack } }, printed);
    await start($);
    await create($, 'gh stack submit --auto');
    await clock.advance(1000);
    // Read before the layers below them, each waits on the one below.
    expect(await rowsIn(await band($))).toEqual([
      '#237 ≡ #236 3/3 ○ waiting on layer 2/3',
      '#235 ≡ #236 2/3 ○ waiting on layer 1/3',
      '#234 ≡ #236 1/3 ✓ ready to merge',
    ]);
    // A layer turning ready has those above read again at once.
    await clock.advance(3000);
    expect(await rowsIn(await band($))).toEqual([
      '#237 ≡ #236 3/3 ✓ ready to merge',
      '#235 ≡ #236 2/3 ✓ ready to merge',
      '#234 ≡ #236 1/3 ✓ ready to merge',
    ]);
  });

  test('after the bottom layer merges, the next follows its rebase and the top waits on it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const stack = stackJson(236, [234, 235, 237]);
    const merged = JSON.parse(mergedJson('COMPLETED', 'SUCCESS'));
    Object.assign(merged.data.repository.pullRequest, { number: 234, url: pullUrl(234) });
    const gh: Gh = {
      pr: prJson(),
      prs: { 234: plainLayer(234), 235: plainLayer(235), 237: plainLayer(237) },
      stacks: { 234: stack, 235: stack, 237: stack },
    };
    world(on, gh, submitOut([234, 235, 237]));
    await start($);
    await create($, 'gh stack submit --auto');
    await clock.advance(3000);
    // As measured: GitHub retargets the next layer to the trunk, rebases it and
    // runs its checks again, while the top layer's own checks are already green.
    gh.prs = {
      234: JSON.stringify(merged),
      235: plainLayer(235, { baseRefName: 'main', mergeStateStatus: 'UNKNOWN' }, [RUNNING_CI]),
      237: plainLayer(237),
    };
    await clock.advance(61_000);
    const [top, next] = await rowsIn(await band($));
    expect(next).toMatch(/^#235 ≡ #236 2\/3 ● CI/);
    expect(top).toBe('#237 ≡ #236 3/3 ○ waiting on layer 2/3');
    gh.prs = { ...gh.prs, 235: plainLayer(235, { baseRefName: 'main' }) };
    await clock.advance(61_000);
    const rows = await rowsIn(await band($));
    expect(rows.slice(0, 2)).toEqual([
      '#237 ≡ #236 3/3 ✓ ready to merge',
      '#235 ≡ #236 2/3 ✓ ready to merge',
    ]);
    // Once the merged line leaves, the top layer's older stack list still
    // has #234 open, and #235 on the trunk stands for it.
    await clock.advance(5 * 60_000);
    expect(await rowsIn(await band($))).toEqual([
      '#237 ≡ #236 3/3 ✓ ready to merge',
      '#235 ≡ #236 2/3 ✓ ready to merge',
    ]);
  });

  test('a layer read before the stacks API answers waits on the pull request it is based on', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = {
      pr: prJson(),
      prs: {
        234: layerOnBranch(234, { mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]),
        235: layerOnBranch(235, { baseRefName: 'feat/l234' }),
      },
      // A gateway error leaves the stack unknown, not "no stack".
      stackFails: 99,
      stackError: 'gh: HTTP 502: Bad Gateway\n',
      stopBefore: { user: 'release' },
    };
    const seen = world(on, gh, submitOut([234, 235]));
    await start($);
    await create($, 'gh stack submit --auto');
    // Read in the same tick as #234, its first read cannot see it; the next can.
    await clock.advance(7000);
    expect(await rowsIn(await band($))).toContain('#235 ○ waiting on layer below');
    const woken = seen.wakes.length;
    await clock.advance(60_000);
    expect(seen.wakes.slice(woken).filter((w) => w.includes('#235 ready'))).toEqual([]);
    // #234 turns ready, then not: each change has #235 read again at once.
    gh.prs = { ...gh.prs, 234: layerOnBranch(234) };
    await clock.advance(62_000);
    expect(await rowsIn(await band($))).toContain('#235 ✓ ready to merge');
    gh.prs = { ...gh.prs, 234: layerOnBranch(234, { mergeStateStatus: 'BLOCKED' }, [RUNNING_CI]) };
    await clock.advance(62_000);
    expect(await rowsIn(await band($))).toContain('#235 ○ waiting on layer below');
  });

  test('a layer read again with an unchanged line has the layers above left to their own pace', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const stack = stackJson(236, [234, 235]);
    // The lower layer runs CI, read every 10 s; the upper one waits on it.
    const gh: Gh = {
      pr: prJson(),
      prs: {
        234: prJson({ number: 234, url: pullUrl(234) }, [RUNNING_CI]),
        235: prJson({ number: 235, url: pullUrl(235) }),
      },
      stacks: { 234: stack, 235: stack },
    };
    const seen = world(on, gh, submitOut([234, 235]));
    await start($);
    await create($, 'gh stack submit --auto');
    // Past the minute of fast reads a gh stack command starts.
    await clock.advance(70_000);
    const readsOf = (n: number) =>
      seen.runs.filter((r) => r.includes('graphql') && r.includes(` n=${n}`)).length;
    const before = readsOf(235);
    // The lower layer's reads change nothing, so the upper keeps its minute.
    await clock.advance(60_000);
    expect(readsOf(235) - before).toBeLessThanOrEqual(2);
  });

  test('two stacks open beside a lane keep apart, each where its first line was', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const a = stackJson(236, [234, 235]);
    const b = stackJson(240, [238, 239]);
    const stacks = { 234: a, 235: a, 238: b, 239: b };
    // Watched in this order; #300 is in no stack.
    world(on, { pr: prJson(), stacks }, submitOut([234, 300, 238, 235, 239]));
    await start($);
    await create($, 'gh stack submit --auto');
    // Long enough for the upper layers to be read after the ones below.
    await clock.advance(3000);
    expect(await rowsIn(await band($))).toEqual([
      '#235 ≡ #236 2/2 ✓ ready to merge',
      '#234 ≡ #236 1/2 ✓ ready to merge',
      '#300 ✓ ready to merge',
      '#239 ≡ #240 2/2 ✓ ready to merge',
      '#238 ≡ #240 1/2 ✓ ready to merge',
    ]);
  });

  test('a gh stack command asks every watched stack again; another command does not', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    const seen = world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/1 ✓ ready to merge');
    const asks = () => seen.runs.filter((r) => r.includes('/stacks')).length;
    const before = asks();
    await create($, 'git status');
    await clock.advance(120_000);
    expect(asks()).toBe(before);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack push');
    await clock.advance(11_000);
    expect(asks()).toBe(before + 1);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/2 ✓ ready to merge');
  });

  test('a read in flight when a gh stack command runs does not keep the old stack', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/1 ✓ ready to merge');
    gh.holdFirst = true;
    await clock.advance(60_000);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack submit --auto');
    gh.release?.();
    // The held read itself asks again, before any later poll.
    await clock.advance(1);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/2 ✓ ready to merge');
  });

  test('a stacks lookup in flight when a gh stack command runs is asked again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.holdStack = true;
    await create($, 'gh stack push');
    // Time passes on both sides of the command while the lookup is held, so the
    // answer counts as asked before the command only if stamped when asked.
    await clock.advance(16_000);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack sync');
    await clock.advance(5000);
    gh.release?.();
    await clock.advance(120_000);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/2 ✓ ready to merge');
  });

  test('a gh stack command that failed still has every stack asked again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    world(on, gh, `${pullUrl(234)}\n`, (command) => command.startsWith('gh stack'));
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack submit --auto');
    await clock.advance(11_000);
    expect(await firstRow($)).toBe('#234 ≡ #236 1/2 ✓ ready to merge');
  });

  test('a stack known before a gh stack command is asked again once it merged', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: '[]' };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
    gh.stack = stackJson(236, [127, 128]);
    await create($, 'gh stack link 127 128');
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    gh.pr = JSON.stringify(merged);
    // A ready line is read once a minute; gh stack link starts no burst.
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 2\/2 merged into main · /);
  });

  test("a lane stacked elsewhere and then merged names the stack's trunk", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: '[]' };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
    gh.stack = stackJson(236, [127, 128]);
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    gh.pr = JSON.stringify(merged);
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 2\/2 merged into main · /);
  });

  test('a merged layer whose stacks lookup failed at the merge asks again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: '[]' };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.stack = stackJson(236, [127, 128]);
    gh.stackFails = 1;
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    // Merged after the lane's last answer, as a real merge is.
    merged.data.repository.pullRequest.mergedAt = new Date(T0 + 30_000).toISOString();
    gh.pr = JSON.stringify(merged);
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 merged into docs\/lower-layer · /);
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 2\/2 merged into main · /);
  });

  test('a merged layer asks again after a failed lookup whatever the clocks say', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: stackJson(236, [127, 128]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.stack = '[]';
    gh.stackFails = 1;
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'develop';
    // GitHub's clock behind this one: its mergedAt precedes the open read.
    merged.data.repository.pullRequest.mergedAt = new Date(T0 - 60_000).toISOString();
    gh.pr = JSON.stringify(merged);
    await clock.advance(61_000);
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 merged into develop · /);
  });

  test('a merged layer refused the stacks API keeps its stack and asks no more', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: stackJson(236, [127, 128]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.stackFails = 99;
    gh.stackError = 'gh: Not Found (HTTP 404)\n';
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(61_000);
    const asks = seen.runs.filter((r) => r.includes('/stacks')).length;
    await clock.advance(30 * 60_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(asks);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 2\/2 merged into main · /);
  });

  test('an open pull request on a host with no stacks API is asked every 10 minutes, no more', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const stackError = 'gh: Not Found (HTTP 404)\n';
    const seen = world(on, { pr: prJson(), stackFails: 99, stackError });
    await start($);
    await create($);
    await clock.advance(1000);
    await clock.advance(25 * 60_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(3);
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
  });

  test('a layer unstacked and then merged keeps its own base', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: stackJson(236, [127, 128]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    // Layer 1/2 is not watched, so this one waits on it.
    expect(await lineIn(await band($))).toBe('#128 ≡ #236 2/2 ○ waiting on layer 1/2');
    gh.stack = '[]';
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'develop';
    gh.pr = JSON.stringify(merged);
    await create($, 'gh stack unstack');
    await clock.advance(61_000);
    expect(await lineIn(await band($))).toMatch(/^#128 merged into develop · /);
  });

  test('a known stack outlasts a stacks lookup refused after a gh stack command', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stack: stackJson(236, [127, 128]) };
    world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    gh.stackFails = 1;
    gh.stackError = 'gh: Resource not accessible by integration (HTTP 403)\n';
    await create($, 'gh stack sync');
    await clock.advance(11_000);
    expect(await lineIn(await band($))).toBe('#128 ≡ #236 2/2 ○ waiting on layer 1/2');
  });

  test("an open layer's stack is asked again every 10 minutes, for changes made elsewhere", async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: '[]' } };
    world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await firstRow($)).toBe('#234 ✓ ready to merge');
    gh.stacks = { 234: stackJson(236, [233, 234]) };
    await clock.advance(5 * 60_000);
    expect(await firstRow($)).toBe('#234 ✓ ready to merge');
    await clock.advance(10 * 60_000);
    expect(await firstRow($)).toBe('#234 ≡ #236 2/2 ○ waiting on layer 1/2');
  });

  test('a merged layer keeps its trunk through a gh stack command', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const merged = JSON.parse(mergedJson('IN_PROGRESS', null));
    merged.data.repository.pullRequest.baseRefName = 'docs/lower-layer';
    const gh: Gh = { pr: JSON.stringify(merged), stack: stackJson(236, [128]) };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 1\/1 merged into main · /);
    gh.stack = '[]';
    const asks = seen.runs.filter((r) => r.includes('/stacks')).length;
    await create($, 'gh stack merge 236 --yes --squash');
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(asks);
    expect(await lineIn(await band($))).toMatch(/^#128 ≡ #236 1\/1 merged into main · /);
  });

  test('gives the band to a survey', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($, 'terminal', { ...PROPS, hasSurvey: true }))).toBeUndefined();
  });
});

function isPushLine(command: string): boolean {
  return command.startsWith('git push');
}

describe('a push Claude makes', () => {
  test('reads every watch at once, then every 5 s for a minute', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    // A ready PR otherwise waits 60 s for its next read.
    await clock.advance(10_000);
    const before = reads(seen.runs);
    await create($, 'git push');
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(before + 1);
    await clock.advance(30_000);
    expect(reads(seen.runs)).toBe(before + 7);
    // Once the minute is over, a ready PR is back to one read a minute.
    await clock.advance(30_000);
    const after = reads(seen.runs);
    await clock.advance(30_000);
    expect(reads(seen.runs)).toBe(after);
  });

  test('reads at once even right after a read', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    const before = reads(seen.runs);
    await create($, 'git push');
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(before + 1);
  });

  // The exit status is the whole shell line's: `git push; false` pushed.
  test('a push in a line that exited with an error still reads at once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() }, `${URL}\n`, isPushLine);
    await start($);
    await create($);
    await clock.advance(11_000);
    const before = reads(seen.runs);
    await create($, 'git push; false');
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(before + 1);
  });

  test('a read already running at the push is read again once it ends', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), holdFirst: true };
    const seen = world(on, gh);
    await start($);
    await create($);
    // The first read starts at 1 s and is still out when Claude pushes.
    await clock.advance(1000);
    await create($, 'git push');
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(1);
    gh.release?.();
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(2);
  });
});

const OWN_PR = { number: 128, url: URL, repository: { nameWithOwner: 'o/r' } };

describe('a push, then the pull request it heads', () => {
  test('the pull request’s first read takes over the push line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const head = { headRefName: 'feat/x', headRepository: { nameWithOwner: 'o/r' } };
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED', ...head }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ● Release 0m11s');
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await pushLineIn(ui)).toBeUndefined();
    expect(await lineIn(ui)).toMatch(/^#128 ● CI /);
    expect(await tool($, 'watches')).not.toContain('feat/x');
  });

  test('a failure told on the push is not told again once its pull request takes over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE') };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    const tip = JSON.parse(pushJson('COMPLETED', 'FAILURE')).data.repository.ref.target;
    const head = { headRefName: 'feat/x', headRepository: { nameWithOwner: 'o/r' } };
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED', ...head }, tip.checkSuites.nodes);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await pushLineIn(await band($))).toBeUndefined();
    await clock.advance(70_000);
    expect(await lineIn(await band($))).toBe('#128 ✗ Release: Publish failed');
    expect(seen.wakes).toHaveLength(1);
  });

  test('a pull request from another branch leaves the push line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const head = { headRefName: 'feat/y', headRepository: { nameWithOwner: 'o/r' } };
    const gh: Gh = {
      pr: prJson({ mergeStateStatus: 'BLOCKED', ...head }, [RUNNING_CI]),
      push: pushJson('IN_PROGRESS'),
    };
    world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ● Release 0m12s');
    expect(await lineIn(ui)).toMatch(/^#128 ● CI /);
  });
});

describe('a push to a branch with no pull request', () => {
  test('follows the branch’s runs, says once they pass, and leaves 5 s later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS') };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push -u origin feat/x');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ● Release 0m11s');
    gh.push = pushJson('COMPLETED', 'SUCCESS');
    await clock.advance(10_000);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ✓ checks passed');
    expect(seen.toasts).toEqual([]);
    // The first read past the 90 s grace settles it; the push's burst moves
    // that read to 96 s.
    await clock.advance(84_000);
    expect(seen.toasts).toEqual([]);
    await clock.advance(1000);
    expect(seen.toasts).toEqual(['push feat/x: its checks passed']);
    expect(seen.wakes).toEqual([]);
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(seen.contexts.at(-1)?.[0]).toContain('The checks on the push to feat/x on o/r passed.');
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ✓ checks passed');
    await clock.advance(5000);
    expect(await pushLineIn(ui)).toBeUndefined();
  });

  test('a failed run stays, toasted once, until a re-run passes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE') };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(600_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ✗ Release: Publish failed');
    expect(seen.toasts).toEqual(['push feat/x: Release: Publish failed']);
    gh.push = pushJson('COMPLETED', 'SUCCESS');
    await clock.advance(66_000);
    expect(await pushLineIn(ui)).toBeUndefined();
  });

  test('a branch with no runs within 90 s leaves', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson(), push: pushJson(null) }, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ○ waiting on checks');
    await clock.advance(95_000);
    expect(await pushLineIn(ui)).toBeUndefined();
  });

  test('a branch heading an open pull request hands the line to it, once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = { ...OWN_PR, headRepository: { nameWithOwner: 'o/r' } };
    world(on, { pr: prJson(), push: pushJson('IN_PROGRESS', null, [pr]) }, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBeUndefined();
    await clock.advance(1000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
    // Pushing again while the PR is watched adds no second line.
    await create($, 'git push');
    await clock.advance(2000);
    expect(await pushLineIn(ui)).toBeUndefined();
    const rows = await ui.findAll({ key: `row-${ID}` });
    expect(rows.length).toBe(1);
  });

  test('a failure told on the push is not told again by the pull request Claude then opens', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = { ...OWN_PR, headRepository: { nameWithOwner: 'o/r' } };
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE') };
    const seen = world(on, gh, `${PUSH_OUT}\n${URL}\n`);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    const tip = JSON.parse(pushJson('COMPLETED', 'FAILURE')).data.repository.ref.target;
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, tip.checkSuites.nodes);
    gh.push = pushJson('COMPLETED', 'FAILURE', [pr]);
    await create($, 'gh pr create --fill');
    await clock.advance(70_000);
    expect(await lineIn(await band($))).toBe('#128 ✗ Release: Publish failed');
    expect(seen.wakes).toHaveLength(1);
  });

  test('a failure Claude was told of on the push is not told again on its pull request', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = { ...OWN_PR, headRepository: { nameWithOwner: 'o/r' } };
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE') };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('Release: Publish failed for the push to feat/x');
    // The PR's head is the pushed commit, so its runs are the push's.
    const tip = JSON.parse(pushJson('COMPLETED', 'FAILURE')).data.repository.ref.target;
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, tip.checkSuites.nodes);
    gh.push = pushJson('COMPLETED', 'FAILURE', [pr]);
    await clock.advance(70_000);
    const ui = await band($);
    expect(await lineIn(ui)).toBe('#128 ✗ Release: Publish failed');
    expect(seen.wakes).toHaveLength(1);
  });

  test('a fork’s branch hands its line to the pull request upstream', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const pr = { ...OWN_PR, headRepository: { nameWithOwner: 'me/r' } };
    const fork = PUSH_OUT.replace('To github.com:o/r.git', 'To github.com:me/r.git');
    world(on, { pr: prJson(), push: pushJson('IN_PROGRESS', null, [pr], 'me/r', 'o/r') }, fork);
    await start($);
    await create($, 'git push');
    await clock.advance(2000);
    expect(await lineIn(await band($))).toBe('#128 ✓ ready to merge');
  });

  test('a pull request a stranger’s fork opened from the branch is not its own', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    // A fork syncing from this branch: head here, base in the fork.
    const stranger = {
      number: 24,
      url: 'https://github.com/someone/r/pull/24',
      repository: { nameWithOwner: 'someone/r' },
      headRepository: { nameWithOwner: 'o/r' },
    };
    world(on, { pr: prJson(), push: pushJson('IN_PROGRESS', null, [stranger]) }, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x · ● Release 0m11s');
  });

  test('pushing the branch again starts its line over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE') };
    world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(120_000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ✗ Release: Publish failed');
    gh.push = pushJson(null);
    await create($, 'git push');
    await clock.advance(1000);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x · ○ waiting on checks');
  });

  test('a read still running when the branch is pushed again does not overwrite it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('COMPLETED', 'FAILURE'), holdFirst: true };
    const seen = world(on, gh, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    gh.push = pushJson(null);
    await create($, 'git push');
    gh.release?.();
    await clock.advance(2000);
    expect(seen.toasts).toEqual([]);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x · ○ waiting on checks');
  });

  test('says why its read failed, then leaves once the grace is over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const error = JSON.stringify({
      data: { repository: { ref: null } },
      errors: [{ message: 'Could not resolve to a Ref' }],
    });
    world(on, { pr: prJson(), push: error }, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    const ui = await band($);
    expect(await pushLineIn(ui)).toBe('⟳ push feat/x gh failed: Could not resolve to a Ref');
    await clock.advance(90_000);
    expect(await pushLineIn(ui)).toBeUndefined();
  });

  test('a branch that is gone leaves at once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gone = JSON.stringify({ data: { repository: { ref: null } } });
    world(on, { pr: prJson(), push: gone }, PUSH_OUT);
    await start($);
    await create($, 'git push');
    await clock.advance(2000);
    expect(await pushLineIn(await band($))).toBeUndefined();
  });

  test('a gone branch whose removal cannot be saved says pr-watch failed, not gh', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gone = JSON.stringify({ data: { repository: { ref: null } } });
    world(on, { pr: prJson(), push: gone }, PUSH_OUT);
    let isRefusing = true;
    on('state.set', ($: unknown, e: any, next: any) => {
      if (!isRefusing || e.key !== 'watches' || !Array.isArray(e.value) || e.value.length > 0) {
        return next(e);
      }
      isRefusing = false;
      return next({ ...e, value: undefined });
    });
    await start($);
    await create($, 'git push');
    await clock.advance(1500);
    expect(await pushLineIn(await band($))).toMatch(/pr-watch failed: /);
  });

  test('a push that moved a branch is followed though another was rejected', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), push: pushJson('IN_PROGRESS') };
    world(on, gh, PUSH_OUT, (command) => command.startsWith('git push'));
    await start($);
    await create($, 'git push --all');
    await clock.advance(1000);
    expect(await pushLineIn(await band($))).toBe('⟳ push feat/x · ● Release 0m11s');
  });

  test('a push that moved no branch adds no line', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(
      on,
      { pr: prJson(), push: pushJson('IN_PROGRESS') },
      'Everything up-to-date\n',
    );
    await start($);
    await create($, 'git push');
    await clock.advance(1000);
    expect(reads(seen.runs)).toBe(0);
    expect(await pushLineIn(await band($))).toBeUndefined();
  });
});
