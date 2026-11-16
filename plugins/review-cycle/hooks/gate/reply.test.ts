import { describe, expect, test } from 'claude-code/testing';

import { endTurn, fakeWorld, queue, say, updating, type Run, type World } from '../fixtures';

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
