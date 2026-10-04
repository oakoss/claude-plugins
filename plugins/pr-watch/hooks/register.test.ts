import { describe, expect, mock, test } from 'claude-code/testing';

const T0 = Date.parse('2026-10-03T22:01:10Z');
const URL = 'https://github.com/o/r/pull/128';
const ID = 'github.com/o/r#128';

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
};

// How gh answers: the PR query, the estimate query, every call failing, or
// that many estimate calls failing first. Tests change it as time passes.
// `partial` answers the PR query with its data and a failing exit, as gh does
// when GraphQL reports an error beside the data.
type Gh = {
  pr: string;
  estimate?: string;
  fails?: boolean;
  estimateFails?: number;
  partial?: boolean;
};

function prJson(over: Record<string, unknown> = {}, suites: unknown[] = []): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number: 128,
          title: 't',
          url: URL,
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          reviewDecision: null,
          commits: {
            nodes: [
              { commit: { checkSuites: { pageInfo: { hasNextPage: false }, nodes: suites } } },
            ],
          },
          ...over,
        },
      },
    },
  });
}

function ciSuite(summary: Record<string, unknown>, jobs: unknown[] = []) {
  return {
    status: summary.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
    conclusion: summary.status === 'COMPLETED' ? summary.conclusion : null,
    workflowRun: {
      runAttempt: 1,
      createdAt: '2026-10-03T22:00:00Z',
      url: 'https://github.com/o/r/actions/runs/1',
      workflow: { databaseId: 7, name: 'CI' },
    },
    checkRuns: {
      nodes: [...jobs, { name: 'CI Summary', detailsUrl: '', isRequired: true, ...summary }],
    },
  };
}

const RUNNING_CI = ciSuite({ status: 'QUEUED', conclusion: null });
const FAILING_CI = ciSuite({ status: 'QUEUED', conclusion: null }, [
  {
    name: 'Typecheck',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    detailsUrl: 'https://github.com/o/r/actions/runs/1/job/9',
    isRequired: false,
  },
]);

// CI's last successful run took 2m20s.
const CI_RUN = JSON.stringify({
  workflow_runs: [{ run_started_at: '2026-10-03T21:00:00Z', updated_at: '2026-10-03T21:02:20Z' }],
});

// A session where Bash prints `stdout` and gh answers from `gh`.
function world(on: any, gh: Gh, stdout = `${URL}\n`, isError = false) {
  const seen = { toasts: [] as string[], runs: [] as string[] };
  on('session.start', () => ({ cwd: '/repo' }));
  // What another plugin, or the engine, draws in the band beneath pr-watch.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, { key: 'beneath' }, 'beneath');
  });
  on('ui.toast', ($: unknown, e: { text: string }) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('process.run', ($: unknown, e: { argv: string[] }) => {
    const argv = e.argv.join(' ');
    seen.runs.push(argv);
    const failed = { value: { exitCode: 1, stdout: '', stderr: 'gh: HTTP 502\nretry later' } };
    if (gh.fails) return failed;
    if (gh.partial && argv.includes('graphql')) {
      return { value: { exitCode: 1, stdout: gh.pr, stderr: 'gh: Resource not accessible' } };
    }
    if (!argv.includes('graphql') && (gh.estimateFails ?? 0) > 0) {
      gh.estimateFails = (gh.estimateFails ?? 0) - 1;
      return failed;
    }
    const out = argv.includes('graphql') ? gh.pr : (gh.estimate ?? '{"workflow_runs":[]}');
    return { value: { exitCode: 0, stdout: out, stderr: '' } };
  });
  on('tool.call', { tool: 'Bash' }, () => {
    const result = { stdout, stderr: '', interrupted: false };
    return isError ? { result, isError: true } : { result };
  });
  return seen;
}

async function start($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true });
}

async function create($: any, command = 'gh pr create --fill') {
  await $.tool.call({ tool: 'Bash', command });
}

async function band($: any, surface: 'terminal' | 'desktop' = 'terminal', props = PROPS) {
  return $.ui.mount({ plugin: 'pr-watch', surface, component: 'AbovePrompt', props });
}

// The PR's line as drawn, its × left off, and whether what lies beneath
// still shows.
async function lineIn(ui: any): Promise<string | undefined> {
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined();
  const row = await ui.find({ key: `row-${ID}` });
  return row?.text.replace(/×$/, '');
}

const ESTIMATE_CALL = 'actions/workflows/7/runs';

describe('a pull request Claude opens', () => {
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
    expect(await lineIn(ui)).toBe('#128 gh failed: HTTP 502');
    const tries = seen.runs.length;
    await clock.advance(5000);
    expect(seen.runs.length).toBe(tries);
    gh.fails = false;
    await clock.advance(5000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
    gh.fails = true;
    await clock.advance(60_000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge · gh failed: HTTP 502');
    gh.fails = false;
    await clock.advance(60_000);
    expect(await lineIn(ui)).toBe('#128 ✓ ready to merge');
  });

  test('a read it cannot save still waits out its delay, and says so once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson() });
    // A watches save after the first read is rejected: the store refuses undefined.
    on('state.set', ($: unknown, e: any, next: any) =>
      e.key === 'watches' && Array.isArray(e.value) && e.value.some((w: any) => w.checkedAt > 0)
        ? next({ ...e, value: undefined })
        : next(e),
    );
    await start($);
    await create($);
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes('graphql')).length).toBeLessThanOrEqual(4);
    expect(seen.toasts).toHaveLength(1);
    expect(seen.toasts[0]).toMatch(/^pr-watch could not save #128: /);
  });

  test('leaves the band when it merges', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const seen = world(on, { pr: prJson({ state: 'MERGED' }) });
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

  test('gives the band to a survey', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($, 'terminal', { ...PROPS, hasSurvey: true }))).toBeUndefined();
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
