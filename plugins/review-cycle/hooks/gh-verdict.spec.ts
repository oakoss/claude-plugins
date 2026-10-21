import { describe, expect, test } from 'vitest';

import { grantOf, NAMED_ELSEWHERE, NO_GRANT, type Grant } from './consent';
import {
  judgeGh,
  parsePullRequest,
  type GhLookups,
  type Hold,
  type InForce,
  type Lookup,
} from './gh-verdict';
import type { GhAction } from './github';
import type { StopBefore } from './ladder';
import type { StackRead } from './stack';

type StackLookup = (n: number) => StackRead | { asks: string; slow?: true };

// What gh prints for oakum's version pull request in this repository.
const VERSION_PR = 'false https://github.com/o/r/pull/62 oakum/version-packages';

// GitHub as the lookups see it, recording each lookup made. The pull request
// lookup answers what gh prints, read as register.ts reads it.
function world(
  stopBefore: StopBefore,
  answers: Partial<
    Record<'mergeTarget' | 'branch' | 'repoUrl' | 'pullRequest' | 'defaultBranch', Lookup>
  > = {},
  unreadable?: string,
  stack?: StackLookup,
  lease?: { ok: true } | { asks: string },
) {
  const calls: string[] = [];
  const ladder: InForce = { stopBefore, source: 'local', ...(unreadable && { unreadable }) };
  const answer = <T>(call: string, value: T) => {
    calls.push(call);
    return Promise.resolve(value);
  };
  const pr = answers.pullRequest ?? { out: 'false https://github.com/o/r/pull/7 fix/x' };
  const lookups: GhLookups = {
    ladder: () => answer('ladder', ladder),
    // Not ready unless a test says so.
    mergeTarget: (lookup) =>
      answer(
        `mergeTarget ${lookup.join(' ')}`,
        // A stack's layers are looked up by number, each answering for itself
        // in the state the test gives.
        stack === undefined
          ? (answers.mergeTarget ?? { out: 'https://github.com/o/r/pull/1 OPEN BLOCKED' })
          : {
              out: `https://github.com/o/r/pull/${lookup[0]} ${answers.mergeTarget?.out ?? 'OPEN BLOCKED'}`,
            },
      ),
    repoUrl: () => answer('repoUrl', answers.repoUrl ?? { out: 'https://github.com/o/r' }),
    // The checkout is on the branch every pull request here is headed by.
    branch: () => answer('branch', answers.branch ?? { out: 'fix/x' }),
    pullRequest: (head, what) =>
      answer(
        `pullRequest ${head.join(' ')}`,
        pr.asks === undefined
          ? parsePullRequest(pr.out, what)
          : { asks: pr.asks, ...(pr.slow && { slow: pr.slow }) },
      ),
    defaultBranch: (repo) =>
      answer(`defaultBranch ${repo ?? '-'}`, answers.defaultBranch ?? { out: 'main' }),
    stack: (n) => answer(`stack ${n}`, stack?.(n) ?? { asks: 'no stack here' }),
    stackLease: (step, remote) =>
      answer(
        `stackLease ${step} ${remote ?? '-'}`,
        lease ?? { asks: 'this clone tracks no stack' },
      ),
  };
  return { calls, lookups };
}

const grant = (g: Partial<Grant> = {}): Grant => ({ ...NO_GRANT, ...g });
// What the ready lookup prints for pull request `n`.
const pull = (n: number, mergeState: string, repo = 'o/r', state = 'OPEN') => ({
  out: `https://github.com/${repo}/pull/${n} ${state} ${mergeState}\n`,
});
const asked = (prompt: string, answer = '') => grantOf(prompt, answer);
const push = (ref: Extract<GhAction, { kind: 'push' }>['ref']): GhAction => ({ kind: 'push', ref });
const merge = (auto: boolean): GhAction => ({ kind: 'merge', admin: false, auto, lookup: ['1'] });

async function judge(
  actions: GhAction[],
  w: ReturnType<typeof world>,
  granted = grant(),
  held: Hold = null,
  pointed: readonly string[] = [],
) {
  return judgeGh('the call', actions, granted, held, w.lookups, {}, null, pointed);
}

describe('GitHub writes on the ladder', () => {
  test('no write reads no settings', async () => {
    const w = world('commit');
    expect(await judge([], w)).toEqual({ ran: [] });
    expect(w.calls).toEqual([]);
  });

  test('a pull request runs below its rung, noted, and is refused at it', async () => {
    const below = await judge([{ kind: 'pr' }], world('merge'));
    expect(below).toEqual({
      ran: [{ step: 'pr', ladder: { stopBefore: 'merge', source: 'local' } }],
    });
    const at = await judge([{ kind: 'pr' }], world('open PR'));
    expect(at).toMatchObject({ deny: expect.stringContaining("doesn't ask for a pull request") });
    expect(await judge([{ kind: 'pr' }], world('open PR'), grant({ pr: true }))).toEqual({
      ran: [],
    });
  });

  test.each<GhAction>([{ kind: 'pr' }, { kind: 'release' }, { kind: 'approve' }])(
    'a hold stops %j at every rung',
    async (action) => {
      const r = await judge([action], world('never stop'), grant(), {
        step: 'merge',
        how: 'mentioned',
      });
      expect(r).toMatchObject({
        deny: expect.stringContaining(
          'the user held off (their message mentioned a merge without asking for one)',
        ),
      });
    },
  );

  test('a hold says why it held', async () => {
    const r = await judge([{ kind: 'pr' }], world('never stop'), grant(), {
      step: 'push',
      how: 'declined',
    });
    expect(r).toMatchObject({
      deny: expect.stringContaining('the user held off (they put off a push the agent offered)'),
    });
  });

  test('an unread write is refused with its remedy, or the default one', async () => {
    const own = await judge(
      [{ kind: 'unread', why: 'it is built at run time', remedy: 'Write it out.' }],
      world('never stop'),
    );
    expect(own).toMatchObject({
      deny: 'it is built at run time, so the gate cannot tell which step it takes, and nothing ran. Write it out. The command: the call',
    });
    const plain = await judge([{ kind: 'unread', why: 'x' }], world('never stop'));
    expect(plain).toMatchObject({
      deny: expect.stringContaining('Run the gh command itself, written out.'),
    });
  });

  test('unreadable settings are named in the refusal', async () => {
    const r = await judge([{ kind: 'approve' }], world('commit', {}, 'the local settings: bad'));
    expect(r).toMatchObject({ deny: expect.stringContaining('could not read the local settings') });
  });

  test('a comment needs the request whatever the rung', async () => {
    const r = await judge([{ kind: 'comment' }], world('never stop'));
    expect(r).toMatchObject({ deny: expect.stringContaining('"Reply to the review on #116?"') });
    expect(await judge([{ kind: 'comment' }], world('commit'), grant({ comment: true }))).toEqual({
      ran: [],
    });
  });
});

