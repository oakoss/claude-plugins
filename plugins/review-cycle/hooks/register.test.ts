import { describe, expect, test } from 'claude-code/testing';

import {
  bash,
  contextOf,
  denied,
  DRY_FLAGS,
  endTurn,
  fakeStore,
  fakeWorld,
  finishLeg,
  github,
  has,
  keptRecord,
  legUnderWay,
  NEW_BRANCH,
  onMain,
  pushing,
  queue,
  ran,
  RECEIPT,
  reloadInto,
  REMOTE,
  remoteSide,
  review,
  reviewerChanges,
  say,
  settle,
  startSession,
  statusOf,
  stops,
  type Run,
  type World,
} from './fixtures';

// consent.ts offeredTargets reads the offer only as an answer's whole last
// paragraph, unquoted.
const OWN_PARAGRAPH = (branch: string) =>
  `alone in its last paragraph, without quotation marks, then end your turn; their answer decides. The question: Push to \`${branch}\`? The command:`;

describe('commands that neither commit nor push', () => {
  test('pass', async ($, on) => {
    fakeWorld(on);
    expect(ran(await bash($, 'ls'))).toBe(true);
  });
  test('a commit hidden in a shell is refused', async ($, on) => {
    fakeWorld(on);
    expect(denied(await bash($, "bash -c 'git commit -m x'"), 'run')).toBe(true);
  });
});

describe('asked for?', () => {
  test('a reviewed commit goes through without a request or a question', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -m x'))).toBe(true);
    expect(w.asked).toBeUndefined();
  });
  test('a request from a peer session grants nothing', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it', 'peer');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
  });
  test('a commit request does not grant a push', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
  });
  test('a push the user asked for goes through', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a merge needs neither a request nor a review', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git merge topic'))).toBe(true);
    expect(w.asked).toBeUndefined();
  });
});

describe('reviewed?', () => {
  test('a commit no reviewer saw is refused, judged on a scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'commit it');
    const r = await bash($, 'git add -A && git commit -m x');
    expect(denied(r, 'never reviewed: a.ts')).toBe(true);
    const add = w.calls.find((c) => c.argv.join(' ') === 'git -C . add -A');
    expect(add?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('commit -a replays add -u on the scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'commit it');
    await bash($, 'git commit -am x');
    const update = w.calls.find((c) => c.argv.join(' ') === 'git add -u');
    expect(update?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('a reviewed, asked-for commit goes through', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
  test('a --continue no reviewer saw is refused, judged on a scratch index', async ($, on) => {
    fakeWorld(on);
    await say($, 'finish the rebase');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, 'never reviewed: a.ts')).toBe(true);
    expect(denied(r, 'then continue')).toBe(true);
  });
  test('a reviewed --continue goes through, its add replayed on a scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    await say($, 'finish the rebase');
    expect(ran(await bash($, 'git add -A && GIT_EDITOR=true git merge --continue'))).toBe(true);
    const add = w.calls.find((c) => c.argv.join(' ') === 'git -C . add -A');
    expect(add?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('a --continue is judged against HEAD, which the rebase already picked', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    await say($, 'finish the rebase');
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('a --continue with unresolved conflicts names them', async ($, on) => {
    let judging = false;
    fakeWorld(on, {
      git: (a) =>
        judging && a === 'git write-tree'
          ? {
              exitCode: 128,
              stderr: `a.ts: unmerged (${'e'.repeat(40)})\nfatal: git-write-tree: error building trees`,
            }
          : null,
    });
    await review($);
    await say($, 'finish the rebase');
    judging = true;
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, 'conflicts are still unresolved, starting with a.ts (')).toBe(true);
    expect(denied(r, '`git add` or `git rm` them')).toBe(true);
  });
  test('an edit after the review is refused as edited after review', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    w.work = { 'a.ts': 'two' };
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'edited after the last review: a.ts')).toBe(true);
  });
  test('an edit while the reviewer ran is not covered', async ($, on) => {
    const w = fakeWorld(on);
    await review($, {
      during: () => {
        w.work = { 'a.ts': 'two' };
      },
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'a.ts')).toBe(true);
  });
  const notReviews: [string, Parameters<typeof review>[1]][] = [
    ['cleanup', { type: 'review-cycle:cleanup' }],
    ['a leg with no receipt', { answer: 'Looks fine.' }],
    ['a leg spawned by another leg', { parentAgentId: 'leg-x' }],
    ['a leg working outside the repository', { cwd: '/tmp/elsewhere' }],
    ['another plugin', { type: 'pr-review-toolkit:code-reviewer' }],
  ];
  for (const [name, opts] of notReviews) {
    test(`${name} does not count as a review`, async ($, on) => {
      fakeWorld(on);
      await review($, opts);
      await say($, 'commit it');
      expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
    });
  }
  test('legs review-pr spawns do not count', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await review($);
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test('a spawn whose tree could not be read does not count', async ($, on) => {
    let spawning = true;
    fakeWorld(on, { fail: (a) => spawning && a === 'mktemp' });
    const r = await ($ as any).agent.spawn({
      tool_use_id: 'x',
      subagentType: 'review-cycle:code-reviewer',
      prompt: 'review',
      description: 'review',
      background: true,
    });
    spawning = false;
    await $.turn.complete({
      answer: RECEIPT,
      durationMs: 1,
      isAborted: false,
      turnId: 'turn-x',
      agentId: r.agentId,
      reason: 'answer',
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test('a tree the check cannot build is refused with the git error that stopped it', async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a === 'git write-tree' });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(await bash($, 'git commit -am x'), 'git write-tree failed: fatal: injected'),
    ).toBe(true);
  });
  test("a replayed git add that fails is refused with git's error", async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a === 'git -C . add a.ts' });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(await bash($, 'git add a.ts && git commit -m x'), 'git add failed: fatal: injected'),
    ).toBe(true);
  });
  test('a reviewed tree git cannot diff covers nothing', async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a.includes('--literal-pathspecs') });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'a.ts')).toBe(true);
  });
});

describe('where the commit lands', () => {
  test("a subagent's commit is refused", async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    const r = await bash($, 'git commit -m x', { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit')).toBe(true);
  });
  test('a commit in another repository is not this gate', async ($, on) => {
    fakeWorld(on, {
      toplevel: (a) =>
        a.startsWith('git -C /tmp/fixture rev-parse')
          ? '/tmp/fixture\n/tmp/fixture/.git\n'
          : undefined,
    });
    expect(ran(await bash($, 'git -C /tmp/fixture commit -m x'))).toBe(true);
  });
  test('a push from another worktree of this repository is refused', async ($, on) => {
    fakeWorld(on, {
      toplevel: (a) => (a.startsWith('git -C ../wt rev-parse') ? '/wt\n/repo/.git\n' : undefined),
    });
    await say($, 'push it');
    expect(denied(await bash($, 'git -C ../wt push'), 'another worktree')).toBe(true);
  });
  test('a target git cannot resolve is refused, not waved through', async ($, on) => {
    fakeWorld(on, { fail: (a) => a.startsWith('git -C /nope rev-parse') });
    await say($, 'commit it');
    expect(
      denied(
        await bash($, 'git -C /nope commit -m x'),
        'so it is refused. Tell the user what failed and stop; suggest running the step outside the gate only if they ask.',
      ),
    ).toBe(true);
  });
});

describe('after the command', () => {
  const HEAD = 'c'.repeat(40);
  const THEIRS = 'd'.repeat(40);
  const UP = 'a'.repeat(40);
  // A snapshot exists, so the only notes are about what the command did.
  const quiet = { shellAliases: '' };

  test('a commit a script made without a review is reported', async ($, on) => {
    fakeWorld(on, {
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, 'records content no reviewer saw (never reviewed: a.ts)')).toBe(true);
    expect(has(context, 'did not go through the commit gate')).toBe(true);
  });
  for (const message of [
    'checkout: moving from main to topic',
    `reset: moving to ${THEIRS}`,
    'pull --ff-only: Fast-forward',
    'merge origin/main: Fast-forward',
    'rebase (finish): returning to refs/heads/main',
  ]) {
    test(`HEAD moved by "${message}" is not a commit`, async ($, on) => {
      fakeWorld(on, {
        ...quiet,
        commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'other' } },
        shell(this: World) {
          this.head = THEIRS;
          this.headLog = [`${THEIRS} ${message}`];
        },
      });
      expect(contextOf(await bash($, './move.sh'))).toEqual([]);
    });
  }
  test('a side-branch commit is judged apart from a reviewed one on this branch', async ($, on) => {
    const SIDE = 'b'.repeat(40);
    fakeWorld(on, {
      ...quiet,
      commits: {
        [HEAD]: { 'a.ts': 'zero' },
        [SIDE]: { 'a.ts': 'zero', 's.ts': 'side' },
        [THEIRS]: { 'a.ts': 'one' },
      },
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} commit: main`,
          `${HEAD} checkout: moving from side to main`,
          `${SIDE} commit: side`,
          `${HEAD} checkout: moving from main to side`,
          ...(this.headLog ?? []),
        ];
      },
    });
    await review($);
    const context = contextOf(await bash($, './two.sh'));
    expect(has(context, 'records content no reviewer saw (never reviewed: s.ts)')).toBe(true);
  });
  test('a commit on another branch is reported after HEAD comes back', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.headLog = [
          `${HEAD} checkout: moving from side to main`,
          `${THEIRS} commit: side`,
          `${HEAD} checkout: moving from main to side`,
          ...(this.headLog ?? []),
        ];
      },
    });
    const context = contextOf(await bash($, './side.sh'));
    // Judged at the side commit, not at the HEAD it returned to.
    expect(
      has(
        context,
        `commit ${THEIRS.slice(0, 12)} records content no reviewer saw (never reviewed: a.ts)`,
      ),
    ).toBe(true);
  });
  test('a pull that merges records a commit', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'merged' } },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} pull: Merge made by the 'ort' strategy.`];
      },
    });
    expect(has(contextOf(await bash($, './sync.sh')), 'records content no reviewer saw')).toBe(
      true,
    );
  });
  // The working tree, which the review covers, holds `one`.
  const MID = 'b'.repeat(40);
  const resolved = {
    [HEAD]: { 'a.ts': 'zero' },
    [MID]: { 'a.ts': 'one' },
    [THEIRS]: { 'a.ts': 'two' },
  };
  test("a --continue's resolution a pre-commit hook changed is reported", async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} commit (cherry-pick): t1`];
      },
    });
    await review($);
    await say($, 'finish it');
    const context = contextOf(await bash($, 'GIT_EDITOR=true git cherry-pick --continue'));
    expect(has(context, 'A pre-commit hook may have changed it')).toBe(true);
  });
  test("a rebase's changed resolution is reported without blaming a pre-commit hook", async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} rebase (continue): t1`];
      },
    });
    await review($);
    await say($, 'finish it');
    const context = contextOf(await bash($, 'GIT_EDITOR=true git rebase --continue'));
    expect(
      has(
        context,
        "records content no reviewer saw (edited after the last review: a.ts). It changed after the gate's check.",
      ),
    ).toBe(true);
    expect(has(context, 'pre-commit')).toBe(false);
  });
  test('the picks a --continue replays after its resolution are not reported', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} rebase (finish): returning to refs/heads/topic`,
          `${THEIRS} rebase (pick): t2`,
          `${MID} rebase (continue): t1`,
        ];
      },
    });
    await review($);
    await say($, 'finish it');
    expect(contextOf(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toEqual([]);
  });
  test('a rebase is judged from the commit it rebased onto', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: {
        [HEAD]: { 'a.ts': 'zero' },
        [UP]: { 'a.ts': 'zero', 'b.ts': 'upstream' },
        [THEIRS]: { 'a.ts': 'one', 'b.ts': 'upstream' },
      },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} pull --rebase (finish): returning to refs/heads/main`,
          `${THEIRS} pull --rebase (pick): local`,
          `${UP} pull --rebase (start): checkout ${UP}`,
        ];
      },
    });
    const context = contextOf(await bash($, './sync.sh'));
    // b.ts came from upstream, so only the rebased change is unreviewed.
    expect(has(context, 'records content no reviewer saw (never reviewed: a.ts)')).toBe(true);
  });
  test('a gh stack rebase or sync is watched as a history step, so its replayed commits are not reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: {
        [HEAD]: { 'a.ts': 'zero' },
        [UP]: { 'a.ts': 'zero', 'b.ts': 'upstream' },
        [THEIRS]: { 'a.ts': 'one', 'b.ts': 'upstream' },
      },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} rebase (finish): returning to refs/heads/topic`,
          `${THEIRS} rebase (pick): local`,
          `${UP} rebase (start): checkout ${UP}`,
        ];
      },
    });
    await say($, 'force push with lease');
    expect(contextOf(await bash($, 'gh stack rebase --upstack'))).toEqual([]);
    expect(contextOf(await bash($, 'gh stack sync'))).toEqual([]);
    expect(contextOf(await bash($, 'gh -R o/r stack sync'))).toEqual([]);
    expect(
      denied(await bash($, 'gh stack rebase && ./deploy.sh'), 'only as their own command'),
    ).toBe(true);
  });
  test('a commit built with plumbing and reached by a reset is not seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} reset: moving to ${THEIRS}`];
      },
    });
    expect(contextOf(await bash($, './plumb.sh'))).toEqual([]);
  });
  test('a HEAD that moved without a reflog entry is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headLogOff: true,
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    expect(has(contextOf(await bash($, './ship.sh')), 'HEAD moved without a reflog entry')).toBe(
      true,
    );
  });
  test('a reflog that no longer reaches the start is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} commit: other history`];
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'does not reach where the command began'),
    ).toBe(true);
  });
  test("a failed read of HEAD's reflog is reported", async ($, on) => {
    let after = false;
    fakeWorld(on, {
      ...quiet,
      fail: (a) => after && /^git log -g -n \d+ --date=raw/.test(a),
      shell() {
        after = true;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command committed'),
    ).toBe(true);
  });
  test('a HEAD that stops naming a commit is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.headMissing = true;
      },
    });
    expect(has(contextOf(await bash($, './break.sh')), 'HEAD no longer resolves')).toBe(true);
  });
  test('the first commit on an unborn branch is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headMissing: true,
      commits: { [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.headMissing = false;
        this.head = THEIRS;
      },
    });
    expect(has(contextOf(await bash($, './init.sh')), 'records content no reviewer saw')).toBe(
      true,
    );
  });
  test('a command that adds more entries than the gate reads is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          ...Array.from({ length: 201 }, (_, i) => `${THEIRS} commit: ${i}`),
          ...(this.headLog ?? []),
        ];
      },
    });
    expect(has(contextOf(await bash($, './many.sh')), 'which the gate does not read')).toBe(true);
  });
  test('a start that could not be read names why', async ($, on) => {
    fakeWorld(on, { ...quiet, fail: (a) => a.startsWith('git log -g -n 3') });
    expect(has(contextOf(await bash($, 'ls')), 'git log -g HEAD failed: fatal: injected')).toBe(
      true,
    );
  });
  test('a commit that lands while HEAD ends unborn is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headMissing: true,
      shell(this: World) {
        this.headLog = [
          `${THEIRS} checkout: moving from main to other`,
          `${THEIRS} commit (initial): x`,
        ];
      },
    });
    expect(has(contextOf(await bash($, './orphan.sh')), 'grew while HEAD ended unborn')).toBe(true);
  });
  test('an unborn HEAD whose log cannot be read is reported as unchecked', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true, logUnreadable: true });
    expect(has(contextOf(await bash($, 'ls')), "awk: can't open file")).toBe(true);
  });
  test('an unborn HEAD in a reftable repository is reported as unchecked', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true, reftable: true });
    expect(has(contextOf(await bash($, 'ls')), 'cannot be read while HEAD is unborn')).toBe(true);
  });
  test('an unborn HEAD that stays unborn is not reported', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true });
    expect(contextOf(await bash($, 'ls'))).toEqual([]);
  });
  test('a new commit whose tree cannot be read is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      fail: (a) => a === `git rev-parse ${THEIRS}^{tree}`,
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), `could not check commit ${THEIRS.slice(0, 12)}`),
    ).toBe(true);
  });

  test('a commit a script made and pushed is reported, push included', async ($, on) => {
    fakeWorld(on, {
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.head = THEIRS;
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} update by push`, `${HEAD} update by push`],
        };
      },
    });
    const context = contextOf(await bash($, './ship.sh'));
    expect(has(context, 'records content no reviewer saw')).toBe(true);
    expect(has(context, 'pushed to origin/main without the user')).toBe(true);
  });
  test('a push the gate did not see is reported unless the user asked for one', async ($, on) => {
    const w = fakeWorld(on, {
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} update by push`, `${HEAD} fetch`],
        };
      },
    });
    const unasked = contextOf(await bash($, './ship.sh'));
    expect(has(unasked, 'pushed to origin/main without the user')).toBe(true);
    w.refs = { 'refs/remotes/origin/main': HEAD };
    await say($, 'push it');
    expect(contextOf(await bash($, './ship.sh'))).toEqual([]);
  });
  test('a push that creates a remote-tracking ref is seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/side': THEIRS };
        this.reflogs = { 'refs/remotes/origin/side': [`${THEIRS} update by push`] };
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'pushed to origin/side without the user'),
    ).toBe(true);
  });
  test('a push from a fresh clone, whose reflog starts at the push, is seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = { 'refs/remotes/origin/main': [`${THEIRS} update by push`] };
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'pushed to origin/main without the user'),
    ).toBe(true);
  });
  test('a fetch after an earlier push is not a push', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} fetch: fast-forward`, `${HEAD} update by push`],
        };
      },
    });
    expect(contextOf(await bash($, 'git fetch'))).toEqual([]);
  });
  test('a renamed remote is not a push', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/upstream/main': HEAD };
        this.reflogs = {
          'refs/remotes/upstream/main': [
            `${HEAD} remote: renamed refs/remotes/origin/main to refs/remotes/upstream/main`,
            `${HEAD} update by push`,
          ],
        };
      },
    });
    expect(contextOf(await bash($, 'git remote rename origin upstream'))).toEqual([]);
  });
  test('a symbolic remote-tracking ref is not read', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.refLines = [`${THEIRS}\trefs/remotes/origin/main\trefs/remotes/origin/HEAD`];
        this.reflogs = { 'refs/remotes/origin/HEAD': [`${THEIRS} update by push`] };
      },
    });
    expect(contextOf(await bash($, './ship.sh'))).toEqual([]);
  });
  test('a reflog that cannot be read hides neither the push check nor the commit', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      refs: { 'refs/remotes/origin/main': HEAD },
      fail: (a) => a.startsWith('git log -g -n 50'),
      shell(this: World) {
        this.head = THEIRS;
        this.refs = { 'refs/remotes/origin/main': THEIRS };
      },
    });
    const context = contextOf(await bash($, './ship.sh'));
    expect(has(context, 'could not check whether this command pushed')).toBe(true);
    expect(has(context, 'records content no reviewer saw')).toBe(true);
  });
  test('refs that cannot be read are reported, not passed over', async ($, on) => {
    fakeWorld(on, { ...quiet, fail: (a) => a.startsWith('git for-each-ref') });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command committed'),
    ).toBe(true);
  });
  test('refs unreadable after the command are reported as an unchecked push', async ($, on) => {
    let after = false;
    fakeWorld(on, {
      ...quiet,
      fail: (a) => after && a.startsWith('git for-each-ref'),
      shell() {
        after = true;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command pushed'),
    ).toBe(true);
  });
});

describe('the off switch', () => {
  test('only the user can change it', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.enabled',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
    const byUser = await $.config.set({ ...change, origin: { kind: 'composer' } });
    expect(byUser).toEqual({ value: false });
  });
});

describe('the status tool', () => {
  test('reports uncovered paths and whether a push was asked for', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.uncovered).toEqual([{ path: 'a.ts', state: 'never-reviewed' }]);
    expect(status.pushRequested).toBe(true);
    expect(status.error).toBe(null);
    expect(status.snapshot).toMatch(/^[0-9a-f]{64}$/);
  });
  test('reports no push request for a message without one', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    expect(JSON.parse((r as { result: string }).result).pushRequested).toBe(false);
  });
});

describe('what the gate reports', () => {
  test('a review that could not be counted is named in the refusal', async ($, on) => {
    fakeWorld(on);
    await review($, { answer: 'Looks fine.' });
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'did not open with the execution receipt')).toBe(true);
  });
  test('a merge that brings in unreviewed content gets no review note', async ($, on) => {
    const next = 'd'.repeat(40);
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, [next]: { 'a.ts': 'theirs' } },
      shell(this: World) {
        this.head = next;
      },
    });
    await say($, 'commit it');
    const r = await bash($, 'git merge topic');
    expect(ran(r)).toBe(true);
    expect((r as { context?: string[] }).context ?? []).toEqual([]);
  });
  test('a plain command runs with a note when the gate cannot watch it', async ($, on) => {
    fakeWorld(on, {
      fail: (a) => a.startsWith('git rev-parse --path-format=absolute --show-toplevel'),
    });
    const r = await bash($, 'ls');
    expect(ran(r)).toBe(true);
    const context = (r as { context?: string[] }).context ?? [];
    expect(context.some((c) => c.includes('could not watch this command'))).toBe(true);
  });
  test('a stack rebase the gate cannot watch is refused', async ($, on) => {
    fakeWorld(on, {
      fail: (a) => a.startsWith('git rev-parse --path-format=absolute --show-toplevel'),
    });
    expect(denied(await bash($, 'gh stack rebase'), 'the gate failed')).toBe(true);
  });
  test('a stack help request the gate cannot watch runs with a note', async ($, on) => {
    fakeWorld(on, {
      fail: (a) => a.startsWith('git rev-parse --path-format=absolute --show-toplevel'),
    });
    const r = await bash($, 'gh stack rebase --help');
    expect(ran(r)).toBe(true);
    const context = (r as { context?: string[] }).context ?? [];
    expect(context.some((c) => c.includes('could not watch this command'))).toBe(true);
  });
});

describe('failures while judging a commit refuse it, naming the cause', () => {
  const failures: [string, (a: string) => boolean, string][] = [
    [
      'the changed-path diff',
      (a) => a.includes('diff-tree') && a.includes(' -- . '),
      // Closed by the refusal's `)`, so `HEAD's parent` does not match.
      'could not compare the tree this commit would record with HEAD)',
    ],
    ['write-tree', (a) => a === 'git write-tree', 'git write-tree failed: fatal: injected'],
    ['the replayed add', (a) => a === 'git -C . add -A', 'git add failed: fatal: injected'],
    ['add -u for commit -a', (a) => a === 'git add -u', 'git add -u failed: fatal: injected'],
    [
      'reading HEAD',
      (a) => a === 'git rev-parse --verify -q HEAD^{commit}',
      'git rev-parse HEAD failed: fatal: injected',
    ],
    ['mktemp', (a) => a === 'mktemp', 'mktemp failed: fatal: injected'],
    [
      'the index path',
      (a) => a.includes('--git-path index'),
      'git rev-parse --git-path index failed: fatal: injected',
    ],
    [
      'the index copy',
      (a) => a.startsWith('sh -c') && a.includes('/repo/.git/index'),
      'copying the index failed: fatal: injected',
    ],
  ];
  for (const [name, fail, cause] of failures) {
    test(name, async ($, on) => {
      let judging = false;
      const w = fakeWorld(on);
      w.fail = (a) => judging && fail(a);
      await review($);
      await say($, 'commit it');
      judging = true;
      const r = await bash(
        $,
        name === 'the replayed add' ? 'git add -A && git commit -m x' : 'git commit -am x',
      );
      expect(denied(r, cause)).toBe(true);
    });
  }
  test('a write-tree that prints no tree id says what it printed', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on);
    w.git = (a) => (judging && a === 'git write-tree' ? { stdout: 'garbage\n' } : null);
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'printed no tree id: garbage')).toBe(true);
  });
  test('a step that fails with no error output gives its exit code', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on);
    w.git = (a) =>
      judging && a === 'git write-tree' ? { exitCode: 128, stdout: '', stderr: '' } : null;
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'git write-tree failed: exit 128')).toBe(true);
  });
  test('an amend whose parent tree cannot be read says so', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    let judging = false;
    const w = fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    w.fail = (a) => judging && a === `git rev-parse ${parent}^{tree}`;
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git commit --amend --no-edit'),
        "could not read the tree of HEAD's parent",
      ),
    ).toBe(true);
  });
  test('a failed add -A builds no working tree, and says why', async ($, on) => {
    const w = fakeWorld(on);
    w.fail = (a) => a === 'git add -A';
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.worktreeTree).toBe(null);
    expect(status.error).toBe('git add -A failed: fatal: injected');
  });
  test("a reviewer whose finishing tree cannot be built is dropped with git's reason", async ($, on) => {
    let finishing = false;
    fakeWorld(on, { fail: (a) => finishing && a === 'git add -A' });
    await review($, {
      during: () => {
        finishing = true;
      },
    });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.droppedReviews).toEqual([
      'review-cycle:code-reviewer: git add -A failed: fatal: injected',
    ]);
  });
  test("a leg's counted report clears its earlier drop", async ($, on) => {
    fakeWorld(on);
    await review($, { answers: ['Waiting for the hook tests.', RECEIPT] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.reviews).toBe(1);
    expect(status.droppedReviews).toEqual([]);
  });
  test('an answer after a counted report drops nothing', async ($, on) => {
    fakeWorld(on);
    await review($, { answers: [RECEIPT, 'Anything else?'] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.reviews).toBe(1);
    expect(status.droppedReviews).toEqual([]);
  });
  test('a leg that reports without a receipt again is listed once', async ($, on) => {
    fakeWorld(on);
    await review($, { answers: ['Waiting.', 'Still waiting.'] });
    await review($, { type: 'review-cycle:pr-test-analyzer', answers: ['Waiting.'] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.droppedReviews).toEqual([
      'review-cycle:code-reviewer: its report did not open with the execution receipt',
      'review-cycle:pr-test-analyzer: its report did not open with the execution receipt',
    ]);
  });
  test("a failed comparison on an amend names HEAD's parent", async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    let judging = false;
    const w = fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    w.fail = (a) => judging && a.includes('diff-tree') && a.includes(' -- . ');
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git commit --amend --no-edit'),
        "could not compare the tree this commit would record with HEAD's parent",
      ),
    ).toBe(true);
  });
  test('a failed comparison on an unborn branch names the empty tree', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on, { headMissing: true, work: { 'a.ts': 'one' } });
    w.fail = (a) => judging && a.includes('diff-tree') && a.includes(' -- . ');
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git add -A && git commit -m first'),
        'could not compare the tree this commit would record with the empty tree',
      ),
    ).toBe(true);
  });
  test('a runner that rejects is named by its step, and not read as unreadable', async ($, on) => {
    const w = fakeWorld(on);
    w.reject = (a) => a === 'git write-tree';
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.error).toContain('git write-tree failed');
    expect(status.error).toContain('timed out');
  });
});

