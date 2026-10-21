import { describe, expect, test } from 'vitest';

import type { Activity, Job, Pull, RunStatus, Watch, Workflow } from '../types';
import {
  barOf,
  changesStacks,
  clockText,
  layerOf,
  orderedOf,
  createdPull,
  delayOf,
  errorLine,
  followTrunk,
  GIVE_UP_AFTER,
  needsTrunk,
  isCleared,
  isQuotaLow,
  isNetworkError,
  isRateLimited,
  offlineDelayOf,
  pauseOf,
  retryDelayOf,
  untilText,
  isSettled,
  lineOf,
  rerunKey,
  takeOverPush,
  type Segment,
  mergedPullOf,
  mergingPull,
  movesPulls,
  pushedBranches,
  pushedPull,
  shownOf,
  submittedPulls,
  toastOf,
  verdictOf,
  QUIET_CAP,
  settingsOf,
  tellsOf,
  toldAfter,
  wakeOf,
  heldWith,
  noticeOf,
  contextOf,
  suggestionOf,
  savedOf,
  savedFrom,
  entryOf,
  prunedOf,
  SESSIONS_KEPT,
  type BotSetting,
  type Memory,
  type WakeSetting,
} from './watch';

const AT = Date.parse('2026-10-03T22:01:10Z');

function verdictAt(p: Pull, estimates: Record<string, number> = {}, host = 'github.com', now = AT) {
  return verdictOf(p, estimates, host, now);
}

function job(name: string, conclusion: string | null, isRequired = false): Job {
  return {
    name,
    status: conclusion === null ? 'running' : 'done',
    conclusion,
    url: `https://x/${name}`,
    isRequired,
  };
}

