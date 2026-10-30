import { describe, expect, test } from 'vitest';

import { readCommand } from './command';
import { NO_GRANT, type Grant } from './consent';
import type { InForce, ModelSteps, SecondRead } from './gh-verdict';
import type { Git, Run } from './git';
import type { PushSpec } from './git-args';
import type { Hold } from './hold';
import type { StopBefore } from './ladder';
import { escalatePush, judgePush, LEASE, stackLayerPushed, type PushConsent } from './push-judge';

function specOf(command: string): PushSpec {
  const c = readCommand(command).classification;
  if (c.kind !== 'gated' || c.push === null) throw new Error(`not a push: ${command}`);
  return c.push;
}

const grant = (g: Partial<Grant> = {}): Grant => ({ ...NO_GRANT, ...g });
const NEW_BRANCH = '*\tHEAD:refs/heads/fix/x\t[new branch]';
const TO_MAIN = ' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349';

const answer = (r: Partial<Run>): Promise<Run> =>
  Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...r });

const FAILS = Symbol('fails');

// git as the push judging sees it: the dry run's ref lines ('fail' for one
// that fails with none), the remote's default branch (null when unreadable),
// and the branch HEAD is on (null for a detached HEAD, FAILS when git fails).
function world(
  dry: readonly string[] | 'fail' = [NEW_BRANCH],
  head: string | null = 'main',
  on: string | null | typeof FAILS = 'refs/heads/fix/x',
) {
  const calls: string[] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const git: Git = (argv, opts) => {
    const a = argv.join(' ');
    calls.push(a);
    envs.push(opts?.env);
    if (argv.includes('--porcelain')) {
      return dry === 'fail'
        ? answer({ exitCode: 128, stderr: 'fatal: Could not read from remote repository.\n' })
        : answer({ stdout: ['To /remote.git', ...dry, 'Done'].join('\n') });
    }
    if (a.startsWith('git ls-remote --symref')) {
      return head === null
        ? answer({ exitCode: 128, stderr: 'fatal: unable to access\n' })
        : answer({ stdout: `ref: refs/heads/${head}\tHEAD\nabc\tHEAD\n` });
    }
    if (a === 'git symbolic-ref -q HEAD') {
      if (on === FAILS) return answer({ exitCode: 128, stderr: 'fatal: not a git repository\n' });
      return on === null ? answer({ exitCode: 1 }) : answer({ stdout: `${on}\n` });
    }
    return answer({ exitCode: 1, stderr: `unexpected: ${a}` });
  };
  return { git, calls, envs };
}

const consent =
  (held: Hold = null): PushConsent =>
  () => ({
    held,
    unread: null,
    shown: 'the push',
  });

function judge(
  command: string,
  w: ReturnType<typeof world>,
  g = grant(),
  stopBefore: StopBefore = 'push',
  commits = false,
  c = consent(),
) {
  const ladder: InForce = { stopBefore, source: 'local' };
  return judgePush(w.git, () => Promise.resolve(ladder), '/repo', c, commits, specOf(command), g);
}

