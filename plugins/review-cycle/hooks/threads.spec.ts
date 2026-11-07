import { describe, expect, test } from 'vitest';

import {
  openThreadsOf,
  planReply,
  threadFactsOf,
  type ReplyContext,
  type ThreadFacts,
} from './threads';

const facts = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  thread: 'PRRT_1',
  repo: 'oakoss/oakterm',
  pull: 109,
  prAuthor: 'me',
  isCrossRepository: false,
  state: 'OPEN',
  reviewDecision: '',
  starterIsBot: true,
  isResolved: false,
  commits: ['a5f6f70aaaaaaaa', 'cda6f31bbbbbbbb'],
  last: null,
  ...over,
});
const ctx = (over: Partial<ReplyContext> = {}): ReplyContext => ({
  asked: false,
  held: false,
  setting: 'push and reply',
  viewer: 'me',
  repo: 'oakoss/oakterm',
  ...over,
});
const item = { thread: 'PRRT_1', body: 'Fixed in a5f6f70.', commit: 'a5f6f70', resolve: true };

describe('planReply', () => {
  test('a reply the user asked for posts on any thread; resolving follows the setting alone', () => {
    const resolving = ctx({ asked: true, setting: 'push, reply and resolve' });
    expect(planReply(item, facts({ starterIsBot: false }), resolving)).toEqual({
      post: true,
      resolve: false,
      unasked: false,
    });
    expect(planReply(item, facts(), ctx({ asked: true, setting: 'ask' }))).toEqual({
      post: true,
      resolve: false,
      unasked: false,
    });
    expect(planReply(item, facts(), resolving)).toEqual({
      post: true,
      resolve: true,
      unasked: false,
    });
  });

  test('push and reply posts unasked on a bot thread of your own pull request, without resolving', () => {
    expect(planReply(item, facts(), ctx())).toEqual({ post: true, resolve: false, unasked: true });
  });

  test('push, reply and resolve also resolves a bot thread the commit fixed', () => {
    const p = planReply(item, facts(), ctx({ setting: 'push, reply and resolve' }));
    expect(p).toEqual({ post: true, resolve: true, unasked: true });
  });

  test.each([
    ['ask', ctx({ setting: 'ask' }), facts(), 'the user has not asked for a reply'],
    ['push fixes', ctx({ setting: 'push fixes' }), facts(), 'the user has not asked for a reply'],
    ['a person opened it', ctx(), facts({ starterIsBot: false }), 'a person opened this thread'],
    ['not yours', ctx(), facts({ prAuthor: 'them' }), '#109 is not one you opened'],
    ['a fork', ctx(), facts({ isCrossRepository: true }), '#109 comes from a fork'],
    ['closed', ctx(), facts({ state: 'MERGED' }), '#109 is not open'],
    ['approved', ctx(), facts({ reviewDecision: 'APPROVED' }), '#109 is already approved'],
    ['an unknown decision', ctx(), facts({ reviewDecision: 'NEW' }), '#109 is already approved'],
    ['held', ctx({ held: true }), facts(), 'the user held off replying'],
  ])('unasked, %s refuses with the question to ask', (_label, c, f, why) => {
    expect(planReply(item, f, c)).toEqual({ refuse: why, ask: true });
  });

  test('a review decision that leaves it unapproved lets it run', () => {
    for (const reviewDecision of ['REVIEW_REQUIRED', 'CHANGES_REQUESTED']) {
      expect(planReply(item, facts({ reviewDecision }), ctx())).toMatchObject({ post: true });
    }
  });

  test('a request outranks a hold for the reply, but the hold keeps the thread open', () => {
    const c = ctx({ asked: true, held: true, setting: 'push, reply and resolve' });
    expect(planReply(item, facts(), c)).toEqual({ post: true, resolve: false, unasked: false });
  });

  test("another repository's thread refuses, asked or not, with no question", () => {
    const f = facts({ repo: 'someone/else' });
    for (const asked of [false, true]) {
      expect(planReply(item, f, ctx({ asked }))).toEqual({
        refuse: '#109 is in someone/else, not this repository',
        ask: false,
      });
    }
    expect(planReply(item, facts({ repo: 'OakOSS/OakTerm' }), ctx())).toMatchObject({ post: true });
  });

  test('a cited commit must be on the pull request', () => {
    const p = planReply({ ...item, commit: 'deadbee' }, facts(), ctx({ asked: true }));
    expect(p).toEqual({ refuse: '`deadbee` is not on #109 yet: push it first', ask: false });
    expect(planReply({ ...item, commit: 'not-a-sha' }, facts(), ctx({ asked: true }))).toEqual({
      refuse: '`not-a-sha` is not a commit id',
      ask: false,
    });
  });

  test('resolving needs the fix commit; a deferral replies without resolving', () => {
    const deferral = { thread: 'PRRT_1', body: 'Not fixing: out of scope.', resolve: true };
    expect(planReply(deferral, facts(), ctx({ asked: true }))).toEqual({
      refuse: 'resolving needs the commit that fixed it',
      ask: false,
    });
    const noResolve = { thread: 'PRRT_1', body: 'Not fixing: out of scope.' };
    expect(planReply(noResolve, facts(), ctx())).toEqual({
      post: true,
      resolve: false,
      unasked: true,
    });
  });

  test('a reply already made is not posted again, but a resolve it still needs goes ahead', () => {
    const cited = facts({ last: { author: 'me', body: 'Fixed in a5f6f70, thanks.' } });
    const skip = { skip: "the thread's last reply is already yours and says this" };
    expect(planReply({ ...item, resolve: false }, cited, ctx({ asked: true }))).toEqual(skip);
    expect(planReply(item, cited, ctx({ setting: 'push, reply and resolve' }))).toEqual({
      post: false,
      resolve: true,
      unasked: true,
    });
    // A longer abbreviation of the same commit, in other words, is the same reply.
    const longer = { ...item, body: 'Done in a5f6f70aaa.', commit: 'a5f6f70aaa', resolve: false };
    expect(planReply(longer, cited, ctx())).toEqual(skip);
    // A later fix, or a hex word that is no commit here, is a new reply.
    for (const body of ['Fixed in cda6f31.', 'See deadbeef1 for context.']) {
      const other = facts({ last: { author: 'me', body } });
      expect(planReply(item, other, ctx())).toMatchObject({ post: true });
    }
    const deferral = { thread: 'PRRT_1', body: 'Not fixing: out of scope.' };
    const same = facts({ last: { author: 'me', body: 'Not fixing: out of scope.' } });
    expect(planReply(deferral, same, ctx())).toEqual(skip);
    // Someone else's reply after yours does not count.
    const theirs = facts({ last: { author: 'pullfrog', body: 'Fixed in a5f6f70.' } });
    expect(planReply(item, theirs, ctx({ asked: true }))).toMatchObject({ post: true });
  });

  test('an already resolved thread is not resolved again', () => {
    const p = planReply(item, facts({ isResolved: true }), ctx({ asked: true }));
    expect(p).toEqual({ post: true, resolve: false, unasked: false });
  });

  test('an empty reply refuses', () => {
    expect(planReply({ ...item, body: '  ' }, facts(), ctx({ asked: true }))).toEqual({
      refuse: 'the reply has no text',
      ask: false,
    });
  });
});