function flow(id: number, name: string, jobs: Job[], status?: RunStatus): Workflow {
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

function pull(workflows: Workflow[], over: Partial<Pull> = {}): Pull {
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

const ci = (jobs: Job[]) => flow(1, 'CI', jobs);
const codeql = (conclusion: string | null) => flow(2, 'CodeQL', [job('Analyze', conclusion)]);
const green = () => ci([job('CI Summary', 'SUCCESS', true)]);

describe('createdPull', () => {
  test('reads the URL gh pr create prints on its last line', () => {
    const out = 'Creating pull request\nhttps://github.com/oakoss/claude-plugins/pull/128\n';
    expect(createdPull('gh pr create --title x --body-file b.md', out)).toEqual({
      host: 'github.com',
      repo: 'oakoss/claude-plugins',
      number: 128,
      url: 'https://github.com/oakoss/claude-plugins/pull/128',
    });
  });

  test('takes the last URL on a line of its own', () => {
    const out = 'see https://github.com/x/y/pull/1 for context\nhttps://github.com/o/r/pull/42\n';
    expect(createdPull('cd repo && gh pr create', out)?.number).toBe(42);
  });

  test('reads gh pr create after any shell separator, a newline included', () => {
    const url = 'https://github.com/o/r/pull/5';
    for (const command of ['cd r\ngh pr create', 'cat b | gh pr create -F -', '(gh pr create)']) {
      expect(createdPull(command, url)?.number).toBe(5);
    }
  });

  test('keeps the host in lower case, so one PR is one watch', () => {
    expect(createdPull('gh pr create', 'https://GitHub.com/o/r/pull/5')?.host).toBe('github.com');
  });

  test('ignores a PR URL another command printed', () => {
    expect(createdPull('gh pr view 128', 'https://github.com/o/r/pull/128')).toBeNull();
    expect(createdPull('echo gh pr create', 'https://github.com/o/r/pull/128')).toBeNull();
  });

  test('ignores a URL that is not a pull request’s', () => {
    for (const url of [
      'a pull request already exists',
      'https://github.com/../../pull/7',
      'https://github.com/o/r/pull/0',
      'https://./o/r/pull/1',
      'https://-/o/r/pull/1',
      'https://a_b/o/r/pull/1',
      '  https://github.com/o/r/pull/1',
      'https://github.com/o/r/pull/1 and more',
    ]) {
      expect(createdPull('gh pr create', url)).toBeNull();
    }
  });
});

describe('submittedPulls', () => {
  // As gh stack submit printed it for stack #236, verbatim.
  const out = [
    'Checking stack state...',
    'Pushing to origin...',
    '✓ Created PR #234 (https://github.com/oakoss/claude-plugins/pull/234) for docs/review-cycle-stack-merge-setting',
    '✓ Created PR #235 (https://github.com/oakoss/claude-plugins/pull/235) for docs/review-cycle-stack-create-label',
    '✓ Stack created on GitHub with 2 PRs (stack #236)',
    '✓ Pushed and synced 2 branches',
  ].join('\n');

  test('reads every pull request gh stack submit created, in order', () => {
    expect(submittedPulls('gh stack submit --auto --open', out)).toEqual([
      {
        host: 'github.com',
        repo: 'oakoss/claude-plugins',
        number: 234,
        url: 'https://github.com/oakoss/claude-plugins/pull/234',
      },
      {
        host: 'github.com',
        repo: 'oakoss/claude-plugins',
        number: 235,
        url: 'https://github.com/oakoss/claude-plugins/pull/235',
      },
    ]);
    expect(submittedPulls('cd repo && gh stack submit', out)).toHaveLength(2);
  });

  test('a layer it could not create, or another command, adds none', () => {
    expect(submittedPulls('gh stack submit', '⚠ failed to create PR for feat/b\n')).toEqual([]);
    expect(submittedPulls('gh stack push', out)).toEqual([]);
    expect(submittedPulls('echo gh stack submit', out)).toEqual([]);
    expect(
      submittedPulls('gh stack submit', '  Created PR #1 (https://github.com/o/r/pull/1) for a\n'),
    ).toEqual([]);
    expect(
      submittedPulls('gh stack submit', 'Created PR #1 (https://github.com/o/r/pull/0) for a\n'),
    ).toEqual([]);
  });
});

describe('mergingPull', () => {
  test('names the pull request a merge names, and none for a bare merge', () => {
    expect(mergingPull('gh pr merge 144 --squash --delete-branch')).toEqual({
      pull: '144',
      repo: null,
    });
    expect(mergingPull('gh pr merge https://github.com/o/r/pull/7')).toEqual({
      pull: 'https://github.com/o/r/pull/7',
      repo: null,
    });
    expect(mergingPull('gh pr merge --squash --delete-branch')).toBeNull();
    expect(mergingPull('git push && GH_PAGER= gh pr merge feat/a --auto')).toEqual({
      pull: 'feat/a',
      repo: null,
    });
  });

  test('skips option values, the repository among them', () => {
    const cases: [string, string, string | null][] = [
      ['gh pr merge -t "Ship 12" -b \'a b\' -R o/r 9', '9', 'o/r'],
      ['gh pr merge --repo=o/r --subject=x --squash 4', '4', 'o/r'],
      ['gh pr merge --repo=o/r 9', '9', 'o/r'],
      ['gh pr merge --subject "Ship it" 9', '9', null],
      ['gh pr merge --body-file m.txt -A a@b.c 9', '9', null],
      ['gh pr merge --match-head-commit abc123 5', '5', null],
      // Short options group, and a valued one takes the rest of its word.
      ['gh pr merge 5 -Ro/r', '5', 'o/r'],
      ['gh pr merge 5 -R=o/r', '5', 'o/r'],
      ['gh pr merge -dR o/r 5', '5', 'o/r'],
      ['gh pr merge -sb "body" 5', '5', null],
      ['GH_REPO=o/r gh pr merge 12', '12', 'o/r'],
    ];
    for (const [command, pull, repo] of cases) {
      expect(mergingPull(command)).toEqual({ pull, repo });
    }
  });

  test('reads only its own command: quotes, redirections, comments and continued lines', () => {
    expect(mergingPull('gh pr merge 3 && gh pr view 4')?.pull).toBe('3');
    expect(mergingPull('gh pr merge -t "a; b" 3')?.pull).toBe('3');
    expect(mergingPull('gh pr merge --squash && gh pr checks -R x/y 4')).toBeNull();
    expect(mergingPull('gh pr merge --squash\ngh pr view 4')).toBeNull();
    expect(mergingPull('gh pr merge --squash # 4 is the current one')).toBeNull();
    expect(mergingPull('gh pr merge --squash >/tmp/merge.log 2>&1')).toBeNull();
    expect(mergingPull('gh pr merge > log 7')?.pull).toBe('7');
    expect(mergingPull('gh pr merge \\\n  --squash 8')?.pull).toBe('8');
  });

  test('merges nothing for help, turning auto-merge off, or another command', () => {
    for (const command of [
      'gh pr merge --help',
      'gh pr merge 5 -h',
      'gh pr merge 5 --disable-auto',
      'gh pr view 5',
      'echo gh pr merge 5',
      'git merge main',
    ]) {
      expect(mergingPull(command)).toBeNull();
    }
  });

  test('follows no merge run from another directory or host', () => {
    for (const command of [
      'cd ../other && gh pr merge 12',
      'pushd x; gh pr merge 12',
      '(cd x && gh pr merge 12)',
      'GH_HOST=ghe.example.com gh pr merge 12',
    ]) {
      expect(mergingPull(command)).toBeNull();
    }
    expect(mergingPull("GH_REPO='o/r' gh pr merge 12")?.repo).toBe('o/r');
  });

  test('follows a named merge after a checkout: gh resolves it the same way', () => {
    for (const command of [
      'git push && gh pr merge 12',
      'git switch main && gh pr merge 12',
      'git -p checkout other && gh pr merge 12',
      'gh pr checkout 12 && gh pr merge 12',
      'echo cd; gh pr merge 12',
    ]) {
      expect(mergingPull(command)?.pull).toBe('12');
    }
  });
});

describe('mergedPullOf', () => {
  const url = 'https://github.com/o/r/pull/7';
  const at = Date.parse('2026-10-08T16:00:00Z');
  const view = (state: string, mergedAt: string | null) => JSON.stringify({ url, state, mergedAt });

  test('is the pull request when open, or merged after the command started', () => {
    const target = { host: 'github.com', repo: 'o/r', number: 7, url };
    expect(mergedPullOf(view('OPEN', null), at)).toEqual(target);
    // However long the command ran after its merge.
    expect(mergedPullOf(view('MERGED', '2026-10-08T16:25:00Z'), at)).toEqual(target);
    // GitHub's clock up to two minutes behind.
    expect(mergedPullOf(view('MERGED', '2026-10-08T15:58:00Z'), at)).toEqual(target);
  });

  test('is stale when merged before or closed: a mention, not Claude’s merge', () => {
    expect(mergedPullOf(view('MERGED', '2026-10-08T15:57:59Z'), at)).toBe('stale');
    expect(mergedPullOf(view('MERGED', null), at)).toBe('stale');
    expect(mergedPullOf(view('CLOSED', null), at)).toBe('stale');
  });

  test('is null when the answer names no pull request', () => {
    expect(mergedPullOf('not json', at)).toBeNull();
    expect(mergedPullOf(JSON.stringify({ url: 'https://example.com' }), at)).toBeNull();
  });
});

describe('movesPulls', () => {
  test('a push or a merge, after any shell separator', () => {
    for (const command of [
      'git push',
      'git push -u origin feat/x',
      'git -C repo push',
      'cd repo && git push',
      'pnpm test\ngit push',
      'git commit -m x; git push',
      'cat m | git push',
      '(git push)',
      '  git push',
      'GIT_TRACE=1 git push',
      'git -c core.x=y push',
      'git --no-pager push',
      'gh pr merge 129 --squash',
      'gh run rerun 37238665430 --failed',
      'gh workflow run ci.yml --ref feat/x',
      'gh stack submit --auto',
      'gh stack push',
      'gh stack sync',
      'gh stack merge 236 --yes --squash',
    ]) {
      expect(movesPulls(command)).toBe(true);
    }
  });

  test('not a command that only names one', () => {
    for (const command of [
      'git status',
      'echo git push',
      'gh pr view 129',
      'git pushd',
      'gh run view 37238665430',
      'gh workflow list',
      'gh stack view --json',
    ]) {
      expect(movesPulls(command)).toBe(false);
    }
  });
});

// What `git push` printed: its remote line, then one ref line.
const pushOut = (to: string, ref: string) => `remote: \n${to}\n${ref}\n`;
const branch = (host: string, repo: string, name: string) => ({
  host,
  repo,
  url: `https://${host}/${repo}/tree/${name}`,
  branch: name,
});

describe('pushedBranches', () => {
  test('reads the remote and each branch the push moved', () => {
    expect(
      pushedBranches(
        'git push -u origin feat/x',
        pushOut('To github.com:o/r.git', ' * [new branch]      feat/x -> feat/x'),
      ),
    ).toEqual([branch('github.com', 'o/r', 'feat/x')]);
    expect(
      pushedBranches(
        'git push',
        pushOut('To https://github.com/o/r.git', '   1a1f1ba..93cfbf4  main -> main'),
      ),
    ).toEqual([branch('github.com', 'o/r', 'main')]);
    expect(
      pushedBranches(
        'git push --force-with-lease',
        pushOut(
          'To ssh://git@GHE.example.com:22/o/r',
          ' + 1a1f1ba...93cfbf4 feat -> feat (forced update)',
        ),
      ),
    ).toEqual([branch('ghe.example.com', 'o/r', 'feat')]);
  });

  test('a delete, a rejection, a tag or nothing to push moves no branch', () => {
    for (const ref of [
      ' - [deleted]         feat/x',
      ' ! [rejected]        main -> main (fetch first)',
      ' * [new tag]         v1.0.0 -> v1.0.0',
      'Everything up-to-date',
    ]) {
      expect(pushedBranches('git push', pushOut('To github.com:o/r.git', ref))).toEqual([]);
    }
  });

  test('reads --porcelain output, its refs named in full', () => {
    const out = [
      'To github.com:o/r.git',
      '*\trefs/heads/feat:refs/heads/porc\t[new branch]',
      ' \trefs/heads/feat:refs/heads/feat\t6146ffb..1cf72bb',
      '!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)',
      'Done',
    ].join('\n');
    expect(pushedBranches('git push --porcelain', out)).toEqual([
      branch('github.com', 'o/r', 'porc'),
      branch('github.com', 'o/r', 'feat'),
    ]);
  });

  test('a ref outside refs/heads or a remote on no host moves no branch', () => {
    const moved = pushOut('To github.com:o/r.git', ' * [new branch]      feat -> feat');
    const feat = [branch('github.com', 'o/r', 'feat')];
    expect(pushedBranches('git push origin feat 2>&1 | tail -n 20', moved)).toEqual(feat);
    for (const ref of [
      '   72aa440..b87bb85  refs/notes/commits -> refs/notes/commits',
      ' + 72aa440...b87bb85 feat -> refs/pull/1/head (forced update)',
    ]) {
      expect(pushedBranches('git push', pushOut('To github.com:o/r.git', ref))).toEqual([]);
    }
    const local = `${moved}To /srv/backup.git\n * [new branch]      scratch -> scratch\n`;
    expect(pushedBranches('git push', local)).toEqual([branch('github.com', 'o/r', 'feat')]);
  });

  test('only for a git push, and only after its remote', () => {
    const moved = pushOut('To github.com:o/r.git', '   1a1f1ba..93cfbf4  main -> main');
    expect(pushedBranches('git log', moved)).toEqual([]);
    expect(pushedBranches('git push', '   1a1f1ba..93cfbf4  main -> main\n')).toEqual([]);
  });
});

describe('errorLine', () => {
  test('keeps the first line, without gh’s prefix', () => {
    expect(errorLine('gh: Could not resolve to a Repository\n')).toBe(
      'Could not resolve to a Repository',
    );
    expect(errorLine('To get started with GitHub CLI, run: gh auth login\nAlternatively…')).toBe(
      'To get started with GitHub CLI, run: gh auth login',
    );
    expect(errorLine('')).toBe('no message');
  });
});

describe('verdictOf', () => {
  test('a failed job in a workflow holding a required check fails the PR', () => {
    const p = pull([ci([job('Typecheck', 'FAILURE'), job('CI Summary', null, true)])]);
    expect(verdictAt(p, {})).toEqual({
      kind: 'failing',
      workflowId: 1,
      workflow: 'CI',
      job: 'Typecheck',
      url: 'https://x/Typecheck',
    });
  });

  test('names the failed job, not the required summary that failed on it', () => {
    const p = pull([ci([job('CI Summary', 'FAILURE', true), job('Typecheck', 'FAILURE')])]);
    expect(verdictAt(p, {})).toMatchObject({ kind: 'failing', job: 'Typecheck' });
  });

  test('falls back to the run’s URL when the job has none', () => {
    const p = pull([ci([{ ...job('Lint', 'FAILURE'), url: '' }, job('S', null, true)])]);
    expect(verdictAt(p, {})).toMatchObject({ url: 'https://x/run/1' });
  });

  test.each(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])(
    'a job that ended %s fails the PR',
    (conclusion) => {
      const p = pull([ci([job('Build', conclusion), job('CI Summary', null, true)])]);
      expect(verdictAt(p, {}).kind).toBe('failing');
    },
  );

  test('a failure outside the required workflows does not fail the PR', () => {
    expect(verdictAt(pull([green(), codeql('FAILURE')]), {}).kind).toBe('ready');
  });

  test('with no required checks, any failure fails the PR', () => {
    expect(verdictAt(pull([codeql('FAILURE')]), {}).kind).toBe('failing');
  });

  test('a running required workflow is the gate', () => {
    const p = pull([codeql(null), ci([job('CI Summary', null, true)])]);
    const v = verdictAt(p, { 'github.com/2': 999_999 });
    expect(v.kind === 'running' && v.gate.name).toBe('CI');
  });

  test('of several running required workflows, the longest is the gate', () => {
    const lint = flow(3, 'Lint', [job('Lint', null, true)]);
    const p = pull([ci([job('CI Summary', null, true)]), lint]);
    const v = verdictAt(p, { 'github.com/1': 250_000, 'github.com/3': 520_000 });
    expect(v.kind === 'running' && v.gate.name).toBe('Lint');
  });

  test('a required check from a GitHub App leaves every workflow optional', () => {
    expect(verdictAt(pull([codeql(null)], { isGated: true }), {}).kind).toBe('ready');
    expect(verdictAt(pull([codeql('FAILURE')], { isGated: true }), {}).kind).toBe('ready');
  });

  test('a queued workflow counts as running', () => {
    const p = pull([flow(1, 'CI', [job('CI Summary', null, true)], 'queued')]);
    expect(verdictAt(p, {}).kind).toBe('running');
  });

  test('without a required one, the longest running workflow on this host is the gate', () => {
    const p = pull([ci([job('Lint', null)]), codeql(null)]);
    const v = verdictAt(p, { 'github.com/1': 60_000, 'github.com/2': 120_000 });
    expect(v.kind === 'running' && v.gate.name).toBe('CodeQL');
    const elsewhere = verdictAt(p, { 'ghe.example.com/2': 120_000 });
    expect(elsewhere.kind === 'running' && elsewhere.gate.name).toBe('CI');
  });

  test('an optional workflow still running does not hold back a mergeable PR', () => {
    expect(verdictAt(pull([green(), codeql(null)]), {}).kind).toBe('ready');
  });

  test.each([
    [{ merge: 'DIRTY' }, { kind: 'blocked', reason: 'conflicts' }],
    [
      { review: 'CHANGES_REQUESTED', merge: 'BLOCKED' },
      { kind: 'blocked', reason: 'changes requested' },
    ],
    [{ merge: 'BEHIND' }, { kind: 'blocked', reason: 'behind base' }],
    [{ merge: 'BLOCKED' }, { kind: 'blocked', reason: 'blocked' }],
    [
      { merge: 'BLOCKED', review: 'REVIEW_REQUIRED' },
      { kind: 'waiting', reason: 'review' },
    ],
    [{ merge: 'UNKNOWN' }, { kind: 'waiting', reason: 'checking' }],
    [{ isDraft: true }, { kind: 'waiting', reason: 'draft' }],
    [{ merge: 'UNSTABLE' }, { kind: 'ready' }],
    [{ merge: 'HAS_HOOKS' }, { kind: 'ready' }],
    [{ state: 'MERGED' as const }, { kind: 'closed' }],
    [{ state: 'CLOSED' as const }, { kind: 'closed' }],
  ])('settled checks with %o read as %o', (over, verdict) => {
    expect(verdictAt(pull([green()], over), {})).toEqual(verdict);
  });

  test('a blocked PR waits on a required App check that has not finished', () => {
    const p = pull([codeql('SUCCESS')], {
      merge: 'BLOCKED',
      isGated: true,
      isRequiredPending: true,
    });
    expect(verdictAt(p, {})).toEqual({ kind: 'waiting', reason: 'checks' });
    expect(delayOf(verdictAt(p, {}), p, AT)).toBe(10_000);
  });

  test('a blocked PR whose checks have not started waits on them', () => {
    expect(verdictAt(pull([], { merge: 'BLOCKED' }), {})).toEqual({
      kind: 'waiting',
      reason: 'checks to start',
    });
  });
});

describe('delayOf', () => {
  test('polls fast while running or settling, slowly while waiting on a person', () => {
    const p = pull([]);
    expect(delayOf({ kind: 'running', gate: codeql(null) }, p, AT)).toBe(10_000);
    expect(delayOf({ kind: 'waiting', reason: 'checking' }, p, AT)).toBe(10_000);
    expect(delayOf({ kind: 'waiting', reason: 'review' }, p, AT)).toBe(60_000);
    expect(delayOf({ kind: 'waiting', reason: 'draft' }, p, AT)).toBe(60_000);
    expect(delayOf({ kind: 'ready' }, p, AT)).toBe(60_000);
    expect(delayOf({ kind: 'closed' }, p, AT)).toBeNull();
  });

  test('polls fast while any workflow on the line still runs', () => {
    const p = pull([green(), codeql(null)]);
    expect(delayOf({ kind: 'ready' }, p, AT)).toBe(10_000);
    expect(delayOf({ kind: 'ready' }, pull([green()]), AT)).toBe(60_000);
  });

  test('a line the same for half an hour is read every 5 minutes, while waiting on a person', () => {
    const p = pull([]);
    const review = { kind: 'waiting' as const, reason: 'review' };
    expect(delayOf(review, p, AT, AT - 29 * 60_000)).toBe(60_000);
    expect(delayOf(review, p, AT, AT - 30 * 60_000)).toBe(300_000);
    expect(delayOf({ kind: 'running', gate: codeql(null) }, p, AT, 0)).toBe(10_000);
    const failed = {
      kind: 'merged-failing' as const,
      workflowId: 1,
      workflow: 'CI',
      job: 'x',
      url: '',
    };
    expect(delayOf(failed, p, AT, AT - 30 * 60_000)).toBe(300_000);
  });
});

describe('toastOf', () => {
  const lint = { kind: 'failing' as const, workflowId: 1, workflow: 'CI', job: 'Lint', url: '' };
  const build = { ...lint, job: 'Build' };

  test('says when a PR turns ready or a job fails, once each', () => {
    expect(toastOf('#1', { kind: 'ready' }, 'running')).toBe('#1 is ready to merge');
    expect(toastOf('#1', { kind: 'ready' }, 'ready')).toBeNull();
    expect(toastOf('#1', lint, 'running')).toBe('#1 CI: Lint failed');
    expect(toastOf('#1', lint, shownOf(lint))).toBeNull();
    expect(toastOf('#1', { kind: 'blocked', reason: 'conflicts' }, 'running')).toBeNull();
  });

  test('says when a different job fails next', () => {
    expect(toastOf('#1', build, shownOf(lint))).toBe('#1 CI: Build failed');
  });

  test('tells failures apart when names hold a slash', () => {
    const a = { ...lint, workflow: 'a/b', job: 'c' };
    const b = { ...lint, workflow: 'a', job: 'b/c' };
    expect(shownOf(a)).not.toBe(shownOf(b));
  });
});

const minute = (m: number) => `2026-10-03T21:${String(m).padStart(2, '0')}:00Z`;

const said = (author: string, at: string, did = 'commented on', isBot = false) => ({
  author,
  at,
  url: `https://x/${author}`,
  did,
  isBot,
  isReview: did !== 'commented on',
});

describe('isQuotaLow', () => {
  test('is low under a tenth of the quota, and unknown is not low', () => {
    expect(isQuotaLow({ remaining: 499, limit: 5000 })).toBe(true);
    expect(isQuotaLow({ remaining: 500, limit: 5000 })).toBe(false);
    expect(isQuotaLow(new Map<string, never>().get('github.com'))).toBe(false);
  });
});

const body = (errors: unknown[]) => JSON.stringify({ errors });

describe('isRateLimited', () => {
  test('reads a limit from gh’s message or the GraphQL errors', () => {
    expect(isRateLimited('', 'gh: API rate limit exceeded for user ID 1.\n')).toBe(true);
    expect(isRateLimited('', 'gh: You have exceeded a secondary rate limit. (HTTP 403)')).toBe(
      true,
    );
    expect(isRateLimited(body([{ type: 'RATE_LIMITED', message: 'x' }]), 'gh: x')).toBe(true);
    expect(isRateLimited(body([{ message: 'API rate limit already exceeded' }]), '')).toBe(true);
    expect(isRateLimited('', 'gh: HTTP 429: Too Many Requests')).toBe(true);
  });

  test('is not any other failure, or a rate limit named in the data', () => {
    expect(isRateLimited('', 'gh: HTTP 502')).toBe(false);
    expect(isRateLimited(body([{ type: 'NOT_FOUND', message: 'x' }]), 'gh: x')).toBe(false);
    expect(isRateLimited(JSON.stringify({ data: { title: 'rate limit' } }), '')).toBe(false);
    expect(isRateLimited('not json', '')).toBe(false);
    expect(isRateLimited('', 'gh: Rate limiting is not enabled. (HTTP 404)')).toBe(false);
  });
});

describe('isNetworkError', () => {
  test('reads what gh prints when GitHub cannot be reached', () => {
    for (const stderr of [
      'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com',
      'Post "https://api.github.com/graphql": net/http: TLS handshake timeout',
      'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused',
      'Post "https://api.github.com/graphql": read tcp 10.0.0.2:5000->1.2.3.4:443: read: connection reset by peer',
      'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
      'Post "https://api.github.com/graphql": dial tcp 1.2.3.4:443: i/o timeout',
      'Post "https://api.github.com/graphql": EOF',
      'Post "https://api.github.com/graphql": unexpected EOF',
      'gh: Bad Gateway (HTTP 502)',
      'gh: Service Unavailable (HTTP 503)',
      'gh: Gateway Timeout (HTTP 504)',
    ]) {
      expect(isNetworkError(stderr), stderr).toBe(true);
    }
  });

  test('is not a refusal, a missing pull request or a GraphQL error', () => {
    for (const stderr of [
      'gh: Not Found (HTTP 404)',
      'gh: Bad credentials (HTTP 401)',
      'gh: Resource not accessible by integration (HTTP 403)',
      'gh: Server Error (HTTP 500)',
      'gh: Could not resolve to a PullRequest with the number of 999.',
    ]) {
      expect(isNetworkError(stderr), stderr).toBe(false);
    }
  });

  test('tries an unreachable host sooner than a failing read, up to a minute apart', () => {
    expect([1, 2, 3, 4].map((n) => offlineDelayOf(n))).toEqual([15_000, 30_000, 60_000, 60_000]);
  });
});

describe('pauseOf', () => {
  const reset = '2026-10-03T23:00:00Z';

  test('a spent quota waits for its reset', () => {
    const q = { remaining: 0, limit: 5000, resetAt: reset };
    expect(pauseOf(q, undefined, AT)).toEqual({ until: Date.parse(reset), backoff: 60_000 });
  });

  test('any other limit waits a minute, doubling to 15', () => {
    const q = { remaining: 4000, limit: 5000, resetAt: reset };
    const first = pauseOf(q, undefined, AT);
    expect(first).toEqual({ until: AT + 60_000, backoff: 60_000 });
    expect(pauseOf(undefined, first, AT).backoff).toBe(120_000);
    expect(pauseOf(undefined, { until: 0, backoff: 600_000 }, AT).backoff).toBe(900_000);
    expect(pauseOf(undefined, { until: 0, backoff: 900_000 }, AT).backoff).toBe(900_000);
  });

  test('a quota low but not spent waits the backoff, as a secondary limit', () => {
    const q = { remaining: 400, limit: 5000, resetAt: reset };
    expect(pauseOf(q, undefined, AT).until).toBe(AT + 60_000);
  });

  test('a reset already past waits the backoff', () => {
    const q = { remaining: 0, limit: 5000, resetAt: '2026-10-03T22:00:00Z' };
    expect(pauseOf(q, undefined, AT).until).toBe(AT + 60_000);
  });
});

describe('retryDelayOf and untilText', () => {
  test('failed reads wait 10 s, doubling to 5 minutes, some 15 minutes over 8', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => retryDelayOf(n));
    expect(delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    expect(GIVE_UP_AFTER).toBe(8);
  });

  test('names a local time as HH:MM', () => {
    const at = new Date(2026, 9, 3, 7, 5).getTime();
    expect(untilText(at)).toBe('07:05');
  });
});