describe('a push the user did not ask for', () => {
  test('runs unasked below its rung, and is refused at it as a push to decide', async () => {
    const below = await judge('git push origin fix/x', world(), grant(), 'open PR');
    expect(below).toEqual({
      ran: { step: 'push', ladder: { stopBefore: 'open PR', source: 'local' } },
    });
    const at = await judge('git push origin fix/x', world());
    expect(at).toMatchObject({
      deny: expect.stringContaining('To push, stop and ask them'),
      step: 'push',
    });
    expect(at).not.toHaveProperty('final');
  });

  test('asks whatever the setting when it pushes to the default branch', async () => {
    const r = await judge('git push origin main', world([TO_MAIN]), grant(), 'never stop');
    expect(r).toMatchObject({
      deny: expect.stringContaining(
        'asks whatever the setting: it pushes to `main`, the default branch',
      ),
    });
  });

  test('a bare force names the lease instead, and a lease asks for a force push', async () => {
    const bare = await judge('git push --force origin fix/x', world());
    expect(bare).toMatchObject({ deny: expect.stringContaining(`Use ${LEASE} instead`) });
    const lease = await judge('git push --force-with-lease origin fix/x', world());
    expect(lease).toMatchObject({ deny: expect.stringContaining("doesn't ask for a force push") });
  });

  test.each([
    ['git push --all origin', 'it pushes every branch'],
    ['git push --tags origin', 'it pushes tags'],
    ['git push origin "$BRANCH"', 'its remote or branch is built at run time'],
    ['git fetch && git push origin fix/x', '`git fetch` runs before it in the same command'],
  ])('%s asks whatever the setting: %s', async (command, why) => {
    const r = await judge(command, world(), grant(), 'never stop');
    expect(r).toMatchObject({ deny: expect.stringContaining(`asks whatever the setting: ${why}`) });
  });

  test('a push whose dry run fails asks whatever the setting', async () => {
    const r = await judge('git push origin fix/x', world('fail'), grant(), 'never stop');
    expect(r).toMatchObject({
      deny: expect.stringContaining(
        'a dry run of it, which shows what it would push, failed (fatal: Could not read from remote repository.)',
      ),
    });
  });

  test('a refusal beside a commit says to commit on its own', async () => {
    const r = await judge(
      'git commit -m x && git push origin fix/x',
      world(),
      grant(),
      'push',
      true,
    );
    expect(r).toMatchObject({
      deny: expect.stringContaining('To commit without pushing, run the commit on its own.'),
    });
  });

  test('a bare force with no request says the lease needs one too, and not with one', async () => {
    const none = await judge('git push --force origin fix/x', world());
    expect(none).toMatchObject({
      deny: expect.stringContaining('instead, which also needs their request;'),
    });
    const leased = await judge('git push --force origin fix/x', world(), grant({ push: 'lease' }));
    expect(leased).toMatchObject({ deny: expect.stringContaining(`Use ${LEASE} instead;`) });
  });

  test('the dry run carries the push options and no credential prompt', async () => {
    const w = world();
    await judge('git -c push.default=current push -q origin fix/x', w, grant(), 'never stop');
    const i = w.calls.findIndex((c) => c.includes('--porcelain'));
    expect(w.calls[i]).toBe(
      'git -c push.default=current push --dry-run -q origin fix/x --dry-run --porcelain --no-verify --no-quiet --recurse-submodules=no',
    );
    expect(w.envs[i]).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  test('a delete says a requested merge covers --delete-branch', async () => {
    const r = await judge('git push origin --delete fix/x', world(), grant(), 'never stop');
    expect(r).toMatchObject({
      deny: expect.stringContaining('also covers `gh pr merge --delete-branch`'),
    });
  });

  test('a requested pull request lets the plain push through as its own', async () => {
    const r = await judge('git push origin fix/x', world(), grant({ pr: true }));
    expect(r).toEqual({
      ran: { step: 'push', ladder: { stopBefore: 'push', source: 'local' }, forPr: true },
    });
  });

  test('a hold on the push keeps a requested pull request from carrying it', async () => {
    const held = consent({ step: 'push', how: 'mentioned' });
    const r = await judge(
      'git push origin fix/x',
      world(),
      grant({ pr: true }),
      'push',
      false,
      held,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('held off') });
  });
});

describe('a push the user asked for', () => {
  test('runs when the request covers it and its targets read clean', async () => {
    const w = world();
    expect(await judge('git push origin fix/x', w, grant({ push: 'push' }))).toEqual({ ran: null });
    expect(w.calls.filter((c) => c.includes('--porcelain'))).toHaveLength(1);
  });

  test('to a default branch it did not name asks, finally, with the offer that covers it', async () => {
    const r = await judge('git push origin main', world([TO_MAIN]), grant({ push: 'push' }));
    expect(r).toMatchObject({
      deny: expect.stringContaining('which the request did not name'),
      final: true,
    });
    expect(r).toMatchObject({ deny: expect.stringContaining('"Push to `main`?"') });
    const named = grant({ push: 'push', pushNamed: ['main'] });
    expect(await judge('git push origin main', world([TO_MAIN]), named)).toEqual({ ran: null });
  });

  test('runs with a note when its dry run fails or its default branch is unread', async () => {
    const failed = await judge('git push origin fix/x', world('fail'), grant({ push: 'push' }));
    expect(failed).toMatchObject({
      ran: null,
      note: expect.stringContaining('a dry run of it failed'),
    });
    const unread = await judge(
      'git push origin fix/x',
      world([NEW_BRANCH], null),
      grant({ push: 'push' }),
    );
    expect(unread).toMatchObject({ note: expect.stringContaining('could not be read') });
  });

  test('a commit that moves the default branch counts an up-to-date push of it', async () => {
    const upToDate = ['=\trefs/heads/main:refs/heads/main\t[up to date]'];
    const w = world(upToDate, 'main', 'refs/heads/main');
    const r = await judge(
      'git commit -m x && git push origin main',
      w,
      grant({ push: 'push' }),
      'push',
      true,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('the default branch'), final: true });
    expect(w.calls).toContain('git symbolic-ref -q HEAD');
  });

  test('a commit on a detached HEAD counts an up-to-date default branch it pushes', async () => {
    const upToDate = ['=\tHEAD:refs/heads/main\t[up to date]'];
    const r = await judge(
      'git commit -m x && git push origin HEAD:main',
      world(upToDate, 'main', null),
      grant({ push: 'push' }),
      'push',
      true,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('the default branch'), final: true });
  });

  test('a commit whose branch cannot be read counts an up-to-date default branch', async () => {
    const upToDate = ['=\trefs/heads/feature:refs/heads/main\t[up to date]'];
    const r = await judge(
      'git commit -m x && git push origin feature:main',
      world(upToDate, 'main', FAILS),
      grant({ push: 'push' }),
      'push',
      true,
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('the default branch'), final: true });
  });

  test('asks first when a step before it can change where it goes, or it is built at run time', async () => {
    const after = await judge(
      'git fetch && git push origin fix/x',
      world(),
      grant({ push: 'push' }),
    );
    expect(after).toMatchObject({
      deny: expect.stringContaining('`git fetch` runs before it'),
      final: true,
    });
    const built = await judge('git push origin "$BRANCH"', world(), grant({ push: 'push' }));
    expect(built).toMatchObject({
      deny: expect.stringContaining('built at run time'),
      final: true,
    });
  });
});