describe('threadFactsOf', () => {
  // GitHub's answer to THREAD_QUERY for a pullfrog thread on oakterm #109.
  const answer = {
    data: {
      node: {
        isResolved: false,
        pullRequest: {
          repository: { nameWithOwner: 'oakoss/oakterm' },
          number: 109,
          state: 'OPEN',
          isCrossRepository: false,
          reviewDecision: null,
          author: { login: 'jbabin91' },
          commits: { nodes: [{ commit: { oid: 'd1cdd2b651ea' } }] },
        },
        first: { nodes: [{ author: { __typename: 'Bot' } }] },
        last: { nodes: [{ author: { login: 'pullfrog' }, body: 'Glyph pass…' }] },
      },
    },
  };

  test('reads the thread, its pull request, its starter and its last reply', () => {
    expect(threadFactsOf('PRRT_1', JSON.stringify(answer))).toEqual({
      thread: 'PRRT_1',
      repo: 'oakoss/oakterm',
      pull: 109,
      prAuthor: 'jbabin91',
      isCrossRepository: false,
      state: 'OPEN',
      reviewDecision: '',
      starterIsBot: true,
      isResolved: false,
      commits: ['d1cdd2b651ea'],
      last: { author: 'pullfrog', body: 'Glyph pass…' },
    });
  });

  test('a person who opened the thread is no bot', () => {
    const human = structuredClone(answer);
    human.data.node.first.nodes[0]!.author.__typename = 'User';
    expect(threadFactsOf('PRRT_1', JSON.stringify(human))).toMatchObject({ starterIsBot: false });
  });

  test('null entries in its lists are skipped', () => {
    const holes = structuredClone(answer) as unknown as {
      data: {
        node: { pullRequest: { commits: { nodes: unknown[] } }; last: { nodes: unknown[] } };
      };
    };
    holes.data.node.pullRequest.commits.nodes.push(null);
    holes.data.node.last.nodes = [null];
    expect(threadFactsOf('PRRT_1', JSON.stringify(holes))).toMatchObject({
      commits: ['d1cdd2b651ea'],
      last: null,
    });
  });

  test('an id that is no review thread, or an unreadable answer, says so', () => {
    expect(threadFactsOf('X', '{"data":{"node":{}}}')).toEqual({
      why: '`X` names no review thread',
    });
    expect(threadFactsOf('X', 'not json')).toEqual({ why: 'thread `X` could not be read' });
    expect(threadFactsOf('X', '{"data":{"node":null}}')).toEqual({
      why: 'thread `X` could not be read',
    });
    const noRepo = structuredClone(answer) as { data: { node: { pullRequest: object } } };
    delete (noRepo.data.node.pullRequest as { repository?: unknown }).repository;
    expect(threadFactsOf('X', JSON.stringify(noRepo))).toEqual({
      why: 'thread `X` could not be read',
    });
  });
});

const node = (id: string, isResolved: boolean) => ({
  id,
  isResolved,
  path: 'a.rs',
  line: 3,
  first: { nodes: [{ author: { __typename: 'Bot', login: 'pullfrog' }, body: 'x' }] },
});
const page = (hasNextPage: boolean) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage },
            nodes: [node('PRRT_a', true), node('PRRT_b', false)],
          },
        },
      },
    },
  });

describe('openThreadsOf', () => {
  test('lists the unresolved threads, and says when GitHub has more past the first page', () => {
    expect(openThreadsOf(page(false), 7)).toEqual({
      threads: [
        { thread: 'PRRT_b', path: 'a.rs', line: 3, byBot: true, author: 'pullfrog', body: 'x' },
      ],
      more: false,
    });
    expect(openThreadsOf(page(true), 7)).toMatchObject({ more: true });
    const holes = JSON.parse(page(false));
    holes.data.repository.pullRequest.reviewThreads.nodes.unshift(null);
    expect(openThreadsOf(JSON.stringify(holes), 7)).toMatchObject({
      threads: [{ thread: 'PRRT_b' }],
    });
  });
});