describe('what a commit records', () => {
  test('an amend is judged against the parent, so unreviewed HEAD content is refused', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit --amend --no-edit'), 'never reviewed: a.ts')).toBe(
      true,
    );
  });
  test('paths the committed config ignores need no review', async ($, on) => {
    const config = '{"ignore":["dist/**"]}';
    fakeWorld(on, {
      work: { 'a.ts': 'zero', 'dist/x.js': 'built', '.claude/review-cycle.json': config },
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero', '.claude/review-cycle.json': config } },
    });
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
  test('the config itself always needs review, whatever it ignores', async ($, on) => {
    fakeWorld(on, {
      work: { 'a.ts': 'zero', '.claude/review-cycle.json': '{"ignore":["**"]}' },
    });
    await say($, 'commit it');
    const r = await bash($, 'git add -A && git commit -m x');
    expect(denied(r, '.claude/review-cycle.json')).toBe(true);
  });
  test('an ignore entry cannot excuse anything until it is reviewed itself', async ($, on) => {
    fakeWorld(on, {
      work: { 'a.ts': 'one', '.claude/review-cycle.json': '{"ignore":["**"]}' },
    });
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'never reviewed: .claude/review-cycle.json')).toBe(true);
  });
  test('tracker state needs no review', async ($, on) => {
    fakeWorld(on, { work: { 'a.ts': 'zero', '.beads/issues.jsonl': 'x' } });
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
});

describe('consent through the session', () => {
  test("yes to the agent's push question grants the push", async ($, on) => {
    const w = fakeWorld(on);
    await ($ as any).turn.complete({
      answer: 'Committed.\n\nPush `fix/x` to `origin`?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(w.asked).toBeUndefined();
  });
});

describe('the question dialog', () => {
  test(
    "another plugin's dialog grants nothing",
    {
      plugins: [
        {
          name: 'other',
          register(on) {
            on('prompt.submit', async ($, e, next) => {
              await $.ui.ask('Which phrase should the docs quote?', ['Push changes', 'Other']);
              return next(e);
            });
          },
        },
      ],
    },
    async ($, on) => {
      fakeWorld(on, { dialog: { 'Which phrase should the docs quote?': 'Push changes' } });
      await say($, 'raise the dialog');
      expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
    },
  );
  test("the agent's own dialog grants nothing", async ($, on) => {
    const w = fakeWorld(on, {
      dialog: (q) => (q.question === 'Push the branch?' ? 'Push' : undefined),
    });
    await ($ as any).tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: 'Push the branch?', options: [{ label: 'Push' }] }],
    });
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
    expect(w.asked).toHaveLength(1);
  });
});

describe('a push the user did not ask for', () => {
  test('is refused with a request to ask in the reply, and no dialog', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, "the user's latest message doesn't ask for a push, so nothing ran.")).toBe(
      true,
    );
    expect(denied(r, 'the question mcp__review-cycle__offer gives for step push,')).toBe(true);
    expect(denied(r, 'The command: git push origin fix/x')).toBe(true);
    expect(w.asked).toBeUndefined();
  });
  test('runs once the next message says yes to the question', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    await ($ as any).turn.complete({
      answer: 'Fixed.\n\nPush `fix/x` to `origin`?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });
  test('stays refused when the next message asks for something else', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    await ($ as any).turn.complete({
      answer: 'Fixed.\n\nPush `fix/x` to `origin`?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'not yet, rename the helper first');
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });
  test('a reviewed commit with it is refused whole, naming the commit on its own', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x && git push');
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a reviewed --continue with it is refused without naming a commit', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue && git push');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, 'run the commit on its own')).toBe(false);
  });
  test('a push alone does not mention a commit', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), 'To commit without pushing')).toBe(false);
  });
  test('names what a shell alias expands to', async ($, on) => {
    fakeWorld(on, { shellAliases: "alias -- ship='git push --force origin main'\n" });
    await say($, 'fix the parser');
    expect(
      denied(
        await bash($, 'ship'),
        'The command: ship (aliases expanded: git push --force origin main)',
      ),
    ).toBe(true);
  });
  test('quotes only the start of a long command', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    const r = await bash($, `git push origin ${'x'.repeat(400)}`);
    expect(denied(r, `The command: git push origin ${'x'.repeat(284)}…`)).toBe(true);
    expect(denied(r, 'x'.repeat(286))).toBe(false);
  });
  test('a commit no reviewer saw is refused for the review first', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git commit -am x && git push'), 'never reviewed')).toBe(true);
  });
  test('a dry run needs neither a review nor a request', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit --dry-run -am x'))).toBe(true);
  });
  test('a push typed into the running turn grants it', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    await ($ as any).prompt.submit({
      text: 'push it',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 't',
    });
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a request typed into the running turn keeps its push and adds to it', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    await queue($, 'Lets file the beads');
    expect(ran(await bash($, 'git push'))).toBe(true);
    await queue($, 'also open a PR');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  for (const text of ['wait, rename the helper first', "wait, don't push", 'stop', 'please stop']) {
    test(`a hold typed into the running turn drops the push: ${text}`, async ($, on) => {
      fakeWorld(on);
      await say($, 'ship it');
      await queue($, text);
      expect(ran(await bash($, 'git push'))).toBe(false);
    });
  }
  test('a request typed in while the gate checks a push stops it once; the retry runs', async ($, on) => {
    let typed = false;
    fakeWorld(on, {
      git: (a) => {
        if (!typed && a.startsWith('git for-each-ref')) {
          typed = true;
          void queue($, 'Lets file the beads');
        }
        return null;
      },
    });
    await say($, 'ship it');
    expect(denied(await bash($, 'git push'), 'sent a new message')).toBe(true);
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a shell alias that runs another program for git is refused first', async ($, on) => {
    fakeWorld(on, { shellAliases: "alias -- git='hub'\n" });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), '`git` is a shell alias here (for `hub`)')).toBe(true);
  });
});

describe('a force push', () => {
  test('a push request does not cover it; one that names a force does', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    const r = await bash($, 'git push --force-with-lease origin fix/x');
    expect(denied(r, "doesn't ask for a force push")).toBe(true);
    expect(denied(r, '"Force-push `fix/x` to `origin` with a lease?"')).toBe(true);
    await say($, 'force push it');
    expect(ran(await bash($, 'git push --force-with-lease origin fix/x'))).toBe(true);
  });
  test('a bare --force points to the lease unless named', async ($, on) => {
    fakeWorld(on);
    await say($, 'force push it');
    const r = await bash($, 'git push --force origin fix/x');
    expect(denied(r, 'Use `--force-with-lease --force-if-includes` instead;')).toBe(true);
    expect(denied(r, 'without a lease?"')).toBe(true);
    expect(denied(await bash($, 'git push origin +fix/x'), 'a bare --force')).toBe(true);
    await say($, 'force push it without a lease');
    expect(ran(await bash($, 'git push --force origin fix/x'))).toBe(true);
  });
  test('with no request at all, the bare refusal says the lease needs one too', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push -f'), 'which also needs their request')).toBe(true);
  });
  test('a commit with a force push is told to run on its own', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'push it');
    const r = await bash($, 'git commit -am x && git push --force-with-lease');
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
    expect(denied(r, "doesn't ask for a force push")).toBe(true);
  });
});

