import { expect, test as kitTest, type TestRest } from 'claude-code/testing';

// A CI runner ran these tests about four times slower than a laptop, so a test
// that steps the clock many times outlasts the kit's 5 s there; each gets 15 s.
const TIMEOUT_MS = 15_000;
export const test = (name: string, ...rest: TestRest): void => {
  if (rest.length === 2) kitTest(name, { timeoutMs: TIMEOUT_MS, ...rest[0] }, rest[1]);
  else kitTest(name, { timeoutMs: TIMEOUT_MS }, rest[0]);
};

export const T0 = Date.parse('2026-10-03T22:01:10Z');
export const URL = 'https://github.com/o/r/pull/128';
export const ID = 'github.com/o/r#128';

export const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
};

// How gh answers; tests change it as time passes.
// `partial` answers the PR query with its data and a failing exit, as gh does
// when GraphQL reports an error beside the data.
export type Gh = {
  pr: string;
  // The pushed-branch query's answer.
  push?: string;
  // The estimate query's answer.
  estimate?: string;
  // GitHub's stacks API answer for the pull request; `[]` (no stack) when unset.
  // That many stacks calls fail first, with this stderr when set.
  stack?: string;
  // The stacks API's answer for these pull request numbers, over `stack`.
  stacks?: Record<number, string>;
  stackFails?: number;
  stackError?: string;
  // Awaited before each store write, to hold one open.
  storeHold?: () => Promise<void>;
  // The GraphQL read and gh pr view answers for these numbers, over `pr` and `view`.
  prs?: Record<number, string>;
  views?: Record<number, string>;
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
  // Every gh call fails.
  fails?: boolean;
  // Every GraphQL read is refused for GitHub's rate limit, or only the merged variant.
  limited?: boolean;
  mergedLimited?: boolean;
  // Every GraphQL read fails, while gh pr view still answers.
  readsFail?: boolean;
  // GitHub cannot be reached: every GraphQL read fails as gh does on a dropped connection.
  offline?: boolean;
  // Every pushed-branch read fails with this stderr.
  pushError?: string;
  // That many estimate calls fail first.
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
  onStoreSet?: (key: string) => string | undefined;
  release?: () => void;
};

