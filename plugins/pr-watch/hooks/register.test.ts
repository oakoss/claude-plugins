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
  // GitHub's stacks API answer for the pull request; `[]` (no stack) when unset.
  // That many stacks calls fail first, with this stderr when set.
  stack?: string;
  // The stacks API's answer for these pull request numbers, over `stack`.
  stacks?: Record<number, string>;
  stackFails?: number;
  stackError?: string;
  // The trunk history query's answer; a branch that is gone when unset. Only
  // that query is refused for GitHub's rate limit.
  trunk?: string;
  trunkLimited?: boolean;
  // gh pr view's answer; it fails when unset.
  view?: string;
  // The tool whose registration the host refuses.
  registerFails?: string;
  // That many merged-variant reads fail first.
  mergedFails?: number;
  fails?: boolean;
  // Every GraphQL read is refused for GitHub's rate limit, or only the merged variant.
  limited?: boolean;
  mergedLimited?: boolean;
  // Every GraphQL read fails, while gh pr view still answers.
  readsFail?: boolean;
  // GitHub cannot be reached: every GraphQL read fails as gh does on a dropped connection.
  offline?: boolean;
  estimateFails?: number;
  // A re-run attempt's REST answer; the call fails when unset, and with this
  // stderr when it is set.
  attempt?: string;
  attemptError?: string;
  partial?: boolean;
  // Holds the first PR read, every pushed-branch read, or the next gh pr view,
  // until the test calls `release`.
  holdFirst?: boolean;
  // Holds the next stacks call, answering what it would have when asked.
  holdStack?: boolean;
  holdPush?: boolean;
  holdView?: boolean;
  // pr-watch's prompts are refused: the hook throws, so the kit finds nothing beneath.
  wakeRejects?: boolean;
  // review-cycle's stop-before, by settings source; unset, none is.
  stopBefore?: Partial<Record<'policy' | 'user' | 'project' | 'local', string>>;
  // review-cycle is not loaded, or its commit gate is switched off.
  reviewCycle?: 'absent' | 'off';
  settingsFail?: boolean;
  configFails?: boolean;
  // Runs once as review-cycle's /config rows are read, before they answer.
  onConfigList?: () => Promise<void>;
  suggestions?: boolean;
  // A hook beneath pr-watch drops the person's prompts; writes of kept news are refused.
  dropPerson?: boolean;
  throwPerson?: boolean;
  quietFails?: boolean;
  // The session's id and pr-watch's store, kept across sessions; the store's reads fail.
  session?: string;
  store?: Map<string, unknown>;
  storeFails?: boolean;
  // Runs on each store write; a reason it returns refuses the write.
  onStoreSet?: () => string | undefined;
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

const pullUrl = (n: number) => `https://github.com/o/r/pull/${n}`;

// The stacks API's answer for a layer of stack `number` in o/r.
function stackJson(number: number, layers: number[]): string {
  const pullRequests = layers.map((n) => ({ number: n, state: 'open', merged_at: null }));
  return JSON.stringify([
    { number, base: { ref: 'main' }, open: true, pull_requests: pullRequests },
  ]);
}

// What gh stack submit prints, as it did for stack #236, opening these o/r pull requests.
function submitOut(numbers: number[], more: string[] = []): string {
  const created = numbers.map((n) => `✓ Created PR #${n} (${pullUrl(n)}) for feat/l${n}`);
  return ['Checking stack state...', 'Pushing to origin...', ...created, ...more].join('\n');
}

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