describe('a push the user asked for', () => {
  test('"delete the branch" deletes a remote branch', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push origin --delete fix/x'))).toBe(false);
    await say($, 'delete the branch');
    expect(ran(await bash($, 'git push origin --delete fix/x'))).toBe(true);
  });
  test('a branch delete asked for beside a named tag still deletes', async ($, on) => {
    fakeWorld(
      on,
      pushing({
        git: remoteSide({ 'origin --delete fix/x': ['-\t:refs/heads/fix/x\t[deleted]'] }),
      }),
    );
    await say($, 'push the v1.2.0 tag and delete the branch');
    expect(ran(await bash($, 'git push origin --delete fix/x'))).toBe(true);
  });
  test('"ship them" pushes and opens the pull request', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(false);
    await say($, 'ok, lets ship them');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
  });
  test('is not reported as one the user did not ask for', async ($, on) => {
    const head = 'c'.repeat(40);
    const theirs = 'd'.repeat(40);
    fakeWorld(on, {
      refs: { 'refs/remotes/origin/main': head },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': theirs };
        this.reflogs = {
          'refs/remotes/origin/main': [`${theirs} update by push`, `${head} fetch`],
        };
      },
    });
    await say($, 'push it');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    // This world answers no dry run, so the only note says where it went is unchecked.
    expect(contextOf(r)).toEqual([
      'review-cycle ran the push the user asked for without fully checking where it goes: its dry run named no ref it would update. If it may have reached the default branch or a tag they did not name, tell them.',
    ]);
  });
  test('a reviewed commit beside it is not reported either', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([]);
  });
  test('a commit records the review rounds since the last one', async ($, on) => {
    fakeStore(on);
    const w = fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'two' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    const status = async () =>
      JSON.parse(((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result);
    await review($);
    await review($);
    w.work = { 'a.ts': 'two' };
    await review($);
    const before = await status();
    expect(before.roundsSinceCommit).toBe(2);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const after = await status();
    expect(after.rounds).toEqual([{ commit: 'd'.repeat(12), rounds: 2, date: expect.any(String) }]);
    expect(after.roundsSinceCommit).toBe(0);
  });
  test("a commit ends the cycle its legs' drops and changes belong to", async ($, on) => {
    fakeStore(on);
    let isReading = false;
    let lands = false;
    fakeWorld(on, {
      commits: {
        ['c'.repeat(40)]: { 'a.ts': 'zero' },
        ['d'.repeat(40)]: { 'a.ts': 'one' },
        ['e'.repeat(40)]: { 'a.ts': 'zero' },
      },
      fail: (a) => isReading && a === 'git add -A',
      shell(this: World, c: string) {
        if (c === 'ls') isReading = true;
        if (c.startsWith('git commit') && lands) this.head = 'd'.repeat(40);
        if (c === './release.sh') this.head = 'e'.repeat(40);
      },
    });
    const lists = async () => {
      const s = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
      return [s.droppedReviews.length, s.reviewerChanges.length];
    };
    await review($, { answer: 'Looks fine.' });
    const leg = await legUnderWay($);
    await bash($, 'ls', { agentId: leg });
    isReading = false;
    await finishLeg($, leg, false);
    await review($);
    expect(await lists()).toEqual([1, 1]);
    await say($, 'commit it');
    // A commit that does not land, and one the gate did not judge, end nothing.
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    expect(await lists()).toEqual([1, 1]);
    expect(ran(await bash($, './release.sh'))).toBe(true);
    expect(await lists()).toEqual([1, 1]);
    lands = true;
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    expect(await lists()).toEqual([0, 0]);
  });
  test('a commit while a leg still runs keeps the lists for the review to read', async ($, on) => {
    fakeStore(on);
    let isReading = false;
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      fail: (a) => isReading && a === 'git add -A',
      shell(this: World, c: string) {
        if (c === 'ls') isReading = true;
        if (c.startsWith('git commit')) this.head = 'd'.repeat(40);
      },
    });
    await review($, { answer: 'Looks fine.' });
    await review($);
    const leg = await legUnderWay($);
    await bash($, 'ls', { agentId: leg });
    isReading = false;
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const s = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect([s.droppedReviews.length, s.reviewerChanges.length]).toEqual([1, 1]);
  });
  test('a review-pr leg still running does not hold the lists past a commit', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World, c: string) {
        if (c.startsWith('git commit')) this.head = 'd'.repeat(40);
      },
    });
    await review($, { answer: 'Looks fine.' });
    await review($);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await legUnderWay($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const s = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(s.droppedReviews).toEqual([]);
  });
  test('rounds are recorded only for a commit or --continue the gate judged', async ($, on) => {
    fakeStore(on);
    let moves = false;
    let next = 'd';
    const w = fakeWorld(on, {
      commits: {
        ['c'.repeat(40)]: { 'a.ts': 'zero' },
        ['d'.repeat(40)]: { 'a.ts': 'one' },
        ['e'.repeat(40)]: { 'a.ts': 'one' },
        ['f'.repeat(40)]: { 'a.ts': 'one' },
      },
      shell(this: World) {
        if (moves) this.head = next.repeat(40);
      },
    });
    const status = async () => {
      const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
      return JSON.parse(r.result);
    };
    await review($);
    await say($, 'commit it');
    // Nothing to commit: HEAD stays, so the round still waits for its commit.
    expect(ran(await bash($, 'git commit -m x'))).toBe(true);
    const held = await status();
    expect([held.rounds, held.roundsSinceCommit]).toEqual([[], 1]);
    // A script's commit is not judged, so its rounds go to the next one recorded.
    moves = true;
    expect(ran(await bash($, './release.sh'))).toBe(true);
    const scripted = await status();
    expect([scripted.rounds, scripted.roundsSinceCommit]).toEqual([[], 1]);
    // A --continue the gate judged records its rounds.
    next = 'e';
    w.work = { 'a.ts': 'one', 'b.ts': 'new' };
    await review($);
    w.commits['e'.repeat(40)] = { ...w.work };
    await say($, 'finish the merge');
    expect(ran(await bash($, 'git add -A && GIT_EDITOR=true git merge --continue'))).toBe(true);
    const continued = await status();
    expect(continued.rounds).toEqual([
      { commit: 'e'.repeat(12), rounds: 2, date: expect.any(String) },
    ]);
  });
  test('judged commits sent together record one entry for all of them', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      commits: {
        ['c'.repeat(40)]: { 'a.ts': 'zero' },
        ['d'.repeat(40)]: { 'a.ts': 'one' },
        ['e'.repeat(40)]: { 'a.ts': 'one' },
      },
      shell(this: World, command: string) {
        this.head = (command.endsWith(' a') ? 'd' : 'e').repeat(40);
      },
    });
    await review($);
    await say($, 'commit it');
    const [a, b] = await Promise.all([bash($, 'git commit -am a'), bash($, 'git commit -am b')]);
    expect([ran(a), ran(b)]).toEqual([true, true]);
    expect([contextOf(a), contextOf(b)]).toEqual([[], []]);
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    const { rounds } = JSON.parse(r.result);
    expect(rounds.map((x: { commit: string; rounds: number }) => [x.commit, x.rounds])).toEqual([
      [`${'c'.repeat(12)}..${'e'.repeat(12)}`, 1],
    ]);
  });
  test('a rounds record the store cannot take is named, and the commit still runs', async ($, on) => {
    fakeStore(on, { refuse: 'disk full' });
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), "could not record this commit's review rounds (1 round:")).toBe(true);
    const s = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    expect(JSON.parse(s.result).roundsSinceCommit).toBe(0);
  });
  test('a message the user sends while the gate reads the repository stops it', async ($, on) => {
    let armed = false;
    fakeWorld(on, {
      git: (a) => {
        if (armed && a.includes('for-each-ref')) {
          armed = false;
          void ($ as any).prompt.submit({
            text: 'stop',
            origin: { kind: 'composer' },
            wait: false,
            turnId: 't',
          });
        }
        return null;
      },
    });
    await say($, 'push it');
    armed = true;
    expect(denied(await bash($, 'git push'), 'while the gate was checking')).toBe(true);
  });
  test('a message during the review check of a commit and push stops both', async ($, on) => {
    let armed = false;
    fakeWorld(on, {
      git: (a) => {
        if (armed && a.includes('write-tree')) {
          armed = false;
          void ($ as any).prompt.submit({
            text: 'stop',
            origin: { kind: 'composer' },
            wait: false,
            turnId: 't',
          });
        }
        return null;
      },
    });
    await review($);
    await say($, 'commit and push');
    armed = true;
    expect(
      denied(await bash($, 'git commit -am x && git push'), 'while the gate was checking'),
    ).toBe(true);
  });
  test(
    'a call a hook above abandons does not run',
    {
      plugins: [
        {
          name: 'above',
          tier: 'prepend',
          register(on) {
            on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
              if (!e.command.includes('abandoned')) return next(e);
              // Gives up while the gate is still reading the repository.
              void next(e);
              return { deny: 'above' };
            });
          },
        },
      ],
    },
    async ($, on) => {
      const ranCommands: string[] = [];
      fakeWorld(on, {
        shell: (command) => {
          ranCommands.push(command);
        },
      });
      await say($, 'push it');
      expect(denied(await bash($, 'git push origin abandoned'), 'above')).toBe(true);
      await settle();
      expect(ranCommands).toEqual([]);
      expect(ran(await bash($, 'git push'))).toBe(true);
    },
  );
  test(
    'a GitHub MCP call a hook above abandons does not run',
    {
      plugins: [
        {
          name: 'above',
          tier: 'prepend',
          register(on) {
            on('tool.call', { tool: 'mcp__github__create_pull_request' }, async ($, e, next) => {
              void next(e);
              return { deny: 'above' };
            });
          },
        },
      ],
    },
    async ($, on) => {
      const calls: string[] = [];
      fakeWorld(on, {
        settings: { local: stops('never stop') },
        shell: (command) => {
          calls.push(command);
        },
      });
      await say($, 'fix the parser');
      expect(denied(await mcp($, 'mcp__github__create_pull_request', {}), 'above')).toBe(true);
      await settle();
      expect(calls).toEqual([]);
    },
  );
});

const tagLine = (v: string) => `*\trefs/tags/${v}:refs/tags/${v}\t[new tag]`;
const newBranch = (b: string) => `*\trefs/heads/${b}:refs/heads/${b}\t[new branch]`;

// GitHub answering a merge lookup with `--repo` from that repository.
function elsewhere(a: string): Partial<Run> | null {
  const m = /^gh pr view (\d+) --repo (\S+) .*mergeStateStatus/.exec(a);
  if (m === null) return github('fix/x')(a);
  return { stdout: `https://github.com/${m[2]}/pull/${m[1]} OPEN CLEAN\n` };
}

async function mcp($: any, tool: string, args: Record<string, unknown>, extra = {}) {
  return $.tool.call({ tool, ...args, ...extra });
}

const RAN_PUSH =
  'review-cycle: ran a push without asking, since the stop-before setting is open PR (.claude/settings.local.json).';

// The on-screen line for a step the setting runs unasked is a /config choice.
const NOTICE = { options: { unaskedNotice: true } };

const updating = (prUpdates: string) => ({
  pluginConfigs: { 'review-cycle': { options: { prUpdates } } },
});
const OWN_PULL = {
  number: 99,
  author: { login: 'me' },
  isCrossRepository: false,
  url: 'https://github.com/o/r/pull/99',
  reviewDecision: '',
};
// A push updating `branch` on github.com/o/r, which heads these open pull requests.
function openPull(pulls: unknown[], branch = 'fix/x'): (a: string) => Partial<Run> | null {
  return (a) => {
    if (/^git (?:-c \S+ )*push --dry-run /.test(a)) {
      const line = ` \trefs/heads/${branch}:refs/heads/${branch}\t${'c'.repeat(7)}..${'d'.repeat(7)}`;
      return { stdout: ['To git@github.com:o/r.git', line, 'Done'].join('\n') };
    }
    if (a.startsWith('git ls-remote --symref')) return { stdout: 'ref: refs/heads/main\tHEAD\n' };
    if (a.startsWith(`gh pr list --head ${branch} --state open`)) {
      return { stdout: JSON.stringify(pulls) };
    }
    if (a.startsWith('gh api --hostname github.com user')) return { stdout: 'me\n' };
    return null;
  };
}

describe('the prUpdates setting', () => {
  test("push fixes lets a push to the user's own open pull request run, and says so", async ($, on) => {
    const w = fakeWorld(
      on,
      pushing({ settings: { local: updating('push fixes') }, git: openPull([OWN_PULL]) }),
    );
    await say($, 'fix the failing test');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    const line =
      "review-cycle: ran a push of `fix/x` to #99 without asking, since the prUpdates setting is push fixes (.claude/settings.local.json) and #99 is the user's own open pull request. If git rejects it, stop and tell the user rather than force it.";
    expect(contextOf(r)).toEqual([line]);
    // Shown whatever the unasked-step notice says.
    expect(w.logs).toEqual([line]);
  });
  for (const level of ['push and reply', 'push, reply and resolve'] as const) {
    test(`${level} pushes fixes too, and the line names it`, async ($, on) => {
      fakeWorld(on, pushing({ settings: { local: updating(level) }, git: openPull([OWN_PULL]) }));
      await say($, 'fix the failing test');
      const r = await bash($, 'git push');
      expect(ran(r)).toBe(true);
      expect(contextOf(r)[0]).toContain(`since the prUpdates setting is ${level} (`);
    });
  }
  test('the /config value is read', { options: { prUpdates: 'push fixes' } }, async ($, on) => {
    fakeWorld(on, pushing({ git: openPull([OWN_PULL]) }));
    await say($, 'fix the failing test');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)[0]).toContain('push fixes (/config)');
  });
  test('a held push still asks', async ($, on) => {
    fakeWorld(
      on,
      pushing({ settings: { local: updating('push fixes') }, git: openPull([OWN_PULL]) }),
    );
    await say($, "fix the failing test, but don't push yet");
    expect(ran(await bash($, 'git push'))).toBe(false);
  });
  test('a session no one watches still asks', async ($, on) => {
    fakeWorld(
      on,
      pushing({ settings: { local: updating('push fixes') }, git: openPull([OWN_PULL]) }),
    );
    await say($, 'fix the failing test', 'sdk');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(false);
    expect(denied(r, 'prUpdates')).toBe(false);
  });
  test('the default asks, as before', async ($, on) => {
    fakeWorld(on, pushing({ git: openPull([OWN_PULL]) }));
    await say($, 'fix the failing test');
    const r = await bash($, 'git push');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, 'prUpdates')).toBe(false);
  });
  for (const [what, pulls, why] of [
    ['no open pull request', [], '`fix/x` heads no open pull request'],
    ['an approved one', [{ ...OWN_PULL, reviewDecision: 'APPROVED' }], '#99 is approved'],
    ["someone else's", [{ ...OWN_PULL, author: { login: 'alice' } }], '#99 is not one you opened'],
    ['a fork', [{ ...OWN_PULL, isCrossRepository: true }], '#99 comes from another repository'],
  ] as const) {
    test(`push fixes asks for a push to a branch with ${what}, and says why`, async ($, on) => {
      const git = openPull([...pulls]);
      fakeWorld(on, pushing({ settings: { local: updating('push fixes') }, git }));
      await say($, 'fix the failing test');
      const r = await bash($, 'git push');
      expect(denied(r, "doesn't ask for a push")).toBe(true);
      expect(
        denied(
          r,
          `The prUpdates setting lets a push to the user's own open pull request run, but not this one: ${why}`,
        ),
      ).toBe(true);
    });
  }
  test('a push to the default branch or a tool branch, and a force push, still ask', async ($, on) => {
    const local = updating('push fixes');
    fakeWorld(on, pushing({ settings: { local }, git: openPull([OWN_PULL], 'main') }));
    await say($, 'fix the failing test');
    expect(denied(await bash($, 'git push origin main'), 'default branch')).toBe(true);
    expect(
      denied(await bash($, 'git push --force-with-lease'), "doesn't ask for a force push"),
    ).toBe(true);
  });
  test('a push to a branch its tool rebuilds asks', async ($, on) => {
    const git = openPull([OWN_PULL], 'renovate/deps');
    fakeWorld(on, pushing({ settings: { local: updating('push fixes') }, git }));
    await say($, 'fix the failing test');
    expect(denied(await bash($, 'git push'), 'a branch its own tool rebuilds')).toBe(true);
  });
  test(
    'a committed project file can only make it ask',
    { options: { prUpdates: 'push fixes' } },
    async ($, on) => {
      fakeWorld(on, pushing({ settings: { project: updating('ask') }, git: openPull([OWN_PULL]) }));
      await say($, 'fix the failing test');
      expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
    },
  );
});

