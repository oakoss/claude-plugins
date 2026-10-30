// Builders the vitest specs share.
import type { Job, Pull, RunStatus, Watch, Workflow } from '../types';

export function job(name: string, conclusion: string | null, isRequired = false): Job {
  return {
    name,
    status: conclusion === null ? 'running' : 'done',
    conclusion,
    url: `https://x/${name}`,
    isRequired,
  };
}

export function flow(id: number, name: string, jobs: Job[], status?: RunStatus): Workflow {
  const isDone = jobs.every((j) => j.status === 'done');
  const bad = jobs.find((j) => j.conclusion !== 'SUCCESS' && j.conclusion !== null);
  return {
    id,
    name,
    status: status ?? (isDone ? 'done' : 'running'),
    conclusion: isDone ? (bad?.conclusion ?? 'SUCCESS') : null,
    startedAt: '2026-10-03T22:00:00Z',
    isRerun: false,
    attempt: 1,
    url: `https://x/run/${id}`,
    jobs,
  };
}

export function pull(workflows: Workflow[], over: Partial<Pull> = {}): Pull {
  return {
    number: 128,
    title: 't',
    url: 'https://github.com/o/r/pull/128',
    state: 'OPEN',
    isDraft: false,
    merge: 'CLEAN',
    review: null,
    workflows,
    isGated: workflows.some((w) => w.jobs.some((j) => j.isRequired)),
    isRequiredPending: false,
    isTruncated: false,
    base: 'main',
    mergedAt: null,
    mergeRuns: null,
    activity: [],
    // As parsePull reads it: at least as new as anyone else's activity.
    activityAt: over.activity?.at(-1)?.at ?? null,
    ...over,
  };
}

export function watched(p?: Pull, over: Partial<Watch> = {}): Watch {
  return {
    host: 'github.com',
    repo: 'o/r',
    number: 128,
    url: 'https://github.com/o/r/pull/128',
    pull: p,
    checkedAt: 0,
    ...over,
  };
}
