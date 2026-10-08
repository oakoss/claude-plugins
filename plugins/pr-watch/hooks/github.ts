// The gh calls pr-watch makes and what it reads from their output. Pure:
// register.tsx runs the commands.
import type { Activity, Job, Pull, RunStatus, Workflow } from '../types';

// Whether a check is required is asked only of the head commit: the base
// branch's runs after a merge gate nothing.
const suites = (required: string) => `checkSuites(first: 100) {
      pageInfo { hasNextPage }
      nodes {
        status conclusion
        workflowRun { runAttempt createdAt url workflow { databaseId name } }
        checkRuns(first: 100) { nodes { name status conclusion detailsUrl ${required} } }
      }
    }`;

// The latest comments and reviews, and who reads them: someone else's are news.
const PULL_QUERY = `query($o: String!, $r: String!, $n: Int!) {
  viewer { login }
  repository(owner: $o, name: $r) { pullRequest(number: $n) {
    number title url state isDraft mergeStateStatus reviewDecision baseRefName mergedAt
    commits(last: 1) { nodes { commit { ${suites('isRequired(pullRequestNumber: $n)')} } } }
    mergeCommit { ${suites('')} }
    comments(last: 10) { nodes { author { login __typename } createdAt url } }
    reviews(last: 10) { nodes { author { login __typename } submittedAt state url } }
  } }
}`;

const PUSH_QUERY = `query($o: String!, $r: String!, $b: String!) {
  repository(owner: $o, name: $r) { nameWithOwner parent { nameWithOwner } ref(qualifiedName: $b) {
    target { ... on Commit { ${suites('')} } }
    associatedPullRequests(states: OPEN, first: 100) {
      nodes { number url repository { nameWithOwner } headRepository { nameWithOwner } }
    }
  } }
}`;

function onHost(host: string): string[] {
  return host === 'github.com' ? [] : ['--hostname', host];
}

export function pullArgs(host: string, repo: string, number: number): string[] {
  const [owner = '', name = ''] = repo.split('/');
  return [
    'gh',
    'api',
    'graphql',
    ...onHost(host),
    '-f',
    `query=${PULL_QUERY}`,
    '-f',
    `o=${owner}`,
    '-f',
    `r=${name}`,
    '-F',
    `n=${number}`,
  ];
}

// A pull request's URL, state and merge time, as gh resolves a number, URL or
// branch.
export function viewArgs(pull: string, repo: string | null): string[] {
  return [
    'gh',
    'pr',
    'view',
    pull,
    ...(repo === null ? [] : ['--repo', repo]),
    '--json',
    'url,state,mergedAt',
  ];
}

export function pushArgs(host: string, repo: string, branch: string): string[] {
  const [owner = '', name = ''] = repo.split('/');
  return [
    'gh',
    'api',
    'graphql',
    ...onHost(host),
    '-f',
    `query=${PUSH_QUERY}`,
    '-f',
    `o=${owner}`,
    '-f',
    `r=${name}`,
    '-f',
    `b=refs/heads/${branch}`,
  ];
}

// Over three repositories' history, 10 runs predicted the next run as well as
// 20 or better; a median of 20 lagged a CI slowdown by about 10 runs.
const ESTIMATE_RUNS = 10;

export function estimateArgs(host: string, repo: string, workflowId: number): string[] {
  return [
    'gh',
    'api',
    ...onHost(host),
    `repos/${repo}/actions/workflows/${workflowId}/runs?status=success&per_page=${ESTIMATE_RUNS}`,
  ];
}

