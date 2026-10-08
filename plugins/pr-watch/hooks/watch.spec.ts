import { describe, expect, test } from 'vitest';

import type { Activity, Job, Pull, RunStatus, Watch, Workflow } from '../types';
import {
  barOf,
  clockText,
  createdPull,
  delayOf,
  errorLine,
  isCleared,
  isSettled,
  lineOf,
  movesPulls,
  pushedBranches,
  pushedPull,
  shownOf,
  toastOf,
  verdictOf,
  QUIET_CAP,
  settingsOf,
  tellsOf,
  toldAfter,
  wakeOf,
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

  test('tells every failed job once, in workflows that gate the merge or not', () => {
    const p = pull([
      ci([job('Test', 'FAILURE', true), job('Lint', 'FAILURE'), job('Build', null)]),
      flow(2, 'Docs', [job('Links', 'FAILURE')]),
    ]);
    const first = after(p);
    expect(first.text).toContain('CI: Test failed');
    expect(first.text).toContain('CI: Lint failed');
    expect(first.text).toContain('Docs: Links failed');
    expect(after(p, first).text).toBeNull();
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
    const again = { ...job('Lint', 'FAILURE'), url: 'https://x/run/2/Lint' };
    expect(after(pull([ci([again])]), first).text).toContain('https://x/run/2/Lint');
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
    expect(after(passed, first).text).toBeNull();
    expect(after(passed, {}, push).text).toContain(
      'The checks on the push to feat/x on o/r passed.',
    );
    const early = wakeOf(pr, passed, verdictAt(passed), { told: ['k'] }, { isEarly: true });
    expect(early).toEqual({ text: null, told: [], heard: { since: null, keys: [] } });
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
    expect(after(p)).toEqual({ text: null, told: [], heard: undefined });
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

  test('a failed merge never settles: it stays, read each minute until a re-run passes', () => {
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
