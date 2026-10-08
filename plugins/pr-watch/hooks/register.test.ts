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
  // The pushed-branch query's answer.
  push?: string;
  estimate?: string;
  fails?: boolean;
  estimateFails?: number;
  partial?: boolean;
  // Holds the first PR read until the test calls `release`.
  holdFirst?: boolean;
  // pr-watch's prompts are refused: the hook throws, so the kit finds nothing beneath.
  wakeRejects?: boolean;
  release?: () => void;
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
// `fails` names the Bash commands that end in an error.
function world(
  on: any,
  gh: Gh,
  stdout = `${URL}\n`,
  fails: boolean | ((command: string) => boolean) = false,
) {
  // `wakes`: the prompts pr-watch submitted to the session, to tell Claude.
  const seen = { toasts: [] as string[], runs: [] as string[], wakes: [] as string[] };
  on('session.start', () => ({ cwd: '/repo' }));
  // What another plugin, or the engine, draws in the band beneath pr-watch.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, { key: 'beneath' }, 'beneath');
  });
  on('prompt.submit', ($: unknown, e: { text: string; origin?: { kind: string } }) => {
    if (e.origin?.kind === 'plugin') {
      if (gh.wakeRejects) throw new Error('refused');
      seen.wakes.push(e.text);
    }
    return { text: e.text };
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
    const query = argv.includes('refs/heads/') ? (gh.push ?? gh.pr) : gh.pr;
    const out = argv.includes('graphql') ? query : (gh.estimate ?? '{"workflow_runs":[]}');
    const answer = { value: { exitCode: 0, stdout: out, stderr: '' } };
    if (gh.holdFirst && argv.includes('graphql')) {
      gh.holdFirst = false;
      return new Promise((resolve) => {
        gh.release = () => resolve(answer);
      });
    }
    return answer;
  });
  on('tool.call', { tool: 'Bash' }, ($: unknown, e: { command: string }) => {
    const result = { stdout, stderr: '', interrupted: false };
    const isError = typeof fails === 'function' ? fails(e.command) : fails;
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
  return row?.text.replace(/ ×$/, '');
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

  test('gives the band to a survey', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    world(on, { pr: prJson() });
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await lineIn(await band($, 'terminal', { ...PROPS, hasSurvey: true }))).toBeUndefined();
  });
});

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
    expect(seen.wakes[0]).toContain('not a request to merge');
    // GitHub recomputing the merge state is not a new ready.
    gh.pr = prJson({ mergeStateStatus: 'UNKNOWN' });
    await clock.advance(70_000);
    expect(await lineIn(await band($))).toBe('#128 ○ waiting on checking');
    gh.pr = prJson();
    await clock.advance(120_000);
    expect(seen.wakes).toHaveLength(1);
  });

  test('wakes it for each job as it fails, once each, and again on a new run', async ($, on) => {
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
    await clock.advance(20_000);
    expect(seen.wakes).toHaveLength(2);
    expect(seen.wakes[1]).toContain('CI: Lint failed');
    expect(seen.wakes[1]).not.toContain('Typecheck');
    await clock.advance(60_000);
    expect(seen.wakes).toHaveLength(2);
    gh.pr = prJson({ mergeStateStatus: 'BLOCKED' }, [ciSuite(running, [failedJob('Lint', 2, 20)])]);
    await clock.advance(60_000);
    expect(seen.wakes).toHaveLength(3);
    expect(seen.wakes[2]).toContain('runs/2/job/20');
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

  // Who wakes Claude among a person's comment, a bot's comment and a bot's
  // review, by setting.
  const settings = [
    [{}, ['@alice']],
    [{ botComments: 'reviews' }, ['@alice', '@rabbit']],
    [{ botComments: 'comments and reviews' }, ['@alice', '@oakum', '@rabbit']],
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
        gh.pr = commentedJson([person, bot], [review]);
        await clock.advance(20_000);
        const text = seen.wakes.join('\n');
        for (const who of ['@alice', '@oakum', '@rabbit']) {
          expect(text.includes(who)).toBe((woken as readonly string[]).includes(who));
        }
      },
    );
  }

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