describe('settingsOf and tellsOf', () => {
  test('read each /config setting, its default when unset or unknown', () => {
    expect(settingsOf({})).toEqual({ wake: 'checks and comments', bots: 'never' });
    expect(settingsOf({ wake: 'checks', botComments: 'reviews' })).toEqual({
      wake: 'checks',
      bots: 'reviews',
    });
    expect(settingsOf({ wake: true, botComments: 'x' })).toEqual({
      wake: 'checks and comments',
      bots: 'never',
    });
  });

  test('tell a person’s activity, and a bot’s by kind as the settings say', () => {
    const person = said('alice', minute(1));
    const botReview = said('coderabbit', minute(2), 'reviewed', true);
    const botComment = said('oakum', minute(3), 'commented on', true);
    const told = (wake: WakeSetting, bots: BotSetting) => {
      const tells = tellsOf(wake, bots);
      return [person, botReview, botComment].filter((a) => tells(a)).map((a) => a.author);
    };
    expect(told('checks and comments', 'never')).toEqual(['alice']);
    expect(told('checks and comments', 'reviews')).toEqual(['alice', 'coderabbit']);
    expect(told('checks and comments', 'comments and reviews')).toEqual([
      'alice',
      'coderabbit',
      'oakum',
    ]);
    expect(told('checks', 'comments and reviews')).toEqual([]);
    expect(told('off', 'comments and reviews')).toEqual([]);
  });
});

describe('toldAfter', () => {
  test('with waking off, keeps what was told and lasts, and adds nothing', () => {
    expect(toldAfter(['a', 'b'], ['a'], true)).toEqual(['a', 'b']);
    expect(toldAfter(['a', 'b'], ['a', 'c'], false)).toEqual(['a']);
    expect(toldAfter(['a'], undefined, false)).toEqual([]);
  });

  test('tells ready again on waking when it ended and came back while waking was off', () => {
    const pr = { repo: 'o/r', number: 128, url: 'u' };
    const ready = pull([green()]);
    const running = pull([ci([job('Test', null)])], { merge: 'BLOCKED' });
    let told = wakeOf(pr, ready, verdictAt(ready), {}).told;
    for (const p of [running, ready])
      told = toldAfter(wakeOf(pr, p, verdictAt(p), { told }).told, told, false);
    expect(wakeOf(pr, ready, verdictAt(ready), { told }).text).toContain('ready to merge');
  });
});

