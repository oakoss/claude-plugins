import { describe, expect, test } from 'vitest';

import { readCommand } from './command';
import { NO_GRANT, type Grant } from './consent';
import type { InForce, ModelSteps, SecondRead } from './gh-verdict';
import type { Git, Run } from './git';
import type { PushSpec } from './git-args';
import type { Hold } from './hold';
import type { StopBefore } from './ladder';
import { escalatePush, judgePush, LEASE, type PushConsent } from './push-judge';

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