describe('the stop-before setting', () => {
  test('a push below the rung runs without asking, told to the agent but not shown', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([RAN_PUSH]);
    expect(w.logs ?? []).toEqual([]);
  });
  test('with the notice on, a push below the rung is shown too', NOTICE, async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(contextOf(r)).toEqual([RAN_PUSH]);
    expect(w.logs).toEqual([RAN_PUSH]);
  });
  test(
    'a push a script makes below the rung is logged, not reported as unasked',
    NOTICE,
    async ($, on) => {
      const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
      await say($, 'fix the parser');
      const context = contextOf(await bash($, './release.sh'));
      expect(has(context, RAN_PUSH)).toBe(true);
      expect(has(context, 'without the user asking')).toBe(false);
      expect(w.logs).toHaveLength(1);
    },
  );
  // Each dry-run output is what git 2.56 printed for that push. The last column
  // is what "push it" does: run, stay refused, or run once a request names it.
  const TAG = ['*\trefs/tags/v1:refs/tags/v1\t[new tag]'];
  const asking: [string, readonly string[] | 'fail' | null, string, string][] = [
    [
      'git push origin main',
      [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
      'push it to main',
    ],
    [
      'git push origin @',
      [' \tHEAD:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
      'push to main',
    ],
    ['git push origin v1', TAG, 'it pushes the tag `v1`', 'push the v1 tag'],
    // push.followTags carries a new annotated tag along with the branch.
    ['git push', [NEW_BRANCH, ...TAG], 'it pushes the tag `v1`', 'push the v1 tag'],
    [
      'git push',
      'fail',
      'a dry run of it, which shows what it would push, failed (fatal: Could not read from remote repository.)',
      'runs',
    ],
    ['git push --tags', null, 'it pushes tags', 'runs'],
    ['git push origin --delete old', null, 'it deletes a remote branch', 'runs'],
    ['git push --all', null, 'it pushes every branch', 'runs'],
    ['git push origin "$BRANCH"', null, 'its remote or branch is built at run time', 'refused'],
  ];
  for (const [command, lines, reason, then] of asking) {
    test(`${command} asks whatever the setting: ${reason}`, async ($, on) => {
      const args = command.replace(/^git push ?/, '');
      const git = remoteSide(lines === null ? {} : { [args]: lines });
      fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git }));
      await say($, 'fix the parser');
      const r = await bash($, command);
      expect(denied(r, `This push asks whatever the setting: ${reason}.`)).toBe(true);
      await say($, 'push it');
      if (then === 'refused') {
        expect(denied(await bash($, command), 'Write the remote and branch out.')).toBe(true);
        return;
      }
      if (then !== 'runs') {
        expect(denied(await bash($, command), 'which the request did not name')).toBe(true);
        await say($, then);
      }
      expect(ran(await bash($, command))).toBe(true);
    });
  }
  test('a yes to the offer the refusal suggests lets the push run', async ($, on) => {
    const git = remoteSide({
      'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
    });
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git }));
    await say($, 'push it');
    const r = await bash($, 'git push origin main');
    expect(denied(r, OWN_PARAGRAPH('main'))).toBe(true);
    await ($ as any).turn.complete({ answer: 'Done.\n\nPush to `main`?', reason: 'answer' });
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin main'))).toBe(true);
  });
  test('a push the user asked for that git partly rejects is judged by the refs it lands', async ($, on) => {
    const lines = [
      `To ${REMOTE}`,
      ' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349',
      '!\trefs/heads/other:refs/heads/other\t[rejected] (non-fast-forward)',
      'Done',
    ];
    const rest = remoteSide({});
    const git = (a: string) =>
      a.includes('push --dry-run') && a.includes(DRY_FLAGS)
        ? { exitCode: 1, stdout: lines.join('\n'), stderr: 'error: failed to push some refs\n' }
        : rest(a);
    fakeWorld(on, pushing({ git }));
    await say($, 'push it');
    const r = await bash($, 'git push origin main other');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
  });
  test('a commit before a push the user asked for moves an up-to-date main', async ($, on) => {
    const rest = remoteSide({
      'origin main': ['=\trefs/heads/main:refs/heads/main\t[up to date]'],
    });
    const git = (a: string) =>
      a.startsWith('git symbolic-ref') ? { stdout: 'refs/heads/main\n' } : rest(a);
    fakeWorld(on, pushing({ git }));
    await review($);
    await say($, 'commit and push');
    const r = await bash($, 'git commit -am x && git push origin main');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
  });
  test('a commit before a push asks for an up-to-date main when its branch cannot be read', async ($, on) => {
    const rest = remoteSide({
      'origin main': ['=\trefs/heads/main:refs/heads/main\t[up to date]'],
    });
    const git = (a: string) =>
      a.startsWith('git symbolic-ref')
        ? { exitCode: 128, stderr: 'fatal: not a git repository\n' }
        : rest(a);
    fakeWorld(on, pushing({ git }));
    await review($);
    await say($, 'commit and push');
    const r = await bash($, 'git commit -am x && git push origin main');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
  });
  test("a user's push never deletes the default branch, even named", async ($, on) => {
    const git = remoteSide({ 'origin :main': ['-\t:refs/heads/main\t[deleted]'] });
    fakeWorld(on, pushing({ git }));
    await say($, 'push to main');
    const r = await bash($, 'git push origin :main');
    expect(denied(r, 'it deletes `main`, the default branch')).toBe(true);
    expect(denied(r, 'The gate never does that for the user')).toBe(true);
  });
  test('a git step before a push the user asked for asks, since it can change where it goes', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, 'push it');
    const r = await bash($, 'git fetch && git push');
    expect(denied(r, '`git fetch` runs before it in the same command')).toBe(true);
  });
  test('a remote branch delete asks a question its reply grants', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin --delete old');
    expect(denied(r, '"Delete `fix/x` from `origin`?"')).toBe(true);
    expect(denied(r, '`gh pr merge --delete-branch`')).toBe(true);
    await endTurn($, 'answer', 'Delete `old` from `origin`?');
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin --delete old'))).toBe(true);
  });
  test("a pull request's push runs unnoted, but still asks before main", async ($, on) => {
    const w = fakeWorld(
      on,
      pushing({
        git: remoteSide({ 'origin main': [' \trefs/heads/main:refs/heads/main\t1..2'] }),
      }),
    );
    await say($, 'open a PR');
    const r = await bash($, 'git push -u origin HEAD');
    expect(ran(r)).toBe(true);
    expect(w.logs ?? []).toEqual([]);
    expect(has(contextOf(r), 'without')).toBe(false);
    expect(denied(await bash($, 'git push origin main'), 'the default branch')).toBe(true);
  });
  test('a held pull request request lets no push through', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'open a PR. do not push.');
    expect(denied(await bash($, 'git push -u origin HEAD'), 'held off (')).toBe(true);
  });
  test("a script's push under a pull request request is still reported", async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'open a PR');
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, 'without the user asking for a push')).toBe(true);
  });
  test("the dry run carries the push's own -c options", async ($, on) => {
    const upstream = ' \trefs/heads/fix/x:refs/heads/main\t1..2';
    const w = fakeWorld(
      on,
      pushing({
        settings: { local: stops('never stop') },
        git: (a) =>
          a.startsWith('git -c push.default=upstream push') && a.includes('--dry-run')
            ? { stdout: [`To ${REMOTE}`, upstream, 'Done'].join('\n') }
            : remoteSide()(a),
      }),
    );
    await say($, 'fix the parser');
    const r = await bash($, 'git -c push.default=upstream push');
    expect(denied(r, 'the default branch')).toBe(true);
    const probe = w.calls.find((c) => c.argv.includes('--dry-run'));
    expect(probe?.init?.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });
  // Measured on git 2.56: a later --no-verify and --no-quiet win, and an
  // option before the push's own `--` would take a flag as its value.
  const flags = DRY_FLAGS.split(' ');
  const probes: [string, string[]][] = [
    ['git push -q --verify origin main', ['-q', '--verify', 'origin', 'main', ...flags]],
    ['git push origin -- main', ['origin', ...flags, '--', 'main']],
    ['git push -o -- origin main', ['-o', '--', 'origin', 'main', ...flags]],
  ];
  for (const [command, words] of probes) {
    test(`the dry run of ${command} leads with --dry-run and ends its options with the flags`, async ($, on) => {
      const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
      await say($, 'fix the parser');
      await bash($, command);
      const probe = w.calls.find((c) => c.argv.includes('--porcelain'));
      expect(probe?.argv).toEqual(['git', 'push', '--dry-run', ...words]);
    });
  }
  test('a push option with no value is refused before any dry run', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push origin main -o'), 'without a value')).toBe(true);
    expect(w.calls.some((c) => c.argv.includes('--porcelain'))).toBe(false);
  });
  test('a push after a step that can retarget it asks, without a dry run', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git checkout main && git push');
    expect(denied(r, '`git checkout` runs before it in the same command')).toBe(true);
    expect(w.calls.some((c) => c.argv.includes('--porcelain'))).toBe(false);
  });
  test('a quiet push and a commit with its push are still judged', async ($, on) => {
    const main = ['=\trefs/heads/main:refs/heads/main\t[up to date]'];
    fakeWorld(
      on,
      pushing({
        settings: { local: stops('never stop') },
        git: remoteSide({ '-q origin main': main, 'origin main': main }),
      }),
    );
    await review($);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push -q origin main'), 'the default branch')).toBe(true);
    expect(
      denied(await bash($, 'git commit -am x && git push origin main'), 'the default branch'),
    ).toBe(true);
  });
  test('an unreadable setting leaves its rung out of the commit refusal', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'could not read .claude/settings.local.json')).toBe(true);
    expect(denied(r, 'the stop-before setting is')).toBe(false);
  });
  test('a commit dry run needs no request at a commit rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit --dry-run -am x'))).toBe(true);
  });
  test("a remote whose default branch can't be read asks", async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}, null) }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(
      denied(r, `the default branch of ${REMOTE} could not be read (fatal: unable to access)`),
    ).toBe(true);
  });
  test('at the default setting, a refused push skips the always-ask reason', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin main');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, 'asks whatever the setting')).toBe(false);
  });
  test('an unreadable settings file stops before a commit too', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await review($);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
  });
  test('a force push asks whatever the setting', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push --force-with-lease'), 'force push')).toBe(true);
  });
  test('a pull request a newer message overtakes does not run, and logs nothing', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: (a) => {
        if (!typed && a.startsWith('git for-each-ref')) {
          typed = true;
          void say($, "don't open a PR");
        }
        return null;
      },
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('a pull request at the rung is refused, with the question to ask', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr create --fill');
    expect(denied(r, "doesn't ask for a pull request")).toBe(true);
    expect(denied(r, 'The question: Open a pull request? The command:')).toBe(true);
  });
  test('by default a pull request asks, and a request for one lets it run', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'pull request')).toBe(true);
    await say($, 'open a PR');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('never stop lets a pull request run, logged', NOTICE, async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(w.logs?.[0]).toContain('ran a pull request without asking');
  });
  test('outside a repository a newer message still stops a pull request', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
      settingsRead: () => {
        if (typed) return;
        typed = true;
        void say($, 'actually, rename the helper first');
      },
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh -R o/r pr create --fill');
    expect(denied(r, 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  // The note says the step ran, not that it succeeded, so it stands either way.
  test('a pull request that failed is still noted as run', NOTICE, async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') }, bashFails: true });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr create --fill');
    expect(has(contextOf(r), 'ran a pull request without asking')).toBe(true);
    expect(w.logs).toHaveLength(1);
  });
  test('a permitted push that moved no ref is still noted as run', NOTICE, async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: remoteSide() });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(w.logs).toEqual([RAN_PUSH]);
  });
  test('a failure while judging a pull request refuses it', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      reject: (a) => a.includes('--show-toplevel'),
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'the gate failed')).toBe(true);
  });
  test('Monitor refuses a pull request', async ($, on) => {
    fakeWorld(on);
    const r = await $.tool.call({ tool: 'Monitor', command: 'gh pr create --fill' } as never);
    expect(denied(r, 'opens, merges, approves or comments on a pull request')).toBe(true);
    const merge = await $.tool.call({ tool: 'Monitor', command: 'gh pr merge 116' } as never);
    expect(denied(merge, 'Monitor runs commands the gate does not check')).toBe(true);
  });
  test('a merge asks at a merge rung and runs once asked for', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 116 --squash'), "doesn't ask for a merge")).toBe(true);
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 116 --squash --delete-branch'))).toBe(true);
  });
  test('a merge in another repository runs once the user names it there', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: elsewhere });
    await say($, 'merge 53');
    const linesmith = 'gh pr merge 53 -R oakoss/linesmith --squash';
    expect(denied(await bash($, linesmith), 'not this repository')).toBe(true);
    await say($, 'Ok, lets merge oakoss/linesmith#53');
    const other = 'gh pr merge 53 -R oakoss/other --squash';
    expect(denied(await bash($, other), 'not this repository')).toBe(true);
    expect(ran(await bash($, linesmith))).toBe(true);
  });
  test("a bare merge after an answer ending with the pull request's link runs here", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    const report = 'Shipped; checks passed.\nPR: https://github.com/o/r/pull/116';
    await endTurn($, 'answer', report);
    await say($, 'Ok, lets merge 116');
    expect(ran(await bash($, 'gh pr merge 116 --squash --delete-branch'))).toBe(true);
  });
  test('a merge asked for once it is ready runs only with --auto', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'Lets merge it when its ready');
    const remedy = '`gh pr merge 116 --auto`, which leaves';
    expect(denied(await bash($, 'gh pr merge 116 --squash'), remedy)).toBe(true);
    expect(denied(await bash($, 'gh pr merge 116 --body --auto'), remedy)).toBe(true);
    expect(ran(await bash($, 'gh pr merge 116 --auto --squash'))).toBe(true);
  });
  test('a merge asked for once it is ready runs now when GitHub reports it ready', async ($, on) => {
    const git = github('fix/x', 'main', false, 'github.com/o/r', 'CLEAN');
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git });
    await say($, 'Ok, lets merge 116 when its ready');
    expect(denied(await bash($, 'gh pr merge 117 --squash'), 'the user asked to merge #116')).toBe(
      true,
    );
    expect(denied(await bash($, 'gh pr merge 117 --auto'), 'the user asked to merge #116')).toBe(
      true,
    );
    const r = await bash($, 'gh pr merge 116 --squash');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'GitHub reports #116 CLEAN')).toBe(true);
    // Shown whatever the notice setting: GitHub's state, not the setting, let it run.
    expect(w.logs?.some((l) => l.includes('GitHub reports #116 CLEAN'))).toBe(true);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.argv.slice(3))).toContainEqual([
      '116',
      '--json',
      'url,state,mergeStateStatus',
      '--jq',
      String.raw`"\(.url) \(.state) \(.mergeStateStatus)"`,
    ]);
    const repoViews = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repoViews.map((c) => c.argv.slice(3))).toContainEqual(['--json', 'url', '--jq', '.url']);
  });
  test('a merge below the rung runs, noted', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 116');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran a merge without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv).toEqual([
      'gh',
      'pr',
      'view',
      '116',
      '--json',
      'url,isCrossRepository,headRefName',
      '--jq',
      String.raw`"\(.isCrossRepository) \(.url) \(.headRefName)"`,
    ]);
    expect(view?.init?.timeoutMs).toBe(5000);
  });
  test("merging oakum's version pull request is a release", async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('oakum/version-packages'),
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 62'), "doesn't ask for a release")).toBe(true);
    await say($, 'release it');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
  });
  test('an unasked merge of the version pull request is noted as a release', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: github('oakum/version-packages'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 62 --auto');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran a release without asking')).toBe(true);
  });
  test('a refusal of a step the message named is kept as a miss; one it did not name is not', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('merge') },
      git: github('oakum/version-packages'),
    });
    const misses = async () => {
      const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
      return JSON.parse((r as { result: string }).result).misses;
    };
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    expect(await misses()).toEqual([]);
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    // Refused again, it is kept once.
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    const [miss, ...rest] = await misses();
    expect(rest).toEqual([]);
    expect(miss.message).toBe('can we merge the version PRs whenever');
    expect(miss.steps).toEqual(['merge']);
    expect(miss.refusal).toContain('the question mcp__review-cycle__offer gives for step');
    // A "yes" to an offer the gate did not read is kept with that offer, a
    // dotted version and all.
    const closing = 'All green.\nShould I go ahead with the version bump merge for `v0.25.0`?';
    await endTurn($, 'answer', closing);
    await say($, 'yep');
    w.git = github('oakum/version-packages');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    const all = await misses();
    const latest = all.at(-1);
    expect(latest.offer).toBe(closing);
    expect(latest.steps).toEqual(['merge']);
  });
  test('a refused comment the message or its offer named is kept as a miss, with the offer', async ($, on) => {
    fakeWorld(on, { git: github('feat/x') });
    const misses = async () => {
      const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
      return JSON.parse((r as { result: string }).result).misses;
    };
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr comment 99 --body ok'), 'a comment on GitHub')).toBe(true);
    expect(await misses()).toEqual([]);
    const closing =
      'Pullfrog reviewed it.\nShould I post `@pullfrog --codex review this PR` on #99?';
    await endTurn($, 'answer', closing);
    await say($, 'Ok, lets do the codex pass');
    expect(denied(await bash($, 'gh pr comment 99 --body ok'), 'a comment on GitHub')).toBe(true);
    const [miss, ...rest] = await misses();
    expect(rest).toEqual([]);
    expect(miss.message).toBe('Ok, lets do the codex pass');
    expect(miss.offer).toBe(closing);
    expect(miss.steps).toEqual(['comment']);
    // A pull request asked for is no comment.
    await say($, 'open a PR and post the notes');
    expect(denied(await bash($, 'gh pr comment 99 --body ok'), 'a comment on GitHub')).toBe(true);
    const latest = await misses();
    expect(latest.at(-1).message).toBe('open a PR and post the notes');
  });
  test('a miss is recorded once in the store, with its date and repository, and counted', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    // Written with no reader asking.
    await settle();
    const keys = () => [...store.keys()].filter((k) => k.startsWith('misses@'));
    expect(keys()).toHaveLength(1);
    expect(store.get(keys()[0] ?? '')).toEqual({
      message: 'can we merge the version PRs whenever',
      offer: '',
      steps: ['merge'],
      refusal: expect.stringContaining('the question mcp__review-cycle__offer gives for step'),
      kind: 'refused',
      date: '2026-09-26',
      repo: '/repo',
    });
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    const { counts, unsaved } = JSON.parse((r as { result: string }).result);
    expect([counts, unsaved]).toEqual([
      { kept: 1, refused: 1, byModel: 0, since: '2026-09-26' },
      0,
    ]);
    const s = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(s.misses).toEqual({ ...counts, unsaved: 0 });
  });
  test('a miss the store refuses is named, kept unsaved, and saved once it takes it', async ($, on) => {
    const store = fakeStore(on, { refuseFirst: 1 });
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    await settle();
    const status = async () =>
      JSON.parse(((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result);
    // The status's own flush is the second write, which the store takes.
    const s = await status();
    expect(s.misses).toMatchObject({ kept: 1, unsaved: 0 });
    expect(s.missesError).toBeUndefined();
    expect([...store.keys()].filter((k) => k.startsWith('misses@'))).toHaveLength(1);
  });
  test('a miss the store never got before a reload is saved after it', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { git: github('fix/x') });
    const unsaved = {
      message: 'ship it',
      offer: '',
      steps: ['push'],
      refusal: 'r',
      kind: 'refused',
      saved: false,
      key: null,
    };
    reloadInto(on, keptRecord({ misses: [unsaved] }));
    await say($, 'fix the parser');
    await settle();
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    const { misses, counts } = JSON.parse((r as { result: string }).result);
    expect(misses).toEqual([{ ...unsaved, saved: true, key: expect.any(String) }]);
    expect(counts).toMatchObject({ kept: 1 });
    expect([...store.keys()].filter((k) => k.startsWith('misses@'))).toHaveLength(1);
  });
  test('a miss written before a reload, but kept unsaved, is written again in its place', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { git: github('fix/x') });
    const written = {
      message: 'ship it',
      offer: '',
      steps: ['push'],
      refusal: 'r',
      kind: 'refused',
    };
    store.set('misses@5-a', { ...written, date: '2026-09-26', repo: '/repo' });
    reloadInto(on, keptRecord({ misses: [{ ...written, saved: false, key: '5-a' }] }));
    await say($, 'fix the parser');
    await settle();
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    expect(JSON.parse((r as { result: string }).result).counts).toMatchObject({ kept: 1 });
    expect([...store.keys()].filter((k) => k.startsWith('misses@'))).toEqual(['misses@5-a']);
  });
  test('a miss waits to be written until the gate keeps its key', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    let gateSaves = false;
    on('state.set', ($$: unknown, e: { key: string }, next: any) =>
      e.key !== 'gate' || gateSaves ? next(e) : { deny: 'state full' },
    );
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    await settle();
    const keys = () => [...store.keys()].filter((k) => k.startsWith('misses@'));
    const status = async () =>
      JSON.parse(((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result);
    const before = await status();
    expect(keys()).toEqual([]);
    expect(before.misses).toMatchObject({ kept: 0, unsaved: 1 });
    expect(before.missesError).toContain('the gate could not keep its record');
    gateSaves = true;
    const after = await status();
    expect(keys()).toHaveLength(1);
    expect(after.misses).toMatchObject({ kept: 1, unsaved: 0 });
    expect(after.missesError).toBeUndefined();
  });
  test('the error stays while one of two misses is unsaved', async ($, on) => {
    fakeStore(on, {
      refuseWhere: (key, value) =>
        key.startsWith('misses@') && value?.message === 'can we merge the version PRs whenever',
    });
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    await say($, 'should we merge the version PR?');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    await settle();
    const s = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(s.misses).toMatchObject({ kept: 1, unsaved: 1 });
    expect(s.missesError).toContain('disk full');
  });
  test('a store that keeps refusing names the misses it lacks', async ($, on) => {
    fakeStore(on, { refuse: 'disk full' });
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    const s = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(s.misses).toEqual({ kept: 0, refused: 0, byModel: 0, since: null, unsaved: 1 });
    expect(s.missesError).toContain('disk full');
  });
  test("an earlier session's misses are read back, the newest 20 listed", async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { git: github('fix/x') });
    for (let i = 0; i < 21; i++) {
      store.set(`misses@${i + 1}-old`, {
        message: `m${i}`,
        offer: '',
        steps: ['push'],
        refusal: 'r',
        kind: i === 0 ? 'model' : 'refused',
        date: '2026-09-01',
        repo: '/other',
      });
    }
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    const { misses, recorded, counts } = JSON.parse((r as { result: string }).result);
    expect(misses).toEqual([]);
    expect(recorded.map((m: { message: string }) => m.message)).toEqual(
      Array.from({ length: 20 }, (_, i) => `m${i + 1}`),
    );
    expect(counts).toEqual({ kept: 21, refused: 20, byModel: 1, since: '2026-09-01' });
  });
  test('a store it cannot read is named, with no counts', async ($, on) => {
    const store = fakeStore(on, { readFails: 'EIO' });
    fakeWorld(on, { git: github('fix/x') });
    store.set('misses@1-old', {});
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    expect(JSON.parse((r as { result: string }).result)).toMatchObject({
      recorded: null,
      counts: null,
      recordedError: expect.stringContaining('EIO'),
    });
    const s = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(s.misses).toBeNull();
    expect(s.missesError).toContain('EIO');
  });
  test('a refused gh stack push the message named is kept as a miss', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'should we push the stack?');
    const refused = await bash($, 'gh stack push');
    expect(denied(refused, "doesn't ask for a forced push")).toBe(true);
    expect(denied(refused, 'The question: Force-push the stack with a lease? The command:')).toBe(
      true,
    );
    const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    const [miss] = JSON.parse((r as { result: string }).result).misses;
    expect(miss?.steps).toEqual(['push']);
  });
  test('words in a refused command are not read as the step it asks about', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'should we merge?');
    const r = await bash($, 'gh pr comment 5 --body "did you ask for a merge yet"');
    expect(denied(r, 'comment')).toBe(true);
    const res = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    expect(JSON.parse((res as { result: string }).result).misses).toEqual([]);
  });
  test('a miss needs the refused step named, and an offer counts only when answered', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('commit') },
      git: github('feat/x'),
    });
    const count = async () => {
      const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
      return JSON.parse((r as { result: string }).result).misses.length;
    };
    // A push named, a merge refused.
    await say($, 'push it later');
    expect(denied(await bash($, 'gh pr merge 63'), 'merge')).toBe(true);
    // A commit refused: not kept as a miss.
    await say($, 'did the push fail?');
    expect(denied(await bash($, 'git commit -m x'), 'commit')).toBe(true);
    // An offer of a merge the message does not answer.
    await endTurn($, 'answer', 'Tests pass.\nShould I merge 63?');
    for (const text of [
      'now fix the lexer too',
      'please fix the lexer',
      "let's fix it first",
      'do it later',
      'go ahead and fix the lexer',
    ]) {
      await say($, text);
      expect(denied(await bash($, 'gh pr merge 63'), 'merge')).toBe(true);
    }
    expect(await count()).toBe(0);
    // A bare force push named and refused is kept, as on the gh path.
    await say($, 'force push it whenever');
    expect(denied(await bash($, 'git push --force origin fix/x'), 'bare force')).toBe(true);
    expect(await count()).toBe(1);
  });
  test('a merge whose pull request cannot be looked up asks where a release would', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'fix the parser');
    expect(
      denied(await bash($, 'gh pr merge'), 'looking up the pull request it merges failed'),
    ).toBe(true);
    expect(denied(await bash($, 'gh pr merge "$PR"'), 'built at run time')).toBe(true);
    expect(
      denied(
        await bash($, 'env -C ../other gh pr merge 62'),
        'something outside the words the gate looks up picks where it merges',
      ),
    ).toBe(true);
    expect(
      denied(await bash($, 'gh pr merge 62 && echo merged'), 'Run the merge as its own command'),
    ).toBe(true);
    // Asked for both, the merge runs whichever it is.
    await say($, 'merge it and release it');
    expect(ran(await bash($, 'gh pr merge'))).toBe(true);
  });
  test('a lookup that never answers is tried again for longer, then says to run it again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
      rejectWith: 'aborted: still running after 5000ms',
    });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(true);
    expect(denied(r, 'Run the same command again')).toBe(true);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.init?.timeoutMs)).toEqual([5000, 10_000]);
  });
  test('a lookup that answers on its second try lets the merge run', async ($, on) => {
    let tries = 0;
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view') && tries++ === 0,
    });
    await say($, 'merge 62');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
  });
  test('a merge piped into tail is judged as the merge alone', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'merge 62');
    expect(ran(await bash($, 'gh pr merge 62 --squash --delete-branch 2>&1 | tail -4'))).toBe(true);
    const r = await bash($, 'gh pr merge 62 --squash | grep -v warning');
    expect(denied(r, 'other steps in the same command')).toBe(true);
  });
  test('a slow lookup on a merge the user did not ask for still asks them', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.init?.timeoutMs)).toEqual([5000]);
  });
  test('a lookup that cannot start is not retried or taken as slow', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
      rejectWith: 'spawn gh ENOENT',
    });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views).toHaveLength(1);
  });
  test('a lookup that fails outright asks the user, not to run it again', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
  });
  test('--admin is handed to the user, even when the merge was asked for', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'merge it');
    const r = await bash($, 'gh pr merge 116 --admin=true');
    expect(denied(r, 'past branch protection')).toBe(true);
    expect(denied(r, 'Give the user the command to run themselves')).toBe(true);
  });
  test('an approval and a merge are asked for apart', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'approve it');
    expect(denied(await bash($, 'gh pr merge 116'), "doesn't ask for a merge")).toBe(true);
    expect(ran(await bash($, 'gh pr review 116 -a'))).toBe(true);
    await say($, 'merge it');
    expect(denied(await bash($, 'gh pr review 116 --approve=true'), 'an approval')).toBe(true);
  });
  test('an approval below the rung runs, noted as one; a hold stops it', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr review 116 -ab LGTM');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran an approval without asking')).toBe(true);
    await say($, "don't merge yet");
    expect(denied(await bash($, 'gh pr review 116 -a'), 'held off')).toBe(true);
    expect(denied(await bash($, 'gh release create v1'), 'held off')).toBe(true);
  });
  test('a comment always asks unless the review is addressed', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr comment 116 --body done'), 'a comment on GitHub')).toBe(
      true,
    );
    expect(denied(await bash($, 'gh pr review 116 -c -b ok'), 'a comment on GitHub')).toBe(true);
    expect(denied(await bash($, 'gh issue comment 9 --body ok'), 'a comment on GitHub')).toBe(true);
    await say($, 'reply to the review');
    expect(ran(await bash($, 'gh pr comment 116 --body done'))).toBe(true);
  });
  test('a reply lifts no hold', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    await say($, 'reply to the review');
    expect(denied(await bash($, 'git push'), 'held off')).toBe(true);
  });
  test('a gh alias is refused, asked for or not, and gh is never asked for its aliases', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'merge it');
    const r = await bash($, 'gh m 116');
    expect(denied(r, '`gh m` is a gh alias or extension')).toBe(true);
    expect(denied(r, 'Run the gh command itself, written out')).toBe(true);
    expect(denied(await bash($, 'gh pr m 116'), '`gh pr m` is a gh alias')).toBe(true);
    expect(ran(await bash($, 'gh pr view 116'))).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ') === 'gh alias list')).toBe(false);
  });
  test('gh stack submit asks for its pull requests and its lease at once, and one yes runs it', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch of the stack with --force-with-lease')).toBe(
      true,
    );
    const question = 'Force-push the stack with a lease and open its pull requests?';
    expect(denied(r, `The question: ${question} The command:`)).toBe(true);
    await endTurn($, 'answer', question);
    await say($, 'yes');
    expect(ran(await bash($, 'gh stack submit --auto'))).toBe(true);
  });
  test('a lease asked in the message still has gh stack submit ask for both, since the answer is a new message', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await endTurn($, 'answer', 'Force-push the stack with a lease?');
    await say($, 'yes');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch')).toBe(true);
    // gh stack link pushes plainly, so it is never asked a lease.
    const link = await bash($, 'gh stack link feat/a feat/b');
    expect(denied(link, "doesn't ask for a pull request")).toBe(true);
    expect(denied(link, 'also pushes every active branch')).toBe(false);
    await endTurn($, 'answer', 'Force-push the stack with a lease and open its pull requests?');
    await say($, 'yes');
    expect(ran(await bash($, 'gh stack submit --auto'))).toBe(true);
  });
  test('where the setting allows a push its lease cannot bound, gh stack submit still asks for both; gh stack link never for a lease', async ($, on) => {
    // This clone tracks no stack, so the lease bound cannot be read.
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch')).toBe(true);
    const link = await bash($, 'gh stack link feat/a feat/b');
    expect(denied(link, "doesn't ask for a pull request")).toBe(true);
    expect(denied(link, 'also pushes every active branch')).toBe(false);
  });
  test('gh stack is read: moving around runs, a stack push asks for its lease', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'push the stack');
    expect(ran(await bash($, 'gh stack view --json'))).toBe(true);
    expect(ran(await bash($, 'gh stack up'))).toBe(true);
    const r = await bash($, 'gh stack push');
    expect(denied(r, 'pushes every active branch of the stack with --force-with-lease')).toBe(true);
    expect(denied(await bash($, 'gh stack modify'), 'is interactive')).toBe(true);
    expect(denied(await bash($, 'gh stack merge 4 --yes --squash'), 'below it')).toBe(true);
  });
  test('"force push the stack" lets a stack push run', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'gh stack push'))).toBe(false);
    await say($, 'force push the stack');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
  });
  test('gh stack link pushes its branches: the default one needs naming', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'ship it');
    const link = await bash($, 'gh stack link main feat/a');
    expect(denied(link, '`main`, the default branch')).toBe(true);
    expect(denied(link, OWN_PARAGRAPH('main'))).toBe(true);
    expect(ran(await bash($, 'gh stack link feat/a feat/b'))).toBe(true);
    expect(denied(await bash($, 'cd .. && gh stack link feat/a'), 'Run it on its own')).toBe(true);
  });
  test('a stack merge reads GitHub, and merges only what the user named', async ($, on) => {
    const stack = JSON.stringify([
      {
        number: 4,
        pull_requests: [
          { number: 1, merged_at: '2026-10-18T15:02:11Z' },
          { number: 2, merged_at: null },
          { number: 3, merged_at: null },
        ],
      },
    ]);
    // #3 is no stack's number, so the gate asks for the stack holding it.
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/3'
        ? { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)\n' }
        : a === 'gh api -X GET repos/{owner}/{repo}/stacks -f pull_request=3'
          ? { stdout: stack }
          : github('two')(a);
    const w = fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge it');
    const refused = await bash($, 'gh stack merge 3 --yes --squash');
    expect(denied(refused, 'merges #2, #3 together')).toBe(true);
    expect(denied(refused, 'The question: Merge #2 and #3? The command:')).toBe(true);
    await say($, 'merge #2 and #3');
    expect(ran(await bash($, 'gh stack merge 3 --yes --squash'))).toBe(true);
    const looked = w.calls.map((c) => c.argv.join(' ')).filter((a) => a.startsWith('gh '));
    // Each layer is bound by the number GitHub resolves, as `gh pr merge` is.
    expect(looked.some((a) => a.startsWith('gh pr view 2 '))).toBe(true);
    expect(looked.some((a) => a.startsWith('gh pr view 3 '))).toBe(true);
  });
  test('a stack push runs on a push request while it overwrites only what this agent pushed', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const THEIRS_TIP = 'b'.repeat(40);
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [
        {
          number: 4,
          trunk: { branch: 'main' },
          branches: [{ branch: 'spike/two', pullRequest: { number: 2 } }],
        },
      ],
    });
    let onRemote = MINE;
    const answers = (a: string): Partial<Run> | null => {
      if (a === 'git symbolic-ref --quiet --short HEAD') return { stdout: 'spike/two\n' };
      if (a.startsWith('git config --get ')) return { exitCode: 1 };
      if (a === 'git remote') return { stdout: 'origin\n' };
      if (a.startsWith('git remote get-url ')) return { stdout: 'git@github.com:o/r.git\n' };
      if (a === 'git ls-remote --heads origin') {
        return { stdout: `${onRemote}\trefs/heads/spike/two\n` };
      }
      return github('spike/two')(a);
    };
    const w = fakeWorld(on, {
      settings: { local: stops('push') },
      git: answers,
      files: { '/repo/.git/gh-stack': catalog },
      shell(this: World, command: string) {
        if (command !== 'gh stack push') return;
        this.refs = { 'refs/remotes/origin/spike/two': MINE };
        this.reflogs = { 'refs/remotes/origin/spike/two': [`${MINE} update by push`] };
      },
    });
    await say($, 'push it');
    expect(denied(await bash($, 'gh stack push'), 'never saw this agent push')).toBe(true);
    // A forced push the user asked for runs, and the gate records what it pushed.
    await say($, 'force push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
    await say($, 'push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
    // Someone else pushed to the branch since.
    onRemote = THEIRS_TIP;
    expect(
      denied(await bash($, 'gh stack push'), 'which the gate did not see this agent push'),
    ).toBe(true);
    const listing = w.calls.find((c) => c.argv.join(' ') === 'git ls-remote --heads origin');
    expect(listing?.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });
  test('a plain git push of a stack layer is sent to gh stack push', async ($, on) => {
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [
        {
          trunk: { branch: 'main' },
          branches: [
            { branch: 'spike/one', pullRequest: { number: 1, merged: true } },
            { branch: 'spike/two', pullRequest: { number: 2 } },
          ],
        },
      ],
    });
    const remote = remoteSide({
      'origin spike/two': [newBranch('spike/two')],
      'origin spike/one': [newBranch('spike/one')],
      'origin fix/x': [newBranch('fix/x')],
      'origin :old spike/two': ['-\t:refs/heads/old\t[deleted]', newBranch('spike/two')],
      '--force origin spike/two': [
        '+\trefs/heads/spike/two:refs/heads/spike/two\ta...b (forced update)',
      ],
    });
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) => {
        if (a.startsWith('git config --get ')) return { exitCode: 1 };
        if (a === 'git remote') return { stdout: 'origin\n' };
        // The steer matches the push URL; the fetch URL differs so reading it would miss.
        if (a === 'git remote get-url --all origin') return { stdout: 'https://mirror.test/o/r\n' };
        if (a === 'git remote get-url --push --all origin') return { stdout: `${REMOTE}\n` };
        return remote(a);
      },
    });
    await say($, 'push it');
    expect(
      denied(
        await bash($, 'git push origin spike/two'),
        '`spike/two` is a layer of a gh-stack stack',
      ),
    ).toBe(true);
    // One dry run serves every check of the push.
    expect(w.calls.filter((c) => c.argv.includes('--dry-run'))).toHaveLength(1);
    // A merged layer, and a branch in no stack, push as any branch does.
    expect(ran(await bash($, 'git push origin spike/one'))).toBe(true);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    // A delete is judged as any push is, not steered to a command that cannot delete.
    expect(ran(await bash($, 'git push --delete origin spike/two'))).toBe(true);
    // A refusal of its own comes before the steer.
    expect(denied(await bash($, 'git push --force origin spike/two'), 'without a lease')).toBe(
      true,
    );
    // A push that also deletes is steered for the layer it updates.
    await say($, 'push it and delete the branch');
    expect(
      denied(await bash($, 'git push origin :old spike/two'), 'is a layer of a gh-stack stack'),
    ).toBe(true);
  });
  test('without a stack catalog, a push gets no extra dry run for it', async ($, on) => {
    const w = fakeWorld(on, { git: remoteSide() });
    await say($, 'push it');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    // The one dry run is the default-branch check's.
    expect(w.calls.filter((c) => c.argv.includes('--dry-run'))).toHaveLength(1);
  });
  test('a push followed by a fetch records the commit the push set', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const FETCHED = 'b'.repeat(40);
    fakeWorld(on, {
      refs: {},
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/spike/two': FETCHED };
        this.reflogs = {
          'refs/remotes/origin/spike/two': [
            `${FETCHED} fetch: fast-forward`,
            `${MINE} update by push`,
          ],
        };
      },
    });
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await bash($, './push-then-fetch.sh');
    await settle();
    expect(kept?.value.pushed).toEqual([['/repo/.git\torigin/spike/two', MINE]]);
  });
  test('the pushes the gate saw are kept, and read back after a reload', async ($, on) => {
    const MINE = 'a'.repeat(40);
    fakeWorld(on, {
      refs: {},
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/spike/two': MINE };
        this.reflogs = { 'refs/remotes/origin/spike/two': [`${MINE} update by push`] };
      },
    });
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await bash($, 'git push origin spike/two');
    await settle();
    expect(kept?.value.pushed).toEqual([['/repo/.git\torigin/spike/two', MINE]]);
  });
  test('a kept push lets a stack push run after a reload', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [{ trunk: { branch: 'main' }, branches: [{ branch: 'spike/two' }] }],
    });
    fakeWorld(on, {
      settings: { local: stops('push') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) =>
        a === 'git symbolic-ref --quiet --short HEAD'
          ? { stdout: 'spike/two\n' }
          : a.startsWith('git config --get ')
            ? { exitCode: 1 }
            : a === 'git remote'
              ? { stdout: 'origin\n' }
              : a.startsWith('git remote get-url ')
                ? { stdout: 'git@github.com:o/r.git\n' }
                : a === 'git ls-remote --heads origin'
                  ? { stdout: `${MINE}\trefs/heads/spike/two\n` }
                  : github('spike/two')(a),
    });
    reloadInto(on, keptRecord({ pushed: [['/repo/.git\torigin/spike/two', MINE]] }));
    await startSession($);
    await say($, 'push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
  });
  test('a stack number is read as a stack, and only a 404 reads it as a pull request', async ($, on) => {
    const stack = JSON.stringify({
      number: 4,
      pull_requests: [
        { number: 2, merged_at: null },
        { number: 3, merged_at: null },
      ],
    });
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/4'
        ? { stdout: stack }
        : a === 'gh api repos/{owner}/{repo}/stacks/5'
          ? { exitCode: 1, stderr: 'gh: Server Error (HTTP 500)\n' }
          : a.includes('pull_request=')
            ? { stdout: `[${stack}]` }
            : github('two')(a);
    const w = fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge #2 and #3');
    expect(ran(await bash($, 'gh stack merge 4 --yes'))).toBe(true);
    expect(denied(await bash($, 'gh stack merge 5 --yes'), '(HTTP 500)')).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ').includes('pull_request='))).toBe(false);
  });
  test('"merge the stack" and "merge up to #N" merge the stack, and nothing else', async ($, on) => {
    const stack = JSON.stringify({
      number: 4,
      pull_requests: [
        { number: 2, merged_at: null },
        { number: 3, merged_at: null },
      ],
    });
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/4'
        ? { stdout: stack }
        : a === 'gh api repos/{owner}/{repo}/stacks/3'
          ? { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)\n' }
          : a.includes('pull_request=3')
            ? { stdout: `[${stack}]` }
            : github('two')(a);
    fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge the stack');
    expect(ran(await bash($, 'gh stack merge 4 --yes'))).toBe(true);
    expect(denied(await bash($, 'gh pr merge 7'), '')).toBe(true);
    await say($, 'merge up to #3');
    expect(ran(await bash($, 'gh stack merge 3 --yes'))).toBe(true);
    await say($, 'merge up to #2');
    expect(denied(await bash($, 'gh stack merge 3 --yes'), 'merges #2, #3 together')).toBe(true);
  });
  test('a merge asked for covers the version pull request, looked up or not', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('oakum/version-packages'),
    });
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
    // Named by number, it is looked up to find it was the version pull request.
    expect(w.calls.some((c) => c.argv.join(' ').startsWith('gh pr view 62'))).toBe(true);
  });
  test('a merge asked for by number releases only the version PR it names', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, 'merge 131');
    const other = 'it merges #130, and the user asked to merge #131';
    expect(denied(await bash($, 'gh pr merge 130'), other)).toBe(true);
    await say($, 'merge #130');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a yes to an offer naming the version PR among others releases it', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', 'Merge #3 and #130?');
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a refused yes names the question it answered', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn(
      $,
      'answer',
      'Should I squash-merge #3, then #4? They touch different files, so neither needs a rebase after the other merges.',
    );
    await say($, 'Ok, lets do that');
    const r = await bash($, 'gh pr merge 3 --squash');
    expect(denied(r, 'a question the gate does not read')).toBe(true);
    expect(denied(r, '("Should I squash-merge #3')).toBe(true);
    const viaMcp = await mcp($, 'mcp__github__merge_pull_request', {
      owner: 'o',
      repo: 'r',
      pullNumber: 3,
    });
    expect(denied(viaMcp, '("Should I squash-merge #3')).toBe(true);
    // A prompt queued into the turn keeps the reason; a later message drops it.
    await queue($, 'also update the docs');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), '("Should I squash-merge #3')).toBe(
      true,
    );
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), 'does not read')).toBe(false);
  });
  test("a session's end drops the reason a refused yes gave", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    on('session.end', () => ({ sessionId: 's' }));
    await endTurn(
      $,
      'answer',
      'Should I squash-merge #3, then #4? They touch different files, so neither needs a rebase after the other merges.',
    );
    await say($, 'Ok, lets do that');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), '("Should I squash-merge #3')).toBe(
      true,
    );
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    const r = await bash($, 'gh pr merge 3 --squash');
    expect(denied(r, 'merge')).toBe(true);
    expect(denied(r, '("Should I squash-merge #3')).toBe(false);
  });
  test('a refused yes names its reason only for the steps the offer named', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('pr') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I open a PR? After that, CI will run.');
    await say($, 'yes');
    expect(
      denied(await bash($, 'gh pr create --fill'), 'a question the gate does not read ("Should I'),
    ).toBe(true);
    const merge = await bash($, 'gh pr merge 3 --squash');
    expect(denied(merge, "doesn't ask for a merge")).toBe(true);
    expect(denied(merge, 'does not read')).toBe(false);
  });
  test('a queued retraction drops the reason with the yes', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await say($, 'yes');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), 'does not read')).toBe(true);
    await queue($, 'never mind');
    const r = await bash($, 'gh pr merge 3 --squash');
    expect(denied(r, "doesn't ask for a merge")).toBe(true);
    expect(denied(r, '(their')).toBe(false);
  });
  test('a queued yes to an offer the gate cannot read gets its reason', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await queue($, 'yes');
    expect(
      denied(
        await bash($, 'gh pr merge 3 --squash'),
        'a question the gate does not read ("Should I',
      ),
    ).toBe(true);
  });
  test('a merge offer the gate cannot read names its reason on the release it is', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', 'Should I merge #62? After that, CI will run.');
    await say($, 'yes');
    expect(
      denied(await bash($, 'gh pr merge 62'), 'a question the gate does not read ("Should I'),
    ).toBe(true);
  });
  test("a merge offer's reason stays off a push it never offered", async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('push') }, git: remoteSide({}) }));
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await say($, 'yes');
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, '(their')).toBe(false);
  });
  test('a refused yes to a push or a commit names its question too', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('commit') }, git: remoteSide({}) }));
    await review($);
    await endTurn($, 'answer', 'Should I commit and push? After that, CI will run.');
    await say($, 'yes');
    expect(
      denied(await bash($, 'git commit -am x'), 'a question the gate does not read ("Should I'),
    ).toBe(true);
    expect(
      denied(
        await bash($, 'git push origin fix/x'),
        'a question the gate does not read ("Should I',
      ),
    ).toBe(true);
    expect(
      denied(
        await bash($, 'git push origin --delete old'),
        'a question the gate does not read ("Should I',
      ),
    ).toBe(true);
  });
  test('a pick among offered pull requests merges those, across turns', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I squash-merge #3, then #4?');
    await say($, 'merge both');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    // The agent may end its turn while GitHub recalculates #4; the grant is the message's.
    await endTurn($, 'answer', '#3 merged; GitHub is still checking #4.');
    expect(ran(await bash($, 'gh pr merge 4 --squash'))).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 4 --squash'), "doesn't ask for a merge")).toBe(true);
  });
  test('a merge naming one of two offered pull requests merges only that one', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I squash-merge #3, then #4?');
    await say($, 'merge #3');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    const other = 'it merges #4, and the user asked to merge #3';
    expect(denied(await bash($, 'gh pr merge 4 --squash'), other)).toBe(true);
  });
  test('a yes to a squash-merge offer listing pull requests in turn merges each', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Squash-merge #3 and #4?');
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    expect(ran(await bash($, 'gh pr merge 4 --squash'))).toBe(true);
    const other = 'it merges #5, and the user asked to merge #3, #4';
    expect(denied(await bash($, 'gh pr merge 5 --squash'), other)).toBe(true);
  });
  test('a merge asked for with a release held off does not release', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, "merge #130. don't release yet.");
    expect(denied(await bash($, 'gh pr merge 130'), 'held off')).toBe(true);
  });
  test('a release held off beside a merge holds past an earlier hold', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, "don't merge yet");
    await say($, "merge #130. don't release yet.");
    expect(denied(await bash($, 'gh pr merge 130'), 'held off')).toBe(true);
  });
  test('"merge it" naming another pull request elsewhere asks before releasing', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', '#130 is the version PR, which releases.\n\nMerge #131?');
    await say($, 'merge it');
    const other = 'it merges #130, and the user asked to merge #131';
    expect(denied(await bash($, 'gh pr merge 130'), other)).toBe(true);
    await endTurn($, 'answer', 'Release by merging #130?');
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  // The answer offers an unnumbered merge; its last bullet only mentions release PR #52.
  const mentioned =
    'The branch is current.\n- **Release PR #52:** it should not trigger Visual.\n\nSay the word to merge.';
  test('a merge of the pull request the answer offered runs no other', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    const other = 'it merges #74, and the user asked to merge #52';
    expect(denied(await bash($, 'gh pr merge 74 --squash'), other)).toBe(true);
  });
  // #40 is offered three paragraphs up; the closing lines name no pull request.
  const farUp = [
    '#40 passes its checks and is ready to merge.',
    'I also looked at the flaky test; it is unrelated.',
    'The docs build is green.',
    'Want me to merge it?',
  ].join('\n\n');
  test('a merge naming no pull request runs one the answer named anywhere', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
  });
  test('a merge naming no pull request asks before one nothing pointed at', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge it');
    const r = await bash($, 'gh pr merge 200 --squash');
    expect(denied(r, 'neither they nor the answer they replied to named #200')).toBe(true);
    expect(denied(r, 'The question: Merge #200? The command:')).toBe(true);
  });
  test('a queued merge keeps the number it named beside an unnamed one', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge it');
    await queue($, 'and merge 41');
    expect(ran(await bash($, 'gh pr merge 41 --squash'))).toBe(true);
  });
  test('a merge asked for once ready outlasts unrelated messages, until used', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'While we wait on that lets plan out our next bit of work');
    // A wake from another plugin neither grants nor ends it.
    await say($, 'pr-watch: #46 is ready to merge. merge 47', 'plugin');
    expect(await bash($, 'gh pr merge 47 --auto')).toMatchObject({
      deny: expect.stringContaining('#47'),
    });
    expect(await bash($, 'gh pr merge 46 --auto')).not.toHaveProperty('deny');
    await say($, 'thanks');
    expect(await bash($, 'gh pr merge 46 --auto')).toMatchObject({
      deny: expect.stringContaining("doesn't ask for a merge"),
    });
  });
  test('a merge asked for once ready runs through the GitHub tool once it is ready', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('merge') },
      git: (a) =>
        a === 'git symbolic-ref --quiet --short HEAD'
          ? { stdout: 'main\n' }
          : github('fix/x', 'main', false, 'github.com/o/r', 'CLEAN')(a),
    });
    await say($, 'merge 46 once CI passes');
    await say($, 'While we wait on that lets plan out our next bit of work');
    const merge = { owner: 'o', repo: 'r', pullNumber: 46 };
    expect(ran(await mcp($, 'mcp__github__merge_pull_request', merge))).toBe(true);
  });
  test('a merge asked for once ready runs on a wake only once it is ready', async ($, on) => {
    let state = 'BLOCKED';
    fakeWorld(on, {
      settings: { local: stops('merge') },
      git: (a) =>
        a === 'git symbolic-ref --quiet --short HEAD'
          ? { stdout: 'main\n' }
          : github('fix/x', 'main', false, 'github.com/o/r', state)(a),
    });
    await say($, 'merge 46 once CI passes');
    await say($, 'While we wait on that lets plan out our next bit of work');
    await say($, 'pr-watch: #46 changed', 'plugin');
    expect(denied(await bash($, 'gh pr merge 46 --squash'), 'BLOCKED')).toBe(true);
    state = 'CLEAN';
    await say($, 'pr-watch: #46 is ready to merge', 'plugin');
    expect(ran(await bash($, 'gh pr merge 46 --squash'))).toBe(true);
  });
  test('a merge now in a later message never reaches a pull request asked for once ready', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'merge it');
    expect(denied(await bash($, 'gh pr merge 46 --squash'), 'BLOCKED')).toBe(true);
  });
  test('a merge that fails leaves its standing ask', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'thanks');
    w.bashFails = true;
    await bash($, 'gh pr merge 46 --auto');
    w.bashFails = false;
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
  });
  test('a merge on a standing ask is refused behind a pipe, which hides whether it failed', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'thanks');
    const r = await bash($, 'gh pr merge 46 --auto 2>&1 | tail -4');
    expect(denied(r, "reports the filter's exit status")).toBe(true);
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
  });
  test('using one standing ask leaves the others', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'merge 47 once CI passes');
    await say($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
    expect(ran(await bash($, 'gh pr merge 47 --auto'))).toBe(true);
  });
  test('an unnamed merge once ready ends with its message', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge it once CI passes');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 40 --auto'), 'merge')).toBe(true);
  });
  test('a merge asked for once ready ends on a merge hold, telling the agent', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'hold off on the docs push');
    await say($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
    await say($, 'merge 47 once CI passes');
    await say($, "don't merge 47 yet");
    expect(w.contexts?.join('\n')).toContain("ended the user's standing ask to merge #47");
    await say($, 'merge 48 once CI passes');
    await say($, 'do not push. do not merge 48');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 48 --auto'), 'merge')).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 47 --auto'), 'merge')).toBe(true);
  });
  test('a request beside other work grants nothing and tells the agent to ask', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'Ok, lets file that then we can merge 358');
    const note = (w.contexts ?? []).find((c) => c.includes('beside other work')) ?? '';
    expect(note).toContain('seems to ask for a merge beside other work');
    expect(note).toContain('mcp__review-cycle__offer');
    expect(denied(await bash($, 'gh pr merge 358 --squash'), 'merge')).toBe(true);
  });
  test('a message that only names a step, or asks for it outright, gets no such note', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'anything else before we merge?');
    await say($, 'merge 358');
    await say($, 'push it then merge it');
    expect((w.contexts ?? []).filter((c) => c.includes('beside other work'))).toEqual([]);
  });
  test('a merge hold typed into the running turn ends a standing merge', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 47 once CI passes');
    await queue($, "don't merge 47 yet");
    expect(w.contexts?.join('\n')).toContain("ended the user's standing ask to merge #47");
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 47 --auto'), 'merge')).toBe(true);
  });
  test('a main condition joins a standing release whose lookup fails', async ($, on) => {
    let listing = true;
    fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('gh api graphql')) return { stdout: 'main PENDING\n' };
        if (a.startsWith('gh pr list --head oakum/version-packages')) {
          return listing
            ? { stdout: '62:OPEN 55:MERGED\n' }
            : { exitCode: 1, stderr: 'gh: timeout' };
        }
        return github('oakum/version-packages')(a);
      },
    });
    await say($, 'release when the release PR is ready');
    listing = false;
    await say($, 'Ok, lets release once main and the release PR are ready');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'Run the same command again')).toBe(true);
  });
  test('a release asked for once main and the release PR are ready waits on main', async ($, on) => {
    let rollup = 'PENDING';
    fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('gh api graphql')) return { stdout: `main ${rollup}\n` };
        if (a.startsWith('gh pr list --head oakum/version-packages')) {
          return { stdout: '62:OPEN 55:MERGED\n' };
        }
        return github('oakum/version-packages')(a);
      },
    });
    await say($, 'Ok, lets release once main and the release PR are ready');
    await say($, 'While we wait on that lets plan out our next bit of work');
    await say($, 'pr-watch: #62 is ready to merge', 'plugin');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'Run the same command again')).toBe(true);
    rollup = 'SUCCESS';
    expect(ran(await bash($, 'gh pr merge 62 --auto'))).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'release')).toBe(true);
  });
  test('a standing release ask is refused behind a pipe, and still stands', async ($, on) => {
    fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('gh api graphql')) return { stdout: 'main SUCCESS\n' };
        if (a.startsWith('gh pr list --head oakum/version-packages')) {
          return { stdout: '62:OPEN 55:MERGED\n' };
        }
        return github('oakum/version-packages')(a);
      },
    });
    await say($, 'Ok, lets release once main and the release PR are ready');
    await say($, 'thanks');
    const r = await bash($, 'gh pr merge 62 --auto 2>&1 | tail -4');
    expect(denied(r, "reports the filter's exit status")).toBe(true);
    expect(ran(await bash($, 'gh pr merge 62 --auto'))).toBe(true);
  });
  test('a queued message keeps what the earlier one pointed at, until it retracts', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge it');
    await queue($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
    await say($, 'merge 41');
    await queue($, "actually, don't merge it");
    await queue($, 'merge it');
    expect(denied(await bash($, 'gh pr merge 41 --squash'), 'named #41')).toBe(true);
  });
  test('a merge naming no pull request asks when the branch read fails', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    w.reject = (a) => a === 'git symbolic-ref --quiet --short HEAD';
    await say($, 'merge it');
    const r = await bash($, 'gh pr merge 200 --squash');
    expect(denied(r, 'pointed at #200: reading the current branch failed (')).toBe(true);
    expect(denied(r, 'The question: Merge #200? The command:')).toBe(true);
  });
  test('the pull request the answer named stands for a merge that names none', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
  });
  test('a merge once ready whose lookup fails asks for a release too', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'merge it when its ready');
    const r = await bash($, 'gh pr merge 62 --auto');
    expect(denied(r, 'the gate cannot tell whether this is it')).toBe(true);
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    // A bare --auto merge needs no lookup to point at the branch's pull request.
    const bare = await bash($, 'gh pr merge --auto');
    expect(denied(bare, 'the merge may be a release, which the user has not allowed')).toBe(true);
  });
  test('a held merge asks; one beside a commit is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, "don't merge yet");
    expect(
      denied(
        await bash($, 'gh pr merge 116'),
        "held off (they put off a merge) and hasn't asked for a merge since",
      ),
    ).toBe(true);
    await review($);
    await say($, 'commit it and merge it');
    expect(
      denied(await bash($, 'git commit -am x && gh pr merge 116'), '`gh` alongside `git commit`'),
    ).toBe(true);
  });
  test('a GitHub MCP merge is judged as gh pr merge, under any server name', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 116, commit_message: 'long text' };
    const r = await mcp($, 'mcp__github__merge_pull_request', pr);
    expect(denied(r, "doesn't ask for a merge")).toBe(true);
    expect(
      denied(r, 'mcp__github__merge_pull_request {"owner":"o","repo":"r","pullNumber":116}'),
    ).toBe(true);
    const other = 'mcp__gh__work__merge_pull_request';
    expect(denied(await mcp($, other, pr), "doesn't ask for a merge")).toBe(true);
    await say($, 'merge it');
    expect(denied(await mcp($, other, pr), 'review-cycle')).toBe(false);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['116', '--repo', 'o/r']);
  });
  test('a GitHub MCP review approves only with APPROVE', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') } });
    await say($, 'fix the parser');
    const review = { owner: 'o', repo: 'r', pullNumber: 116, method: 'create' };
    const r = await mcp($, 'mcp__github__pull_request_review_write', {
      ...review,
      event: 'APPROVE',
    });
    expect(has(contextOf(r), 'ran an approval without asking')).toBe(true);
    const comment = { ...review, event: 'COMMENT' };
    expect(
      denied(await mcp($, 'mcp__github__pull_request_review_write', comment), 'a comment'),
    ).toBe(true);
    expect(
      denied(await mcp($, 'mcp__github__add_issue_comment', { issue_number: 9 }), 'a comment'),
    ).toBe(true);
  });
  test("updating a pull request's branch asks when its head is the default branch", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('main') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(denied(r, 'it pushes to `main`, the default branch')).toBe(true);
  });
  test("updating a feature pull request's branch runs below the rung, noted", async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['7', '--repo', 'o/r']);
    const repo = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repo?.argv[3]).toBe('github.com/o/r');
  });
  test("a pull request's branch update asks when its head cannot be looked up", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fail') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(denied(r, 'looking up the pull request it updates failed')).toBe(true);
  });
  test("a fork pull request's branch update asks whatever the setting", async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: github('develop', 'main', true),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch 7');
    expect(denied(r, "it updates a branch in the pull request's fork")).toBe(true);
  });
  test('gh pr update-branch is a push to the pull request branch', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch 7 -R o/r');
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['7', '--repo', 'o/r']);
    expect(denied(await bash($, 'gh pr update-branch 7 --rebase'), 'bare force')).toBe(true);
    const moved = await bash($, 'cd ../x && gh pr update-branch 7');
    expect(denied(moved, 'the pull request it updates cannot be looked up')).toBe(true);
  });
  test("a pull request named by URL is checked against its own repository's default", async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('open PR') },
      git: github('release', 'release', false, 'ghe.example.com/o2/r2'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch https://ghe.example.com/o2/r2/pull/7');
    expect(denied(r, 'it pushes to `release`, the default branch')).toBe(true);
    const repo = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repo?.argv[3]).toBe('ghe.example.com/o2/r2');
  });
  test('a GraphQL rebase of a pull request branch needs a bare force', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'push it');
    const rebase =
      'gh api graphql -f query=\'mutation { updatePullRequestBranch(input: {pullRequestId: "X", updateMethod: REBASE}) { clientMutationId } }\'';
    expect(denied(await bash($, rebase), 'bare force')).toBe(true);
  });
  test('a GitHub MCP commit is a push, and asks on the default branch', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const files = { owner: 'o', repo: 'r', files: [], message: 'm' };
    const r = await mcp($, 'mcp__github__push_files', { ...files, branch: 'fix/x' });
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(view?.argv.slice(3)).toEqual([
      'o/r',
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ]);
    const main = await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' });
    expect(denied(main, 'it pushes to `main`, the default branch')).toBe(true);
    expect(denied(main, 'It writes to GitHub directly, so no review covers it.')).toBe(true);
    await say($, 'push it');
    const unnamed = await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' });
    expect(denied(unnamed, 'which the request did not name')).toBe(true);
    await say($, 'push it to main');
    expect(ran(await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' }))).toBe(true);
  });
  test('a hold stops a GitHub MCP pull request at every rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, "don't open a PR yet");
    expect(denied(await mcp($, 'mcp__github__create_pull_request', {}), 'held off')).toBe(true);
  });
  test('a requested pull request lets no GitHub API push through', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('push') }, git: github('fix/x') });
    await say($, 'open a PR');
    const files = { owner: 'o', repo: 'r', files: [], message: 'm', branch: 'fix/x' };
    const r = await mcp($, 'mcp__github__push_files', files);
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(await bash($, 'gh pr update-branch 7 -R o/r'), "doesn't ask for a push")).toBe(
      true,
    );
  });
  test('a GitHub MCP push asks at the default setting', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__create_or_update_file', { branch: 'fix/x' });
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, '"Push `fix/x` to `origin`?"')).toBe(true);
  });
  test('a package publish is the release step', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'pnpm -r publish'), "doesn't ask for a release")).toBe(true);
    expect(denied(await bash($, 'pnpm exec oakum release'), 'a release')).toBe(true);
    expect(ran(await bash($, 'npm publish --dry-run'))).toBe(true);
    await say($, 'publish it');
    expect(ran(await bash($, 'pnpm -r publish'))).toBe(true);
  });
  test('a publish below the rung runs, noted; a subagent is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    const r = await bash($, 'cargo publish');
    expect(has(contextOf(r), 'ran a release without asking')).toBe(true);
    const sub = await bash($, 'npm publish', { agentId: 'sub-1' });
    expect(denied(sub, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('marking a pull request ready is the pull request step', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr ready 119'), "doesn't ask for a pull request")).toBe(true);
    const draft = { owner: 'o', repo: 'r', pullNumber: 119, draft: false };
    const mcpReady = await mcp($, 'mcp__github__update_pull_request', draft);
    expect(denied(mcpReady, "doesn't ask for a pull request")).toBe(true);
    expect(ran(await bash($, 'gh pr ready 119 --undo'))).toBe(true);
    await say($, 'open a pr');
    expect(ran(await bash($, 'gh pr ready 119'))).toBe(true);
  });
  test('a subagent naming gh as data runs', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    const sub = { agentId: 'sub-1' };
    expect(ran(await bash($, 'for c in none gh docs; do echo "$c"; done', sub))).toBe(true);
    expect(ran(await bash($, 'which gh go', sub))).toBe(true);
    expect(ran(await bash($, 'select x in a gh b; do break; done', sub))).toBe(true);
    const merge = await bash($, '[ -x /usr/local/bin/gh ] && gh pr merge 5', sub);
    expect(denied(merge, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('a subagent’s gh call the gate cannot read is told how to write it out', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    const sub = { agentId: 'sub-1' };
    const unread = await bash($, 'gh api "$p" --jq .number', sub);
    expect(denied(unread, 'built at run time')).toBe(true);
    expect(denied(unread, 'a read can name `--method GET`')).toBe(true);
    expect(denied(unread, 'subagents do not')).toBe(false);
    expect(ran(await bash($, 'gh api repos/o/r/pulls/1', sub))).toBe(true);
    const beside = await bash($, 'gh api "$p"; gh pr merge 5', sub);
    expect(denied(beside, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('a GitHub MCP write from a subagent is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'ship it');
    const r = await mcp($, 'mcp__github__create_pull_request', {}, { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  const unreadDefaults: [Partial<Run> | 'reject', string][] = [
    [{ exitCode: 1, stderr: 'HTTP 404' }, 'looking up the default branch failed (HTTP 404)'],
    [{ stdout: '\n' }, 'looking up the default branch printed nothing'],
    ['reject', 'looking up the default branch failed'],
  ];
  for (const [answer, why] of unreadDefaults) {
    test(`a GitHub push asks when ${why}`, async ($, on) => {
      fakeWorld(on, {
        settings: { local: stops('never stop') },
        git: (a) => (a.startsWith('gh repo view') && answer !== 'reject' ? answer : null),
        reject: (a) => answer === 'reject' && a.startsWith('gh repo view'),
      });
      await say($, 'fix the parser');
      const push = { owner: 'o', repo: 'r', branch: 'fix/x' };
      expect(denied(await mcp($, 'mcp__github__push_files', push), why)).toBe(true);
    });
  }
  test('a forced ref update needs a bare force, not a push request', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'push it');
    const force = 'gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true -f sha=abc';
    const r = await bash($, force);
    expect(denied(r, "doesn't ask for a bare force")).toBe(true);
    expect(denied(r, '"Force-push `fix/x` to `origin` without a lease?"')).toBe(true);
    await say($, 'force push it without a lease');
    expect(denied(await bash($, force), OWN_PARAGRAPH('main'))).toBe(true);
    await say($, 'force push to main without a lease');
    expect(ran(await bash($, force))).toBe(true);
  });
  test('a GitHub MCP merge without a number asks where a release could follow', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 });
    expect(denied(r, 'does not name the pull request by number and repository')).toBe(true);
    await say($, 'merge it');
    expect(
      denied(
        await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 }),
        'the gate cannot tell whether this is it',
      ),
    ).toBe(true);
    await endTurn($, 'answer', farUp.replace('#40', '#5'));
    await say($, 'merge it');
    expect(ran(await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 }))).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ').startsWith('gh pr view'))).toBe(false);
  });
  test('a GitHub MCP call a newer message overtakes does not run', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      settingsRead: () => {
        if (typed) return;
        typed = true;
        void say($, "actually, don't open it yet");
      },
    });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__create_pull_request', {});
    expect(denied(r, 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('a gh api push to a feature branch runs below the rung, noted', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh api -X PUT repos/o/r/contents/a.md -f branch=fix/x -f message=m');
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
  });
  test('gh api writes are judged by endpoint', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(
      denied(
        await bash($, 'gh api -X PUT repos/{owner}/{repo}/pulls/116/merge'),
        "doesn't ask for a merge",
      ),
    ).toBe(true);
    expect(
      denied(
        await bash($, 'gh api repos/{owner}/{repo}/contents/a.md -X PUT -f branch=main'),
        'it pushes to `main`, the default branch',
      ),
    ).toBe(true);
    expect(denied(await bash($, 'gh api graphql -f query="$Q"'), 'Write the query out')).toBe(true);
    expect(ran(await bash($, 'gh api repos/{owner}/{repo}/pulls/116'))).toBe(true);
  });
  test('the project file cannot stop later than the user', async ($, on) => {
    fakeWorld(on, { settings: { project: stops('never stop') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
  });
  test('settings that cannot be read stop before every step', async ($, on) => {
    fakeWorld(on, { settings: { project: 'throw', local: stops('never stop') } });
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(denied(r, 'could not read .claude/settings.json: ')).toBe(true);
    expect(denied(r, 'settings unreadable, so the gate stops before every step')).toBe(true);
    expect(denied(r, "doesn't ask for a push")).toBe(true);
  });
  test('an unreadable local file is named as the one that failed', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore.unreadable).toContain('.claude/settings.local.json: ');
    expect(status.stopBefore.from).toBe('unreadable settings');
    expect(
      denied(await bash($, 'gh pr create'), 'could not read .claude/settings.local.json'),
    ).toBe(true);
  });
  test('a message with a hold word runs nothing, and holds the step it names', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "push it; don't open a PR yet");
    expect(denied(await bash($, 'git push'), 'held off (they put off a push)')).toBe(true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect([status.stopBefore.held, status.mayPush, status.mayOpenPr]).toEqual([
      true,
      false,
      false,
    ]);
  });
  test('a commit rung asks before a reviewed --continue, and a yes continues', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, "doesn't ask for a commit")).toBe(true);
    const offer = 'Commit the resolution to `fix/x` and finish the rebase?';
    expect(denied(r, `"${offer}"`)).toBe(true);
    expect(denied(r, 'gives for step finish,')).toBe(true);
    await ($ as any).turn.complete({
      answer: `Reviewed and clean.\n\n${offer}`,
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('a finish waiting on CI lets nothing through', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'when CI passes, finish the rebase, then merge it');
    expect(denied(await bash($, 'GIT_EDITOR=true git rebase --continue'), 'commit')).toBe(true);
  });
  test('"finish the rebase" lets that --continue through a commit rung, and nothing else', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'finish the rebase');
    expect(denied(await bash($, 'GIT_EDITOR=true git merge --continue'), 'commit')).toBe(true);
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('a commit rung asks before a reviewed commit, and a yes commits', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, "doesn't ask for a commit")).toBe(true);
    expect(denied(r, '"Commit the changes to `fix/x`?"')).toBe(true);
    expect(denied(r, 'gives for step commit,')).toBe(true);
    await ($ as any).turn.complete({
      answer: 'Reviewed and clean.\n\nCommit the changes to `fix/x`?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a hold does not stop a commit', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, "don't push yet");
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a hold makes every step ask until a message asks for one', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    expect(denied(await bash($, 'git push'), 'held off (')).toBe(true);
    await say($, 'rename the helper');
    expect(denied(await bash($, 'gh pr create'), 'held off (')).toBe(true);
    await say($, 'push it');
    expect(ran(await bash($, 'git push'))).toBe(true);
    await say($, 'rename it back');
    expect(ran(await bash($, 'gh pr create'))).toBe(true);
  });
  test('a mentioned merge holds no step below it', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'Anything else before we merge 77?');
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(ran(await bash($, 'gh pr create'))).toBe(true);
  });
  test('a request lifts an earlier hold', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    expect(denied(await bash($, 'git push'), 'held off (')).toBe(true);
    await say($, 'push it');
    expect(ran(await bash($, 'git push'))).toBe(true);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a later hold of a merge keeps an earlier hold of the push', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    await say($, "don't merge yet");
    expect(denied(await bash($, 'git push'), 'held off (')).toBe(true);
  });
  test('a merge put off holds no push', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await endTurn($, 'answer', 'Merge #77?');
    await say($, 'not yet');
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a push and pull request put off hold the push', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await endTurn($, 'answer', 'Push `fix/x` to `origin` and open a pull request?');
    await say($, 'not yet');
    expect(denied(await bash($, 'git push'), 'held off (')).toBe(true);
  });
  test('a mentioned pull request holds the pull request, not the push', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't open a PR yet");
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(denied(await bash($, 'gh pr create'), 'held off (')).toBe(true);
  });
  test('a subagent is refused at every rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'ship it');
    const r = await bash($, 'gh pr create --fill', { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('the status tool reports what may run and why', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toEqual({
      stopBefore: 'open PR',
      source: 'local',
      from: '.claude/settings.local.json',
      held: false,
      heldBy: null,
      mandate: null,
    });
    await say($, 'anything else before we merge?');
    const held = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(held.stopBefore).toMatchObject({
      held: true,
      heldBy: { step: 'merge', how: 'mentioned' },
    });
    expect([status.mayCommit, status.mayPush, status.mayOpenPr]).toEqual([true, true, false]);
  });
  test('the status tool says a commit may not run at a commit rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect([status.mayCommit, status.mayPush]).toEqual([false, false]);
  });
  test('only the user changes it', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.stopBefore',
      value: 'never stop',
      previous: 'push',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
    expect(await $.config.set({ ...change, origin: { kind: 'composer' } })).toEqual({
      value: 'never stop',
    });
  });
});