// The first line the band draws.
async function firstRow($: any): Promise<string | undefined> {
  const rows = await rowsIn(await band($));
  return rows[0];
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

// CI's run number `n`.
function runOf(n: number, summary: Record<string, unknown>) {
  const suite = ciSuite(summary);
  suite.workflowRun = { ...suite.workflowRun, url: `https://github.com/o/r/actions/runs/${n}` };
  return suite;
}

const RUNNING_CI = ciSuite({ status: 'IN_PROGRESS', conclusion: null });

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
  // `order`: each gh pr view and Bash command, as they ran.
  // `contexts`: what pr-watch attached to each prompt the person sent.
  const seen = {
    toasts: [] as string[],
    runs: [] as string[],
    // Each run's time limit, by the same index.
    timeouts: [] as (number | undefined)[],
    wakes: [] as string[],
    order: [] as string[],
    registered: [] as string[],
    contexts: [] as (readonly string[] | undefined)[],
    notified: [] as string[],
    suggested: [] as string[],
  };
  on('session.start', () => ({ cwd: '/repo' }));
  on('session.id', () => ({ value: gh.session ?? 's1' }));
  const store = (gh.store ??= new Map());
  on('store.get', ($: unknown, e: { key: string }) =>
    gh.storeFails ? { deny: 'store unreadable' } : { value: structuredClone(store.get(e.key)) },
  );
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    const refused = gh.onStoreSet?.();
    if (refused) return { deny: refused };
    store.set(e.key, structuredClone(e.value));
    return { value: undefined };
  });
  on('store.keys', () => ({ value: [...store.keys()] }));
  on('store.delete', ($: unknown, e: { key: string }) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on('settings.read', ($: unknown, e: { source?: string }) => {
    if (gh.settingsFail) return { deny: 'settings unreadable' };
    if (e.source === undefined) {
      return {
        value: gh.suggestions === undefined ? {} : { promptSuggestionEnabled: gh.suggestions },
      };
    }
    // The user's rung comes from review-cycle's /config row, never these files.
    if (e.source === 'policy' || e.source === 'user') return { deny: 'not read' };
    // A ready pull request wakes Claude unless a test asks for the merge to be asked.
    const stopBefore = (gh.stopBefore ?? { user: 'release' })[e.source as 'project'];
    if (stopBefore === undefined) return { value: {} };
    return { value: { pluginConfigs: { 'review-cycle@oakoss': { options: { stopBefore } } } } };
  });
  // review-cycle's rows show the options it loaded with: a managed value over the user's.
  on('config.list', async () => {
    const during = gh.onConfigList;
    gh.onConfigList = undefined;
    await during?.();
    if (gh.configFails) return { deny: 'menu unreadable' };
    if (gh.reviewCycle === 'absent') return { value: [] };
    const { policy, user } = gh.stopBefore ?? { user: 'release' };
    const stopBefore = policy ?? user ?? 'push';
    return {
      value: [
        { key: 'review-cycle.enabled', value: gh.reviewCycle !== 'off' },
        { key: 'review-cycle.stopBefore', value: stopBefore },
      ],
    };
  });
  // The store refuses a value of undefined.
  if (gh.quietFails !== undefined) {
    on('state.set', ($: unknown, e: { key: string }, next: (e: unknown) => unknown) =>
      gh.quietFails && e.key === 'quiet' ? next({ ...e, value: undefined }) : next(e),
    );
  }
  on('ui.notify', ($: unknown, e: { text: string }) => {
    seen.notified.push(e.text);
    return { value: { isSent: true, channel: 'iterm2' } };
  });
  on('prompt.suggest', ($: unknown, e: { text: string }) => {
    seen.suggested.push(e.text);
    return { isShown: true };
  });
  // What another plugin, or the engine, draws in the band beneath pr-watch.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, { key: 'beneath' }, 'beneath');
  });
  on(
    'prompt.submit',
    ($: unknown, e: { text: string; origin?: { kind: string }; context?: readonly string[] }) => {
      if (e.origin?.kind === 'plugin') {
        if (gh.wakeRejects) throw new Error('refused');
        seen.wakes.push(e.text);
      } else {
        seen.contexts.push(e.context);
        if (gh.dropPerson) return { drop: 'blocked' };
        if (gh.throwPerson) throw new Error('beneath');
      }
      return { text: e.text };
    },
  );
  on('ui.toast', ($: unknown, e: { text: string }) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('tool.register', ($: unknown, e: { name: string }) => {
    if (e.name === gh.registerFails) return { deny: 'registry closed' };
    seen.registered.push(e.name);
    return { value: { tool: `mcp__pr-watch__${e.name}` } };
  });
  on('process.run', ($: unknown, e: { argv: string[]; init?: { timeoutMs?: number } }) => {
    const argv = e.argv.join(' ');
    seen.runs.push(argv);
    seen.timeouts.push(e.init?.timeoutMs);
    // A refusal, not a network failure, which pr-watch retries without counting.
    const failed = { value: { exitCode: 1, stdout: '', stderr: 'gh: HTTP 401\nretry later' } };
    if (gh.fails) return failed;
    const isMerged = argv.includes('mergeCommit {');
    if (argv.includes('graphql') && (gh.limited || (gh.mergedLimited && isMerged))) {
      const message = 'API rate limit exceeded for user ID 1.';
      const stdout = JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message }] });
      return { value: { exitCode: 1, stdout, stderr: `gh: ${message}\n` } };
    }
    if (gh.readsFail && argv.includes('graphql')) return failed;
    if (gh.offline && argv.includes('graphql')) {
      const stderr = 'Post "https://api.github.com/graphql": net/http: TLS handshake timeout\n';
      const down = { value: { exitCode: 1, stdout: '', stderr } };
      // A connection that hangs before failing, held until the test releases it.
      if (gh.holdPush && argv.includes('refs/heads/')) {
        gh.holdPush = false;
        return new Promise((resolve) => {
          gh.release = () => resolve(down);
        });
      }
      return down;
    }
    if (argv.startsWith('gh pr view')) {
      seen.order.push(argv);
      if (gh.view === undefined) return { value: { exitCode: 1, stdout: '', stderr: 'no PR' } };
      const viewed = { value: { exitCode: 0, stdout: gh.view, stderr: '' } };
      if (gh.holdView) {
        gh.holdView = false;
        return new Promise((resolve) => {
          gh.release = () => resolve(viewed);
        });
      }
      return viewed;
    }
    if (argv.includes('mergeCommit {') && (gh.mergedFails ?? 0) > 0) {
      gh.mergedFails = (gh.mergedFails ?? 0) - 1;
      return failed;
    }
    if (gh.partial && argv.includes('graphql')) {
      return { value: { exitCode: 1, stdout: gh.pr, stderr: 'gh: Resource not accessible' } };
    }
    if (argv.includes('/stacks')) {
      if (gh.holdStack) {
        gh.holdStack = false;
        const asked = Number(/pull_request=(\d+)/.exec(argv)?.[1]);
        const stdout = gh.stacks?.[asked] ?? gh.stack ?? '[]';
        return new Promise((resolve) => {
          gh.release = () => resolve({ value: { exitCode: 0, stdout, stderr: '' } });
        });
      }
      if ((gh.stackFails ?? 0) > 0) {
        gh.stackFails = (gh.stackFails ?? 0) - 1;
        if (gh.stackError === undefined) return failed;
        return { value: { exitCode: 1, stdout: '', stderr: gh.stackError } };
      }
      const asked = Number(/pull_request=(\d+)/.exec(argv)?.[1]);
      return { value: { exitCode: 0, stdout: gh.stacks?.[asked] ?? gh.stack ?? '[]', stderr: '' } };
    }
    if (argv.includes('history(first')) {
      if (gh.trunkLimited) {
        const message = 'API rate limit exceeded for user ID 1.';
        const stdout = JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message }] });
        return { value: { exitCode: 1, stdout, stderr: `gh: ${message}\n` } };
      }
      const gone = JSON.stringify({ data: { repository: { ref: null } } });
      return { value: { exitCode: 0, stdout: gh.trunk ?? gone, stderr: '' } };
    }
    if (argv.includes('/attempts/')) {
      if (gh.attemptError !== undefined) {
        return { value: { exitCode: 1, stdout: '', stderr: gh.attemptError } };
      }
      if (gh.attempt === undefined) return failed;
      return { value: { exitCode: 0, stdout: gh.attempt, stderr: '' } };
    }
    if (!argv.includes('graphql') && (gh.estimateFails ?? 0) > 0) {
      gh.estimateFails = (gh.estimateFails ?? 0) - 1;
      return failed;
    }
    const query = argv.includes('refs/heads/') ? (gh.push ?? gh.pr) : gh.pr;
    const out = argv.includes('graphql') ? query : (gh.estimate ?? '{"workflow_runs":[]}');
    const answer = { value: { exitCode: 0, stdout: out, stderr: '' } };
    const isHeld = gh.holdPush && argv.includes('refs/heads/');
    if ((gh.holdFirst || isHeld) && argv.includes('graphql')) {
      gh.holdFirst = false;
      return new Promise((resolve) => {
        gh.release = () => resolve(answer);
      });
    }
    return answer;
  });
  on('tool.call', { tool: 'Bash' }, ($: unknown, e: { command: string }) => {
    seen.order.push(e.command);
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
    expect(await rowsIn(await band($))).toEqual([
      '#237 ⧉ #236 3/3 ✓ ready to merge',
      '#235 ⧉ #236 2/3 ✓ ready to merge',
      '#234 ⧉ #236 1/3 ✓ ready to merge',
    ]);
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
    await clock.advance(1000);
    expect(await rowsIn(await band($))).toEqual([
      '#235 ⧉ #236 2/2 ✓ ready to merge',
      '#234 ⧉ #236 1/2 ✓ ready to merge',
      '#300 ✓ ready to merge',
      '#239 ⧉ #240 2/2 ✓ ready to merge',
      '#238 ⧉ #240 1/2 ✓ ready to merge',
    ]);
  });

  test('a gh stack command asks every watched stack again; another command does not', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    const seen = world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/1 ✓ ready to merge');
    const asks = () => seen.runs.filter((r) => r.includes('/stacks')).length;
    const before = asks();
    await create($, 'git status');
    await clock.advance(120_000);
    expect(asks()).toBe(before);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack push');
    await clock.advance(11_000);
    expect(asks()).toBe(before + 1);
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/2 ✓ ready to merge');
  });

  test('a read in flight when a gh stack command runs does not keep the old stack', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), stacks: { 234: stackJson(236, [234]) } };
    world(on, gh, `${pullUrl(234)}\n`);
    await start($);
    await create($, 'gh pr create --fill');
    await clock.advance(1000);
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/1 ✓ ready to merge');
    gh.holdFirst = true;
    await clock.advance(60_000);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack submit --auto');
    gh.release?.();
    // The held read itself asks again, before any later poll.
    await clock.advance(1);
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/2 ✓ ready to merge');
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
    await clock.advance(11_000);
    gh.stacks = { 234: stackJson(236, [234, 235]) };
    await create($, 'gh stack sync');
    gh.release?.();
    await clock.advance(120_000);
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/2 ✓ ready to merge');
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
    expect(await firstRow($)).toBe('#234 ⧉ #236 1/2 ✓ ready to merge');
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
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 2\/2 merged into main · /);
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
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 2\/2 merged into main · /);
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
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 2\/2 merged into main · /);
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
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 2\/2 merged into main · /);
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
    expect(await lineIn(await band($))).toBe('#128 ⧉ #236 2/2 ✓ ready to merge');
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
    expect(await lineIn(await band($))).toBe('#128 ⧉ #236 2/2 ✓ ready to merge');
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
    expect(await firstRow($)).toBe('#234 ⧉ #236 2/2 ✓ ready to merge');
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
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 1\/1 merged into main · /);
    gh.stack = '[]';
    const asks = seen.runs.filter((r) => r.includes('/stacks')).length;
    await create($, 'gh stack merge 236 --yes --squash');
    await clock.advance(30_000);
    expect(seen.runs.filter((r) => r.includes('/stacks'))).toHaveLength(asks);
    expect(await lineIn(await band($))).toMatch(/^#128 ⧉ #236 1\/1 merged into main · /);
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

// A prompt the person sent.
const person = (text = 'next', over: Record<string, unknown> = {}) =>
  ({ text, origin: { kind: 'composer' }, wait: false, ...over }) as any;

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
// gh pr view's answer for #128, merged ten seconds before T0.
const VIEW = JSON.stringify({ url: URL, state: 'MERGED', mergedAt: '2026-10-03T22:01:00Z' });

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

  // Over an hour of 1 s ticks, slower than the default 5 s on CI's runners.
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
    expect(await tool($, 'watch', { pull: '128' })).toMatch(/rate limited until \d\d:\d\d/);
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

const GIVE_UP = 8;

const OPEN_VIEW = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });

