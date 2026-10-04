import { describe, expect, test } from 'vitest';

import { NO_GRANT, type Grant } from './consent';
import { judgeGh, parsePullRequest, type GhLookups, type InForce, type Lookup } from './gh-verdict';
import type { GhAction } from './github';
import type { StopBefore } from './ladder';

// GitHub as the lookups see it, recording each lookup made. The pull request
// lookup answers what gh prints, read as register.ts reads it.
function world(
  stopBefore: StopBefore,
  answers: Partial<Record<'mergeHead' | 'pullRequest' | 'defaultBranch', Lookup>> = {},
  unreadable?: string,
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
    mergeHead: (lookup) =>
      answer(`mergeHead ${lookup.join(' ')}`, answers.mergeHead ?? { out: 'fix/x' }),
    pullRequest: (head) =>
      answer(
        `pullRequest ${head.join(' ')}`,
        pr.asks === undefined ? parsePullRequest(pr.out) : { asks: pr.asks },
      ),
    defaultBranch: (repo) =>
      answer(`defaultBranch ${repo ?? '-'}`, answers.defaultBranch ?? { out: 'main' }),
  };
  return { calls, lookups };
}

const grant = (g: Partial<Grant> = {}): Grant => ({ ...NO_GRANT, ...g });
const push = (ref: Extract<GhAction, { kind: 'push' }>['ref']): GhAction => ({ kind: 'push', ref });
const merge = (auto: boolean): GhAction => ({ kind: 'merge', admin: false, auto, lookup: ['1'] });

async function judge(
  actions: GhAction[],
  w: ReturnType<typeof world>,
  granted = grant(),
  held = false,
) {
  return judgeGh('the call', actions, granted, held, w.lookups);
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
      const r = await judge([action], world('never stop'), grant(), true);
      expect(r).toMatchObject({ deny: expect.stringContaining('the user held off') });
    },
  );

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
    const release = world('release', { mergeHead: { out: 'oakum/version-packages\n' } });
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
    expect(await judge([forced], world('commit'), grant({ push: 'bare' }))).toEqual({ ran: [] });
  });

  test('a requested pull request lets no GitHub push through', async () => {
    const w = world('push');
    const r = await judge([push({ branch: 'fix/x', repo: 'o/r' })], w, grant({ pr: true }));
    expect(r).toMatchObject({ deny: expect.stringContaining("doesn't ask for a push") });
    expect(w.calls).toEqual(['ladder']);
  });

  test('a requested push is not looked up', async () => {
    const w = world('commit');
    expect(
      await judge([push({ branch: 'main', repo: 'o/r' })], w, grant({ push: 'push' })),
    ).toEqual({ ran: [] });
    expect(w.calls).toEqual(['ladder']);
  });
});

describe('a merge', () => {
  test('allowed either way, looks nothing up', async () => {
    const w = world('never stop');
    const r = await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['1'] }], w);
    expect(r).toMatchObject({ ran: [{ step: 'merge' }] });
    expect(w.calls).toEqual(['ladder']);
  });

  test("of oakum's version pull request is a release", async () => {
    const w = world('release', { mergeHead: { out: 'oakum/version-packages' } });
    const r = await judge(
      [{ kind: 'merge', admin: false, auto: false, lookup: ['62', '--repo', 'o/r'] }],
      w,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('"Release `v0.25.0`?"') });
    expect(w.calls).toEqual(['ladder', 'mergeHead 62 --repo o/r']);
  });

  test('that may be a release asks when the lookup fails', async () => {
    const w = world('release', {
      mergeHead: { asks: 'looking up the pull request it merges failed (x)' },
    });
    const r = await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], w);
    expect(r).toMatchObject({ deny: expect.stringContaining('"Merge and release #62?"') });
  });

  test('not allowed, names why the lookup could not tell', async () => {
    const failed = world('merge', { mergeHead: { asks: 'looking up it failed (x)' } });
    expect(
      await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], failed),
    ).toMatchObject({
      deny: expect.stringContaining('This asks whatever the setting: looking up it failed (x).'),
    });
    const blank = world('release', { mergeHead: { out: ' ' } });
    expect(
      await judge([{ kind: 'merge', admin: false, auto: false, lookup: ['62'] }], blank),
    ).toMatchObject({
      deny: expect.stringContaining('looking up the pull request it merges printed nothing'),
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
        expect(r).toMatchObject({ deny: expect.stringContaining('`gh pr merge <number> --auto`') });
        expect(r).toMatchObject({ deny: expect.stringContaining('"Merge #116 now?"') });
      },
    );

    test('with a merge asked for too, a merge now runs', async () => {
      expect(
        await judge([merge(false)], world('merge'), grant({ merge: true, autoMerge: true })),
      ).toEqual({
        ran: [],
      });
    });

    test("is no release: oakum's version pull request still asks", async () => {
      const w = world('merge', { mergeHead: { out: 'oakum/version-packages' } });
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