describe('reviewer containment', () => {
  test("a reviewer's command that changes the repository is reported", async ($, on) => {
    const w = fakeWorld(on);
    // As `--show-scope -z` prints it: scope, then key and value, each ended by NUL.
    let config = 'local\0core.bare\nfalse\0local\0x.demo\none\ntwo\0';
    let global = 'global\0user.name\nme\0';
    let staged = 'a'.repeat(40);
    let branch = 'refs/heads/main\n';
    w.git = (a) => {
      if (a === 'git config --list --show-scope -z') return { stdout: `${global}${config}` };
      if (a.includes('git ls-files -s')) return { stdout: staged };
      if (a === 'git symbolic-ref -q HEAD') return { stdout: branch };
      return null;
    };
    w.shell = (c) => {
      if (c.startsWith('sed')) w.work['a.ts'] = 'two';
      if (c.startsWith('git config user.email')) config += 'local\0user.email\nx@y\0';
      if (c.startsWith('git add')) staged = 'b'.repeat(40);
      if (c.startsWith('git switch')) branch = 'refs/heads/scratch\n';
      if (c.startsWith('git reset')) w.head = 'd'.repeat(40);
      if (c.startsWith('git config --global')) global = 'global\0user.name\nyou\0';
      if (c.startsWith('git config x.demo')) config = config.replace('two', 'three');
    };
    const leg = await legUnderWay($);
    const first = await bash($, "sed -i '' s/one/two/ a.ts", { agentId: leg });
    expect(ran(first)).toBe(true);
    expect(has(first.context ?? [], 'the working tree of the repository under review')).toBe(true);
    // The gate's own note on the same call survives beside the reviewer's.
    expect(has(first.context ?? [], "could not read the user's shell aliases")).toBe(true);
    const clean = await bash($, 'cp -r . /tmp/copy', { agentId: leg });
    expect(ran(clean) && (clean.context ?? []).length === 0).toBe(true);
    for (const c of [
      'git config --global user.name you',
      'git config user.email x@y',
      'git config x.demo one',
      'git add a.ts',
      'git switch -c scratch',
    ]) {
      await bash($, c, { agentId: leg });
    }
    await bash($, 'git reset --soft HEAD~1', { agentId: leg });
    expect(await reviewerChanges($)).toEqual([
      "review-cycle:code-reviewer: the working tree changed while `sed -i '' s/one/two/ a.ts` ran, by it or by another agent",
      'review-cycle:code-reviewer: the local git config changed while `git config user.email x@y` ran, by it or by another agent',
      'review-cycle:code-reviewer: the local git config changed while `git config x.demo one` ran, by it or by another agent',
      'review-cycle:code-reviewer: the staged content changed while `git add a.ts` ran, by it or by another agent',
      'review-cycle:code-reviewer: HEAD changed while `git switch -c scratch` ran, by it or by another agent',
      'review-cycle:code-reviewer: HEAD changed while `git reset --soft HEAD~1` ran, by it or by another agent',
    ]);
  });
  test("the main session's commands are not compared", async ($, on) => {
    const w = fakeWorld(on);
    w.shell = () => {
      w.work['a.ts'] = 'two';
    };
    const r = await bash($, 'echo hi > a.ts');
    expect(ran(r) && !has(r.context ?? [], 'of the repository under review changed')).toBe(true);
    expect(await reviewerChanges($)).toEqual([]);
  });
  test('a working tree that cannot be built leaves the other parts compared', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    let config = 'local\0core.bare\nfalse\0';
    w.git = (a) => (a === 'git config --list --show-scope -z' ? { stdout: config } : null);
    w.fail = (a) => a === 'git add -A';
    w.shell = () => {
      config += 'local\0user.email\nx@y\0';
    };
    await bash($, 'git config user.email x@y', { agentId: leg });
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: the local git config changed while `git config user.email x@y` ran, by it or by another agent',
      'review-cycle:code-reviewer: could not check the working tree (git add -A failed: fatal: injected) while `git config user.email x@y` ran',
    ]);
  });
  test('an unreadable part is said, and the readable parts are still compared', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    let reads = 0;
    // Readable before the command, unreadable after it.
    w.fail = (a) => a === 'git rev-parse --verify -q HEAD' && ++reads > 1;
    w.shell = () => {
      w.work['a.ts'] = 'two';
    };
    const r = await bash($, 'ls', { agentId: leg });
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: the working tree changed while `ls` ran, by it or by another agent',
      'review-cycle:code-reviewer: could not check HEAD while `ls` ran',
    ]);
  });
  test('a leg capped mid-command keeps its could-not-check, marked over budget', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    let isCapped = false;
    w.fail = (a) => isCapped && a === 'git add -A';
    w.shell = () => {
      w.timers?.[0]?.fire();
      isCapped = true;
    };
    await bash($, 'sleep 60', { agentId: leg });
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: could not check the working tree (git add -A failed: fatal: injected) while `sleep 60` ran, its leg over budget',
    ]);
  });
  test('an unreadable HEAD is said, not reported as a change', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    w.fail = (a) => a === 'git rev-parse --verify -q HEAD';
    const r = await bash($, 'ls', { agentId: leg });
    expect(ran(r)).toBe(true);
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
  });
  test('a background command is said to be checked only until it returns', async ($, on) => {
    fakeWorld(on);
    const leg = await legUnderWay($);
    const r = await bash($, 'pnpm test', { agentId: leg, run_in_background: true });
    expect(has(r.context ?? [], 'runs in the background')).toBe(true);
  });
  test('a detached or unborn HEAD is read, not said unreadable', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    for (const [argv, why] of [
      ['git symbolic-ref -q HEAD', 'detached'],
      ['git rev-parse --verify -q HEAD', 'unborn'],
    ] as const) {
      w.git = (a) => (a === argv ? { exitCode: 1, stdout: '' } : null);
      const r = await bash($, `echo ${why}`, { agentId: leg });
      expect(ran(r) && !has(r.context ?? [], 'could not check')).toBe(true);
    }
    // Both reads exiting 1 is no state git has: a read that failed.
    w.git = (a) =>
      a.startsWith('git rev-parse --verify -q HEAD') || a === 'git symbolic-ref -q HEAD'
        ? { exitCode: 1, stdout: '' }
        : null;
    const r = await bash($, 'ls', { agentId: leg });
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
  });
  for (const [argv, part] of [
    ['ls-files -s', 'the staged content'],
    ['git config --list --show-scope', 'the local git config'],
  ] as const) {
    test(`unreadable ${part} is said`, async ($, on) => {
      const w = fakeWorld(on);
      const leg = await legUnderWay($);
      w.fail = (a) => a.includes(argv);
      const r = await bash($, 'ls', { agentId: leg });
      expect(has(r.context ?? [], `could not check whether this command changed ${part}`)).toBe(
        true,
      );
    });
  }
});

