import { describe, expect, test } from 'vitest';

import { estimateArgs, parseEstimate, parsePull, pullArgs } from './github';

// Shaped like `gh api graphql` output for oakoss/claude-plugins#128.
function prOutput(suites: unknown[], pr: Record<string, unknown> = {}, more = false): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number: 128,
          title: 'feat: nudge',
          url: 'https://github.com/oakoss/claude-plugins/pull/128',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          reviewDecision: null,
          commits: {
            nodes: [
              { commit: { checkSuites: { pageInfo: { hasNextPage: more }, nodes: suites } } },
            ],
          },
          ...pr,
        },
      },
    },
  });
}

function suite(run: Record<string, unknown> = {}, jobs: unknown[] = []) {
  return {
    status: 'IN_PROGRESS',
    conclusion: null,
    workflowRun: {
      runAttempt: 1,
      createdAt: '2026-10-03T22:38:02Z',
      url: 'https://github.com/oakoss/claude-plugins/actions/runs/37159100895',
      workflow: { databaseId: 336_558_760, name: 'CI' },
      ...run,
    },
    checkRuns: { nodes: jobs },
  };
}

// A GitHub App's suite holding one required check.
function app(status: string) {
  return {
    status,
    conclusion: null,
    workflowRun: null,
    checkRuns: { nodes: [{ name: 'Vercel', status, isRequired: true }] },
  };
}

const TYPECHECK = {
  name: 'Typecheck',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  detailsUrl: 'https://x/job/1',
  startedAt: '2026-10-03T22:38:05Z',
  isRequired: false,
};
const SUMMARY = {
  name: 'CI Summary',
  status: 'QUEUED',
  conclusion: null,
  detailsUrl: 'https://x/job/2',
  startedAt: null,
  isRequired: true,
};

describe('parsePull', () => {
  test('reads the pull request and its workflows', () => {
    const pull = parsePull(prOutput([suite({}, [TYPECHECK, SUMMARY])]));
    expect(pull).toMatchObject({
      number: 128,
      state: 'OPEN',
      merge: 'CLEAN',
      review: null,
      isDraft: false,
      isGated: true,
      isTruncated: false,
    });
    expect(pull.workflows).toEqual([
      {
        id: 336_558_760,
        name: 'CI',
        status: 'running',
        conclusion: null,
        startedAt: '2026-10-03T22:38:02Z',
        isRerun: false,
        url: 'https://github.com/oakoss/claude-plugins/actions/runs/37159100895',
        jobs: [
          {
            name: 'Typecheck',
            status: 'done',
            conclusion: 'SUCCESS',
            url: 'https://x/job/1',
            isRequired: false,
          },
          {
            name: 'CI Summary',
            status: 'queued',
            conclusion: null,
            url: 'https://x/job/2',
            isRequired: true,
          },
        ],
      },
    ]);
  });

  test('reads the review, draft, closed and finished states', () => {
    const done = { ...suite(), status: 'COMPLETED', conclusion: 'FAILURE' };
    const pull = parsePull(
      prOutput([done], { reviewDecision: 'CHANGES_REQUESTED', isDraft: true, state: 'CLOSED' }),
    );
    expect(pull).toMatchObject({ review: 'CHANGES_REQUESTED', isDraft: true, state: 'CLOSED' });
    expect(pull.workflows[0]).toMatchObject({ status: 'done', conclusion: 'FAILURE' });
  });

  test('a missing merge state reads as unknown', () => {
    expect(parsePull(prOutput([], { mergeStateStatus: null })).merge).toBe('UNKNOWN');
  });

  test('marks a re-run, whose creation time is the first attempt’s', () => {
    const rerun = suite({ runAttempt: 2 });
    expect(parsePull(prOutput([rerun])).workflows[0]?.isRerun).toBe(true);
  });

  test('keeps only the newest run of each workflow', () => {
    const cancelled = {
      ...suite({ createdAt: '2026-10-03T22:00:00Z' }),
      status: 'COMPLETED',
      conclusion: 'CANCELLED',
    };
    const later = { ...suite({ createdAt: '2026-10-03T22:05:00Z' }), status: 'COMPLETED' };
    const pull = parsePull(prOutput([cancelled, { ...later, conclusion: 'SUCCESS' }]));
    expect(pull.workflows).toHaveLength(1);
    expect(pull.workflows[0]?.conclusion).toBe('SUCCESS');
    const reversed = parsePull(prOutput([{ ...later, conclusion: 'SUCCESS' }, cancelled]));
    expect(reversed.workflows[0]?.conclusion).toBe('SUCCESS');
  });

  test('says when a required App check has not finished', () => {
    expect(parsePull(prOutput([app('IN_PROGRESS')])).isRequiredPending).toBe(true);
    expect(parsePull(prOutput([app('COMPLETED')])).isRequiredPending).toBe(false);
    const required = { ...SUMMARY, status: 'IN_PROGRESS' };
    expect(parsePull(prOutput([suite({}, [required])])).isRequiredPending).toBe(false);
  });

  test('a required check from a GitHub App gates the pull request', () => {
    const app = {
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      workflowRun: null,
      checkRuns: { nodes: [{ name: 'Cloudflare Pages', isRequired: true }] },
    };
    const pull = parsePull(prOutput([app, suite({}, [TYPECHECK])]));
    expect(pull.isGated).toBe(true);
    expect(pull.workflows.map((w) => w.name)).toEqual(['CI']);
    expect(parsePull(prOutput([suite({}, [TYPECHECK])])).isGated).toBe(false);
  });

  test('says when GitHub has more check suites than it returned', () => {
    expect(parsePull(prOutput([], {}, true)).isTruncated).toBe(true);
  });

  test('leaves out check suites that belong to no workflow, or that it cannot read', () => {
    const app = { status: 'QUEUED', conclusion: null, workflowRun: null, checkRuns: { nodes: [] } };
    const noId = suite({ workflow: { databaseId: 'abc', name: 'Bad' } });
    const noName = suite({ workflow: { databaseId: 9, name: '' } });
    const noTime = suite({ createdAt: 'nope' });
    // Date.parse alone reads "1" as a year.
    const looseTime = suite({ createdAt: '1' });
    const zeroId = suite({ workflow: { databaseId: 0, name: 'Zero' } });
    const badJobs = { ...suite(), checkRuns: { nodes: {} } };
    const jobs = [null, 5, { ...TYPECHECK, name: '' }, SUMMARY];
    const pull = parsePull(
      prOutput([app, noId, noName, noTime, looseTime, zeroId, suite({}, jobs)]),
    );
    expect(pull.workflows.map((w) => w.name)).toEqual(['CI']);
    expect(pull.workflows[0]?.jobs.map((j) => j.name)).toEqual(['CI Summary']);
    expect(parsePull(prOutput([badJobs])).workflows[0]?.jobs).toEqual([]);
  });

  test('keeps the data GitHub sent beside an error', () => {
    const out = JSON.parse(prOutput([]));
    out.errors = [{ message: 'Resource not accessible by integration' }];
    expect(parsePull(JSON.stringify(out)).number).toBe(128);
  });

  test('says what GitHub refused', () => {
    const out = JSON.stringify({ errors: [{ message: 'Could not resolve to a Repository' }] });
    expect(() => parsePull(out)).toThrow('Could not resolve to a Repository');
  });

  test('says when the pull request is missing or unreadable', () => {
    const out = JSON.stringify({ data: { repository: { pullRequest: null } } });
    expect(() => parsePull(out)).toThrow('pull request not found');
    expect(() => parsePull(prOutput([], { number: 'x' }))).toThrow('pull request has no number');
    expect(() => parsePull(prOutput([], { number: 0 }))).toThrow('pull request has no number');
  });

  test('says when gh printed something other than JSON', () => {
    expect(() => parsePull('HTTP 502')).toThrow('gh printed something other than JSON');
  });
});