describe('a push through GitHub', () => {
  test('to a feature branch runs below the rung, after a default-branch lookup', async () => {
    const w = world('open PR');
    const r = await judge([push({ branch: 'fix/x', repo: 'o/r' })], w);
    expect(r).toMatchObject({ ran: [{ step: 'push' }] });
    expect(w.calls).toEqual(['ladder', 'defaultBranch o/r']);
  });

  test('to the default branch asks', async () => {
    const r = await judge([push({ branch: 'main', repo: 'o/r' })], world('never stop'));
    expect(r).toMatchObject({
      deny: expect.stringContaining('it pushes to `main`, the default branch'),
    });
  });

  test('a lookup that prints nothing asks', async () => {
    const r = await judge(
      [push({ branch: 'main', repo: 'o/r' })],
      world('never stop', { defaultBranch: { out: '' } }),
    );
    expect(r).toMatchObject({
      deny: expect.stringContaining('looking up the default branch printed nothing'),
    });
  });

  test('surrounding space in a lookup is not part of its answer', async () => {
    const padded = world('never stop', { defaultBranch: { out: ' main\n' } });
    expect(await judge([push({ branch: 'main', repo: 'o/r' })], padded)).toMatchObject({
      deny: expect.stringContaining('it pushes to `main`, the default branch'),
    });
    const release = world('release', { pullRequest: { out: VERSION_PR } });
    expect(
      await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], release),
    ).toMatchObject({
      deny: expect.stringContaining('"Release `v0.25.0`?"'),
    });
  });

  test('a pull request whose branch is empty asks', async () => {
    const w = world('never stop');
    w.lookups.pullRequest = () => Promise.resolve({ cross: false, repo: 'o/r', branch: '' });
    expect(await judge([push({ head: ['7'] })], w)).toMatchObject({
      deny: expect.stringContaining('names no branch'),
    });
  });

  test('a lookup that rejects reaches the caller, which refuses', async () => {
    const w = world('never stop');
    w.lookups.defaultBranch = () => Promise.reject(new Error('gh gone'));
    await expect(judge([push({ branch: 'fix/x', repo: 'o/r' })], w)).rejects.toThrow('gh gone');
    w.lookups.ladder = () => Promise.reject(new Error('settings gone'));
    await expect(judge([{ kind: 'pr' }], w)).rejects.toThrow('settings gone');
  });

  test('a failed lookup asks, saying why', async () => {
    const w = world('never stop', {
      defaultBranch: { asks: 'looking up the default branch failed (x)' },
    });
    const r = await judge([push({ branch: 'fix/x', repo: 'o/r' })], w);
    expect(r).toMatchObject({
      deny: expect.stringContaining('looking up the default branch failed (x)'),
    });
  });

  test("a pull request's branch is looked up on its own host", async () => {
    const w = world('never stop', {
      pullRequest: { out: 'false https://ghe.example.com/o2/r2/pull/7 release' },
      defaultBranch: { out: 'main' },
    });
    expect(await judge([push({ head: ['7'] })], w)).toMatchObject({ ran: [{ step: 'push' }] });
    expect(w.calls).toEqual(['ladder', 'pullRequest 7', 'defaultBranch ghe.example.com/o2/r2']);
  });

  test("a fork's branch, or a lookup that prints something else, asks", async () => {
    const fork = world('never stop', {
      pullRequest: { out: 'true https://github.com/f/r/pull/7 x' },
    });
    expect(await judge([push({ head: ['7'] })], fork)).toMatchObject({
      deny: expect.stringContaining("the pull request's fork"),
    });
    for (const out of ['nothing like it', 'false https://github.com/o/r/issues/7 x']) {
      expect(
        await judge([push({ head: ['7'] })], world('never stop', { pullRequest: { out } })),
      ).toMatchObject({ deny: expect.stringContaining(`printed \`${out}\``) });
    }
  });

  test('a push that asks for its own reason is never let through, and looks nothing up', async () => {
    const w = world('never stop');
    const r = await judge([push({ asks: 'it pushes a tag', force: false })], w);
    expect(r).toMatchObject({ deny: expect.stringContaining('it pushes a tag') });
    expect(w.calls).toEqual(['ladder']);
  });

  test('a forced update needs a bare force, which also covers the push', async () => {
    const forced = push({ asks: 'it force-updates `x`', force: true });
    const r = await judge([forced], world('never stop'), grant({ push: 'lease' }));
    expect(r).toMatchObject({ deny: expect.stringContaining('bare force') });
    expect(await judge([forced], world('commit'), grant({ push: 'bare' }))).toEqual({
      ran: [],
      notes: [
        'review-cycle ran the push the user asked for without checking where it goes: it force-updates `x`. If it may have reached the default branch or a tag they did not name, tell them.',
      ],
    });
  });

  test('a requested pull request lets no GitHub push through', async () => {
    const w = world('push');
    const r = await judge([push({ branch: 'fix/x', repo: 'o/r' })], w, grant({ pr: true }));
    expect(r).toMatchObject({ deny: expect.stringContaining("doesn't ask for a push") });
    expect(w.calls).toEqual(['ladder']);
  });

  test('a requested push to the default branch asks unless the request named it', async () => {
    const main = push({ branch: 'main', repo: 'o/r' });
    expect(await judge([main], world('never stop'), grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('`main`, the default branch, which the request did not name'),
    });
    expect(
      await judge([main], world('commit'), grant({ push: 'push', pushNamed: ['main'] })),
    ).toEqual({ ran: [] });
    expect(
      await judge(
        [push({ branch: 'fix/x', repo: 'o/r' })],
        world('commit'),
        grant({ push: 'push' }),
      ),
    ).toEqual({ ran: [] });
  });

  test('a requested tag write asks unless the request named the tag', async () => {
    const tag = push({ asks: 'it pushes a tag', force: false, tag: 'v1.2.0' });
    expect(await judge([tag], world('commit'), grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('"Push the `v1.2.0` tag?"'),
      final: true,
    });
    const named = grant({ push: 'push', pushNamed: ['tag:v1.2.0'] });
    expect(await judge([tag], world('commit'), named)).toEqual({ ran: [] });
  });

  test('a requested forced update or delete of the default branch asks', async () => {
    const forced = push({
      asks: 'it force-updates `main`',
      force: true,
      branch: { name: 'main', repo: 'o/r', deletes: false },
    });
    expect(await judge([forced], world('commit'), grant({ push: 'bare' }))).toMatchObject({
      deny: expect.stringContaining('"Push to `main`?"'),
    });
    const named = grant({ push: 'bare', pushNamed: ['main'] });
    expect(await judge([forced], world('commit'), named)).toEqual({ ran: [] });
    const deleted = push({
      asks: 'it deletes `main`',
      force: false,
      branch: { name: 'main', repo: 'o/r', deletes: true },
    });
    expect(
      await judge([deleted], world('commit'), grant({ push: 'push', pushNamed: ['main'] })),
    ).toMatchObject({ deny: expect.stringContaining('The gate never does that for the user') });
  });

  test('a requested delete says so when the default branch cannot be looked up', async () => {
    const down = world('commit', { defaultBranch: { asks: 'gh is not logged in' } });
    const deleted = push({
      asks: 'it deletes `develop`',
      force: false,
      branch: { name: 'develop', repo: 'o/r', deletes: true },
    });
    expect(await judge([deleted], down, grant({ push: 'push' }))).toEqual({
      ran: [],
      notes: [
        'review-cycle ran the push the user asked for without checking where it goes: gh is not logged in. If it may have reached the default branch or a tag they did not name, tell them.',
      ],
    });
  });

  test('a requested write whose branch is built at run time asks', async () => {
    const built = push({
      asks: 'the branch it names is built at run time',
      force: false,
      unknown: true,
    });
    expect(await judge([built], world('commit'), grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('Write the branch and repository out'),
      final: true,
    });
  });

  test('a requested write that names no branch asks', async () => {
    const unnamed = push({ asks: 'it names no branch', force: false, toDefault: true });
    expect(await judge([unnamed], world('commit'), grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('Write the branch and repository out in the call'),
    });
  });

  test('a requested push to main asks when the default branch cannot be looked up', async () => {
    const down = world('commit', { defaultBranch: { asks: 'gh is not logged in' } });
    const main = push({ branch: 'main', repo: 'o/r' });
    expect(await judge([main], down, grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('`main`, the default branch'),
    });
    const other = await judge(
      [push({ branch: 'fix/x', repo: 'o/r' })],
      down,
      grant({ push: 'push' }),
    );
    expect(other).toEqual({
      ran: [],
      notes: [
        'review-cycle ran the push the user asked for without checking where it goes: gh is not logged in. If it may have reached the default branch or a tag they did not name, tell them.',
      ],
    });
  });
});