function statusOf(status: unknown): RunStatus {
  if (status === 'COMPLETED') return 'done';
  if (status === 'IN_PROGRESS') return 'running';
  return 'queued';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function id(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Date.parse alone accepts almost any string, "1" included.
function isTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIME.test(value) && Number.isFinite(Date.parse(value));
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function parse(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('gh printed something other than JSON');
  }
}

function jobOf(j: any): Job | null {
  const name = str(j?.name);
  if (name === null) return null;
  return {
    name,
    status: statusOf(j.status),
    conclusion: str(j.conclusion),
    url: str(j.detailsUrl) ?? '',
    isRequired: j.isRequired === true,
  };
}

function workflowOf(s: any): Workflow | null {
  const run = s?.workflowRun;
  const workflowId = id(run?.workflow?.databaseId);
  const name = str(run?.workflow?.name);
  if (workflowId === null || name === null || !isTime(run.createdAt)) return null;
  const jobs: Job[] = [];
  for (const node of list(s.checkRuns?.nodes)) {
    const j = jobOf(node);
    if (j) jobs.push(j);
  }
  return {
    id: workflowId,
    name,
    status: statusOf(s.status),
    conclusion: str(s.conclusion),
    startedAt: run.createdAt,
    // A re-run keeps the first attempt's creation time, so its clock is unknown.
    isRerun: typeof run.runAttempt === 'number' && run.runAttempt > 1,
    attempt: typeof run.runAttempt === 'number' ? run.runAttempt : 1,
    url: str(run.url) ?? '',
    jobs,
  };
}

export type Checks = Pick<Pull, 'workflows' | 'isGated' | 'isRequiredPending' | 'isTruncated'>;

// A commit's check suites. Those with no workflow run come from GitHub Apps,
// not Actions, and can sit queued forever; they count only as required checks.
function checksOf(suites: any): Checks {
  // A commit keeps a suite for every run of a workflow; the newest stands for it.
  const newest = new Map<number, Workflow>();
  let isGated = false;
  let isRequiredPending = false;
  for (const s of list(suites?.nodes)) {
    const required = list(s?.checkRuns?.nodes).filter((j) => j?.isRequired === true);
    // A required check from a GitHub App gates the merge too.
    if (required.length > 0) isGated = true;
    const w = workflowOf(s);
    if (!w) {
      if (required.some((j) => j.status !== 'COMPLETED')) isRequiredPending = true;
      continue;
    }
    const seen = newest.get(w.id);
    if (!seen || Date.parse(w.startedAt) >= Date.parse(seen.startedAt)) newest.set(w.id, w);
  }
  return {
    workflows: [...newest.values()],
    isGated,
    isRequiredPending,
    isTruncated: suites?.pageInfo?.hasNextPage === true,
  };
}

// Nothing on the base branch is required, so a merge keeps only its runs.
function runsOf({ workflows, isTruncated }: Checks): Pull['mergeRuns'] {
  return { workflows, isTruncated };
}

const isBot = (author: any) => author?.__typename === 'Bot';

const REVIEWED: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes on',
  COMMENTED: 'reviewed',
  DISMISSED: 'reviewed',
};

