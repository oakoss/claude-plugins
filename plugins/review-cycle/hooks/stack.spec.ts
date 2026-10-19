import { describe, expect, test } from 'vitest';

import type { Lookup } from './gh-verdict';
import {
  anonymized,
  type LeaseIo,
  layerOf,
  leaseHolds,
  mergeSet,
  parseCatalog,
  readStack,
  stackHeads,
  stackLease,
  stackOf,
} from './stack';

// Stack #4 as `GET repos/{o}/{r}/stacks/4` answered in the 2026-10-18 spike
// (oakoss/stack-spike-2), trimmed: #1 merged, then #2 and #3.
const pr = (number: number, merged = false) => ({
  number,
  state: merged ? 'closed' : 'open',
  merged_at: merged ? '2026-10-18T15:02:11Z' : null,
  draft: false,
  head: { ref: `spike/${number}`, sha: 'f5a524d' },
});
const STACK = { number: 4, open: true, pull_requests: [pr(1, true), pr(2), pr(3)] };
const byStack = { by: 'stack', out: JSON.stringify(STACK) } as const;
const byPr = (stacks: unknown[]) => ({ by: 'pr', out: JSON.stringify(stacks) }) as const;

// gh answering by endpoint, recording what was asked.
function gh(answers: Record<string, Lookup>) {
  const asked: string[] = [];
  const ghApi = (args: string[]) => {
    const call = args.join(' ');
    asked.push(call);
    return Promise.resolve(answers[call] ?? { asks: `unexpected ${call}` });
  };
  return { asked, ghApi };
}

describe('readStack', () => {
  const STACK_4 = 'repos/{owner}/{repo}/stacks/4';
  const HOLDING_4 = '-X GET repos/{owner}/{repo}/stacks -f pull_request=4';
  const NOT_FOUND = { asks: 'looking up stack #4 failed (gh: Not Found (HTTP 404))' };

  test('a stack number is read as that stack', async () => {
    const { asked, ghApi } = gh({ [STACK_4]: { out: '{}' } });
    expect(await readStack(4, ghApi)).toEqual({ by: 'stack', out: '{}' });
    expect(asked).toEqual([STACK_4]);
  });
  test('a 404 reads the stack holding that pull request', async () => {
    const { asked, ghApi } = gh({ [STACK_4]: NOT_FOUND, [HOLDING_4]: { out: '[]' } });
    expect(await readStack(4, ghApi)).toEqual({ by: 'pr', out: '[]' });
    expect(asked).toEqual([STACK_4, HOLDING_4]);
  });
  test('any other failure asks, without reading it as a pull request', async () => {
    const failed = { asks: 'looking up stack #4 failed (gh: Server Error (HTTP 500))' };
    const { asked, ghApi } = gh({ [STACK_4]: failed, [HOLDING_4]: { out: '[]' } });
    expect(await readStack(4, ghApi)).toEqual(failed);
    expect(asked).toEqual([STACK_4]);
  });
  test('a failed second read asks, slow included', async () => {
    const slow = { asks: 'timed out', slow: true } as const;
    const { ghApi } = gh({ [STACK_4]: NOT_FOUND, [HOLDING_4]: slow });
    expect(await readStack(4, ghApi)).toEqual(slow);
  });
});

describe('mergeSet', () => {
  test('a stack merges every unmerged layer', () => {
    expect(mergeSet(4, byStack)).toEqual({ prs: [2, 3] });
  });
  test('a pull request merges with every unmerged one below it', () => {
    expect(mergeSet(3, byPr([STACK]))).toEqual({ prs: [2, 3] });
    expect(mergeSet(2, byPr([STACK]))).toEqual({ prs: [2] });
  });
  test.each([
    ['a merged pull request', 1, byPr([STACK]), '#1 has already merged'],
    [
      'a stack that has merged',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(1, true)] }) },
      'stack #4 has merged every layer',
    ],
    [
      'an empty stack',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [] }) },
      'stack #4 has merged every layer',
    ],
    ['a number in no stack', 9, byPr([]), '#9 is neither a stack nor a pull request in one'],
    ['a pull request in two stacks', 3, byPr([STACK, STACK]), '#3 is in more than one stack'],
    ['a stack not holding it', 9, byPr([STACK]), 'a shape the gate does not read'],
    ['not JSON', 4, { by: 'stack', out: 'nope' }, 'a shape the gate does not read'],
    [
      'a layer with no number',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ merged_at: null }] }) },
      'a shape the gate does not read',
    ],
    [
      'a layer numbered 0',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(0)] }) },
      'a shape the gate does not read',
    ],
    [
      'a layer listed twice',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [pr(2), pr(2)] }) },
      'a shape the gate does not read',
    ],
    [
      'an empty merged_at',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ number: 2, merged_at: '' }] }) },
      'a shape the gate does not read',
    ],
    [
      'a merged_at that is neither null nor a date',
      4,
      { by: 'stack', out: JSON.stringify({ pull_requests: [{ number: 2 }] }) },
      'a shape the gate does not read',
    ],
  ] as const)('%s asks', (_, n, read, asks) => {
    expect(mergeSet(n, read)).toMatchObject({
      asks: expect.stringContaining(asks),
      remedy: expect.any(String),
    });
  });
});