describe('a merge', () => {
  test('allowed either way and unasked, is noted as the step it is', async () => {
    const one: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['1'] };
    const plain = world('never stop');
    expect(await judge([one], plain)).toEqual(merged('never stop'));
    expect(plain.calls).toEqual(['ladder', 'pullRequest 1']);
    const version = world('never stop', { pullRequest: { out: VERSION_PR } });
    expect(await judge([{ ...one, auto: true }], version)).toEqual({
      ran: [{ step: 'release', ladder: { stopBefore: 'never stop', source: 'local' } }],
    });
    // Pointing and the note read the pull request once between them.
    const away = world('never stop', { branch: { out: 'main' } });
    expect(await judge([merge(false)], away, grant({ merge: true }))).toEqual(merged('never stop'));
    expect(away.calls.filter((c) => c.startsWith('pullRequest'))).toHaveLength(1);
    // A lookup that fails still runs what the setting allows, noted as a merge.
    const lost = world('never stop', { pullRequest: { asks: 'looking it up failed (x)' } });
    expect(await judge([one], lost)).toEqual(merged('never stop'));
  });

  test('a release asked for does not hide an unasked merge of another', async () => {
    const one: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['1'] };
    expect(await judge([one], world('release'), grant({ release: true }))).toEqual(
      merged('release'),
    );
    // Of the version pull request, the release was asked for, so nothing is noted.
    const version = world('release', { pullRequest: { out: VERSION_PR } });
    expect(await judge([one], version, grant({ release: true }))).toEqual({ ran: [] });
  });

  test("of oakum's version pull request is a release", async () => {
    const w = world('release', { pullRequest: { out: VERSION_PR } });
    const r = await judge(
      [{ kind: 'merge', admin: false, auto: false, lookup: ['62', '--repo', 'o/r'] }],
      w,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('"Release `v0.25.0`?"') });
    expect(w.calls).toEqual(['ladder', 'pullRequest 62 --repo o/r']);
  });

  test("asked for, covers oakum's version pull request, found by its branch", async () => {
    const w = world('merge', { pullRequest: { out: `false ${PR1} oakum/version-packages` } });
    const r = await judge([merge(false)], w, grant({ merge: true }));
    expect(r).toEqual({ ran: [] });
    expect(w.calls).toEqual(['ladder', 'mergeTarget 1', 'repoUrl', 'pullRequest 1']);
  });

  const PR1 = 'https://github.com/o/r/pull/1';
  describe('asked for with no pull request named', () => {
    const away = { branch: { out: 'main' } } as const;
    const unnamedDeny = 'neither they nor the answer they replied to named #1';
    test('covers one the answer named, the current branch’s, or a bare gh pr merge', async () => {
      const unnamed = grant({ merge: true });
      expect(await judge([merge(false)], world('merge', away), unnamed, null, ['1'])).toEqual({
        ran: [],
      });
      expect(await judge([merge(false)], world('merge'), unnamed)).toEqual({ ran: [] });
      const bare: GhAction = { kind: 'merge', admin: false, auto: false, lookup: [] };
      expect(await judge([bare], world('merge', away), unnamed)).toEqual({ ran: [] });
    });

    test('asks before merging one nothing pointed at', async () => {
      for (const named of [[], [NAMED_ELSEWHERE]]) {
        const r = await judge(
          [merge(false)],
          world('merge', away),
          grant({ merge: true, mergeNamed: named }),
          null,
          ['40'],
        );
        expect(r).toMatchObject({
          deny: expect.stringContaining(
            `it merges #1, and the user named no pull request, and ${unnamedDeny}`,
          ),
        });
        expect(r).toMatchObject({ deny: expect.stringContaining('"Merge #1?"') });
      }
    });

    test('asks before merging another branch’s pull request, even once ready', async () => {
      const r = await judge([merge(true)], world('merge', away), grant({ autoMerge: true }));
      expect(r).toMatchObject({ deny: expect.stringContaining(unnamedDeny) });
    });

    test('asks before merging a fork’s pull request whose branch shares a name', async () => {
      for (const branch of ['fix/x', 'oakum/version-packages']) {
        const fork = world('merge', { pullRequest: { out: `true ${PR1} ${branch}` } });
        expect(await judge([merge(false)], fork, grant({ merge: true }))).toMatchObject({
          deny: expect.stringContaining(unnamedDeny),
        });
      }
    });

    test('names why when a lookup fails, retrying when GitHub was slow', async () => {
      const lost = world('merge', { branch: { asks: 'reading it failed (y)' } });
      expect(await judge([merge(false)], lost, grant({ merge: true }))).toMatchObject({
        deny: expect.stringContaining(
          'the gate cannot tell whether the conversation pointed at #1: reading it failed (y)',
        ),
      });
      // A checkout on no branch heads no pull request.
      const detached = world('merge', { branch: { out: '' } });
      expect(await judge([merge(false)], detached, grant({ merge: true }))).toMatchObject({
        deny: expect.stringContaining("nor is it this branch's"),
      });
      const headless = world('merge', { pullRequest: { asks: 'looking it up failed (x)' } });
      const failed = await judge([merge(false)], headless, grant({ merge: true }));
      expect(failed).toMatchObject({ deny: expect.stringContaining('looking it up failed (x)') });
      expect(failed).toMatchObject({ deny: expect.stringContaining('"Merge #1?"') });
      const slow = world('merge', { pullRequest: { asks: 'it timed out', slow: true } });
      expect(await judge([merge(false)], slow, grant({ merge: true }))).toMatchObject({
        deny: expect.stringContaining(
          'ask the user only if it fails the same way again. The command:',
        ),
      });
    });

    test('reads an Enterprise host served over http', async () => {
      const w = world('merge', {
        pullRequest: { out: 'false http://ghe.example.com/o/r/pull/1 fix/x' },
      });
      expect(await judge([merge(false)], w, grant({ merge: true }))).toEqual({ ran: [] });
    });

    test('is never stricter than the setting, but for a merge now asked for once ready', async () => {
      for (const stop of ['release', 'never stop'] as const) {
        for (const asked of [
          { merge: true },
          { autoMerge: true },
          { merge: true, autoMerge: true },
        ]) {
          expect(await judge([merge(false)], world(stop, away), grant(asked))).toEqual(
            merged(stop),
          );
        }
      }
      // A number asked for once ready binds only that pull request.
      const mixed = grant({
        merge: true,
        mergeNamed: [NAMED_ELSEWHERE],
        autoMerge: true,
        readyNamed: ['62'],
      });
      expect(await judge([merge(false)], world('release', away), mixed, null, ['62'])).toEqual(
        merged('release'),
      );
      // Merging now and once ready, a failed lookup runs as merging now does.
      const both = grant({ merge: true, autoMerge: true });
      const blind = world('never stop', { mergeTarget: { asks: 'looking it up failed (x)' } });
      expect(await judge([merge(false)], blind, both)).toEqual(merged('never stop'));
      // Merging now on a once-ready ask, a failed lookup is refused whatever the setting.
      expect(await judge([merge(false)], blind, grant({ autoMerge: true }))).toMatchObject({
        deny: expect.stringContaining('looking it up failed (x)'),
      });
      // `--auto` leaves the wait to GitHub, so a failed lookup runs as merging now does.
      expect(await judge([merge(true)], blind, grant({ autoMerge: true }))).toEqual(
        merged('never stop'),
      );
      // A number named once ready needs no pointing, so a failed branch read is moot.
      const unread = world('release', {
        branch: { asks: 'git failed' },
        mergeTarget: pull(1, 'CLEAN'),
      });
      const ready1 = grant({ merge: true, autoMerge: true, readyNamed: ['1'] });
      expect(await judge([merge(false)], unread, ready1)).not.toHaveProperty('deny');
      // `--auto` of a pointed pull request asks no release question the setting answers.
      const auto = world('never stop', { pullRequest: { asks: 'looking it up failed (x)' } });
      expect(await judge([merge(true)], auto, grant({ autoMerge: true }), null, ['1'])).toEqual({
        ran: [],
      });
      // A failed lookup runs where the setting lets any merge through, and is
      // named where the setting would ask whether it is a release.
      const failed = (stop: StopBefore) =>
        world(stop, { pullRequest: { asks: 'looking it up failed (x)', slow: true } });
      expect(await judge([merge(false)], failed('never stop'), grant({ merge: true }))).toEqual(
        merged('never stop'),
      );
      const named = await judge([merge(false)], failed('release'), grant({ merge: true }));
      expect(named).toMatchObject({ deny: expect.stringContaining('looking it up failed (x)') });
      expect(named).toMatchObject({ deny: expect.stringContaining('Run the same command again') });
      const loose = world('never stop', away);
      expect(await judge([beside('200')], loose, grant({ merge: true }))).toEqual({
        ran: [{ step: 'merge', ladder: { stopBefore: 'never stop', source: 'local' } }],
      });
    });

    test('never reads a fork’s version branch as a release', async () => {
      const fork = world('commit', {
        pullRequest: { out: VERSION_PR.replace('false', 'true') },
        mergeTarget: { out: 'https://github.com/o/r/pull/1 OPEN BLOCKED' },
      });
      const asked = grant({ autoMerge: true, release: true });
      expect(await judge([merge(false)], fork, asked)).toMatchObject({
        deny: expect.stringContaining('it merges #1'),
      });
    });

    test('a bare merge naming only its repository needs no lookup', async () => {
      const w = world('merge', { mergeTarget: { asks: 'looking it up failed (x)' } });
      const bare: GhAction = {
        kind: 'merge',
        admin: false,
        auto: false,
        lookup: ['--repo', 'o/r'],
      };
      expect(await judge([bare], w, grant({ merge: true }))).toEqual({ ran: [] });
      expect(w.calls).toEqual(['ladder']);
    });

    test('beside other steps, covers only a number the conversation pointed at', async () => {
      const w = world('merge', away);
      expect(await judge([beside('40')], w, grant({ merge: true }), null, ['40'])).toEqual({
        ran: [],
      });
      expect(w.calls).toEqual(['ladder']);
      // `gh pr checkout 62 && gh pr merge` merges #62, not this branch's.
      for (const other of [beside(), beside('200'), beside('feat/y')]) {
        expect(await judge([other], w, grant({ merge: true }), null, ['40'])).toMatchObject({
          deny: expect.stringContaining('Run the merge as its own command.'),
        });
      }
      const elsewhere: GhAction = {
        kind: 'merge',
        admin: false,
        auto: false,
        lookup: { cannot: 'elsewhere', selector: '40' },
      };
      expect(await judge([elsewhere], w, grant({ merge: true }), null, ['40'])).toMatchObject({
        deny: expect.stringContaining('the gate cannot tell whether this is it'),
      });
    });
  });

  test('asked for by number, covers only the version pull request it names', async () => {
    const version = { pullRequest: { out: VERSION_PR } } as const;
    const other = await judge(
      [merge(false)],
      world('release', version),
      grant({ merge: true, mergeNamed: ['131'] }),
    );
    expect(other).toMatchObject({
      deny: expect.stringContaining('it merges #1, and the user asked to merge #131'),
    });
    const named = await judge(
      [merge(false)],
      world('release', version),
      grant({ merge: true, mergeNamed: ['1'] }),
    );
    expect(named).toEqual({ ran: [] });
    // Another pull request it did not name is refused, whatever the setting.
    const other131 = grant({ merge: true, mergeNamed: ['131'] });
    for (const stop of ['release', 'never stop'] as const) {
      expect(await judge([merge(false)], world(stop), other131)).toMatchObject({
        deny: expect.stringContaining('it merges #1, and the user asked to merge #131'),
      });
    }
    // One whose pull request it cannot tell covers one the conversation pointed at.
    const vague = world('merge', { branch: { out: 'main' } });
    const told = grant({ merge: true, mergeNamed: [NAMED_ELSEWHERE] });
    expect(await judge([merge(false)], vague, told, null, ['1', '2'])).toEqual({ ran: [] });
  });

  test('that may be a release asks when the lookup fails', async () => {
    const w = world('release', {
      pullRequest: { asks: 'looking up the pull request it merges failed (x)' },
    });
    const r = await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], w);
    expect(r).toMatchObject({ deny: expect.stringContaining('"Merge and release #62?"') });
  });

  test('not allowed, names why the lookup could not tell', async () => {
    const failed = world('merge', { pullRequest: { asks: 'looking up it failed (x)' } });
    expect(
      await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], failed),
    ).toMatchObject({
      deny: expect.stringContaining('This asks whatever the setting: looking up it failed (x).'),
    });
    const garbled = world('release', { pullRequest: { out: 'oakum/version-packages' } });
    expect(
      await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], garbled),
    ).toMatchObject({
      deny: expect.stringContaining(
        'looking up the pull request it merges printed `oakum/version-packages`',
      ),
    });
    const unnamed = await judge(
      [{ kind: 'merge', admin: false, auto: false, lookup: { cannot: 'unnamed' } }],
      world('release'),
    );
    expect(unnamed).toMatchObject({
      deny: expect.stringContaining('it does not name the pull request by number and repository'),
    });
  });

  test('beside other steps, or picked elsewhere, cannot be looked up', async () => {
    const beside = await judge(
      [{ kind: 'merge', admin: false, auto: false, lookup: { cannot: 'beside' } }],
      world('release'),
    );
    expect(beside).toMatchObject({
      deny: expect.stringContaining('Run the merge as its own command'),
    });
    const elsewhere = await judge(
      [{ kind: 'merge', admin: false, auto: false, lookup: { cannot: 'elsewhere' } }],
      world('release'),
    );
    expect(elsewhere).toMatchObject({ deny: expect.stringContaining('`GH_REPO=`') });
  });

  describe('asked for once the pull request is ready', () => {
    const ready = grant({ autoMerge: true });

    test('runs with --auto, unnoted', async () => {
      expect(await judge([merge(true)], world('merge'), ready)).toEqual({ ran: [] });
    });

    test.each(['merge', 'release', 'never stop'] as const)(
      'refuses a merge now at %s, naming --auto',
      async (stopBefore) => {
        const r = await judge([merge(false)], world(stopBefore), ready);
        expect(r).toMatchObject({ deny: expect.stringContaining('`gh pr merge 1 --auto`') });
        expect(r).toMatchObject({ deny: expect.stringContaining('"Merge #116 now?"') });
      },
    );

    test.each(['CLEAN', 'HAS_HOOKS', 'UNSTABLE'])(
      'lets a merge now run when GitHub already reports it %s, saying why',
      async (state) => {
        const w = world('merge', { mergeTarget: pull(1, state) });
        const r = await judge([merge(false)], w, ready);
        expect(r).toEqual({
          ran: [
            {
              step: 'merge',
              ladder: expect.anything(),
              ready: `GitHub reports #1 ${state}, which is all \`--auto\` waits for`,
            },
          ],
        });
        expect(w.calls).toContain('mergeTarget 1');
      },
    );

    test.each(['BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT'])(
      'refuses a merge now when GitHub reports it %s, naming the state',
      async (state) => {
        const r = await judge(
          [merge(false)],
          world('never stop', { mergeTarget: pull(1, state) }),
          ready,
        );
        expect(r).toMatchObject({ deny: expect.stringContaining(`#1's merge state as ${state}`) });
      },
    );

    test('refuses a merge now while GitHub is still working it out', async () => {
      const r = await judge(
        [merge(false)],
        world('never stop', { mergeTarget: pull(1, 'UNKNOWN') }),
        ready,
      );
      expect(r).toMatchObject({ deny: expect.stringContaining('try again shortly') });
    });

    test.each([
      [
        'a failed read',
        { asks: 'looking up whether the pull request is ready failed (x)' },
        'failed (x)',
      ],
      [
        'several lines',
        { out: '1 https://github.com/o/r/pull/1 CLEAN\nBLOCKED' },
        'printed "1 https',
      ],
      ['null', { out: 'null' }, 'printed "null"'],
      [
        'trailing words',
        { out: 'https://github.com/o/r/pull/1 OPEN CLEAN extra' },
        'printed "https',
      ],
    ] as const)('refuses a merge now on %s', async (_, mergeTarget, why) => {
      const r = await judge([merge(false)], world('never stop', { mergeTarget }), ready);
      expect(r).toMatchObject({ deny: expect.stringContaining(why) });
    });

    test.each([
      ['"merge 46 when its ready"', asked('Ok, lets merge 46 when its ready')],
      [
        'a ready merge answering "Merge #46?"',
        asked('merge it when its ready', 'Want me to merge #46?'),
      ],
      ['a yes to "Merge #46 once it is ready?"', asked('yes', 'Merge #46 once it is ready?')],
    ])('after %s, refuses a merge of #47, now or with --auto', async (_, granted) => {
      for (const auto of [false, true]) {
        const r = await judge(
          [merge(auto)],
          world('merge', { mergeTarget: pull(47, 'CLEAN') }),
          granted,
        );
        expect(r).toMatchObject({
          deny: expect.stringContaining('it merges #47, and the user asked to merge #46'),
        });
      }
    });

    test('a merge of a pull request the user did not name is refused whatever the setting', async () => {
      const granted = asked('Ok, lets merge 46 when its ready');
      const w = world('never stop', { mergeTarget: pull(47, 'CLEAN') });
      expect(await judge([merge(false)], w, granted)).toMatchObject({
        deny: expect.stringContaining('it merges #47, and the user asked to merge #46'),
      });
    });

    test("a release the user asked for covers oakum's version pull request", async () => {
      const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['62'] };
      const answers = {
        mergeTarget: pull(62, 'CLEAN'),
        pullRequest: { out: VERSION_PR },
      } as const;
      const released = grant({ merge: true, mergeNamed: ['46'], release: true });
      const w = world('push', answers);
      expect(await judge([action], w, released)).toEqual({ ran: [] });
      expect(w.calls.filter((c) => c.startsWith('pullRequest'))).toHaveLength(1);
      const unread = world('push', {
        mergeTarget: pull(62, 'CLEAN'),
        pullRequest: { asks: 'looking up the pull request it merges failed (x)' },
      });
      expect(await judge([action], unread, released)).toMatchObject({
        deny: expect.stringContaining('the user asked to merge #46 (looking up'),
      });
      const merged = grant({ merge: true, mergeNamed: ['46'] });
      expect(await judge([action], world('push', answers), merged)).toMatchObject({
        deny: expect.stringContaining('it merges #62, and the user asked to merge #46'),
      });
    });

    test('refuses a named merge when the current repository cannot be read', async () => {
      const w = world('never stop', {
        mergeTarget: pull(46, 'CLEAN'),
        repoUrl: { asks: 'looking up the current repository failed (x)' },
      });
      const r = await judge([merge(false)], w, asked('Ok, lets merge 46 when its ready'));
      expect(r).toMatchObject({ deny: expect.stringContaining('failed (x)') });
    });

    test('after "merge 46, and merge 62 once CI passes", #62 merges now only when ready', async () => {
      const granted = asked('merge 46, and merge 62 once CI passes');
      const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['62'] };
      const blocked = await judge(
        [action],
        world('merge', { mergeTarget: pull(62, 'BLOCKED') }),
        granted,
      );
      expect(blocked).toMatchObject({
        deny: expect.stringContaining("#62's merge state as BLOCKED"),
      });
      const now = await judge(
        [action],
        world('merge', { mergeTarget: pull(46, 'BLOCKED') }),
        granted,
      );
      expect(now).toEqual({ ran: [] });
    });

    test('a merge request naming a pull request binds to the number GitHub resolves', async () => {
      const granted = asked('merge 131');
      const url: GhAction = {
        kind: 'merge',
        admin: false,
        auto: false,
        lookup: ['https://github.com/o/r/pull/130/files/131'],
      };
      const r = await judge([url], world('merge', { mergeTarget: pull(130, 'CLEAN') }), granted);
      expect(r).toMatchObject({
        deny: expect.stringContaining('it merges #130, and the user asked to merge #131'),
      });
      const failed = await judge(
        [url],
        world('never stop', {
          mergeTarget: { asks: 'looking up the pull request it merges failed (x)' },
        }),
        granted,
      );
      expect(failed).toMatchObject({
        deny: expect.stringContaining('cannot tell whether this is it'),
      });
    });

    test('after "merge 46 when its ready", a merge now of a ready #46 runs, by branch or URL', async () => {
      const granted = asked('Ok, lets merge 46 when its ready');
      for (const lookup of [['fix/x'], ['https://github.com/o/r/pull/46/files']]) {
        const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup };
        const r = await judge(
          [action],
          world('merge', { mergeTarget: pull(46, 'CLEAN') }),
          granted,
        );
        expect(r).toMatchObject({
          ran: [{ step: 'merge', ready: expect.stringContaining('#46 CLEAN') }],
        });
      }
    });

    test('after a yes to an offer naming two pull requests, refuses a merge now of either, not --auto', async () => {
      const granted = asked('yes', 'Pushed #46 and #47.\nMerge it once CI passes?');
      const now = await judge(
        [merge(false)],
        world('never stop', { mergeTarget: pull(46, 'CLEAN') }),
        granted,
      );
      expect(now).toMatchObject({
        deny: expect.stringContaining('cannot tell which pull request the user asked to merge'),
      });
      const auto = world('merge', { mergeTarget: pull(46, 'CLEAN') });
      expect(await judge([merge(true)], auto, granted, null, ['46', '47'])).toEqual({ ran: [] });
    });

    test.each(['MERGED', 'CLOSED'])(
      'refuses a merge now of a pull request that is %s',
      async (state) => {
        const w = world('never stop', { mergeTarget: pull(46, 'UNKNOWN', 'o/r', state) });
        const r = await judge([merge(false)], w, asked('Ok, lets merge 46 when its ready'));
        expect(r).toMatchObject({ deny: expect.stringContaining(`#46 is ${state.toLowerCase()}`) });
        expect(r).toMatchObject({
          deny: expect.stringContaining('`--auto` cannot merge it either'),
        });
        expect(r).not.toMatchObject({ deny: expect.stringContaining('Run `gh pr merge') });
      },
    );

    test('a ready merge beside a merge now does not cover the version pull request', async () => {
      const granted = asked('merge 46, and merge 62 once CI passes');
      const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['62'] };
      const w = world('push', {
        mergeTarget: pull(62, 'CLEAN'),
        pullRequest: { out: VERSION_PR },
      });
      const r = await judge([action], w, granted);
      expect(r).toMatchObject({ deny: expect.stringContaining("doesn't ask for a release") });
    });

    test('refuses a merge now of a pull request in another repository', async () => {
      const w = world('never stop', { mergeTarget: pull(46, 'CLEAN', 'evil/other') });
      const r = await judge([merge(false)], w, asked('Ok, lets merge 46 when its ready'));
      expect(r).toMatchObject({
        deny: expect.stringContaining('in https://github.com/evil/other'),
      });
      expect(r).toMatchObject({
        deny: expect.stringContaining('give them the command to run themselves'),
      });
    });

    test.each([
      ['unnamed', 'Name it by number.'],
      ['beside', 'Run the merge as its own command.'],
      ['elsewhere', 'on another host or repository, give them the command'],
    ] as const)(
      'refuses a merge now whose pull request the gate cannot tell (%s), naming the fix',
      async (cannot, remedy) => {
        const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup: { cannot } };
        const w = world('never stop', { mergeTarget: pull(1, 'CLEAN') });
        for (const granted of [ready, asked('merge 46')]) {
          const r = await judge([action], w, granted);
          expect(r).toMatchObject({
            deny: expect.stringContaining('cannot tell whether this is it'),
          });
          expect(r).toMatchObject({ deny: expect.stringContaining(remedy) });
        }
      },
    );

    test('after "merge it, and merge 62 once CI passes", #62 merges now only when ready', async () => {
      const granted = asked('merge it, and merge 62 once CI passes');
      const action: GhAction = { kind: 'merge', admin: false, auto: false, lookup: ['62'] };
      const behind = await judge(
        [action],
        world('merge', { mergeTarget: pull(62, 'BEHIND') }),
        granted,
      );
      expect(behind).toMatchObject({
        deny: expect.stringContaining("#62's merge state as BEHIND"),
      });
      const other = await judge(
        [action],
        world('merge', { mergeTarget: pull(46, 'BEHIND') }),
        granted,
      );
      expect(other).not.toHaveProperty('deny');
    });

    test('a version pull request not ready yet asks for a release, not --auto', async () => {
      const w = world('push', {
        mergeTarget: pull(155, 'BLOCKED'),
        pullRequest: { out: VERSION_PR },
      });
      const r = await judge([merge(false)], w, asked('merge 155 once CI passes'));
      expect(r).toMatchObject({ deny: expect.stringContaining('"Release `v0.25.0`?"') });
      expect(r).not.toMatchObject({ deny: expect.stringContaining('--auto') });
    });

    test('a ready version pull request merged now at a permissive rung is noted as a release', async () => {
      const w = world('never stop', {
        mergeTarget: pull(46, 'CLEAN'),
        pullRequest: { out: VERSION_PR },
      });
      const r = await judge([merge(false)], w, asked('Ok, lets merge 46 when its ready'));
      expect(r).toMatchObject({ ran: [{ step: 'merge' }, { step: 'release' }] });
    });

    test('a ready version pull request merged now is still a release that asks', async () => {
      const w = world('merge', {
        mergeTarget: pull(1, 'CLEAN'),
        pullRequest: { out: VERSION_PR },
      });
      const r = await judge([merge(false)], w, ready);
      expect(r).toMatchObject({ deny: expect.stringContaining('"Release `v0.25.0`?"') });
    });

    test('with a merge asked for too, a merge now runs', async () => {
      expect(
        await judge([merge(false)], world('merge'), grant({ merge: true, autoMerge: true })),
      ).toEqual({
        ran: [],
      });
      // Named to merge now, a blocked #1 needs no readiness.
      const named = grant({ merge: true, mergeNamed: ['1'], autoMerge: true });
      expect(await judge([merge(false)], world('merge'), named)).toEqual({ ran: [] });
    });

    test("is no release: oakum's version pull request still asks", async () => {
      const w = world('merge', { pullRequest: { out: VERSION_PR } });
      const r = await judge([merge(true)], w, ready);
      expect(r).toMatchObject({ deny: expect.stringContaining('"Release `v0.25.0`?"') });
    });

    test('an --auto merge without one asks as any merge does', async () => {
      const r = await judge([merge(true)], world('merge'));
      expect(r).toMatchObject({ deny: expect.stringContaining('"Merge #116?"') });
    });
  });

  test('--admin is never let through', async () => {
    const r = await judge(
      [{ kind: 'merge', admin: true, auto: false, lookup: ['1'] }],
      world('never stop'),
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('past branch protection') });
  });
});

