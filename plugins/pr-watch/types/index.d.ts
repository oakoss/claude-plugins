export type RunStatus = 'queued' | 'running' | 'done';

export type Job = {
  name: string;
  status: RunStatus;
  conclusion: string | null;
  url: string;
  isRequired: boolean;
};

export type Workflow = {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: string | null;
  // The run's creation, which a re-run keeps from its first attempt.
  startedAt: string;
  isRerun: boolean;
  url: string;
  jobs: Job[];
};

// A comment or review on a pull request by someone other than the viewer.
export type Activity = {
  author: string;
  at: string;
  url: string;
  did: string;
  isBot: boolean;
  isReview: boolean;
};

export type Pull = {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  merge: string;
  review: string | null;
  workflows: Workflow[];
  // Some check on the head commit is required, from a workflow or an App.
  isGated: boolean;
  // A required check from a GitHub App has not finished.
  isRequiredPending: boolean;
  // The head commit has more check suites than one read returns.
  isTruncated: boolean;
  // The branch merged into, and once merged, when and the merge commit's runs.
  base: string;
  mergedAt: string | null;
  mergeRuns: { workflows: Workflow[]; isTruncated: boolean } | null;
  // The latest comments and reviews by others, oldest first; null when the
  // reply lacks the viewer or either list.
  activity: Activity[] | null;
  // The newest comment or review in the window, the viewer's included.
  activityAt: string | null;
};

// A pull request the band follows, as the last poll left it. A push Claude
// made to a branch with no open pull request has `push` and number 0, and its
// `pull` reads as a merge into that branch at the push.
export type Watch = {
  host: string;
  repo: string;
  number: number;
  url: string;
  push?: { branch: string; pushedAt: number };
  pull?: Pull;
  error?: string;
  checkedAt: number;
  // What the line last said, so a toast fires once per change.
  shown?: string;
  // The conditions Claude has been told of, so each is told once while it lasts.
  told?: string[];
  // The comments and reviews heard, and the newest time at the first read,
  // which hears without telling: older ones are history.
  heard?: { since: string | null; keys: string[] };
};

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': {
      watches: Watch[];
      // The last successful run's length in ms, by `<host>/<workflow id>`; 0
      // when the workflow has none.
      estimates: Record<string, number>;
      now: number;
    };
  }
}