async function tool($: any, name: string, input: object = {}): Promise<string> {
  const r = await $.tool.call({ tool: `mcp__pr-watch__${name}`, ...input });
  return (r as { result: string }).result;
}

// pr-watch's store as a session `id` left it, watching `pulls`.
const resumed = (id: string, pulls: unknown[]) =>
  new Map<string, unknown>([[`session:${id}`, { at: T0 - 60_000, pulls }]]);

const pullsIn = (gh: Gh, id: string) =>
  (gh.store!.get(`session:${id}`) as { pulls: { url: string }[] } | undefined)?.pulls;

describe('a resumed session', () => {
  const OPEN = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });
  const saved = (told: string[] = []) => ({
    host: 'github.com',
    repo: 'o/r',
    number: 128,
    url: URL,
    told,
  });
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

describe('the tools', () => {
  test('are registered when the session starts', async ($, on) => {
    const seen = world(on, { pr: prJson() });
    await start($);
    expect(seen.registered).toEqual(['watch', 'unwatch', 'watches']);
    expect(seen.toasts).toEqual([]);
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
    expect(answer).toContain('pr-watch is now watching o/r#128: #128 ✓ ready to merge');
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

  test('watch leaves a read already in flight to tell its own news', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    const gh: Gh = { pr: prJson(), view: OPEN_VIEW, holdFirst: true };
    const seen = world(on, gh);
    await start($);
    await create($);
    await clock.advance(1000);
    expect(await tool($, 'watch', { pull: '128' })).toBe(
      'pr-watch was already watching o/r#128: #128 loading…\npr-watch tells you when that changes, at once or with the next message, so there is no need to poll gh.',
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
    expect(answer).toContain('pr-watch could not finish its first read: ');
    expect(answer).not.toContain('no need to poll');
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