const pushRan = async ($: any) => ran(await bash($, 'git push origin fix/x'));

describe('an epic mandate', () => {
  const START = 'ok, lets do epic cpl-czgp';

  test('"do epic <id>" lets pushes and pull requests run, never a merge', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    expect(await pushRan($)).toBe(true);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(denied(await bash($, 'gh pr merge 5 --squash'), 'merge')).toBe(true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toMatchObject({ stopBefore: 'merge', source: 'mandate' });
    expect(status.stopBefore.mandate).toEqual({ epic: 'cpl-czgp' });
  });
  test("the session's end ends it", async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    on('session.end', () => ({ sessionId: 's' }));
    await say($, START);
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await say($, 'start on the parser');
    expect(await pushRan($)).toBe(false);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore.mandate).toBeNull();
  });
  test("the session's end right after a reload ends it, and drops the kept offer", async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    on('session.end', () => ({ sessionId: 's' }));
    reloadInto(
      on,
      keptRecord({ mandate: { epic: 'cpl-czgp' }, lastAnswer: 'Want me to push it?' }),
    );
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await say($, 'yes');
    expect(await pushRan($)).toBe(false);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore.mandate).toBeNull();
  });
  test('it lasts past a message that does not touch it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(true);
  });
  test('a hold ends it, and it stays ended', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'hold off on pushing for now');
    expect(denied(await bash($, 'git push origin fix/x'), 'held off')).toBe(true);
    // "push it" lifts the hold for itself; the job does not come back.
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a start that holds, declines or waits starts nothing', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    for (const text of ["don't do epic cpl-czgp yet", 'do epic cpl-czgp after lunch']) {
      await say($, text);
      expect(await pushRan($)).toBe(false);
    }
  });
  test('a decline of the offer it answers starts none', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await endTurn($, 'answer', 'Push it?');
    await say($, 'Not yet. Do epic cpl-czgp.');
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a hold on any step ends it, a merge mentioned beside a stop included', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'did the merge of 41 go through?');
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
    await say($, START);
    await say($, 'Stop the epic. Do not merge anything.');
    await say($, 'push it');
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a retraction ends it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'stop the epic');
    expect(await pushRan($)).toBe(false);
  });
  test('the Agent SDK starts one, and the agent is told why a step ran', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START, 'sdk');
    const r = await bash($, 'git push origin fix/x');
    expect(ran(r)).toBe(true);
    expect(contextOf(r).join('\n')).toContain('raised by the user\'s "do epic" request');
  });
  test('a prompt no person typed neither starts nor ends it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, 'do epic cpl-czgp', 'task-notification');
    expect(await pushRan($)).toBe(false);
    await say($, START);
    await say($, 'hold off on pushing', 'task-notification');
    expect(await pushRan($)).toBe(true);
  });
  test('a push to the default branch still asks', async ($, on) => {
    const main = { 'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'] };
    fakeWorld(on, pushing({ git: remoteSide(main) }));
    await say($, START);
    const r = await bash($, 'git push origin main');
    expect(denied(r, 'it pushes to `main`, the default branch.')).toBe(true);
  });
  test('a setting that stops later stands', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('release') }, git: remoteSide({}) }));
    await say($, START);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toMatchObject({ stopBefore: 'release', source: 'local' });
  });
});