// The catalog the 2026-10-18 spike left (oakoss/stack-spike), trimmed.
const CATALOG = JSON.stringify({
  schemaVersion: 1,
  repository: 'github.com:oakoss/stack-spike',
  stacks: [
    {
      id: '2282014',
      number: 4,
      trunk: { branch: 'main', head: '14dc087' },
      branches: [
        { branch: 'spike/one', head: 'f5a524d', pullRequest: { number: 1, merged: true } },
        { branch: 'spike/two', head: 'e6206dd', pullRequest: { number: 2 } },
        { branch: 'spike/three', base: 'e6206dd' },
      ],
    },
  ],
});
const SPIKE = parseCatalog(CATALOG)?.[0];
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('parseCatalog', () => {
  test('reads each stack, its trunk and what merged', () => {
    expect(SPIKE).toEqual({
      number: 4,
      trunk: 'main',
      branches: [
        { branch: 'spike/one', merged: true },
        { branch: 'spike/two', merged: false },
        { branch: 'spike/three', merged: false },
      ],
    });
  });
  test.each([
    'not json',
    JSON.stringify({ schemaVersion: 2, stacks: [] }),
    JSON.stringify({ schemaVersion: 1 }),
    JSON.stringify({ schemaVersion: 1, stacks: [{ trunk: { branch: 'main' }, branches: [{}] }] }),
    JSON.stringify({
      schemaVersion: 1,
      stacks: [{ number: -3, trunk: { branch: 'main' }, branches: [] }],
    }),
    JSON.stringify({
      schemaVersion: 1,
      stacks: [{ number: '4', trunk: { branch: 'main' }, branches: [] }],
    }),
  ])('refuses what it cannot read: %s', (text) => {
    expect(parseCatalog(text)).toBeNull();
  });
});

describe('anonymized', () => {
  // Each pair is what `git remote get-url` and the dry run's `To` line printed
  // (git 2.56.0), as the 2026-10-19 review measured them.
  test.each([
    ['git@github.com:o/r.git', 'github.com:o/r.git'],
    ['ssh://git@github.com/o/r.git', 'ssh://github.com/o/r.git'],
    ['ssh://git:pw@github.com/o/r.git', 'ssh://github.com/o/r.git'],
    ['https://github.com/o/r.git', 'https://github.com/o/r.git'],
    ['../bare.git', '../bare.git'],
    ['/srv/git/r.git', '/srv/git/r.git'],
    ['file:///srv/git/r.git', 'file:///srv/git/r.git'],
    ['github.com:o/r.git', 'github.com:o/r.git'],
  ])('%s prints as %s', (url, shown) => {
    expect(anonymized(url)).toBe(shown);
  });
});

describe('layerOf', () => {
  const stacks = parseCatalog(CATALOG) ?? [];
  test('names the first unmerged layer a push updates', () => {
    expect(layerOf(stacks, ['fix/x', 'spike/three', 'spike/two'])).toBe('spike/three');
  });
  test('a merged layer, the trunk and a branch in no stack are not layers', () => {
    expect(layerOf(stacks, ['spike/one', 'main', 'fix/x'])).toBeNull();
    expect(layerOf([], ['spike/two'])).toBeNull();
  });
});

describe('stackOf', () => {
  const stacks = parseCatalog(CATALOG) ?? [];
  test('finds the stack holding a branch or trunk', () => {
    expect(stackOf(stacks, 'spike/two')).toEqual(SPIKE);
    expect(stackOf(stacks, 'main')).toEqual(SPIKE);
  });
  test('asks for a branch in no stack, or in two', () => {
    expect(stackOf(stacks, 'fix/x')).toEqual({ asks: '`fix/x` is in no stack this clone tracks' });
    expect(stackOf([...stacks, ...stacks], 'spike/two')).toEqual({
      asks: '`spike/two` is in more than one stack',
    });
  });
});

// The spike's stack with spike/two on origin where this agent pushed it.
function facts(over: Partial<Parameters<typeof leaseHolds>[0]> = {}) {
  if (SPIKE === undefined) throw new Error('the spike catalog did not parse');
  return {
    stack: SPIKE,
    defaultBranch: 'main',
    remote: 'origin',
    tips: new Map([['spike/two', A]]),
    pushed: new Map([['origin/spike/two', A]]),
    github: null,
    ...over,
  };
}