function isPushLine(command: string): boolean {
  return command.startsWith('git push');
}

function reads(runs: string[]): number {
  return runs.filter((r) => r.includes('graphql')).length;
}

// Merged at 22:01:00, 10 s before T0, with Release running or done on main.
function mergedJson(status: string, conclusion: string | null): string {
  const release = {
    status,
    conclusion,
    workflowRun: {
      runAttempt: 1,
      createdAt: '2026-10-03T22:01:00Z',
      url: 'https://github.com/o/r/actions/runs/9',
      workflow: { databaseId: 9, name: 'Release' },
    },
    checkRuns: { nodes: [{ name: 'Publish', status, conclusion, detailsUrl: '' }] },
  };
  return prJson({
    state: 'MERGED',
    baseRefName: 'main',
    mergedAt: '2026-10-03T22:01:00Z',
    mergeCommit: { checkSuites: { pageInfo: { hasNextPage: false }, nodes: [release] } },
  });
}

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
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain(
      "o/r#128 merged into main, and the merge commit's checks passed.",
    );
    const settled = reads(seen.runs);
    // A message does not clear it early.
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed');
    await clock.advance(5000);
    expect(await lineIn(ui)).toBeUndefined();
    await clock.advance(120_000);
    expect(reads(seen.runs)).toBe(settled);
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
    expect(await lineIn(ui)).toBe('#128 merged into main · ✓ checks passed · gh failed: HTTP 502');
    const before = reads(seen.runs);
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false } as any);
    expect(await lineIn(ui)).toMatch(/gh failed/);
    await clock.advance(20_000);
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
      '#128 merged into main · ○ waiting on checks · gh failed: HTTP 502',
    );
    gh.fails = false;
    gh.pr = mergedJson('IN_PROGRESS', null);
    await clock.advance(10_000);
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

// What `git push` printed, stderr merged in, as the hook receives it.
const PUSH_OUT = [
  'remote: ',
  "remote: Create a pull request for 'feat/x' on GitHub by visiting:        ",
  'remote:      https://github.com/o/r/pull/new/feat/x        ',
  'remote: ',
  'To github.com:o/r.git',
  ' * [new branch]      feat/x -> feat/x',
  "branch 'feat/x' set up to track 'origin/feat/x'.",
].join('\n');
const PUSH_ID = 'github.com/o/r@feat/x';

// The pushed branch's tip, with Release running or done, or the open pull
// requests it heads; `self` and `parent` name the pushed repository.
function pushJson(
  status: string | null,
  conclusion: string | null = null,
  prs: object[] = [],
  self = 'o/r',
  parent: string | null = null,
): string {
  const release = status && {
    status,
    conclusion,
    workflowRun: {
      runAttempt: 1,
      createdAt: '2026-10-03T22:01:00Z',
      url: 'https://github.com/o/r/actions/runs/9',
      workflow: { databaseId: 9, name: 'Release' },
    },
    checkRuns: { nodes: [{ name: 'Publish', status, conclusion, detailsUrl: '' }] },
  };
  const suites = { pageInfo: { hasNextPage: false }, nodes: release ? [release] : [] };
  return JSON.stringify({
    data: {
      repository: {
        nameWithOwner: self,
        parent: parent && { nameWithOwner: parent },
        ref: {
          target: { checkSuites: suites },
          associatedPullRequests: { nodes: prs },
        },
      },
    },
  });
}

const OWN_PR = { number: 128, url: URL, repository: { nameWithOwner: 'o/r' } };

async function pushLineIn(ui: any): Promise<string | undefined> {
  const row = await ui.find({ key: `row-${PUSH_ID}` });
  return row?.text.replace(/ ×$/, '');
}

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
    expect(seen.wakes).toHaveLength(1);
    expect(seen.wakes[0]).toContain('The checks on the push to feat/x on o/r passed.');
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