// The question the offer tool returns, as the agent's answer ends on it.
async function offered($: any, input: Record<string, unknown>): Promise<string> {
  const r = (await $.tool.call({ tool: 'mcp__review-cycle__offer', ...input })) as {
    result: string;
  };
  return r.result.replace(/^.*word for word: /, '');
}

// GitHub's answer to THREAD_QUERY: a pullfrog thread on the user's open #109.
const threadAnswer = (
  over: { starter?: string; author?: string; state?: string; repo?: string; last?: object } = {},
) =>
  JSON.stringify({
    data: {
      node: {
        isResolved: false,
        pullRequest: {
          repository: { nameWithOwner: over.repo ?? 'o/r' },
          number: 109,
          state: over.state ?? 'OPEN',
          isCrossRepository: false,
          reviewDecision: null,
          author: { login: over.author ?? 'me' },
          commits: { nodes: [{ commit: { oid: 'a5f6f70aaaa' } }] },
        },
        first: { nodes: [{ author: { __typename: over.starter ?? 'Bot' } }] },
        last: { nodes: [over.last ?? { author: { login: 'pullfrog' }, body: 'finding' }] },
      },
    },
  });

// GitHub for o/r as user `me`; `post` and `resolve` replace the mutations' answers.
const github109 =
  (answer = threadAnswer(), over: { post?: Partial<Run>; resolve?: Partial<Run> } = {}) =>
  (a: string): Partial<Run> | null =>
    a === 'gh api user --jq .login'
      ? { stdout: 'me\n' }
      : a.startsWith('gh repo view --json nameWithOwner')
        ? { stdout: 'o/r\n' }
        : a.includes('addPullRequestReviewThreadReply')
          ? (over.post ?? { stdout: 'https://github.com/o/r/pull/109#discussion_r1\n' })
          : a.includes('resolveReviewThread')
            ? (over.resolve ?? { stdout: 'true\n' })
            : /id=PRRT_\w+ /.test(`${a} `)
              ? { stdout: answer }
              : null;

async function replied($: any, input: Record<string, unknown>): Promise<string> {
  const r = (await $.tool.call({ tool: 'mcp__review-cycle__reply', ...input })) as {
    result: string;
  };
  return r.result;
}

const FIXED = { thread: 'PRRT_1', body: 'Fixed in a5f6f70.', commit: 'a5f6f70', resolve: true };
const posts = (w: World) =>
  w.calls.filter((c) => c.argv.join(' ').includes('addPullRequestReviewThreadReply')).length;
const resolves = (w: World) =>
  w.calls.filter((c) => c.argv.join(' ').includes('resolveReviewThread')).length;