test('one write that may not run refuses the whole call', async () => {
  const r = await judge([{ kind: 'pr' }, { kind: 'comment' }], world('never stop'));
  expect(r).toMatchObject({ deny: expect.stringContaining('a comment on GitHub') });
});

const stack = (step: 'push' | 'sync' | 'submit' | 'link'): GhAction => ({
  kind: 'stack',
  step,
  where: { remote: null },
});

const link = (
  where: { remote: string | null } | { unread: string },
  ...branches: string[]
): GhAction => ({ kind: 'stack', step: 'link', where, branches });

describe('gh stack', () => {
  test.each(['push', 'sync', 'submit'] as const)(
    '%s leases every branch, so a plain push grant or the ladder does not cover it',
    async (step) => {
      for (const g of [grant({ push: 'push', pr: true }), grant()]) {
        const r = await judge([stack(step)], world('never stop'), g);
        expect(r).toMatchObject({
          deny: expect.stringContaining('with --force-with-lease'),
        });
      }
      expect(await judge([stack(step)], world('push'), grant({ push: 'lease', pr: true }))).toEqual(
        { ran: [] },
      );
    },
  );

  test.each(['push', 'sync', 'submit'] as const)(
    '%s runs on a push request when its lease can only overwrite what this agent pushed',
    async (step) => {
      const w = world('push', {}, undefined, undefined, { ok: true });
      expect(await judge([stack(step)], w, grant({ push: 'push', pr: true }))).toEqual({ ran: [] });
      expect(w.calls).toContain(`stackLease ${step} -`);
      const free = world('never stop', {}, undefined, undefined, { ok: true });
      expect(await judge([stack(step)], free, grant({ pr: true }))).toEqual({
        ran: [{ step: 'push', ladder: { stopBefore: 'never stop', source: 'local' } }],
      });
    },
  );

  test('a push request does not cover a lease that could overwrite another push', async () => {
    const w = world('push', {}, undefined, undefined, {
      asks: '`origin/b` is at 1234567, which the gate never saw this agent push',
    });
    expect(await judge([stack('push')], w, grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining(
        'only while each branch is where this agent last pushed it, and `origin/b` is at 1234567',
      ),
    });
  });

  test('without a push request the boundary is not read', async () => {
    const w = world('push', {}, undefined, undefined, { ok: true });
    expect(await judge([stack('push')], w, grant())).toMatchObject({
      deny: expect.stringContaining("doesn't ask for a forced push"),
    });
    expect(w.calls.some((c) => c.startsWith('stackLease'))).toBe(false);
  });

  test('a stack push run elsewhere, or to a named remote, is read where it pushes', async () => {
    const w = world('push', {}, undefined, undefined, { ok: true });
    const elsewhere: GhAction = {
      kind: 'stack',
      step: 'push',
      where: { unread: 'it runs in another directory or repository, which the gate does not read' },
    };
    expect(await judge([elsewhere], w, grant({ push: 'push' }))).toMatchObject({
      deny: expect.stringContaining('another directory or repository'),
    });
    const named: GhAction = { kind: 'stack', step: 'sync', where: { remote: 'fork' } };
    expect(await judge([named], w, grant({ push: 'push' }))).toEqual({ ran: [] });
    expect(w.calls).toContain('stackLease sync fork');
  });

  test('a pull request submit opens unasked is noted as run by the setting', async () => {
    expect(await judge([stack('submit')], world('never stop'), grant({ push: 'lease' }))).toEqual({
      ran: [{ step: 'pr', ladder: { stopBefore: 'never stop', source: 'local' } }],
    });
  });

  test('submit and link open pull requests too', async () => {
    for (const step of ['submit', 'link'] as const) {
      const r = await judge([stack(step)], world('open PR'), grant({ push: 'lease' }));
      expect(r).toMatchObject({ deny: expect.stringContaining("doesn't ask for a pull request") });
    }
  });

  test('link pushes plainly, as a push the ladder lets through', async () => {
    expect(await judge([stack('link')], world('never stop'))).toEqual({
      ran: [
        { step: 'pr', ladder: { stopBefore: 'never stop', source: 'local' } },
        { step: 'push', ladder: { stopBefore: 'never stop', source: 'local' } },
      ],
    });
    expect(await judge([stack('link')], world('push'), grant({ pr: true }))).toMatchObject({
      deny: expect.any(String),
    });
  });

  test('link pushing the default branch needs the request to name it', async () => {
    const asked = grant({ push: 'push', pr: true });
    const r = await judge([link({ remote: null }, 'main', 'feat/a')], world('push'), asked);
    expect(r).toMatchObject({ deny: expect.stringContaining('`main`, the default branch') });
    expect(r).toMatchObject({ deny: expect.stringContaining('"Push to `main`?"') });
    const ladder = await judge([link({ remote: null }, 'main')], world('never stop'));
    expect(ladder).toMatchObject({ deny: expect.stringContaining('the default branch') });
    const named = grant({ push: 'push', pr: true, pushNamed: ['main'] });
    expect(await judge([link({ remote: null }, 'main')], world('push'), named)).toEqual({
      ran: [],
    });
    expect(await judge([link({ remote: null }, 'feat/a')], world('push'), asked)).toEqual({
      ran: [],
    });
  });

  test('link checks the default branch it looks up, not main', async () => {
    const asked = grant({ push: 'push', pr: true });
    const w = world('push', { defaultBranch: { out: 'develop' } });
    expect(await judge([link({ remote: null }, 'develop')], w, asked)).toMatchObject({
      deny: expect.stringContaining('`develop`, the default branch'),
    });
    expect(await judge([link({ remote: null }, 'main')], w, asked)).toEqual({ ran: [] });
  });

  test('link to a named remote does not read its default branch', async () => {
    const w = world('never stop');
    const r = await judge([link({ remote: 'fork' }, 'feat/a')], w);
    expect(r).toMatchObject({ deny: expect.stringContaining('`fork`, whose default branch') });
    expect(w.calls).not.toContain('defaultBranch -');
    const asked = grant({ push: 'push', pr: true });
    expect(await judge([link({ remote: 'fork' }, 'feat/a')], w, asked)).toMatchObject({
      ran: [],
      notes: [expect.stringContaining('`fork`')],
    });
  });

  test('link the setting lets through asks when the default branch is unreadable', async () => {
    const w = world('never stop', { defaultBranch: { asks: 'gh failed' } });
    expect(await judge([link({ remote: null }, 'feat/a')], w)).toMatchObject({
      deny: expect.stringContaining('the default branch could not be read (gh failed)'),
    });
  });

  test('link with an unreadable default branch runs with a note, unless it pushes main', async () => {
    const asked = grant({ push: 'push', pr: true });
    const w = world('push', { defaultBranch: { asks: 'gh failed' } });
    const r = await judge([link({ remote: null }, 'feat/a')], w, asked);
    expect(r).toMatchObject({ ran: [], notes: [expect.stringContaining('gh failed')] });
    expect(await judge([link({ remote: null }, 'main')], w, asked)).toMatchObject({
      deny: expect.stringContaining('the default branch'),
    });
  });

  test('link where the gate cannot tell which repository it pushes to asks', async () => {
    const asked = grant({ push: 'push', pr: true });
    const r = await judge(
      [link({ unread: 'it runs beside other commands' }, 'feat/a')],
      world('push'),
      asked,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('Run it on its own') });
  });
});

