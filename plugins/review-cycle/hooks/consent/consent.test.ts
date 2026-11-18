import { describe, expect, test } from 'claude-code/testing';

import {
  bash,
  contextOf,
  denied,
  endTurn,
  fakeWorld,
  github,
  keptRecord,
  pushing,
  ran,
  reloadInto,
  remoteSide,
  say,
  statusOf,
  stops,
  type World,
} from '../fixtures';

const tagLine = (v: string) => `*\trefs/tags/${v}:refs/tags/${v}\t[new tag]`;

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

const END_WITH = 'End your answer with this line, word for word: ';

// The question the offer tool returns, as the agent's answer ends on it.
async function offered($: any, input: Record<string, unknown>): Promise<string> {
  const r = (await $.tool.call({ tool: 'mcp__review-cycle__offer', ...input })) as {
    result: string;
  };
  expect(r.result.startsWith(END_WITH)).toBe(true);
  return r.result.slice(END_WITH.length);
}

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

  test('a release naming versions refuses a release of any other, or of one the gate cannot name', async ($, on) => {
    fakeWorld(on, byHand());
    await endTurn($, 'answer', await offered($, { step: 'release', version: 'pr-kit@0.6.1' }));
    await say($, 'yes');
    const other = await bash($, 'gh release create pr-watch@0.9.0 --verify-tag');
    expect(
      denied(other, 'the user asked to release `pr-kit@0.6.1`, and this releases `pr-watch@0.9.0`'),
    ).toBe(true);
    expect(denied(other, 'The question: Release `pr-watch@0.9.0`?')).toBe(true);
    expect(denied(await bash($, 'gh release create "$TAG"'), 'cannot name')).toBe(true);
    expect(
      denied(await bash($, 'gh api repos/{owner}/{repo}/releases -f tag_name=v9'), '`v9`'),
    ).toBe(true);
    expect(ran(await bash($, 'gh release edit pr-kit@0.6.1 --notes x'))).toBe(true);
    // A publish names no version, and oakum's releases every pending one.
    expect(denied(await bash($, 'npm publish'), 'cannot name')).toBe(true);
    expect(denied(await bash($, 'pnpm exec oakum release'), 'cannot name')).toBe(true);
  });

  test('a release naming versions does not merge the version pull request', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', await offered($, { step: 'release', version: 'v0.25.0' }));
    await say($, 'yes');
    const r = await bash($, 'gh pr merge 130');
    expect(denied(r, 'the user asked to release `v0.25.0`, and merging #130')).toBe(true);
    const byUrl = await bash($, 'gh pr merge https://github.com/o/r/pull/130');
    expect(denied(byUrl, 'the user asked to release `v0.25.0`, and merging #130')).toBe(true);
    const bare = await bash($, 'gh pr merge');
    expect(denied(bare, 'merging the version pull request releases')).toBe(true);
    await endTurn($, 'answer', await offered($, { step: 'release', pulls: ['130'] }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });

  test('a setting that frees releases does not hold one to the versions named', async ($, on) => {
    fakeWorld(on, { ...byHand(), settings: { local: stops('never stop') } });
    await endTurn($, 'answer', await offered($, { step: 'release', version: 'pr-kit@0.6.1' }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh release create pr-watch@0.9.0'))).toBe(true);
  });

  test('a release that names no version still covers any', async ($, on) => {
    fakeWorld(on, byHand());
    await endTurn($, 'answer', await offered($, { step: 'release', pulls: ['343'] }));
    await say($, 'yes');
    expect(ran(await bash($, 'gh release create pr-watch@0.9.0'))).toBe(true);
    expect(ran(await bash($, 'gh release create "$TAG"'))).toBe(true);
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
    const cleanup = await bash($, 'gh release delete pr-kit@0.6.1 --cleanup-tag --yes');
    expect(denied(cleanup, 'it deletes the tag `pr-kit@0.6.1`')).toBe(true);
    expect(ran(await bash($, 'gh release delete pr-kit@0.6.1 --yes'))).toBe(true);
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