describe('wakeOf', () => {
  const pr = { repo: 'o/r', number: 128, url: 'https://github.com/o/r/pull/128' };
  const push = { ...pr, number: 0, push: { branch: 'feat/x', pushedAt: AT } };
  // What the next read tells, given what the last one left.
  const after = (p: Pull, last: Memory = {}, w: typeof pr = pr) => wakeOf(w, p, verdictAt(p), last);

  test('says a pull request is ready once, as news rather than a request to merge', () => {
    const p = pull([green()]);
    const first = after(p);
    expect(first.text).toContain('GitHub reports o/r#128 ready to merge.');
    expect(first.text).toContain('not a request to merge. https://github.com/o/r/pull/128');
    expect(first.text).not.toContain('checks passed');
    expect(after(p, first).text).toBeNull();
  });

  test('says ready again once it stopped being ready, but not after GitHub recomputes', () => {
    const ready = after(pull([green()]));
    const checking = after(pull([green()], { merge: 'UNKNOWN' }), ready);
    expect(after(pull([green()]), checking).text).toBeNull();
    const running = after(pull([ci([job('Test', null)])], { merge: 'BLOCKED' }), ready);
    expect(after(pull([green()]), running).text).toContain('ready to merge');
  });

  test('says nothing of running checks, a wait on review, or a branch behind its base', () => {
    expect(after(pull([ci([job('Test', null)])])).text).toBeNull();
    expect(after(pull([green()], { merge: 'BLOCKED', review: 'REVIEW_REQUIRED' })).text).toBeNull();
    expect(after(pull([green()], { merge: 'BEHIND' })).text).toBeNull();
  });

  test('says conflicts and requested changes once each, whatever the checks say', () => {
    const p = pull([ci([job('Lint', 'FAILURE'), job('Test', null)])], {
      merge: 'DIRTY',
      review: 'CHANGES_REQUESTED',
    });
    const first = after(p);
    expect(first.text).toContain('o/r#128 has merge conflicts with main.');
    expect(first.text).toContain('A reviewer requested changes on o/r#128.');
    expect(first.text).toContain('CI: Lint failed for o/r#128: https://x/Lint');
    expect(after(p, first).text).toBeNull();
  });

  test('keeps conflicts told while GitHub recomputes the merge state', () => {
    const told = after(pull([green()], { merge: 'DIRTY' })).told;
    const checking = after(pull([green()], { merge: 'UNKNOWN' }), { told });
    expect(after(pull([green()], { merge: 'DIRTY' }), checking).text).toBeNull();
  });

  test('tells each failing run once, in workflows that gate the merge or not', () => {
    const p = pull([
      ci([job('Test', 'FAILURE', true), job('Lint', 'FAILURE'), job('Build', null)]),
      flow(2, 'Docs', [job('Links', 'FAILURE')]),
    ]);
    const first = after(p);
    expect(first.text).toContain(
      'CI: Test, Lint failed for o/r#128: https://x/Test; the run: https://x/run/1',
    );
    expect(first.text).toContain('Docs: Links failed');
    expect(after(p, first).text).toBeNull();
  });

  test('does not tell a later job failing in a run already told, a summary job among them', () => {
    const first = after(pull([ci([job('Lint', 'FAILURE'), job('CI Summary', null, true)])]));
    const summary = pull([ci([job('Lint', 'FAILURE'), job('CI Summary', 'FAILURE', true)])]);
    expect(after(summary, first).text).toBeNull();
  });

  test('tells a re-run attempt of a run failing again', () => {
    const first = after(pull([ci([job('Lint', 'FAILURE')])]));
    const rerun = { ...ci([job('Lint', 'FAILURE')]), attempt: 2 };
    expect(after(pull([rerun]), first).text).toContain('CI: Lint failed');
  });

  test('keeps a pull request’s conditions its own when told is shared across watches', () => {
    const dirty = pull([green()], { merge: 'DIRTY' });
    const other = { ...pr, number: 7 };
    expect(after(dirty, after(dirty, undefined, other)).text).toContain(
      'o/r#128 has merge conflicts',
    );
  });

  test('tells the same job failing on a new run', () => {
    const first = after(pull([ci([job('Lint', 'FAILURE')])]));
    const again = {
      ...ci([{ ...job('Lint', 'FAILURE'), url: 'https://x/run/2/Lint' }]),
      url: 'https://x/run/2',
    };
    expect(after(pull([again]), first).text).toContain('https://x/run/2/Lint');
  });

  test('tells a failure on the merge commit apart from the same job on the pull request', () => {
    const first = after(pull([ci([job('Lint', 'FAILURE')])]));
    const onMerge = { ...flow(1, 'CI', [job('Lint', 'FAILURE')]), url: 'https://x/run/9' };
    const told = after(merged([onMerge]), first);
    expect(told.text).toContain('CI: Lint failed on the merge commit for o/r#128');
    expect(after(merged([codeql('FAILURE')]), first, push).text).toContain(
      'CodeQL: Analyze failed for the push to feat/x on o/r',
    );
  });

  test('says a merge’s and a push’s checks passed, unless the grace has not ended', () => {
    const passed = merged([green()]);
    const first = after(passed);
    expect(first.text).toContain("o/r#128 merged into main, and the merge commit's checks passed.");
    expect(first.passed).toEqual([
      "o/r#128 merged into main, and the merge commit's checks passed.",
    ]);
    expect(first.news).toEqual([]);
    expect(after(passed, first).text).toBeNull();
    expect(after(passed, {}, push).text).toContain(
      'The checks on the push to feat/x on o/r passed.',
    );
    const early = wakeOf(pr, passed, verdictAt(passed), { told: ['k'] }, { isEarly: true });
    expect(early).toEqual({
      text: null,
      news: [],
      ready: null,
      passed: [],
      told: [],
      heard: { since: null, keys: [] },
    });
  });

  test('a merge Claude made tells a failure but not passed checks', () => {
    const own = { isOwnMerge: true };
    const passed = merged([green()]);
    const quiet = wakeOf(pr, passed, verdictAt(passed), {}, own);
    expect(quiet.text).toBeNull();
    expect(quiet.told).toHaveLength(1);
    const failed = merged([codeql('FAILURE')]);
    expect(wakeOf(pr, failed, verdictAt(failed), {}, own).text).toContain('CodeQL: Analyze failed');
  });

  test('keeps the ready line apart, leads with it, and holds each line once', () => {
    const ready = pull([ci([job('Test', 'SUCCESS')])]);
    const woke = wakeOf(pr, ready, verdictAt(ready), {});
    expect(woke.ready).toBe('GitHub reports o/r#128 ready to merge.');
    expect(woke.news).toEqual([]);
    expect(noticeOf(['@alice commented'], woke.ready, pr.url)).toMatch(
      /^pr-watch: GitHub reports o\/r#128 ready to merge\. @alice commented\n/,
    );
    const held = { id: 'x', label: '#128', url: pr.url, news: ['@alice commented'], ready: null };
    const again = heldWith(held, { ...held, news: ['@alice commented', '@bob commented'] });
    expect(again.news).toEqual(['@alice commented', '@bob commented']);
    expect(heldWith({ ...held, ready: woke.ready }, held).ready).toBe(woke.ready);
  });

  test('tells each push its own passed checks', () => {
    const passed = merged([green()]);
    const a = { ...pr, number: 0, push: { branch: 'feat/a', pushedAt: AT } };
    const b = { ...pr, number: 0, push: { branch: 'feat/b', pushedAt: AT } };
    const first = after(passed, {}, a);
    expect(after(passed, first, b).text).toContain(
      'The checks on the push to feat/b on o/r passed.',
    );
  });

  test('says ready again after checks that ran while GitHub recomputed the merge state', () => {
    const ready = after(pull([green()]));
    const running = after(pull([ci([job('Test', null)])], { merge: 'UNKNOWN' }), ready);
    expect(after(pull([green()]), running).text).toContain('ready to merge');
  });

  test('hears the comments and reviews already there on the first read without telling them', () => {
    const p = pull([ci([job('Test', null)])], {
      activity: [said('alice', '2026-10-03T21:00:00Z'), said('bob', '2026-10-03T21:30:00Z')],
    });
    const first = after(p);
    expect(first.text).toBeNull();
    expect(first.heard).toEqual({
      since: '2026-10-03T21:30:00Z',
      keys: ['https://x/alice', 'https://x/bob'],
    });
    expect(after(pull([ci([job('Test', null)])])).heard).toEqual({ since: null, keys: [] });
  });

  test('tells each comment and review it has not heard, though two share a second', () => {
    const old = said('alice', '2026-10-03T21:00:00Z');
    const p = pull([ci([job('Test', null)])], {
      activity: [
        old,
        said('bob', '2026-10-03T21:00:00Z', 'approved'),
        said('carol', '2026-10-03T21:40:00Z', 'requested changes on'),
      ],
    });
    const woke = after(p, { heard: { since: old.at, keys: [old.url] } });
    expect(woke.text).toContain('@bob approved o/r#128: https://x/bob');
    expect(woke.text).toContain('@carol requested changes on o/r#128: https://x/carol');
    expect(woke.text).not.toContain('@alice');
    expect(after(p, woke).text).toBeNull();
  });

  test('tells no comment that slides back into the window once a newer one is deleted', () => {
    const window = Array.from({ length: 10 }, (_, i) => said(`u${i + 1}`, minute(i + 1)));
    const first = after(pull([], { activity: window }));
    const newest = said('u11', minute(11));
    const later = after(pull([], { activity: [...window.slice(1), newest] }), first);
    expect(later.text).toContain('@u11');
    const older = said('u0', minute(0));
    const deleted = [older, ...window.slice(0, 9)];
    expect(after(pull([], { activity: deleted }), later).text).toBeNull();
    expect(after(pull([], { activity: window }), later).text).toBeNull();
  });

  test('tells a bot’s comment only when bots are asked for, and hears it either way', () => {
    const first = after(pull([]));
    const p = pull([], { activity: [said('oakum[bot]', minute(1), 'commented on', true)] });
    const quiet = wakeOf(pr, p, verdictAt(p), first);
    expect(quiet.text).toBeNull();
    expect(quiet.heard?.keys).toEqual(['https://x/oakum[bot]']);
    const tells = tellsOf('checks and comments', 'comments and reviews');
    expect(wakeOf(pr, p, verdictAt(p), first, { tells }).text).toContain(
      '@oakum[bot] commented on o/r#128',
    );
  });

  test('stops comment-only wakes after QUIET_CAP in a row, saying so on the last', () => {
    let last: Memory = after(pull([]));
    const items: Activity[] = [];
    const texts: (string | null)[] = [];
    for (let i = 1; i <= QUIET_CAP + 2; i++) {
      items.push(said(`u${i}`, minute(i)));
      const woke = after(pull([], { activity: [...items] }), last);
      texts.push(woke.text);
      // Reads with nothing new, and one that cannot tell whose comments are
      // whose, hold the count.
      const quiet = after(pull([], { activity: [...items] }), woke);
      expect(quiet.text).toBeNull();
      const unknown = after(pull([], { activity: null }), quiet);
      expect(unknown.text).toBeNull();
      last = unknown;
    }
    expect(texts.slice(0, QUIET_CAP).every((t) => t !== null)).toBe(true);
    expect(texts[QUIET_CAP - 2]).not.toContain('no more comments');
    expect(texts[QUIET_CAP - 1]).toContain(`https://x/u${QUIET_CAP}`);
    expect(texts[QUIET_CAP - 1]).toContain(
      'pr-watch will tell you of no more comments or reviews on o/r#128',
    );
    expect(texts.slice(QUIET_CAP)).toEqual([null, null]);
    // Other news after the cap tells no comment held back by it.
    const failing = pull([ci([job('Lint', 'FAILURE')])], { activity: [...items] });
    const reset = after(failing, last);
    expect(reset.text).toContain('CI: Lint failed');
    expect(reset.text).not.toContain(`u${QUIET_CAP + 1}`);
  });

  test('other news resets the cap and carries the comments that came with it', () => {
    let last: Memory = { heard: { since: null, keys: [], streak: QUIET_CAP + 3 } };
    const comment = said('alice', minute(1));
    const failing = pull([ci([job('Lint', 'FAILURE')])], { activity: [comment] });
    const woke = after(failing, last);
    expect(woke.text).toContain('CI: Lint failed');
    expect(woke.text).toContain('@alice commented on');
    expect(woke.heard?.streak).toBeUndefined();
    last = woke;
    const next = pull([ci([job('Lint', 'FAILURE')])], {
      activity: [comment, said('bob', minute(2))],
    });
    expect(after(next, last).heard?.streak).toBe(1);
  });

  test('a pull request turning ready resets the cap too', () => {
    const last: Memory = { heard: { since: null, keys: [], streak: QUIET_CAP + 3 } };
    const ready = pull([ci([job('Test', 'SUCCESS')])], { activity: [said('alice', minute(1))] });
    const woke = after(ready, last);
    expect(woke.ready).not.toBeNull();
    expect(woke.text).toContain('@alice commented on');
    expect(woke.heard?.streak).toBeUndefined();
  });

  test('takes the floor from the viewer’s own newer comments too', () => {
    const alice = said('alice', minute(1));
    const first = after(pull([], { activity: [alice], activityAt: minute(19) }));
    expect(first.heard?.since).toBe(minute(19));
    const older = said('bob', minute(0));
    expect(
      after(pull([], { activity: [older, alice], activityAt: minute(18) }), first).text,
    ).toBeNull();
  });

  test('hears nothing from a read that cannot tell whose comments are whose', () => {
    const p = pull([ci([job('Test', null)])], { activity: null });
    expect(after(p)).toEqual({
      text: null,
      news: [],
      ready: null,
      passed: [],
      told: [],
      heard: undefined,
    });
    const heard = { since: null, keys: ['https://x/alice'] };
    expect(after(p, { heard }).heard).toEqual(heard);
    const known = pull([ci([job('Test', null)])], {
      activity: [said('alice', '2026-10-01T00:00:00Z')],
    });
    expect(after(known, after(p)).text).toBeNull();
  });

  test('tells a comment on a pull request that had none when first read', () => {
    const first = after(pull([ci([job('Test', null)])]));
    const p = pull([ci([job('Test', null)])], {
      activity: [said('alice', '2026-10-03T21:00:00Z')],
    });
    expect(after(p, first).text).toContain('@alice commented on o/r#128');
  });
});