// The push judged at the push rung, as escalatePush calls it.
const judgeOf =
  (command: string, w: ReturnType<typeof world>, g = grant()) =>
  (model?: ModelSteps) => {
    const ladder: InForce = { stopBefore: 'push', source: 'local' };
    return judgePush(
      w.git,
      () => Promise.resolve(ladder),
      '/repo',
      consent(),
      false,
      specOf(command),
      g,
      model,
    );
  };

describe('the escalation from grammar to model', () => {
  type Yes = { steps: ModelSteps; quote: string };
  function reads(second: SecondRead<Yes>) {
    const asked: string[] = [];
    const read = () => {
      asked.push('second');
      return Promise.resolve(second);
    };
    return { asked, read };
  }

  test('a push the grammar allows asks the model nothing', async () => {
    const m = reads(null);
    const r = await escalatePush(
      judgeOf('git push origin fix/x', world(), grant({ push: 'push' })),
      m.read,
    );
    expect(r).toEqual({ verdict: { ran: null }, yes: null });
    expect(m.asked).toEqual([]);
  });

  test('a final refusal asks the model nothing', async () => {
    const m = reads({ steps: { push: true }, quote: 'x' });
    const r = await escalatePush(
      judgeOf('git push origin main', world([TO_MAIN]), grant({ push: 'push' })),
      m.read,
    );
    expect(r.verdict).toMatchObject({ final: true });
    expect(m.asked).toEqual([]);
  });

  test("the model's yes lets the refused push through, and is returned", async () => {
    const yes = { steps: { push: true }, quote: 'ship it' } as const;
    const r = await escalatePush(judgeOf('git push origin fix/x', world()), reads(yes).read);
    expect(r).toEqual({ verdict: { ran: null }, yes });
  });

  test('a model that cannot judge adds why and keeps the step; nothing to add keeps the refusal', async () => {
    const judge = judgeOf('git push origin fix/x', world());
    const plain = await escalatePush(judge, reads(null).read);
    const why = await escalatePush(judge, reads({ why: 'timed out' }).read);
    expect(plain.verdict).toMatchObject({ step: 'push' });
    expect(why.verdict).toEqual({
      deny: `${(plain.verdict as { deny: string }).deny} The model check could not judge the message (timed out).`,
      step: 'push',
    });
  });

  test("the model's yes to a pull request does not carry a push the user held off", async () => {
    const ladder: InForce = { stopBefore: 'push', source: 'local' };
    const r = await judgePush(
      world().git,
      () => Promise.resolve(ladder),
      '/repo',
      consent({ step: 'push', how: 'mentioned' }),
      false,
      specOf('git push origin fix/x'),
      grant(),
      { pr: true },
    );
    expect(r).toMatchObject({ deny: expect.stringContaining('held off') });
  });

  test('a yes that does not cover the push leaves it refused, with no yes', async () => {
    const r = await escalatePush(
      judgeOf('git push origin fix/x', world()),
      reads({ steps: { approve: true }, quote: 'sign off' }).read,
    );
    expect(r).toMatchObject({ verdict: { step: 'push' }, yes: null });
  });
});