// A clone on spike/two whose one remote holds spike/two where this agent pushed it.
function io(over: Partial<LeaseIo> = {}): LeaseIo & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    catalog: () => Promise.resolve(CATALOG),
    branch: () => Promise.resolve('spike/two'),
    config: (key) => {
      asked.push(`config ${key}`);
      return Promise.resolve(null);
    },
    remotes: () => Promise.resolve(['origin']),
    urls: () => Promise.resolve({ fetch: 'git@h:o/r.git\n', push: 'git@h:o/r.git\n' }),
    heads: (remote) => {
      asked.push(`heads ${remote}`);
      return Promise.resolve(`${A}\trefs/heads/spike/two\n${B}\trefs/heads/main\n`);
    },
    defaultBranch: () => Promise.resolve({ out: 'main' }),
    ghApi: (args) => {
      asked.push(`gh ${args.join(' ')}`);
      return Promise.resolve({ out: JSON.stringify({ pull_requests: [] }) });
    },
    pushed: new Map([['origin/spike/two', A]]),
    ...over,
  };
}

// The same clone, its remote listing `listed`.
const theirs = (listed: string) => io({ heads: () => Promise.resolve(listed) });

describe('leaseHolds', () => {
  test('holds while every unmerged branch is absent or where this agent pushed it', () => {
    expect(leaseHolds(facts())).toEqual({ ok: true });
    // A merged branch is not pushed, wherever its tip is.
    expect(
      leaseHolds(
        facts({
          tips: new Map([
            ['spike/two', A],
            ['spike/one', B],
          ]),
        }),
      ),
    ).toEqual({
      ok: true,
    });
  });
  test('asks when a branch moved since this agent pushed it, or it never pushed it', () => {
    expect(leaseHolds(facts({ pushed: new Map([['origin/spike/two', B]]) }))).toEqual({
      asks: '`origin/spike/two` is at aaaaaaa, which the gate did not see this agent push (it pushed bbbbbbb)',
    });
    expect(leaseHolds(facts({ pushed: new Map() }))).toEqual({
      asks: '`origin/spike/two` is at aaaaaaa, which the gate never saw this agent push',
    });
    // A push to another remote is not one to this one.
    expect(leaseHolds(facts({ pushed: new Map([['fork/spike/two', A]]) }))).toMatchObject({
      asks: expect.stringContaining('never saw'),
    });
  });
  test('a branch new to the remote does not hide a later one that moved', () => {
    expect(leaseHolds(facts({ tips: new Map([['spike/three', B]]) }))).toEqual({
      asks: '`origin/spike/three` is at bbbbbbb, which the gate never saw this agent push',
    });
  });
  test('asks when a branch it pushes is the trunk', () => {
    if (SPIKE === undefined) throw new Error('the spike catalog did not parse');
    const stack = { ...SPIKE, trunk: 'spike/three' };
    expect(leaseHolds(facts({ stack }))).toEqual({
      asks: "`spike/three` is the stack's trunk or the default branch",
    });
  });
  test('asks when a branch it pushes is the default branch', () => {
    expect(leaseHolds(facts({ defaultBranch: 'spike/three' }))).toEqual({
      asks: "`spike/three` is the stack's trunk or the default branch",
    });
  });
  test('asks when GitHub holds a layer the catalog lacks', () => {
    expect(leaseHolds(facts({ github: ['spike/one', 'spike/two', 'theirs/four'] }))).toEqual({
      asks: "GitHub's stack holds `theirs/four`, which this clone's catalog lacks",
    });
    expect(leaseHolds(facts({ github: ['spike/two'] }))).toEqual({ ok: true });
  });
});

describe('stackHeads', () => {
  test('lists the heads GitHub has, none for a stack it does not have', async () => {
    const { ghApi } = gh({
      'repos/{owner}/{repo}/stacks/4': { out: JSON.stringify(STACK) },
      'repos/{owner}/{repo}/stacks/5': { asks: 'failed (gh: Not Found (HTTP 404))' },
      'repos/{owner}/{repo}/stacks/6': { asks: 'failed (gh: Server Error (HTTP 500))' },
      'repos/{owner}/{repo}/stacks/7': { out: '{"pull_requests":[{"number":2}]}' },
    });
    expect(await stackHeads(4, ghApi)).toEqual(['spike/1', 'spike/2', 'spike/3']);
    expect(await stackHeads(5, ghApi)).toEqual([]);
    expect(await stackHeads(6, ghApi)).toEqual({ asks: 'failed (gh: Server Error (HTTP 500))' });
    expect(await stackHeads(7, ghApi)).toMatchObject({ asks: expect.stringContaining('shape') });
  });
});