const held = (id: string, ready: string | null, news: string[] = []) => ({
  id,
  label: `#${id}`,
  url: `u/${id}`,
  news,
  ready,
});

const watchId = (w: Watch) => `${w.repo}#${w.number}`;

describe('savedOf, savedFrom, entryOf and prunedOf', () => {
  const watched: Watch = {
    host: 'github.com',
    repo: 'o/r',
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    checkedAt: 1,
    told: [
      JSON.stringify(['o/r', 7, 'ready']),
      JSON.stringify(['o/r', 7, 'passed']),
      JSON.stringify(['o/r', 7, 'conflicts']),
      'run',
    ],
    heard: { since: null, keys: ['c/1'] },
  };

  const none = { ready: new Set<string>(), passed: new Set<string>() };
  const id = watchId;
  const CONFLICTS = JSON.stringify(['o/r', 7, 'conflicts']);

  test('keeps a pull request, not a push, and what Claude was told', () => {
    const push: Watch = { ...watched, number: 0, push: { branch: 'x', pushedAt: 1 } };
    expect(savedOf([watched, push], none, id)).toEqual([
      {
        host: 'github.com',
        repo: 'o/r',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        told: watched.told,
        heard: { since: null, keys: ['c/1'] },
      },
    ]);
  });

  test('counts a ready or passed line still waiting to be delivered as untold', () => {
    const ready = { ready: new Set(['o/r#7']), passed: new Set<string>() };
    const passed = { ready: new Set<string>(), passed: new Set(['o/r#7']) };
    expect(savedOf([watched], ready, id)[0]?.told).toEqual([
      JSON.stringify(['o/r', 7, 'passed']),
      CONFLICTS,
      'run',
    ]);
    expect(savedOf([watched], passed, id)[0]?.told).toEqual([
      JSON.stringify(['o/r', 7, 'ready']),
      CONFLICTS,
      'run',
    ]);
  });

  test('rebuilds a saved pull request from the store, field by field', () => {
    const good = savedOf([watched], none, id)[0];
    expect(savedFrom(good)).toEqual(good);
    expect(savedFrom({ ...good, url: 'https://evil/x/pull/1', extra: 1 })).toEqual(good);
    expect(savedFrom({ ...good, told: 5, heard: { keys: 'abc', since: null } })).toEqual({
      ...good,
      told: [],
      heard: undefined,
    });
    expect(
      savedFrom({ ...good, told: ['a', 3], heard: { since: 's', keys: [1, 'k'], streak: 2 } }),
    ).toEqual({ ...good, told: ['a'], heard: { since: 's', keys: ['k'], streak: 2 } });
    for (const bad of [
      { ...good, host: 1 },
      { ...good, repo: undefined },
      { ...good, number: 'x' },
      { ...good, number: -1 },
      { ...good, number: 1.5 },
      null,
    ]) {
      expect(savedFrom(bad)).toBeNull();
    }
  });

  test('reads an entry, counting what it could not', () => {
    const good = savedOf([watched], none, id)[0];
    expect(entryOf({ at: 1, pulls: [good, { host: 'h' }, null] })).toEqual({
      pulls: [good],
      skipped: 2,
    });
    // What the store answers for a key never set.
    const unset = new Map<string, unknown>().get('session:x');
    expect(entryOf(unset)).toEqual({ pulls: [], skipped: 0 });
    expect(entryOf({ at: 1 })).toEqual({ pulls: [], skipped: 1 });
  });

  test('prunes the oldest sessions past the newest kept, unreadable ones first', () => {
    const entries = Array.from(
      { length: SESSIONS_KEPT + 2 },
      (_, i) => [`session:s${i}`, { at: i }] as const,
    );
    expect(prunedOf([...entries, ['session:bad', null]])).toEqual([
      'session:s1',
      'session:s0',
      'session:bad',
    ]);
    expect(prunedOf(entries.slice(0, SESSIONS_KEPT))).toEqual([]);
  });
});

describe('contextOf and suggestionOf', () => {
  test('carries every line, ready first, and says merging needs asking only for a ready one', () => {
    const passed = held('1', null, ['o/r#1 merged into main, and the checks passed.']);
    expect(contextOf([passed])).toBe(
      'pr-watch, since your last turn: o/r#1 merged into main, and the checks passed.',
    );
    expect(contextOf([passed, held('2', 'GitHub reports o/r#2 ready to merge.', ['x.'])])).toBe(
      [
        'pr-watch, since your last turn: o/r#1 merged into main, and the checks passed. GitHub reports o/r#2 ready to merge. x.',
        'Merging needs the user to ask for it; offer it if it fits.',
      ].join('\n'),
    );
    expect(contextOf([])).toBeNull();
    expect(contextOf([held('3', null)])).toBeNull();
  });

  test('suggests merging the latest ready pull request', () => {
    expect(suggestionOf([held('1', 'r1'), held('2', null, ['n']), held('3', 'r3')])).toBe(
      'merge #3',
    );
    expect(suggestionOf([held('2', null, ['n'])])).toBeNull();
  });
});

describe('barOf', () => {
  test('fills in eighths of a cell and keeps its width', () => {
    expect(barOf(0.5, 4)).toEqual({ filled: '██', rest: '░░' });
    expect(barOf(0.5625, 4)).toEqual({ filled: '██▎', rest: '░' });
    expect(barOf(0.06, 1)).toEqual({ filled: '', rest: '░' });
    expect(barOf(0.07, 1)).toEqual({ filled: '▏', rest: '' });
    expect(barOf(0, 3)).toEqual({ filled: '', rest: '░░░' });
    expect(barOf(1, 3)).toEqual({ filled: '███', rest: '' });
    for (const f of [0.01, 0.33, 0.77, 0.99]) {
      const b = barOf(f, 10);
      // Every glyph is one UTF-16 unit, so length counts cells.
      expect(b.filled.length + b.rest.length).toBe(10);
    }
  });

  test('clamps a fraction outside 0 to 1', () => {
    expect(barOf(-0.1, 4)).toEqual({ filled: '', rest: '░░░░' });
    expect(barOf(1.5, 4)).toEqual({ filled: '████', rest: '' });
  });
});

describe('clockText', () => {
  test('reads as minutes and seconds, never below zero', () => {
    expect(clockText(19_000)).toBe('0m19s');
    expect(clockText(204_000)).toBe('3m24s');
    expect(clockText(1500)).toBe('0m02s');
    expect(clockText(-5000)).toBe('0m00s');
  });
});

const at = Date.parse('2026-10-03T22:01:10Z');