// Null without the viewer, whose own are not news, or without either list,
// which a reply carrying errors may leave out.
function activityOf(pr: any, viewer: string | null): Activity[] | null {
  if (viewer === null || !Array.isArray(pr.comments?.nodes) || !Array.isArray(pr.reviews?.nodes)) {
    return null;
  }
  const found: Activity[] = [];
  for (const c of list(pr.comments?.nodes)) {
    const author = str(c?.author?.login);
    if (author === null || author === viewer || !isTime(c.createdAt)) continue;
    const url = str(c.url) ?? '';
    const bot = isBot(c.author);
    found.push({ author, at: c.createdAt, url, did: 'commented on', isBot: bot, isReview: false });
  }
  for (const r of list(pr.reviews?.nodes)) {
    const author = str(r?.author?.login);
    const did = REVIEWED[str(r?.state) ?? ''];
    if (author === null || author === viewer || !did || !isTime(r.submittedAt)) continue;
    const url = str(r.url) ?? '';
    found.push({ author, at: r.submittedAt, url, did, isBot: isBot(r.author), isReview: true });
  }
  return found.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// The newest comment or review in the window, the viewer's included: an older
// one can only come into view when a newer one is deleted.
function windowNewest(pr: any): string | null {
  let newest: string | null = null;
  const times = [
    ...list(pr.comments?.nodes).map((c) => c?.createdAt),
    ...list(pr.reviews?.nodes).map((r) => r?.submittedAt),
  ];
  for (const t of times) {
    if (isTime(t) && (newest === null || Date.parse(t) > Date.parse(newest))) newest = t;
  }
  return newest;
}

export function parsePull(stdout: string): Pull {
  const body: any = parse(stdout);
  const pr = body?.data?.repository?.pullRequest;
  if (!pr) {
    const problem = str(body?.errors?.[0]?.message);
    throw new Error(problem ?? 'pull request not found');
  }
  const number = id(pr.number);
  if (number === null) throw new Error('pull request has no number');
  return {
    number,
    title: str(pr.title) ?? '',
    url: str(pr.url) ?? '',
    state: pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN',
    isDraft: pr.isDraft === true,
    merge: str(pr.mergeStateStatus) ?? 'UNKNOWN',
    review: str(pr.reviewDecision),
    base: str(pr.baseRefName) ?? 'base',
    mergedAt: isTime(pr.mergedAt) ? pr.mergedAt : null,
    ...checksOf(pr.commits?.nodes?.[0]?.commit?.checkSuites),
    mergeRuns: pr.mergeCommit ? runsOf(checksOf(pr.mergeCommit.checkSuites)) : null,
    activity: activityOf(pr, str(body?.data?.viewer?.login)),
    activityAt: windowNewest(pr),
  };
}

export type Pushed =
  | { kind: 'runs'; runs: Pull['mergeRuns'] }
  // The PR's own repository: a fork's branch heads a PR upstream.
  | { kind: 'pr'; repo: string; number: number; url: string | null }
  // No such branch: deleted since, or a forced tag read as one.
  | { kind: 'gone' };

// A pushed branch's tip runs, or the open pull request it heads.
export function parsePush(stdout: string): Pushed {
  const body: any = parse(stdout);
  const problem = str(body?.errors?.[0]?.message);
  if (problem) throw new Error(problem);
  const repository = body?.data?.repository;
  if (!repository) throw new Error('repository not found');
  const ref = repository.ref;
  if (!ref) return { kind: 'gone' };
  // Strangers' forks open PRs from a popular branch too; only one from this
  // repository into itself or its parent is this push's.
  const self = str(repository.nameWithOwner)?.toLowerCase();
  const parent = str(repository.parent?.nameWithOwner)?.toLowerCase();
  const open = list(ref.associatedPullRequests?.nodes).find((n) => {
    const base = str(n?.repository?.nameWithOwner)?.toLowerCase();
    const head = str(n?.headRepository?.nameWithOwner)?.toLowerCase();
    return self !== undefined && head === self && (base === self || base === parent);
  });
  const number = id(open?.number);
  const repo = str(open?.repository?.nameWithOwner);
  if (number !== null && repo !== null) return { kind: 'pr', repo, number, url: str(open.url) };
  return { kind: 'runs', runs: runsOf(checksOf(ref.target?.checkSuites)) };
}

// The median length of the recent successful first attempts: one run off a
// release branch or a cached re-run (7 s, measured) does not set it. 0 when the
// workflow has none, null when gh's answer does not say.
export function parseEstimate(stdout: string): number | null {
  let body: any;
  try {
    body = JSON.parse(stdout);
  } catch {
    return null;
  }
  const runs = body?.workflow_runs;
  if (!Array.isArray(runs)) return null;
  const firsts = runs.filter((run) => run && (run.run_attempt ?? 1) === 1);
  if (firsts.length === 0) return 0;
  const lengths = firsts
    .filter((run) => isTime(run.run_started_at) && isTime(run.updated_at))
    .map((run) => Date.parse(run.updated_at) - Date.parse(run.run_started_at))
    .filter((ms) => ms > 0)
    .toSorted((a, b) => a - b);
  if (lengths.length === 0) return null;
  const mid = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 1 ? lengths[mid]! : (lengths[mid - 1]! + lengths[mid]!) / 2;
}