describe('stackLease', () => {
  test('holds on the remote gh-stack picks, reading GitHub only for sync', async () => {
    const push = io();
    expect(await stackLease('push', null, push)).toEqual({ ok: true });
    expect(push.asked).toEqual([
      'config branch.spike/two.pushRemote',
      'config remote.pushDefault',
      'config branch.spike/two.remote',
      'config gh-stack.remote',
      'config remote.origin.receivepack',
      'config remote.origin.uploadpack',
      'heads origin',
    ]);
    const sync = io();
    expect(await stackLease('sync', null, sync)).toEqual({ ok: true });
    expect(sync.asked).toContain('gh repos/{owner}/{repo}/stacks/4');
  });
  test('takes the remote named, or the first configured one', async () => {
    const named = io();
    await stackLease('push', 'origin', named);
    expect(named.asked).toEqual([
      'config remote.origin.receivepack',
      'config remote.origin.uploadpack',
      'heads origin',
    ]);
    const configured = io({
      config: (key) => Promise.resolve(key === 'remote.pushDefault' ? 'fork' : null),
    });
    expect(await stackLease('push', null, configured)).toMatchObject({
      asks: expect.stringContaining('`fork/spike/two`'),
    });
  });
  test.each([
    ['no catalog', { catalog: () => Promise.resolve(null) }, 'this clone tracks no stack'],
    [
      'an unread catalog',
      { catalog: () => Promise.resolve('{}') },
      'a shape the gate does not read',
    ],
    [
      'a detached HEAD',
      { branch: () => Promise.resolve({ asks: 'HEAD is on no branch' }) },
      'no branch',
    ],
    ['a branch in no stack', { branch: () => Promise.resolve('fix/x') }, 'in no stack'],
    ['no remote', { remotes: () => Promise.resolve([]) }, 'no remote'],
    ['two remotes', { remotes: () => Promise.resolve(['origin', 'fork']) }, 'several remotes'],
    [
      'a failed listing',
      { heads: () => Promise.resolve({ asks: 'listing failed' }) },
      'listing failed',
    ],
    [
      'an unread default branch',
      { defaultBranch: () => Promise.resolve({ asks: 'gh failed' }) },
      'gh failed',
    ],
    [
      'a remote that reads as an option',
      { config: () => Promise.resolve('--upload-pack=x') },
      'reads as an option',
    ],
  ] as const)('asks on %s', async (_, over, asks) => {
    expect(await stackLease('push', null, io(over as Partial<LeaseIo>))).toMatchObject({
      asks: expect.stringContaining(asks),
    });
  });
  test('reads the listing, SHA-256 included, and asks on a line it cannot read', async () => {
    expect(await stackLease('push', null, theirs(`${B}\trefs/heads/spike/two\n`))).toMatchObject({
      asks: expect.stringContaining('`origin/spike/two` is at bbbbbbb'),
    });
    const wide = `${'c'.repeat(64)}\trefs/heads/spike/two\n`;
    expect(await stackLease('push', null, theirs(wide))).toMatchObject({
      asks: expect.stringContaining('is at ccccccc'),
    });
    expect(await stackLease('push', null, theirs('warning: x\n'))).toEqual({
      asks: '`git ls-remote` printed a line the gate does not read',
    });
    expect(await stackLease('push', null, theirs(''))).toEqual({ ok: true });
  });
  test('asks when the remote pushes to another URL than it lists', async () => {
    const split = io({
      urls: () => Promise.resolve({ fetch: 'git@h:o/r.git\n', push: 'git@h:me/r.git\n' }),
    });
    expect(await stackLease('push', null, split)).toEqual({
      asks: '`origin` pushes to a URL other than the one it lists branches from',
    });
    expect(split.asked).not.toContain('heads origin');
    const both = 'git@h:o/r.git\ngit@h:me/r.git\n';
    const twice = io({ urls: () => Promise.resolve({ fetch: both, push: both }) });
    expect(await stackLease('push', null, twice)).toMatchObject({
      asks: expect.stringContaining('a URL other than'),
    });
  });
  test.each(['receivepack', 'uploadpack'])('asks when the remote sets its own %s', async (pack) => {
    const own = io({
      config: (key) =>
        Promise.resolve(key === `remote.origin.${pack}` ? 'git -C /other receive-pack' : null),
    });
    expect(await stackLease('push', null, own)).toEqual({
      asks: `\`origin\` sets its own ${pack} program`,
    });
    expect(own.asked).not.toContain('heads origin');
  });
  test('sync asks when GitHub cannot be read', async () => {
    const r = await stackLease(
      'sync',
      null,
      io({ ghApi: () => Promise.resolve({ asks: 'gh down' }) }),
    );
    expect(r).toEqual({ asks: 'gh down' });
  });
});