describe('parseEstimate', () => {
  test('is the last successful run’s length', () => {
    const out = JSON.stringify({
      workflow_runs: [
        { run_started_at: '2026-10-03T22:49:09Z', updated_at: '2026-10-03T22:50:48Z' },
      ],
    });
    expect(parseEstimate(out)).toBe(99_000);
  });

  test('is 0 when the workflow never succeeded', () => {
    expect(parseEstimate(JSON.stringify({ workflow_runs: [] }))).toBe(0);
  });

  test('is unknown when the answer does not say', () => {
    expect(parseEstimate(JSON.stringify({ message: 'Not Found' }))).toBeNull();
    expect(parseEstimate(JSON.stringify({ workflow_runs: [{ run_started_at: null }] }))).toBeNull();
    const loose = { workflow_runs: [{ run_started_at: '1', updated_at: '2' }] };
    expect(parseEstimate(JSON.stringify(loose))).toBeNull();
    expect(parseEstimate('<html>502</html>')).toBeNull();
  });
});

describe('the gh calls', () => {
  test('name the repository and pull request, the number as an integer', () => {
    const args = pullArgs('github.com', 'oakoss/claude-plugins', 128);
    expect(args.slice(0, 3)).toEqual(['gh', 'api', 'graphql']);
    expect(args).toContain('o=oakoss');
    expect(args).toContain('r=claude-plugins');
    expect(args.slice(-2)).toEqual(['-F', 'n=128']);
    expect(args).not.toContain('--hostname');
  });

  test('ask for the head commit’s required checks', () => {
    const query = pullArgs('github.com', 'a/b', 1).find((a) => a.startsWith('query='));
    expect(query).toContain('commits(last: 1)');
    expect(query).toContain('isRequired(pullRequestNumber: $n)');
  });

  test('ask for the base branch, when it merged, and the merge commit’s runs', () => {
    const query = pullArgs('github.com', 'a/b', 1).find((a) => a.startsWith('query=')) ?? '';
    for (const field of ['baseRefName', 'mergedAt', 'mergeCommit { checkSuites']) {
      expect(query).toContain(field);
    }
  });

  test('pass a GitHub Enterprise host', () => {
    expect(pullArgs('ghe.example.com', 'a/b', 1)).toContain('ghe.example.com');
    expect(estimateArgs('ghe.example.com', 'a/b', 9)).toEqual([
      'gh',
      'api',
      '--hostname',
      'ghe.example.com',
      'repos/a/b/actions/workflows/9/runs?status=success&per_page=1',
    ]);
  });
});