describe('the reply tools', () => {
  test('threads lists the open threads of a pull request, bot or not', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.includes('reviewThreads')
          ? {
              stdout: JSON.stringify({
                data: {
                  repository: {
                    pullRequest: {
                      reviewThreads: {
                        nodes: [
                          {
                            id: 'PRRT_1',
                            isResolved: false,
                            path: 'a.rs',
                            line: 7,
                            first: {
                              nodes: [
                                { author: { __typename: 'Bot', login: 'pullfrog' }, body: 'x' },
                              ],
                            },
                          },
                          {
                            id: 'PRRT_2',
                            isResolved: true,
                            path: 'b.rs',
                            line: 1,
                            first: { nodes: [] },
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            }
          : null,
    });
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__threads', pr: '109' })) as {
      result: string;
    };
    expect(JSON.parse(r.result)).toEqual({
      pull: 109,
      threads: [
        {
          thread: 'PRRT_1',
          path: 'a.rs',
          line: 7,
          outdated: false,
          byBot: true,
          author: 'pullfrog',
          body: 'x',
          lastBy: '',
        },
      ],
    });
  });

  test('threads given no pr names the key it takes', async ($, on) => {
    fakeWorld(on);
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__threads', pull: '109' })) as {
      result: string;
    };
    expect(r.result).toBe('review-cycle: threads takes pr, a pull request number such as "109"');
  });

  test('under ask, a reply refuses with the offer question, and a yes to it posts and resolves', async ($, on) => {
    const w = fakeWorld(on, { git: github109() });
    await say($, 'fix the review findings');
    const refused = await replied($, { replies: [FIXED] });
    expect(refused).toContain('"outcome":"refused"');
    expect(refused).toContain('Reply to the review on #109?');
    expect(posts(w)).toBe(0);
    await endTurn($, 'answer', 'Fixed and pushed.\n\nReply to the review on #109?');
    await say($, 'yes');
    // Resolving follows the setting alone, so under ask the thread stays open.
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied"');
    expect([posts(w), resolves(w)]).toEqual([1, 0]);
    // Asked for, it is no unasked reply.
    expect(w.logs?.join('\n') ?? '').not.toContain('without asking');
  });

  test('a request queued after the one that asked keeps the reply asked for', async ($, on) => {
    const w = fakeWorld(on, { git: github109(threadAnswer({ starter: 'User' })) });
    await say($, 'reply to the review');
    await queue($, 'also fix the tests');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied"');
    expect(posts(w)).toBe(1);
  });

  test('push and reply posts unasked on a bot thread of your own pull request, without resolving, and says so', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: updating('push and reply') }, git: github109() });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied"');
    expect([posts(w), resolves(w)]).toEqual([1, 0]);
    expect(w.logs?.join('\n')).toContain(
      'review-cycle: answered review threads without asking, since the prUpdates setting is push and reply (#109: 1 reply, 0 resolved): https://github.com/o/r/pull/109#discussion_r1',
    );
  });

  test('push, reply and resolve also resolves it', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied and resolved"');
    expect([posts(w), resolves(w)]).toEqual([1, 1]);
    expect(w.logs?.join('\n')).toContain('#109: 1 reply, 1 resolved');
  });

  test('a thread a person opened still asks, whatever the setting', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(threadAnswer({ starter: 'User' })),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain('a person opened this thread');
    expect(posts(w)).toBe(0);
  });

  test('a declined reply stays held across later messages, until the user asks for one', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(),
    });
    await say($, "don't reply yet");
    expect(await replied($, { replies: [FIXED] })).toContain('the user held off replying');
    await say($, 'fix the tests');
    expect(await replied($, { replies: [FIXED] })).toContain('the user held off replying');
    expect(posts(w)).toBe(0);
    await say($, 'ok, reply to the review now');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied and resolved"');
    await say($, 'fix the lint');
    // The request lifted the hold, so the setting runs again.
    expect(await replied($, { replies: [{ ...FIXED, thread: 'PRRT_2' }] })).toContain(
      '"outcome":"replied and resolved"',
    );
  });

  test('a mention of the review comments holds nothing', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: updating('push and reply') }, git: github109() });
    await say($, 'fix the review comments');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied"');
    expect(posts(w)).toBe(1);
  });

  test('a subagent replies to nothing, whatever the setting or the yes', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(),
    });
    await endTurn($, 'answer', 'Reply to the review on #109?');
    await say($, 'yes');
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__reply',
      agentId: 'sub-1',
      replies: [FIXED],
    } as any)) as { result: string };
    expect(r.result).toContain('subagents do not');
    expect(posts(w)).toBe(0);
  });

  test("another repository's thread refuses, even after a yes", async ($, on) => {
    const w = fakeWorld(on, { git: github109(threadAnswer({ repo: 'someone/else' })) });
    await endTurn($, 'answer', 'Reply to the review on #109?');
    await say($, 'yes');
    const r = await replied($, { replies: [FIXED] });
    expect(r).toContain('#109 is in someone/else, not this repository');
    expect(r).not.toContain('Reply to the review on #109?');
    expect(posts(w)).toBe(0);
  });

  for (const [label, post] of [
    [
      'GitHub refused',
      { exitCode: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)' },
    ],
    [
      'gh is not logged in',
      { exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' },
    ],
    [
      'a connection never made',
      {
        exitCode: 1,
        stderr:
          'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
      },
    ],
  ] as const) {
    test(`a post ${label} failed, is not retried and resolves nothing`, async ($, on) => {
      const w = fakeWorld(on, {
        settings: { local: updating('push, reply and resolve') },
        git: github109(threadAnswer(), { post }),
      });
      await say($, 'fix the review findings');
      expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"failed"');
      expect([posts(w), resolves(w)]).toEqual([1, 0]);
    });
  }

  for (const [label, post] of [
    ['a gateway error', { exitCode: 1, stderr: 'gh: Bad Gateway (HTTP 502)' }],
    ['a killed gh', { exitCode: 1, stderr: '' }],
    [
      'GitHub’s own timeout',
      {
        exitCode: 1,
        stderr:
          'gh: Something went wrong while executing your query. This may be the result of a timeout.',
      },
    ],
    [
      'a TLS fault after the request',
      {
        exitCode: 1,
        stderr: 'Post "https://api.github.com/graphql": local error: tls: bad record MAC',
      },
    ],
    [
      'a dropped connection',
      {
        exitCode: 1,
        stderr: 'Post "https://api.github.com/graphql": read: connection reset by peer',
      },
    ],
  ] as const) {
    test(`a post ended by ${label} may have landed, so it is unknown`, async ($, on) => {
      const w = fakeWorld(on, {
        settings: { local: updating('push, reply and resolve') },
        git: github109(threadAnswer(), { post }),
      });
      await say($, 'fix the review findings');
      const r = await replied($, { replies: [FIXED] });
      expect(r).toContain('"outcome":"unknown"');
      expect(r).toContain('read the thread before trying again');
      expect([posts(w), resolves(w)]).toEqual([1, 0]);
    });
  }

  test('a resolve ended by a gateway error is unknown', async ($, on) => {
    fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(threadAnswer(), {
        resolve: { exitCode: 1, stderr: 'gh: Service Unavailable (HTTP 503)' },
      }),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain(
      '"outcome":"replied, resolve unknown"',
    );
  });

  test('a resolve that timed out is unknown', async ($, on) => {
    fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(),
      reject: (a) => a.includes('resolveReviewThread'),
      rejectWith: 'aborted: still running after 20000ms',
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain(
      '"outcome":"replied, resolve unknown"',
    );
  });

  test('a thread that cannot be read fails without the question', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push and reply') },
      git: github109('{"data":{"node":{}}}'),
    });
    await say($, 'fix the review findings');
    const r = await replied($, { replies: [FIXED] });
    expect(r).toContain('"outcome":"failed","why":"`PRRT_1` names no review thread"');
    expect(r).not.toContain('Reply to the review');
    expect(posts(w)).toBe(0);
  });

  test('settings it cannot read say so in the refusal', async ($, on) => {
    fakeWorld(on, {
      settings: { project: 'throw', local: updating('push and reply') },
      git: github109(),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain(
      'the prUpdates setting could not be read',
    );
  });

  test('a GitHub answer with a hole in it is read, not crashed on', async ($, on) => {
    const answer = JSON.parse(threadAnswer());
    answer.data.node.pullRequest.commits.nodes.push(null);
    answer.data.node.last.nodes = [null];
    const w = fakeWorld(on, {
      settings: { local: updating('push and reply') },
      git: github109(JSON.stringify(answer)),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain('"outcome":"replied"');
    expect(posts(w)).toBe(1);
  });

  test('a resolve GitHub refused or did not do reports the reply only', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(threadAnswer(), { resolve: { stdout: 'false\n' } }),
    });
    await say($, 'fix the review findings');
    const r = await replied($, { replies: [FIXED] });
    expect(r).toContain('"outcome":"replied, not resolved"');
    expect(r).toContain('GitHub answered isResolved false');
    expect(w.logs?.join('\n')).toContain('#109: 1 reply, 0 resolved');
  });

  test('a post that timed out or answered no comment is unknown, not failed', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push and reply') },
      git: github109(threadAnswer(), { post: { stdout: '\n' } }),
      reject: (a) => a.includes('PRRT_2') && a.includes('addPullRequestReviewThreadReply'),
      rejectWith: 'aborted: still running after 20000ms',
    });
    await say($, 'fix the review findings');
    const r = await replied($, { replies: [FIXED, { ...FIXED, thread: 'PRRT_2' }] });
    expect(r.match(/"outcome":"unknown"/g)).toHaveLength(2);
    expect(r).toContain('read the thread before trying again');
    expect(posts(w)).toBe(2);
    // Sent unasked, a reply that may have posted is still shown.
    expect(w.logs?.join('\n')).toContain('#109: 0 replies, 0 resolved, 2 may have posted');
  });

  test('a reply already posted is skipped, and its resolve can still be finished', async ($, on) => {
    const mine = { author: { login: 'me' }, body: 'Fixed in a5f6f70.' };
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(threadAnswer({ last: mine })),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED] })).toContain(
      '"outcome":"already replied and resolved"',
    );
    expect(await replied($, { replies: [{ ...FIXED, resolve: false }] })).toContain(
      '"outcome":"skipped"',
    );
    expect([posts(w), resolves(w)]).toEqual([0, 1]);
  });

  test('a preview posts nothing, and an unpushed commit or too many threads refuses', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: updating('push, reply and resolve') },
      git: github109(),
    });
    await say($, 'fix the review findings');
    expect(await replied($, { replies: [FIXED], preview: true })).toContain(
      '"outcome":"would reply and resolve"',
    );
    const unpushed = await replied($, { replies: [{ ...FIXED, commit: 'deadbee' }] });
    expect(unpushed).toContain('push it first');
    // A yes would not push the commit, so no question.
    expect(unpushed).not.toContain('Reply to the review');
    const many = Array.from({ length: 11 }, (_, i) => ({ thread: `PRRT_${i}`, body: 'x' }));
    expect(await replied($, { replies: many })).toContain('at most 10 threads a call');
    const ten = Array.from({ length: 10 }, (_, i) => ({ thread: `PRRT_${i}`, body: 'x' }));
    expect(await replied($, { replies: ten, preview: true })).not.toContain('at most');
    expect(
      await replied($, {
        replies: [
          { thread: 'PRRT_1', body: 'x' },
          { thread: 'PRRT_1', body: 'y' },
        ],
      }),
    ).toContain('a thread appears twice');
    expect(posts(w)).toBe(0);
  });
});

describe('the offer tool', () => {
  test('a yes to its merge question merges that pull request alone', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    const question = await offered($, { step: 'merge', pulls: ['3'] });
    expect(question).toBe('Merge #3?');
    await endTurn($, 'answer', `CI is green.\n\n${question}`);
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 4'))).toBe(false);
    expect(ran(await bash($, 'gh pr merge 3'))).toBe(true);
  });
  test('a yes to its release question lets the version pull request merge', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', await offered($, { step: 'release', pulls: ['130'] }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a yes to its push and pull request question lets both run', async ($, on) => {
    fakeWorld(on, pushing({}));
    const question = await offered($, { step: 'push-pr', branch: 'fix/x' });
    await endTurn($, 'answer', `Ready.\n\n${question}`);
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
  });
  test('a refused merge points at its question, and a yes to it merges', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 3');
    expect(denied(r, 'the question mcp__review-cycle__offer gives for step merge,')).toBe(true);
    await endTurn($, 'answer', await offered($, { step: 'merge', pulls: ['3'] }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 3'))).toBe(true);
  });
  test('a yes to its merge and release question merges the version pull request', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', await offered($, { step: 'merge-release', pulls: ['130'] }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a yes to its release question for a version releases it', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    const question = await offered($, { step: 'release', version: 'v0.25.0' });
    expect(question).toBe('Release `v0.25.0`?');
    await endTurn($, 'answer', question);
    await say($, 'yes');
    expect(ran(await bash($, 'gh release create v0.25.0'))).toBe(true);
  });
  // A release by hand, as on 2026-11-14: three tags at one commit, each pushed
  // and then released. git sends all three with a push of one (push.followTags).
  const VERSIONS = ['pr-kit@0.6.1', 'pr-watch@0.9.0', 'review-cycle@0.39.0'];
  const byHand = (): Partial<World> => {
    const pushes = remoteSide({
      'origin pr-kit@0.6.1': VERSIONS.map((v) => tagLine(v)),
      '--no-follow-tags origin pr-kit@0.6.1': [tagLine('pr-kit@0.6.1')],
    });
    const gh = github('main');
    return pushing({ settings: { local: stops('merge') }, git: (a) => pushes(a) ?? gh(a) });
  };

  test('one yes to a question naming the versions pushes each tag and creates each release', async ($, on) => {
    fakeWorld(on, byHand());
    await say($, 'ok, lets create them by hand');
    expect(denied(await bash($, 'git push origin pr-kit@0.6.1'), 'so nothing ran')).toBe(true);
    const question = await offered($, { step: 'release', versions: VERSIONS });
    expect(question).toBe('Release `pr-kit@0.6.1`, `pr-watch@0.9.0` and `review-cycle@0.39.0`?');
    await endTurn($, 'answer', `The tags are ready.\n\n${question}`);
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin pr-kit@0.6.1'))).toBe(true);
    for (const v of VERSIONS) {
      expect(ran(await bash($, `gh release create ${v} --verify-tag`)), v).toBe(true);
    }
  });

  test('"ok, lets release them" to that question covers the same', async ($, on) => {
    fakeWorld(on, byHand());
    await endTurn($, 'answer', await offered($, { step: 'release', versions: VERSIONS }));
    await say($, 'ok, lets release them');
    expect(ran(await bash($, 'git push origin pr-kit@0.6.1'))).toBe(true);
    expect(ran(await bash($, 'gh release create pr-watch@0.9.0'))).toBe(true);
  });

  test('a yes to one version’s question pushes that tag alone, and releases', async ($, on) => {
    fakeWorld(on, byHand());
    await endTurn($, 'answer', await offered($, { step: 'release', version: 'pr-kit@0.6.1' }));
    await say($, 'yes');
    const all = await bash($, 'git push origin pr-kit@0.6.1');
    expect(denied(all, 'it pushes the tag `pr-watch@0.9.0`, which the request did not name')).toBe(
      true,
    );
    expect(denied(all, '--no-follow-tags pushes only what the command names')).toBe(true);
    expect(ran(await bash($, 'git push --no-follow-tags origin pr-kit@0.6.1'))).toBe(true);
    expect(ran(await bash($, 'gh release create pr-kit@0.6.1'))).toBe(true);
  });

  test('a tag push nobody asked for is refused with the tag’s own question, and "yes, push the tag" answers it', async ($, on) => {
    fakeWorld(on, byHand());
    await say($, 'fix the parser');
    const command = 'git push --no-follow-tags origin pr-kit@0.6.1';
    const refused = await bash($, command);
    expect(denied(refused, 'The question: Push the `pr-kit@0.6.1` tag?')).toBe(true);
    expect(denied(refused, 'gives for step push')).toBe(false);
    const question = await offered($, { step: 'push-tag', version: 'pr-kit@0.6.1' });
    expect(question).toBe('Push the `pr-kit@0.6.1` tag?');
    await endTurn($, 'answer', question);
    await say($, 'Yes, push the tag');
    expect(ran(await bash($, command))).toBe(true);
    // The tag alone: its release is still to ask.
    expect(denied(await bash($, 'gh release create pr-kit@0.6.1'), 'so nothing ran')).toBe(true);
  });

  test('a push to the default branch nobody asked for is refused with the question that names it', async ($, on) => {
    const git = remoteSide({
      'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
    });
    fakeWorld(on, pushing({ settings: { local: stops('merge') }, git }));
    await say($, 'fix the parser');
    const refused = await bash($, 'git push origin main');
    expect(denied(refused, 'The question: Push to `main`?')).toBe(true);
    expect(denied(refused, 'gives for step push')).toBe(false);
    await endTurn($, 'answer', 'Done.\n\nPush to `main`?');
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin main'))).toBe(true);
  });

  test('a yes to a release of versions deletes no tag it named', async ($, on) => {
    const pushes = remoteSide({
      'origin --delete pr-kit@0.6.1': ['-\t:refs/tags/pr-kit@0.6.1\t[deleted]'],
    });
    const gh = github('main');
    fakeWorld(on, pushing({ settings: { local: stops('merge') }, git: (a) => pushes(a) ?? gh(a) }));
    await endTurn($, 'answer', await offered($, { step: 'release', versions: VERSIONS }));
    await say($, 'yes');
    const tag = await bash($, 'git push origin --delete pr-kit@0.6.1');
    expect(denied(tag, 'it deletes the tag `pr-kit@0.6.1`')).toBe(true);
  });

  test('a yes to its bare force-push question lets that push run', async ($, on) => {
    fakeWorld(on, pushing({}));
    await endTurn($, 'answer', await offered($, { step: 'force-push-bare', branch: 'fix/x' }));
    await say($, 'yes');
    expect(ran(await bash($, 'git push --force origin fix/x'))).toBe(true);
  });
  test('a yes to its stack push question lets the stack push run', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    const question = await offered($, { step: 'stack-push' });
    expect(question).toBe('Force-push the stack with a lease?');
    await endTurn($, 'answer', question);
    await say($, 'yes');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
  });
  test('a yes to its delete question deletes that branch', async ($, on) => {
    fakeWorld(on, pushing({}));
    const question = await offered($, { step: 'delete', branch: 'fix/x' });
    expect(question).toBe('Delete `fix/x` from `origin`?');
    await endTurn($, 'answer', question);
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin --delete fix/x'))).toBe(true);
  });
  test('a refused gh thread reply points at the reply tool', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'I updated the configs. You should be able to handle this on your own');
    // The command an agent ran in oakterm (#118) under push, reply and resolve.
    const r = await bash(
      $,
      "gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{url}}}' -f t=PRRT_1 -f b=done",
    );
    expect(denied(r, 'mcp__review-cycle__reply tool instead')).toBe(true);
    expect(denied(r, 'mcp__review-cycle__offer')).toBe(false);
  });
  test('a refused comment points at its question, and a yes to it posts', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr comment 109 --body done');
    expect(denied(r, 'the question mcp__review-cycle__offer gives for step comment')).toBe(true);
    // The fuller question an agent wrote in oakterm (#109) is not read as asked.
    await endTurn($, 'answer', 'Reply to and resolve the four review threads on #109?');
    await say($, 'yes');
    expect(denied(await bash($, 'gh pr comment 109 --body done'), 'a comment on GitHub')).toBe(
      true,
    );
    const question = await offered($, { step: 'comment', pulls: ['109'] });
    expect(question).toBe('Reply to the review on #109?');
    await endTurn($, 'answer', `Each reply names its fix commit.\n\n${question}`);
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr comment 109 --body done'))).toBe(true);
  });
  test('an offer it cannot phrase says why', async ($, on) => {
    fakeWorld(on);
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__offer',
      step: 'merge',
      pulls: ['#3'],
    })) as { result: string };
    expect(r.result).toContain('no question: pulls must be');
  });
});
