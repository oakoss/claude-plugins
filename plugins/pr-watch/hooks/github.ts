// The gh calls pr-watch makes and what it reads from their output. Pure:
// register.tsx runs the commands.
import type { Job, Pull, RunStatus, Workflow } from '../types';

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

const PULL_QUERY = `query($o: String!, $r: String!, $n: Int!) {
  repository(owner: $o, name: $r) { pullRequest(number: $n) {
    number title url state isDraft mergeStateStatus reviewDecision baseRefName mergedAt
    commits(last: 1) { nodes { commit { ${suites('isRequired(pullRequestNumber: $n)')} } } }
    mergeCommit { ${suites('')} }
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

export function estimateArgs(host: string, repo: string, workflowId: number): string[] {
  return [
    'gh',
    'api',
    ...onHost(host),
    `repos/${repo}/actions/workflows/${workflowId}/runs?status=success&per_page=1`,
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
  };
}

// The last successful run's length; 0 when the workflow has none, null when
// gh's answer does not say.
export function parseEstimate(stdout: string): number | null {
  let body: any;
  try {
    body = JSON.parse(stdout);
  } catch {
    return null;
  }
  const runs = body?.workflow_runs;
  if (!Array.isArray(runs)) return null;
  const run = runs[0];
  if (!run) return 0;
  if (!isTime(run.run_started_at) || !isTime(run.updated_at)) return null;
  const ms = Date.parse(run.updated_at) - Date.parse(run.run_started_at);
  return ms > 0 ? ms : null;
}
