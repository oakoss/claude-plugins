import { describe, expect, test } from 'vitest';

import type { Job, Pull, RunStatus, Watch, Workflow } from '../types';
import {
  barOf,
  clockText,
  createdPull,
  delayOf,
  errorLine,
  isSettled,
  lineOf,
  movesPulls,
  shownOf,
  toastOf,
  verdictOf,
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
    ]) {
      expect(movesPulls(command)).toBe(true);
    }
  });

  test('not a command that only names one', () => {
    for (const command of ['git status', 'echo git push', 'gh pr view 129', 'git pushd']) {
      expect(movesPulls(command)).toBe(false);
    }
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
const KNOWN = { 'github.com/1': 140_000 };

// How many cells the running bar takes in a band `columns` wide.
function cells(columns: number): number {
  const segs = lineOf(watched(pull([runningCi()])), at, KNOWN, columns);
  return (segs[2]?.text.length ?? 0) + (segs[3]?.text.length ?? 0);
}

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
      '#128 merged · ● Release 1m10s · CodeQL ✓',
    );
  });

  test('names a failed job on the base branch, any workflow counting', () => {
    const p = merged([release('FAILURE'), codeql('SUCCESS')]);
    expect(verdictAt(p, {}, 'github.com', at)).toMatchObject({
      kind: 'merged-failing',
      job: 'Publish',
    });
    expect(textOf(watched(p))).toBe('#128 merged · ✗ Release: Publish failed');
    expect(toastOf('#128', verdictAt(p, {}, 'github.com', at), 'merged-running')).toBe(
      '#128 merged: Release: Publish failed',
    );
  });

  test('settles once every run passed and the grace is over: said once, then read no more', () => {
    const p = merged([release('SUCCESS')]);
    const v = verdictAt(p, {}, 'github.com', at);
    expect(v).toEqual({ kind: 'merged-passed' });
    expect(textOf(watched(p))).toBe('#128 merged · ✓ main checks passed');
    expect(toastOf('#128', v, 'merged-running')).toBe('#128 merged: its checks passed');
    // 70 s after the merge a late run may still start, so it keeps reading.
    expect(delayOf(v, p, at)).toBe(10_000);
    expect(isSettled(v, p, at)).toBe(false);
    const later = at + 30_000;
    expect(delayOf(v, p, later)).toBeNull();
    expect(isSettled(v, p, later)).toBe(true);
  });

  test('a failed run with another still going on the base branch has not settled', () => {
    const p = merged([release('FAILURE'), codeql(null)]);
    const later = at + 30_000;
    const v = verdictAt(p, {}, 'github.com', later);
    expect(v.kind).toBe('merged-failing');
    expect(isSettled(v, p, later)).toBe(false);
    expect(delayOf(v, p, later)).toBe(10_000);
  });

  test('waits up to 90 s for the merge commit’s runs to start, then leaves', () => {
    expect(verdictAt(merged(null), {}, 'github.com', at)).toEqual({ kind: 'merged-waiting' });
    expect(textOf(watched(merged([])))).toBe("#128 merged · ○ waiting on main's checks");
    const later = at + 30_000;
    expect(verdictAt(merged([]), {}, 'github.com', later)).toEqual({ kind: 'closed' });
  });

  test('a pull request closed without merging leaves at once', () => {
    expect(verdictAt(pull([green()], { state: 'CLOSED' }), {}, 'github.com', at)).toEqual({
      kind: 'closed',
    });
  });
});

describe('lineOf', () => {
  test('a running gate with a known length draws a bar and both times', () => {
    const p = pull([runningCi(), codeql('SUCCESS'), flow(3, 'Deps', [job('Review', null)])]);
    expect(textOf(watched(p), KNOWN)).toMatch(
      /^#128 ● CI [█▏▎▍▌▋▊▉]+░+ 1m10s \/ ~2m20s · CodeQL ✓ · Deps ●$/,
    );
  });

  test('marks a failed other workflow red', () => {
    const segs = lineOf(watched(pull([runningCi(), codeql('FAILURE')])), at, KNOWN, 80);
    expect(segs.at(-1)).toEqual({ text: ' · CodeQL ✗', color: 'red', isDim: false });
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

  test('a re-run shows no clock, since GitHub keeps the first attempt’s start', () => {
    const rerun = { ...runningCi(), isRerun: true };
    expect(textOf(watched(pull([rerun])), KNOWN)).toBe('#128 ● CI re-run');
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

  test('the failing job links to its log', () => {
    const failing = pull([ci([job('Typecheck', 'FAILURE'), job('CI Summary', null, true)])]);
    expect(lineOf(watched(failing), at, {}, 80)[1]?.url).toBe('https://x/Typecheck');
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