test('one dry run serves every check on the same push', async () => {
  const w = world([TO_MAIN]);
  const spec = specOf('git push origin main');
  const ladder: InForce = { stopBefore: 'never stop', source: 'local' };
  const once = () =>
    judgePush(w.git, () => Promise.resolve(ladder), '/repo', consent(), false, spec, grant());
  await once();
  await once();
  expect(w.calls.filter((c) => c.includes('--porcelain'))).toHaveLength(1);
});

test('the refusal quotes the command as it stands when refusing', async () => {
  const w = world([TO_MAIN]);
  let shown = 'before git';
  const late: PushConsent = () => ({ held: null, unread: null, shown });
  const git: Git = (argv, opts) => {
    shown = 'after git';
    return w.git(argv, opts);
  };
  const ladder: InForce = { stopBefore: 'never stop', source: 'local' };
  const r = await judgePush(
    git,
    () => Promise.resolve(ladder),
    '/repo',
    late,
    false,
    specOf('git push origin main'),
    grant(),
  );
  expect(r).toMatchObject({ deny: expect.stringContaining('The command: after git') });
});

const layerRef = (branch: string) => `*\trefs/heads/${branch}:refs/heads/${branch}\t[new branch]`;

describe('stackLayerPushed', () => {
  const ORIGIN = 'https://github.com/o/r.git';
  const CATALOG = JSON.stringify({
    schemaVersion: 1,
    stacks: [
      {
        trunk: { branch: 'main' },
        branches: [
          { branch: 'spike/one', pullRequest: { number: 1, merged: true } },
          { branch: 'spike/two', pullRequest: { number: 2 } },
          { branch: 'spike/three', pullRequest: { number: 3 } },
        ],
      },
    ],
  });

  // git as the steer sees it: the dry run's ref lines under `To <to>`.
  function gitOf(lines: readonly string[], to = ORIGIN) {
    const calls: string[] = [];
    const git: Git = (argv) => {
      calls.push(argv.join(' '));
      if (argv.includes('--porcelain')) {
        return answer({ stdout: [`To ${to}`, ...lines, 'Done'].join('\n') });
      }
      return answer({ stdout: 'ref: refs/heads/main\tHEAD\n' });
    };
    return { git, calls };
  }

  type Io = Parameters<typeof stackLayerPushed>[3];
  const io = (over: Partial<Io> = {}, config: Record<string, string> = {}): Io => ({
    catalog: () => Promise.resolve(CATALOG),
    config: (key) => Promise.resolve(config[key] ?? null),
    remotes: () => Promise.resolve(['origin']),
    urls: () => Promise.resolve({ fetch: ORIGIN, push: ORIGIN }),
    ...over,
  });

  const steer = (command: string, w: ReturnType<typeof gitOf>, i = io()) =>
    stackLayerPushed(w.git, '/repo', specOf(command), i);

  test('names an unmerged layer pushed where gh-stack pushes it', async () => {
    const w = gitOf([layerRef('spike/two')]);
    expect(await steer('git push origin spike/two', w)).toBe('spike/two');
    expect(w.calls.filter((c) => c.includes('--dry-run'))).toHaveLength(1);
  });

  test('a merged layer, the trunk, a branch in no stack, a tag or a deleted layer is not one', async () => {
    for (const ref of [
      layerRef('spike/one'),
      layerRef('main'),
      layerRef('fix/x'),
      // `refs/tags/x` is as long as `refs/heads/`, so this names spike/two if read as a branch.
      '*\trefs/tags/xspike/two:refs/tags/xspike/two\t[new tag]',
      '-\t:refs/heads/spike/two\t[deleted]',
    ]) {
      expect(await steer('git push origin x', gitOf([ref])), ref).toBeNull();
    }
    const both = gitOf(['-\t:refs/heads/old\t[deleted]', layerRef('spike/two')]);
    expect(await steer('git push origin :old spike/two', both)).toBe('spike/two');
    const after = gitOf([layerRef('fix/x'), layerRef('spike/one'), layerRef('spike/two')]);
    expect(await steer('git push origin fix/x spike/one spike/two', after)).toBe('spike/two');
  });

  test('matches the push URL as git prints it, without its user, among several', async () => {
    const ssh = io({
      urls: () => Promise.resolve({ fetch: ORIGIN, push: `${ORIGIN}\ngit@github.com:o/r.git ` }),
    });
    const w = gitOf([layerRef('spike/two')], 'github.com:o/r.git');
    expect(await steer('git push origin spike/two', w, ssh)).toBe('spike/two');
  });

  test('a layer whose remote cannot be picked or read does not stop the next layer', async () => {
    const pushed = [layerRef('spike/two'), layerRef('spike/three')];
    const config = {
      'branch.spike/two.pushRemote': 'gone',
      'branch.spike/three.pushRemote': 'origin',
    };
    const unread = io(
      {
        urls: (remote) =>
          Promise.resolve(
            remote === 'gone' ? { asks: 'no such remote' } : { fetch: ORIGIN, push: ORIGIN },
          ),
      },
      config,
    );
    const command = 'git push origin spike/two spike/three';
    expect(await steer(command, gitOf(pushed), unread)).toBe('spike/three');
    const unpicked = io(
      { remotes: () => Promise.resolve(['origin', 'backup']) },
      { 'branch.spike/three.pushRemote': 'origin' },
    );
    expect(await steer(command, gitOf(pushed), unpicked)).toBe('spike/three');
    const elsewhere = io(
      {
        urls: (remote) =>
          Promise.resolve(
            remote === 'gone'
              ? { fetch: '/backup.git', push: '/backup.git' }
              : { fetch: ORIGIN, push: ORIGIN },
          ),
      },
      config,
    );
    expect(await steer(command, gitOf(pushed), elsewhere)).toBe('spike/three');
  });

  test('a layer pushed to another remote than the one gh-stack picks is not steered', async () => {
    const picked = io({}, { 'branch.spike/two.pushRemote': 'origin' });
    const w = gitOf([layerRef('spike/two')], '/backup.git');
    expect(await steer('git push backup spike/two', w, picked)).toBeNull();
  });

  test('a remote it cannot pick or read leaves the push to the other checks', async () => {
    const several = io({ remotes: () => Promise.resolve(['origin', 'backup']) });
    const pushed = [layerRef('spike/two')];
    expect(await steer('git push origin spike/two', gitOf(pushed), several)).toBeNull();
    const unread = io({ urls: () => Promise.resolve({ asks: 'no such remote' }) });
    expect(await steer('git push origin spike/two', gitOf(pushed), unread)).toBeNull();
  });

  test('without a readable catalog with stacks, or a push it can rerun, there is no dry run', async () => {
    const empty = JSON.stringify({ schemaVersion: 1, stacks: [] });
    for (const catalog of [null, { asks: 'unreadable' }, 'not json', empty] as const) {
      const w = gitOf([layerRef('spike/two')]);
      const none = io({ catalog: () => Promise.resolve(catalog) });
      expect(await steer('git push origin spike/two', w, none)).toBeNull();
      expect(w.calls).toEqual([]);
    }
    const w = gitOf([layerRef('spike/two')]);
    const spec = { ...specOf('git push origin spike/two'), argv: null };
    expect(await stackLayerPushed(w.git, '/repo', spec, io())).toBeNull();
    expect(w.calls).toEqual([]);
  });
});