const layer = (number: number, merged = false) => ({
  number,
  merged_at: merged ? '2026-10-18T15:02:11Z' : null,
});
const STACK4 = { number: 4, pull_requests: [layer(1, true), layer(2), layer(3)] };
const STACKS: StackLookup = (n) =>
  n === 4
    ? { by: 'stack', out: JSON.stringify(STACK4) }
    : { by: 'pr', out: JSON.stringify([1, 2, 3].includes(n) ? [STACK4] : []) };
// A request naming gh-stack merges: "merge the stack", "merge up to #3".
const stackAsked = (...stack: string[]) => grant({ mergeStack: stack });
const plain = (lookup: string[]): GhAction => ({
  kind: 'merge',
  admin: false,
  auto: false,
  lookup,
});
const m = (target: number | null): GhAction => ({
  kind: 'stack-merge',
  target: target ?? { cannot: 'unnamed' },
});

describe('gh stack merge', () => {
  test('a merge of one layer is judged as that pull request', async () => {
    const w = world('push', {}, undefined, STACKS);
    expect(await judge([m(2)], w, grant({ merge: true }), null, ['2'])).toEqual({ ran: [] });
    // An unnamed merge of a layer nothing pointed at asks, as `gh pr merge 2` does.
    const away = world('push', { branch: { out: 'main' } }, undefined, STACKS);
    expect(await judge([m(2)], away, grant({ merge: true }))).toMatchObject({
      deny: expect.stringContaining('the answer they replied to named #2'),
    });
    // Named, it is looked up and bound by number, as `gh pr merge 2` is.
    expect(await judge([m(2)], w, grant({ merge: true, mergeNamed: ['2'] }))).toEqual({
      ran: [],
    });
    expect(w.calls).toContain('mergeTarget 2');
  });

  test('a merge of several layers needs every one named', async () => {
    const r = await judge([m(3)], world('push', {}, undefined, STACKS), grant({ merge: true }));
    expect(r).toMatchObject({ deny: expect.stringContaining('merges #2, #3 together') });
    expect(
      await judge(
        [m(3)],
        world('push', {}, undefined, STACKS),
        grant({ merge: true, mergeNamed: ['2', '3'] }),
      ),
    ).toEqual({ ran: [] });
    expect(
      await judge(
        [m(4)],
        world('push', {}, undefined, STACKS),
        grant({ merge: true, mergeNamed: ['3'] }),
      ),
    ).toMatchObject({ deny: expect.stringContaining('merges #2, #3 together') });
  });

  test('a setting that merges unasked covers several layers', async () => {
    const r = await judge([m(4)], world('release', {}, undefined, STACKS));
    expect(r).toMatchObject({ ran: [{ step: 'merge' }, { step: 'merge' }] });
  });

  test('a layer named for once ready counts as named, and is judged on readiness', async () => {
    const named = grant({ merge: true, mergeNamed: ['2'], autoMerge: true, readyNamed: ['3'] });
    expect(await judge([m(3)], world('push', {}, undefined, STACKS), named)).toMatchObject({
      deny: expect.stringContaining('only once the pull request is ready'),
    });
    const ready = world('push', { mergeTarget: { out: 'OPEN CLEAN' } }, undefined, STACKS);
    expect(await judge([m(3)], ready, named)).toMatchObject({ ran: [{ step: 'merge' }] });
  });

  test('a request to merge the stack, or up to a layer, names each layer it merges', async () => {
    // Stack #4 holds #2 and #3, unmerged.
    for (const [action, stack] of [
      [m(4), 'stack'],
      [m(3), 'stack'],
      [m(4), 'stack:4'],
      [m(3), 'upto:3'],
      [m(4), 'upto:3'],
      [m(2), 'upto:2'],
    ] as const) {
      const w = world('push', {}, undefined, STACKS);
      expect(await judge([action], w, stackAsked(stack))).toEqual({ ran: [] });
    }
    for (const [action, stack] of [
      [m(3), 'stack:4'],
      // #3 is a pull request in stack #4, not a stack.
      [m(3), 'stack:3'],
      [m(3), 'upto:2'],
      [m(4), 'upto:2'],
    ] as const) {
      const r = await judge([action], world('push', {}, undefined, STACKS), stackAsked(stack));
      expect(r).toMatchObject({ deny: expect.stringContaining('merges #2, #3 together') });
    }
  });

  test('a stack request covers no other merge, before it or after it', async () => {
    const w = world('push', {}, undefined, STACKS);
    // #2 is one of the stack's layers, so a grant leaking from them would cover it.
    for (const lookup of [['5'], ['2'], []]) {
      for (const actions of [[plain(lookup)], [m(4), plain(lookup)], [plain(lookup), m(4)]]) {
        expect(await judge(actions, w, grant({ mergeStack: ['stack'] }))).toMatchObject({
          deny: expect.any(String),
        });
      }
    }
  });

  test('a layer that is the version pull request is judged as a release', async () => {
    const r = await judge(
      [m(4)],
      world('release', { pullRequest: { out: VERSION_PR } }, undefined, STACKS),
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('release') });
  });

  test.each([
    [m(null), 'the current branch’s stack'],
    [m(9), '#9 is neither a stack nor a pull request in one'],
    [m(1), '#1 has already merged'],
    [{ kind: 'stack-merge', target: { cannot: 'beside' } } as const, 'Run the merge as its own'],
    [{ kind: 'stack-merge', target: { cannot: 'elsewhere' } } as const, '`GH_REPO=`'],
  ])('%j asks: %s', async (action, why) => {
    const w = world('never stop', {}, undefined, STACKS);
    const r = await judge([action], w, grant({ merge: true }));
    expect(r).toMatchObject({ deny: expect.stringContaining(why) });
  });

  test('a stack GitHub cannot read asks, and a slow one is tried again', async () => {
    const failed = world('never stop', {}, undefined, () => ({
      asks: 'looking up stack #4 failed (x)',
    }));
    expect(await judge([m(4)], failed, grant({ merge: true }))).toMatchObject({
      deny: expect.stringContaining('failed (x), so nothing ran. Give the user the command'),
    });
    const slow = world('never stop', {}, undefined, () => ({ asks: 'timed out', slow: true }));
    expect(await judge([m(4)], slow, grant({ merge: true }))).toMatchObject({
      deny: expect.stringContaining('GitHub did not answer in time'),
    });
  });
});

function merged(stop: StopBefore) {
  return { ran: [{ step: 'merge', ladder: { stopBefore: stop, source: 'local' } }] };
}

function beside(selector?: string): GhAction {
  return {
    kind: 'merge',
    admin: false,
    auto: false,
    lookup: { cannot: 'beside', ...(selector !== undefined && { selector }) },
  };
}