function watched(p?: Pull, over: Partial<Watch> = {}): Watch {
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

function textOf(w: Watch, estimates = {}, columns = 80): string {
  return lineOf(w, at, estimates, columns)
    .map((s) => s.text)
    .join('');
}

const runningCi = () => ci([job('CI Summary', null, true)]);
// The line of a pull request whose CI holds these jobs.
const left = (...jobs: Job[]) => textOf(watched(pull([ci(jobs)])));
const queued = (name: string): Job => ({ ...job(name, null), status: 'queued' });
const KNOWN = { 'github.com/1': 140_000 };

// How many cells the running bar takes in a band `columns` wide.
function cells(columns: number): number {
  return barCells(lineOf(watched(pull([runningCi()])), at, KNOWN, columns));
}

const draftWith = (workflows: Workflow[], over: Partial<Pull> = {}) =>
  watched(pull(workflows, { isDraft: true, ...over }));
const draft = (workflows: Workflow[]) => draftWith(workflows);

// The two segments after a line's label.
const leadOf = (p: Pull) => lineOf(watched(p), at, KNOWN, 80).slice(1, 3);

// The bar's two segments follow the label, the gate's mark and its name.
const barCells = (segs: Segment[]) => (segs[3]?.text.length ?? 0) + (segs[4]?.text.length ?? 0);

// Merged at 22:00:00, 70 s before `at`, with these runs on the merge commit.
function merged(runs: Workflow[] | null): Pull {
  const mergeRuns = runs && { workflows: runs, isGated: false, isRequiredPending: false };
  return pull([green()], {
    state: 'MERGED',
    mergedAt: '2026-10-03T22:00:00Z',
    mergeRuns: mergeRuns && { ...mergeRuns, isTruncated: false },
  });
}

const release = (conclusion: string | null) => flow(5, 'Release', [job('Publish', conclusion)]);

// Pushed 70 s before `at`, with these runs on the branch's tip.
const pushed = (runs: Workflow[] | null) =>
  watched(pushedPull('feat/x', at - 70_000, runs && { workflows: runs, isTruncated: false }), {
    number: 0,
    push: { branch: 'feat/x', pushedAt: at - 70_000 },
    url: 'https://github.com/o/r/tree/feat/x',
    checkedAt: at,
  });

describe('after a push', () => {
  test('names the push, then follows the branch’s runs as a merge’s', () => {
    expect(textOf(pushed([]))).toBe('⟳ push feat/x · ○ waiting on checks');
    expect(textOf(pushed([release(null)]))).toBe('⟳ push feat/x · ● Release 1m10s');
    expect(textOf(pushed([release('SUCCESS')]))).toBe('⟳ push feat/x · ✓ checks passed');
    expect(textOf(pushed([release('FAILURE')]))).toBe('⟳ push feat/x · ✗ Release: Publish failed');
  });

  test('says the push, not a merge, in its toasts', () => {
    const p = pushed([release('FAILURE')]).pull!;
    const v = verdictAt(p, {}, 'github.com', at);
    expect(toastOf('push feat/x', v, undefined, '')).toBe('push feat/x: Release: Publish failed');
    expect(toastOf('push feat/x', { kind: 'merged-passed' }, undefined, '')).toBe(
      'push feat/x: its checks passed',
    );
  });
});

describe('after a merge', () => {
  test('follows the merge commit’s runs, the longest as the gate', () => {
    const v = verdictAt(
      merged([release(null), codeql(null)]),
      { 'github.com/5': 90_000 },
      'github.com',
      at,
    );
    expect(v.kind === 'merged-running' && v.gate.name).toBe('Release');
    expect(textOf(watched(merged([release(null), codeql('SUCCESS')])))).toBe(
      '#128 merged into main · ● Release 1m10s · CodeQL ✓',
    );
  });

  test('names a failed job on the base branch, any workflow counting', () => {
    const p = merged([release('FAILURE'), codeql('SUCCESS')]);
    expect(verdictAt(p, {}, 'github.com', at)).toMatchObject({
      kind: 'merged-failing',
      job: 'Publish',
    });
    expect(textOf(watched(p))).toBe('#128 merged into main · ✗ Release: Publish failed');
    expect(toastOf('#128', verdictAt(p, {}, 'github.com', at), 'merged-running')).toBe(
      '#128 merged: Release: Publish failed',
    );
  });

  test('settles once every run passed and the grace is over: said once, then read no more', () => {
    const p = merged([release('SUCCESS')]);
    const v = verdictAt(p, {}, 'github.com', at);
    expect(v).toEqual({ kind: 'merged-passed' });
    expect(textOf(watched(p))).toBe('#128 merged into main · ✓ checks passed');
    expect(toastOf('#128', v, 'merged-running')).toBe('#128 merged: its checks passed');
    // 70 s after the merge a late run may still start, so it keeps reading.
    expect(delayOf(v, p, at)).toBe(10_000);
    expect(isSettled(v, p, at)).toBe(false);
    const later = at + 30_000;
    expect(delayOf(v, p, later)).toBeNull();
    expect(isSettled(v, p, later)).toBe(true);
    // Read settled at `later`, it leaves 5 s on.
    expect(isCleared(v, p, later, later + 4999)).toBe(false);
    expect(isCleared(v, p, later, later + 5000)).toBe(true);
    expect(isCleared(v, p, at, at + 60_000)).toBe(false);
  });

  test('a failed run with another still going on the base branch has not settled', () => {
    const p = merged([release('FAILURE'), codeql(null)]);
    const later = at + 30_000;
    const v = verdictAt(p, {}, 'github.com', later);
    expect(v.kind).toBe('merged-failing');
    expect(isSettled(v, p, later)).toBe(false);
    expect(delayOf(v, p, later)).toBe(10_000);
  });

  test('a failed merge stays, read each minute until a run of it passes', () => {
    const p = merged([release('FAILURE'), codeql('SUCCESS')]);
    const later = at + 3_600_000;
    const v = verdictAt(p, {}, 'github.com', later);
    expect(isSettled(v, p, later)).toBe(false);
    expect(isCleared(v, p, later, later + 60_000)).toBe(false);
    expect(delayOf(v, p, later)).toBe(60_000);
  });

  test('waits up to 90 s for the merge commit’s runs to start, then leaves', () => {
    expect(verdictAt(merged(null), {}, 'github.com', at)).toEqual({ kind: 'merged-waiting' });
    expect(textOf(watched(merged([])))).toBe('#128 merged into main · ○ waiting on checks');
    const later = at + 30_000;
    expect(verdictAt(merged([]), {}, 'github.com', later)).toEqual({ kind: 'closed' });
  });

  test('a pull request closed without merging leaves at once', () => {
    expect(verdictAt(pull([green()], { state: 'CLOSED' }), {}, 'github.com', at)).toEqual({
      kind: 'closed',
    });
  });
});

// Merged as `merged` is, its merge commit `m`.
const onMerge = (runs: Workflow[] | null): Pull => ({
  ...merged(runs),
  mergeOid: 'm',
  stack: { number: 236, trunk: 'main', layers: [] },
});
const commit = (oid: string, workflows: Workflow[], parents?: string[]) => ({
  oid,
  ...(parents ? { parents } : {}),
  runs: { workflows, isTruncated: false },
});
const runOf = (n: number, w: Workflow) => ({ ...w, url: `https://x/run/${n}` });

// A linear trunk, newest first: each commit's parent is the next one, unless given.
const follow = (p: Pull, trunk: ReturnType<typeof commit>[]) =>
  followTrunk(
    p,
    trunk.map((c, i) => ({ parents: trunk[i + 1] ? [trunk[i + 1]!.oid] : [], ...c })),
  );

describe('needsTrunk and followTrunk', () => {
  const late = at + 30_000;

  test('the trunk is read for a merge commit with no runs past the grace, or a failed one', () => {
    expect(needsTrunk(onMerge([]), at)).toBe(false);
    expect(needsTrunk(onMerge([]), late)).toBe(true);
    expect(needsTrunk(onMerge([release('FAILURE'), codeql('SUCCESS')]), at)).toBe(true);
    expect(needsTrunk(onMerge([release('CANCELLED')]), at)).toBe(true);
    expect(needsTrunk(onMerge([release('SUCCESS'), codeql(null)]), late)).toBe(false);
    // Without the merge commit's oid, or its runs, nothing on the trunk is later.
    expect(needsTrunk(merged([]), late)).toBe(false);
    expect(needsTrunk(onMerge(null), late)).toBe(false);
    expect(needsTrunk(pull([], { mergeOid: 'm' }), late)).toBe(false);
    // Outside a stack, only a failure looks past the merge commit.
    for (const stack of [null, undefined]) {
      expect(needsTrunk({ ...onMerge([]), stack }, late)).toBe(false);
      expect(needsTrunk({ ...onMerge([release('FAILURE')]), stack }, late)).toBe(true);
    }
  });

  test("a merge commit with no runs follows the oldest later commit's that has some", () => {
    const trunk = [
      commit('newest', [runOf(3, release(null))]),
      commit('next', [runOf(2, release('SUCCESS'))]),
      commit('bare', []),
      commit('m', []),
      commit('older', [runOf(1, release('FAILURE'))]),
    ];
    const p = follow(onMerge([]), trunk);
    expect(p.mergeRuns?.workflows.map((w) => w.url)).toEqual(['https://x/run/2']);
    expect(p.followed).toEqual({ isLater: true, since: [] });
    expect(textOf(watched(p), {}, 80)).toBe(
      '#128 merged into main · ✓ checks passed on a later commit',
    );
  });

  test("the merge commit's own read stands over the trunk read's runs for it", () => {
    const p = onMerge([release('SUCCESS')]);
    const trunk = [
      commit('a', [runOf(2, release('SUCCESS'))]),
      commit('m', [runOf(9, release('FAILURE'))]),
    ];
    expect(follow(p, trunk)).toBe(p);
  });

  test('a later commit with more checks than read says so', () => {
    const more = {
      ...commit('a', [release('SUCCESS')]),
      runs: { workflows: [release('SUCCESS')], isTruncated: true },
    };
    const p = follow(onMerge([]), [more, commit('m', [])]);
    expect(textOf(watched(p))).toContain('more checks not shown');
  });

  test('a merge commit with no runs and none later is left as it was', () => {
    const p = onMerge([]);
    expect(follow(p, [commit('later', []), commit('m', [])])).toBe(p);
    expect(follow(p, [])).toBe(p);
  });

  test('only commits that descend from the merge commit are later', () => {
    // git log order: a merge of `side` on top, then `side`, then the merge commit.
    const trunk = [
      commit('tip', [], ['m', 'side']),
      commit('side', [runOf(2, release('SUCCESS'))], ['base']),
      commit('m', []),
    ];
    expect(follow(onMerge([]), trunk).followed).toBeUndefined();
    const failing = onMerge([release('FAILURE')]);
    expect(follow(failing, trunk)).toBe(failing);
    const above = [commit('next', [runOf(3, release('SUCCESS'))], ['tip']), ...trunk];
    expect(follow(failing, above).followed).toEqual({ isLater: false, since: ['Release'] });
    // A merge whose first parent is a side branch still holds the merge commit.
    const second = [
      commit('tip', [runOf(4, release('SUCCESS'))], ['side', 'm']),
      commit('side', [], ['base']),
      commit('m', []),
    ];
    expect(follow(failing, second).followed).toEqual({ isLater: false, since: ['Release'] });
  });

  test('a trunk without the merge commit is followed for nothing', () => {
    const trunk = [commit('b', [release('SUCCESS')]), commit('a', [codeql('SUCCESS')])];
    for (const p of [onMerge([]), onMerge([release('FAILURE')])]) {
      expect(follow(p, trunk)).toBe(p);
    }
  });

  test('a failed workflow gives way to its newest finished run on a later commit, once that passed', () => {
    const failing = onMerge([release('FAILURE'), codeql('SUCCESS')]);
    const passedSince = follow(failing, [
      commit('c', [runOf(4, release(null))]),
      commit('b', [runOf(3, release('SUCCESS'))]),
      commit('a', [runOf(2, release('FAILURE'))]),
      commit('m', []),
    ]);
    expect(passedSince.mergeRuns?.workflows.map((w) => w.url)).toEqual([
      'https://x/run/3',
      'https://x/run/2',
    ]);
    expect(passedSince.followed).toEqual({ isLater: false, since: ['Release'] });
    // Only the failed workflow gives way; one that passed, or still runs, on the
    // merge commit keeps its own run.
    const both = follow(onMerge([release('FAILURE'), runOf(7, codeql(null))]), [
      commit('a', [runOf(2, release('SUCCESS')), runOf(5, codeql('SUCCESS'))]),
      commit('m', []),
    ]);
    expect(both.followed).toEqual({ isLater: false, since: ['Release'] });
    expect(both.mergeRuns?.workflows.map((w) => w.url)).toEqual([
      'https://x/run/2',
      'https://x/run/7',
    ]);
    // A run still going on a newer commit does not hide one that finished.
    const stillGoing = follow(failing, [
      commit('b', [runOf(3, release(null))]),
      commit('a', [runOf(2, release('SUCCESS'))]),
      commit('m', []),
    ]);
    expect(stillGoing.mergeRuns?.workflows[0]?.url).toBe('https://x/run/2');
    const v = verdictAt(passedSince, {}, 'github.com', late);
    expect(v.kind).toBe('merged-passed');
    expect(isSettled(v, passedSince, late)).toBe(true);
    expect(textOf(watched(passedSince))).toBe(
      '#128 merged into main · ✓ Release failed, since passed',
    );
  });

  test('a failed workflow stays while its newest later run failed, runs, or never ran', () => {
    const failing = onMerge([release('FAILURE')]);
    const m = commit('m', []);
    const stays = [
      [commit('b', [runOf(3, release('FAILURE'))]), commit('a', [runOf(2, release('SUCCESS'))]), m],
      [commit('a', [runOf(2, release(null))]), m],
      [commit('a', [codeql('SUCCESS')]), m],
      [m, commit('older', [runOf(1, release('SUCCESS'))])],
    ];
    for (const trunk of stays) expect(follow(failing, trunk)).toBe(failing);
    // A skipped run never ran the workflow, so an older pass still counts.
    const skipped = { ...runOf(3, release('SUCCESS')), conclusion: 'SKIPPED' };
    expect(follow(failing, [commit('a', [skipped]), m])).toBe(failing);
    const olderPass = follow(failing, [
      commit('b', [skipped]),
      commit('a', [runOf(2, release('SUCCESS'))]),
      m,
    ]);
    expect(olderPass.mergeRuns?.workflows[0]?.url).toBe('https://x/run/2');
  });

  test('says the later commit, or the workflow that since passed, in its news', () => {
    const pr = { repo: 'o/r', number: 128, url: 'https://github.com/o/r/pull/128' };
    const tell = (p: Pull) => wakeOf(pr, p, verdictAt(p, {}, 'github.com', late), {});
    const later = follow(onMerge([]), [commit('a', [release('SUCCESS')]), commit('m', [])]);
    expect(tell(later).passed).toEqual([
      "o/r#128 merged into main, and a later commit's checks on main passed.",
    ]);
    const failedLater = follow(onMerge([]), [commit('a', [release('FAILURE')]), commit('m', [])]);
    expect(tell(failedLater).text).toContain(
      'Release: Publish failed on a later commit for o/r#128',
    );
    const since = follow(onMerge([release('FAILURE')]), [
      commit('a', [runOf(2, release('SUCCESS'))]),
      commit('m', []),
    ]);
    expect(tell(since).passed).toEqual([
      'o/r#128 merged into main, and Release failed on the merge commit and since passed on main.',
    ]);
    // With no runs on the merge commit, the failure was the followed commit's.
    const both = follow(onMerge([]), [
      commit('b', [runOf(3, release('SUCCESS'))]),
      commit('a', [runOf(2, release('FAILURE'))]),
      commit('m', []),
    ]);
    expect(both.followed).toEqual({ isLater: true, since: ['Release'] });
    expect(tell(both).passed).toEqual([
      'o/r#128 merged into main, and Release failed on a later commit and since passed on main.',
    ]);
    expect(textOf(watched(both))).toBe('#128 merged into main · ✓ Release failed, since passed');
  });
});

// Pull request `number` of `repo`, a layer of stack `stack`.
const layered = (number: number, stack: number, layers: number[], repo = 'o/r') =>
  watched(pull([green()], { number, stack: { number: stack, trunk: 'main', layers } }), {
    number,
    repo,
    url: `https://github.com/${repo}/pull/${number}`,
  });
const lane = (number: number) => watched(pull([green()], { number, stack: null }), { number });
const numbers = (list: Watch[]) => list.map((w) => w.number);
const runningLayer = (stack: Pull['stack']) =>
  watched(pull([runningCi()], { number: 235, stack }), { number: 235 });
const widthAt50 = (w: Watch) => lineOf(w, at, KNOWN, 50).reduce((n, s) => n + s.text.length, 0);

describe('stack layers', () => {
  test("a layer's place is counted from the bottom; a lane has none", () => {
    expect(layerOf(layered(235, 236, [234, 235, 237]))).toEqual({ stack: 236, at: 2, of: 3 });
    expect(layerOf(lane(7))).toBeNull();
    expect(layerOf(watched(pull([green()])))).toBeNull();
    // A stack that does not list the pull request places it nowhere.
    expect(layerOf(layered(235, 236, [234]))).toBeNull();
  });

  test("a layer's line carries its place after the label", () => {
    expect(textOf(layered(235, 236, [234, 235, 237]))).toBe('#235 ⧉ #236 2/3 ✓ ready to merge');
    expect(textOf(lane(7))).toBe('#7 ✓ ready to merge');
  });

  test("a running layer's bar gives up the badge's width, so the line fits as a lane's does", () => {
    // At 50 columns neither line's bar is at its shortest or longest.
    const lone = widthAt50(runningLayer(null));
    expect(widthAt50(runningLayer({ number: 236, trunk: 'main', layers: [234, 235] }))).toBe(lone);
  });

  test("each stack's lines sit together, top layer first, where its first line was", () => {
    const list = [
      lane(1),
      layered(234, 236, [234, 235, 237]),
      layered(301, 300, [301, 302]),
      lane(2),
      layered(237, 236, [234, 235, 237]),
      layered(302, 300, [301, 302]),
      layered(235, 236, [234, 235, 237]),
    ];
    expect(numbers(orderedOf(list))).toEqual([1, 237, 235, 234, 302, 301, 2]);
    // The same stack number in another repository is another stack.
    const other = layered(237, 236, [236, 237], 'o/other');
    expect(numbers(orderedOf([layered(234, 236, [234, 235, 237]), lane(2), other]))).toEqual([
      234, 2, 237,
    ]);
  });

  test('a gh stack command that can change a stack asks every stack again', () => {
    for (const command of [
      'gh stack submit --auto',
      'cd r && gh stack push',
      'gh stack sync',
      'gh stack merge 236 --yes',
      'gh stack add feat/c',
      'gh stack init a b',
      'gh stack modify',
      'gh stack unstack',
      'gh stack link 10 11',
      'gh stack delete 236',
    ]) {
      expect(changesStacks(command)).toBe(true);
    }
    for (const command of [
      'gh stack view --json',
      'gh stack top',
      'echo gh stack push',
      'gh pr create',
    ]) {
      expect(changesStacks(command)).toBe(false);
    }
  });
});

describe('takeOverPush', () => {
  const head = { branch: 'feat/x', repo: 'O/R' };
  const pr = (over: Partial<Pull> = {}, told?: string[]) =>
    watched(pull([green()], { head, ...over }), told ? { told } : {});

  test('puts the pull request in its push line’s row, with what was told of either', () => {
    const push = { ...pushed([release(null)]), told: ['push'] };
    const other = watched(pull([green()]), { number: 7 });
    const mine = pr({}, ['pr']);
    expect(takeOverPush([push, other, mine], mine)).toEqual([
      { ...mine, told: ['pr', 'push'] },
      other,
    ]);
  });

  test('leaves the lines alone for another branch or host, a merged pull request, or a push', () => {
    const push = pushed([release(null)]);
    const cases = [
      pr({ head: { branch: 'feat/y', repo: 'o/r' } }),
      { ...pr(), host: 'ghe.example.com' },
      pr({ state: 'MERGED' }),
      pr({ head: undefined }),
    ];
    for (const mine of cases) expect(takeOverPush([push, mine], mine)).toEqual([push, mine]);
    expect(takeOverPush([push], push)).toEqual([push]);
  });

  test('takes nothing over for a pull request unwatched during its read', () => {
    const push = pushed([release(null)]);
    expect(takeOverPush([push], pr())).toEqual([push]);
  });

  test('leaves a fork’s push to its own read, which knows the fork’s parent', () => {
    const fork = { ...pushed([release(null)]), repo: 'me/r' };
    const upstream = pr({ head: { branch: 'feat/x', repo: 'me/r' } });
    expect(takeOverPush([fork, upstream], upstream)).toEqual([fork, upstream]);
    const own = pr({ head: { branch: 'feat/x', repo: 'o/r' } });
    expect(takeOverPush([fork, own], own)).toEqual([fork, own]);
    const stranger = { ...pr(), repo: 'them/r' };
    const push = pushed([release(null)]);
    expect(takeOverPush([push, stranger], stranger)).toEqual([push, stranger]);
    const sameName = pr({ head: { branch: 'feat/x', repo: 'them/r' } });
    expect(takeOverPush([push, sameName], sameName)).toEqual([push, sameName]);
  });
});

describe('lineOf', () => {
  test('a running gate with a known length draws a bar and both times', () => {
    const p = pull([runningCi(), codeql('SUCCESS'), flow(3, 'Deps', [job('Review', null)])]);
    expect(textOf(watched(p), KNOWN)).toMatch(
      /^#128 ● CI [█▏▎▍▌▋▊▉]+░+ 1m10s \/ ~2m20s · CodeQL ✓ · Deps ●$/,
    );
  });

  test('keeps one unreachable read quiet, then says so dim, never red', () => {
    const ready = pull([green()]);
    expect(textOf(watched(ready, { offline: 1 }))).toBe('#128 ✓ ready to merge');
    const segs = lineOf(watched(ready, { offline: 2 }), at, KNOWN, 80);
    expect(segs.at(-1)).toEqual({ text: ' · offline, retrying', isDim: true });
    expect(segs.some((s) => s.color === 'red')).toBe(false);
    expect(textOf(watched(undefined, { offline: 1 }))).toBe('#128 loading…');
    expect(lineOf(watched(undefined, { offline: 2 }), at, KNOWN, 80)[1]).toEqual({
      text: ' offline, retrying',
      isDim: true,
    });
  });

  test('says a rate limit beside a failure, read or not', () => {
    const until = new Date(2026, 9, 3, 23, 5).getTime();
    const over = { error: 'gh failed: HTTP 502', limitedUntil: until };
    expect(textOf(watched(undefined, over))).toBe(
      '#128 gh failed: HTTP 502 · rate limited until 23:05',
    );
    expect(textOf(watched(pull([green()]), { limitedUntil: until }))).toMatch(
      / · rate limited until 23:05$/,
    );
    expect(textOf(watched(undefined, { error: over.error }))).toBe('#128 gh failed: HTTP 502');
  });

  test('paints what runs blue: the mark and the bar, not the name', () => {
    const segs = lineOf(watched(pull([runningCi(), codeql(null)])), at, KNOWN, 80);
    const colorOf = (text: RegExp) => segs.find((s) => text.test(s.text))?.color;
    expect(segs.slice(1, 3)).toEqual([
      { text: ' ●', color: 'blue', isMark: true },
      { text: ' CI ', url: 'https://x/run/1' },
    ]);
    expect(colorOf(/█/)).toBe('blue');
    expect(segs.slice(-2)).toEqual([
      { text: ' · CodeQL ' },
      { text: '●', color: 'blue', isMark: true },
    ]);
  });

  test("colors only another workflow's mark: red failed, green passed", () => {
    const failed = lineOf(watched(pull([runningCi(), codeql('FAILURE')])), at, KNOWN, 80);
    expect(failed.slice(-2)).toEqual([
      { text: ' · CodeQL ' },
      { text: '✗', color: 'red', isMark: true },
    ]);
    const passed = lineOf(watched(pull([runningCi(), codeql('SUCCESS')])), at, KNOWN, 80);
    expect(passed.slice(-2)).toEqual([
      { text: ' · CodeQL ' },
      { text: '✓', color: 'green', isMark: true },
    ]);
  });

  test("colors only the lead's mark: ready and passed green, blocked yellow", () => {
    expect(leadOf(pull([green()]))).toEqual([
      { text: ' ✓', color: 'green', isMark: true },
      { text: ' ready to merge' },
    ]);
    expect(leadOf(merged([green()]))).toEqual([
      { text: ' merged into main ·', isDim: true },
      { text: ' ✓', color: 'green', isMark: true },
    ]);
    expect(leadOf(pull([green()], { merge: 'DIRTY' }))).toEqual([
      { text: ' ⚠', color: 'yellow', isMark: true },
      { text: ' conflicts' },
    ]);
  });

  test('sizes the bar to the band, between 8 and 24 cells', () => {
    expect(cells(120)).toBe(24);
    expect(cells(40)).toBe(40 - '#128 ● CI '.length - ' 1m10s / ~2m20s'.length - 2);
    expect(cells(20)).toBe(8);
  });

  test('never draws a running bar full', () => {
    const late = lineOf(watched(pull([runningCi()])), at, { 'github.com/1': 10_000 }, 120);
    expect(late[2]?.text).not.toBe('█'.repeat(24));
  });

  test('a running gate of unknown length shows only the time so far', () => {
    expect(textOf(watched(pull([runningCi()])))).toBe('#128 ● CI 1m10s');
  });

  test('a re-run shows no clock until its attempt’s start is known', () => {
    const rerun = { ...runningCi(), isRerun: true, attempt: 2, runId: 9 };
    expect(textOf(watched(pull([rerun])), KNOWN)).toBe('#128 ● CI re-run');
    expect(textOf(watched(pull([{ ...rerun, runId: undefined }])), KNOWN)).toBe('#128 ● CI re-run');
  });

  test('a re-run counts from its attempt’s start, with no bar', () => {
    const rerun = { ...runningCi(), isRerun: true, attempt: 2, runId: 9 };
    const known = { ...KNOWN, [rerunKey('github.com', 9, 2)]: at - 72_000 };
    expect(textOf(watched(pull([rerun])), known)).toBe('#128 ● CI re-run 1m12s');
    const other = { ...KNOWN, [rerunKey('github.com', 9, 1)]: at - 72_000 };
    expect(textOf(watched(pull([rerun])), other)).toBe('#128 ● CI re-run');
  });

  test('names the jobs a running gate still waits on, once some are done', () => {
    expect(left(job('Lint', 'SUCCESS'), job('Windows', null))).toBe('#128 ● CI: Windows 1m10s');
    expect(left(job('Lint', 'SUCCESS'), job('Windows', null), job('Mac', null))).toBe(
      '#128 ● CI: Windows, Mac 1m10s',
    );
    expect(left(job('Lint', 'SUCCESS'), job('A', null), job('B', null), job('C', null))).toBe(
      '#128 ● CI: 3 jobs 1m10s',
    );
    expect(left(job('Lint', null), job('Tests', null))).toBe('#128 ● CI 1m10s');
  });

  test('says queued where no job left has started, and clips long names', () => {
    expect(left(job('Lint', 'SUCCESS'), queued('Windows'))).toBe('#128 ● CI: Windows queued 1m10s');
    expect(left(queued('Lint'), queued('Tests'))).toBe('#128 ● CI queued 1m10s');
    expect(left(job('Lint', 'SUCCESS'), queued('Windows'), job('Mac', null))).toBe(
      '#128 ● CI: Windows queued, Mac 1m10s',
    );
    expect(left(job('Lint', 'SUCCESS'), queued('A'), queued('B'), job('C', null))).toBe(
      '#128 ● CI: 3 jobs 1m10s',
    );
    expect(left(job('Lint', 'SUCCESS'), queued('A'), queued('B'), queued('C'))).toBe(
      '#128 ● CI: 3 jobs queued 1m10s',
    );
    expect(left(job('Lint', 'SUCCESS'), job('Analyze (javascript-typescript)', null))).toBe(
      '#128 ● CI: Analyze (javascript-typ… 1m10s',
    );
  });

  test('reads only this attempt’s start, and names a re-run’s jobs after it', () => {
    const third = { ...runningCi(), isRerun: true, attempt: 3, runId: 9 };
    const second = { ...KNOWN, [rerunKey('github.com', 9, 2)]: at - 72_000 };
    expect(textOf(watched(pull([third])), second)).toBe('#128 ● CI re-run');
    const jobs = [job('Lint', 'SUCCESS'), queued('Tests')];
    const rerun = { ...ci(jobs), isRerun: true, attempt: 2, runId: 9 };
    const started = { [rerunKey('github.com', 9, 2)]: at - 4000 };
    expect(textOf(watched(pull([rerun])), started)).toBe('#128 ● CI re-run: Tests queued 0m04s');
  });

  test('names nothing, and says no queued, when every job of a running gate is done', () => {
    const done = flow(1, 'CI', [job('Lint', 'SUCCESS')], 'running');
    expect(textOf(watched(pull([done])))).toBe('#128 ● CI 1m10s');
  });

  test('keeps a job name of exactly 24 characters whole', () => {
    const name = 'abcdefghijklmnopqrstuvwx';
    expect(left(job('Lint', 'SUCCESS'), job(name, null))).toBe(`#128 ● CI: ${name} 1m10s`);
  });

  test('names the jobs left, and a re-run’s clock, on a merged line too', () => {
    const release = flow(9, 'Release', [job('Build', 'SUCCESS'), job('Publish', null)]);
    expect(textOf(watched(merged([release])))).toBe(
      '#128 merged into main · ● Release: Publish 1m10s',
    );
    const rerun = { ...release, isRerun: true, attempt: 2, runId: 4 };
    const started = { [rerunKey('github.com', 4, 2)]: at - 5000 };
    expect(textOf(watched(merged([rerun])), started)).toBe(
      '#128 merged into main · ● Release re-run: Publish 0m05s',
    );
  });

  test('a draft says so up front, and its checks still show', () => {
    expect(textOf(draft([runningCi()]))).toBe('#128 draft · ● CI 1m10s');
    expect(textOf(draft([ci([job('Lint', 'FAILURE'), job('CI Summary', null, true)])]))).toBe(
      '#128 draft · ✗ CI: Lint failed',
    );
    expect(textOf(draft([green(), codeql('FAILURE')]))).toBe(
      '#128 draft · ✓ checks passed · CodeQL ✗',
    );
    expect(textOf(draft([]))).toBe('#128 ○ draft');
  });

  test('a draft waits on a pending required check, and says what would block it', () => {
    const passed = [green()];
    expect(textOf(draftWith(passed, { isRequiredPending: true }))).toBe(
      '#128 draft · ○ waiting on checks',
    );
    expect(textOf(draftWith(passed, { merge: 'DIRTY' }))).toBe(
      '#128 draft · ✓ checks passed · ⚠ conflicts',
    );
    expect(textOf(draftWith(passed, { review: 'CHANGES_REQUESTED' }))).toBe(
      '#128 draft · ✓ checks passed · ⚠ changes requested',
    );
    expect(textOf(draftWith(passed, { merge: 'BEHIND' }))).toBe(
      '#128 draft · ✓ checks passed · ⚠ behind base',
    );
  });

  test('a draft whose checks passed is not called ready', () => {
    const p = pull([green()], { isDraft: true });
    expect(verdictAt(p, {})).toEqual({ kind: 'waiting', reason: 'draft' });
    expect(textOf(watched(p))).not.toContain('ready to merge');
  });

  test('names the jobs left inside the width the bar is sized from', () => {
    const p = pull([ci([job('Lint', 'SUCCESS'), job('Windows', null)])]);
    const segs = lineOf(watched(p), at, { 'github.com/1': 140_000 }, 40);
    const used = '#128 ● CI: Windows '.length + ' 1m10s / ~2m20s'.length;
    expect(barCells(segs)).toBe(Math.max(8, 40 - used - 2));
  });

  test('a waiting, blocked or failing PR still shows optional workflows that fail or run', () => {
    const waiting = pull([green(), codeql('FAILURE')], {
      merge: 'BLOCKED',
      review: 'REVIEW_REQUIRED',
    });
    expect(textOf(watched(waiting))).toBe('#128 ○ waiting on review · CodeQL ✗');
    expect(textOf(watched(pull([green(), codeql(null)], { merge: 'DIRTY' })))).toBe(
      '#128 ⚠ conflicts · CodeQL ●',
    );
    const failing = pull([
      ci([job('Typecheck', 'FAILURE'), job('CI Summary', null, true)]),
      codeql('FAILURE'),
    ]);
    expect(textOf(watched(failing))).toBe('#128 ✗ CI: Typecheck failed · CodeQL ✗');
  });

  test('ready, failing, blocked and waiting read as one short line', () => {
    expect(textOf(watched(pull([])))).toBe('#128 ✓ ready to merge');
    const failing = pull([ci([job('Typecheck', 'FAILURE'), job('CI Summary', null, true)])]);
    expect(textOf(watched(failing))).toBe('#128 ✗ CI: Typecheck failed');
    expect(textOf(watched(pull([], { merge: 'DIRTY' })))).toBe('#128 ⚠ conflicts');
    expect(textOf(watched(pull([], { merge: 'UNKNOWN' })))).toBe('#128 ○ waiting on checking');
  });

  test('the failing job links to its log, its mark alone red', () => {
    const failing = pull([ci([job('Typecheck', 'FAILURE'), job('CI Summary', null, true)])]);
    expect(lineOf(watched(failing), at, {}, 80).slice(1, 3)).toEqual([
      { text: ' ✗', color: 'red', isMark: true },
      { text: ' CI: Typecheck failed', url: 'https://x/Typecheck' },
    ]);
  });

  test('a ready PR still shows optional workflows that fail or run', () => {
    expect(textOf(watched(pull([green(), codeql('FAILURE')])))).toBe(
      '#128 ✓ ready to merge · CodeQL ✗',
    );
    expect(textOf(watched(pull([green(), codeql(null)])))).toBe('#128 ✓ ready to merge · CodeQL ●');
  });

  test('says when GitHub listed more checks than one read returns', () => {
    expect(textOf(watched(pull([], { isTruncated: true })))).toBe(
      '#128 ✓ ready to merge · more checks not shown',
    );
  });

  test('a PR not yet read, or whose read failed, says so and why', () => {
    const error = 'gh failed: HTTP 502';
    expect(textOf(watched())).toBe('#128 loading…');
    expect(textOf(watched(undefined, { error }))).toBe('#128 gh failed: HTTP 502');
    const after = (p: Pull) => textOf(watched(p, { error }), KNOWN);
    expect(after(pull([]))).toBe('#128 ✓ ready to merge · gh failed: HTTP 502');
    expect(after(pull([], { merge: 'DIRTY' }))).toBe('#128 ⚠ conflicts · gh failed: HTTP 502');
    expect(after(pull([], { merge: 'UNKNOWN' }))).toMatch(/waiting on checking · gh failed/);
    expect(after(pull([runningCi()]))).toMatch(/~2m20s · gh failed: HTTP 502$/);
  });

  test('another workflow of the same name keeps its own mark', () => {
    const second = flow(9, 'CI', [job('Docs', null)]);
    expect(textOf(watched(pull([runningCi(), second])))).toBe('#128 ● CI 1m10s · CI ●');
  });
});