export function prJson(over: Record<string, unknown> = {}, suites: unknown[] = []): string {
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

export const pullUrl = (n: number) => `https://github.com/o/r/pull/${n}`;

// The stacks API's answer for a layer of stack `number` in o/r.
export function stackJson(number: number, layers: number[]): string {
  const pullRequests = layers.map((n) => ({ number: n, state: 'open', merged_at: null }));
  return JSON.stringify([
    { number, base: { ref: 'main' }, open: true, pull_requests: pullRequests },
  ]);
}

// What gh stack submit prints, as it did for stack #236, opening these o/r pull requests.
export function submitOut(numbers: number[], more: string[] = []): string {
  const created = numbers.map((n) => `✓ Created PR #${n} (${pullUrl(n)}) for feat/l${n}`);
  return ['Checking stack state...', 'Pushing to origin...', ...created, ...more].join('\n');
}

export function ciSuite(summary: Record<string, unknown>, jobs: unknown[] = []) {
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

export const RUNNING_CI = ciSuite({ status: 'IN_PROGRESS', conclusion: null });
export const PASSED_CI = ciSuite({ status: 'COMPLETED', conclusion: 'SUCCESS' });

// A draft whose head commit `oid` ran these suites.
export function draftJson(oid: string, suites: unknown[]): string {
  const checkSuites = { pageInfo: { hasNextPage: false }, nodes: suites };
  return prJson({
    isDraft: true,
    mergeStateStatus: 'DRAFT',
    commits: { nodes: [{ commit: { oid, checkSuites } }] },
  });
}

export const FAILING_CI = ciSuite({ status: 'QUEUED', conclusion: null }, [
  {
    name: 'Typecheck',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    detailsUrl: 'https://github.com/o/r/actions/runs/1/job/9',
    isRequired: false,
  },
]);

// A session where Bash prints `stdout` and gh answers from `gh`.
// `fails` names the Bash commands that end in an error.
export function world(
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
    schemas: {} as Record<string, unknown>,
    contexts: [] as (readonly string[] | undefined)[],
    notified: [] as string[],
    suggested: [] as string[],
  };
  on('session.start', () => ({ cwd: '/repo' }));
  on('classic.SessionStart', () => ({ additionalContext: ['below'] }));
  on('session.id', () => ({ value: gh.session ?? 's1' }));
  const store = (gh.store ??= new Map());
  on('store.get', ($: unknown, e: { key: string }) =>
    gh.storeFails ? { deny: 'store unreadable' } : { value: structuredClone(store.get(e.key)) },
  );
  on('store.set', async ($: unknown, e: { key: string; value: unknown }) => {
    await gh.storeHold?.();
    const refused = gh.onStoreSet?.(e.key);
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
  on('tool.register', ($: unknown, e: { name: string; inputSchema?: unknown }) => {
    if (e.name === gh.registerFails) return { deny: 'registry closed' };
    seen.registered.push(e.name);
    seen.schemas[e.name] = e.inputSchema;
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
      const view = gh.views?.[Number(/^gh pr view (\d+)/.exec(argv)?.[1])] ?? gh.view;
      if (view === undefined) return { value: { exitCode: 1, stdout: '', stderr: 'no PR' } };
      const viewed = { value: { exitCode: 0, stdout: view, stderr: '' } };
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
    if (gh.pushError !== undefined && argv.includes('refs/heads/')) {
      return { value: { exitCode: 1, stdout: '', stderr: gh.pushError } };
    }
    const pr = gh.prs?.[Number(/ n=(\d+)/.exec(argv)?.[1])] ?? gh.pr;
    const query = argv.includes('refs/heads/') ? (gh.push ?? pr) : pr;
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

// The turns the engine takes to reach a held gh call change between Claude Code
// builds (2.1.328 needs more than 50), so the bound is wide, and a call never
// held throws rather than let the test go on unheld.
export async function held(gh: Gh): Promise<() => void> {
  for (let i = 0; i < 10_000 && !gh.release; i += 1) await Promise.resolve();
  if (!gh.release) throw new Error('no gh call was held');
  return gh.release;
}

export async function start($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true });
}

export async function create($: any, command = 'gh pr create --fill') {
  await $.tool.call({ tool: 'Bash', command });
}

export async function band($: any, surface: 'terminal' | 'desktop' = 'terminal', props = PROPS) {
  return $.ui.mount({ plugin: 'pr-watch', surface, component: 'AbovePrompt', props });
}

// The PR's line as drawn, its × left off, and whether what lies beneath
// still shows.
export async function lineIn(ui: any): Promise<string | undefined> {
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined();
  const row = await ui.find({ key: `row-${ID}` });
  return row?.text.replace(/ ×$/, '');
}

// A prompt the person sent.
export const person = (text = 'next', over: Record<string, unknown> = {}) =>
  ({ text, origin: { kind: 'composer' }, wait: false, ...over }) as any;

export function reads(runs: string[]): number {
  return runs.filter((r) => r.includes('graphql')).length;
}

// gh pr view's answer for #128, merged 10 s before T0.
export const VIEW = JSON.stringify({ url: URL, state: 'MERGED', mergedAt: '2026-10-03T22:01:00Z' });

export const OPEN_VIEW = JSON.stringify({ url: URL, state: 'OPEN', mergedAt: null });

export function mergedJson(status: string, conclusion: string | null): string {
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

// What `git push` printed, stderr merged in, as the hook receives it.
export const PUSH_OUT = [
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
export function pushJson(
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

export async function pushLineIn(ui: any): Promise<string | undefined> {
  const row = await ui.find({ key: `row-${PUSH_ID}` });
  return row?.text.replace(/ ×$/, '');
}

export async function tool($: any, name: string, input: object = {}): Promise<string> {
  const r = await $.tool.call({ tool: `mcp__pr-watch__${name}`, ...input });
  return (r as { result: string }).result;
}
