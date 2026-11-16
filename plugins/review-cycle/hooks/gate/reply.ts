import type { MatchedHook } from 'claude-code';

import { holds } from '../consent/hold';
import { offerQuestion } from '../consent/offers';
import { ghRead, TIMED_OUT, type $, type Input, type NextOf, type Output } from '../state/engine';
import { held, state } from '../state/gate-state';
import { firstLine, messageOf } from './git';
import { overtaken, prUpdatesInForce, SUBAGENT } from './judge';
import {
  MAX_REPLIES,
  OPEN_THREADS_QUERY,
  openThreadsOf,
  planReply,
  REPLY_MUTATION,
  RESOLVE_MUTATION,
  THREAD_QUERY,
  threadFactsOf,
  type ReplyItem,
} from './threads';

type ThreadsHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__threads' }>;
type ReplyHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__reply' }>;

export async function registerReply($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'threads',
      description:
        "The open (unresolved) review threads of a pull request in this repository: each thread's id, file, line, whether a later push outdated it, whether a bot opened it, who did, its first comment, and who wrote its last (lastBy). Use the ids with review-cycle's reply tool. Read-only. It reads the first 100 threads; more: true means there are others it left out.",
      inputSchema: {
        type: 'object',
        properties: { pr: { type: 'string', description: 'The pull request number, "109".' } },
        required: ['pr'],
      },
    });
    await $.tool.register({
      name: 'reply',
      description: `Replies to review threads on a pull request, and resolves the ones a commit fixed: the way to answer review findings, rather than gh. Each reply names the commit that fixed its finding, which must already be pushed; a reply that defers a finding gives no commit and is not resolved. Runs when the user asked for a reply, or unasked when their prUpdates setting allows it on their own open, unapproved pull request: 'push and reply' replies to threads a bot opened, and 'push, reply and resolve' also resolves them. A thread a person opened always needs the user's request, and is left for that person to resolve; a thread is resolved only under 'push, reply and resolve', asked or not. A refused reply says why and gives the question to ask. At most ${MAX_REPLIES} threads a call; preview: true shows what would happen without posting.`,
      inputSchema: {
        type: 'object',
        properties: {
          replies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                thread: { type: 'string', description: 'A review thread id, "PRRT_…".' },
                body: { type: 'string' },
                commit: { type: 'string', description: 'The pushed commit that fixed it.' },
                resolve: { type: 'boolean', description: 'Resolve the thread; needs commit.' },
              },
              required: ['thread', 'body'],
            },
          },
          preview: { type: 'boolean' },
        },
        required: ['replies'],
      },
    });
  } catch {
    // Without the tools, replies go through gh and the gate as before.
  }
}

const PULL_NUMBER = /^#?(\d{1,9})$/;

export async function onThreads(
  $: $,
  e: Input<ThreadsHook>,
  _next: NextOf<ThreadsHook>,
): Promise<Output<ThreadsHook>> {
  const pr = (e as { pr?: unknown }).pr;
  const m = PULL_NUMBER.exec(typeof pr === 'string' || typeof pr === 'number' ? String(pr) : '');
  if (m === null) {
    return { result: 'review-cycle: threads takes pr, a pull request number such as "109"' };
  }
  const pull = Number(m[1]);
  const read = await ghRead(
    $,
    [
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-F',
      `pr=${pull}`,
      '-f',
      `query=${OPEN_THREADS_QUERY}`,
    ],
    `the review threads of #${pull}`,
  );
  if (read.asks !== undefined) return { result: `review-cycle: ${read.asks}` };
  const listed = openThreadsOf(read.out, pull);
  if ('why' in listed) return { result: `review-cycle: ${listed.why}` };
  const { threads, more } = listed;
  return { result: JSON.stringify(more ? { pull, threads, more } : { pull, threads }) };
}

type ReplyOutcome = { thread: string; outcome: string; url?: string; why?: string };

// Threads a reply call is writing to, so a second call at once cannot post twice.
const replying = new Set<string>();

const MAY_HAVE_POSTED = 'it may have gone through: read the thread before trying again';

export async function onReply(
  $: $,
  e: Input<ReplyHook>,
  next: NextOf<ReplyHook>,
): Promise<Output<ReplyHook>> {
  if (e.agentId) return { result: `review-cycle: ${SUBAGENT}` };
  const message = state.messages;
  const input = e as { replies?: unknown; preview?: unknown };
  const items = replyItemsOf(input.replies);
  if ('why' in items) return { result: `review-cycle: ${items.why}` };
  const preview = input.preview === true;
  const viewer = await ghRead($, ['api', 'user', '--jq', '.login'], 'your GitHub login');
  if (viewer.asks !== undefined) return { result: `review-cycle: nothing posted: ${viewer.asks}` };
  const repo = await ghRead(
    $,
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    'this repository',
  );
  if (repo.asks !== undefined) return { result: `review-cycle: nothing posted: ${repo.asks}` };
  const { prUpdates, unreadable } = await prUpdatesInForce($);
  const context = {
    // The turn's grant, so a message queued after the request keeps it.
    asked: state.message.grant.comment,
    held: holds(held(), 'comment'),
    setting: prUpdates,
    viewer: viewer.out,
    repo: repo.out,
  };
  const outcomes: ReplyOutcome[] = [];
  const asks = new Set<number>();
  const ran = new Map<number, { replied: number; resolved: number; unknown: number }>();
  const tally = (pull: number, key: 'replied' | 'resolved' | 'unknown') => {
    const n = ran.get(pull) ?? { replied: 0, resolved: 0, unknown: 0 };
    ran.set(pull, { ...n, [key]: n[key] + 1 });
  };
  // A new message may hold or take back what this call was judged on.
  const stale = () => overtaken(message, next.signal, 'reply')?.deny.replace(/^review-cycle: /, '');
  try {
    for (const [i, item] of items.entries()) {
      const why = stale();
      if (why !== undefined) {
        for (const rest of items.slice(i)) {
          outcomes.push({ thread: rest.thread, outcome: 'not posted', why });
        }
        break;
      }
      await replyOne(item);
    }
  } catch (error) {
    outcomes.push({
      thread: '*',
      outcome: 'stopped',
      why: `${messageOf(error)}; read the threads before trying again`,
    });
  }
  async function replyOne(item: ReplyItem): Promise<void> {
    const thread = item.thread;
    if (replying.has(thread)) {
      outcomes.push({ thread, outcome: 'skipped', why: 'another call is replying to it' });
      return;
    }
    replying.add(thread);
    try {
      const read = await ghRead(
        $,
        ['api', 'graphql', '-f', `id=${thread}`, '-f', `query=${THREAD_QUERY}`],
        `thread \`${thread}\``,
      );
      const facts = read.asks === undefined ? threadFactsOf(thread, read.out) : { why: read.asks };
      if ('why' in facts) {
        outcomes.push({ thread, outcome: 'failed', why: facts.why });
        return;
      }
      const plan = planReply(item, facts, context);
      if ('skip' in plan) {
        outcomes.push({ thread, outcome: 'skipped', why: plan.skip });
        return;
      }
      if ('refuse' in plan) {
        const why =
          unreadable === undefined
            ? plan.refuse
            : `${plan.refuse} (the prUpdates setting could not be read: ${unreadable})`;
        outcomes.push({ thread, outcome: 'refused', why });
        if (plan.ask) asks.add(facts.pull);
        return;
      }
      if (preview) {
        const verb = [plan.post && 'reply', plan.resolve && 'resolve']
          .filter(Boolean)
          .join(' and ');
        outcomes.push({ thread, outcome: `would ${verb}` });
        return;
      }
      const before = stale();
      if (before !== undefined) {
        outcomes.push({ thread, outcome: 'not posted', why: before });
        return;
      }
      let url: string | undefined;
      if (plan.post) {
        const posted = await ghWrite($, [
          'api',
          'graphql',
          '-f',
          `id=${thread}`,
          '-f',
          `body=${item.body}`,
          '-f',
          `query=${REPLY_MUTATION}`,
          '--jq',
          '.data.addPullRequestReviewThreadReply.comment.url',
        ]);
        // A timeout, or an answer with no comment, may still have posted.
        if ('why' in posted && !posted.unsure) {
          outcomes.push({ thread, outcome: 'failed', why: posted.why });
          return;
        }
        if ('why' in posted || posted.out === '') {
          outcomes.push({
            thread,
            outcome: 'unknown',
            why: `${'why' in posted ? posted.why : 'GitHub answered with no comment'}; ${MAY_HAVE_POSTED}`,
          });
          if (plan.unasked) tally(facts.pull, 'unknown');
          return;
        }
        url = posted.out;
        if (plan.unasked) tally(facts.pull, 'replied');
      }
      const said = plan.post ? 'replied' : 'already replied';
      const withUrl = url === undefined ? {} : { url };
      const between = plan.resolve ? stale() : undefined;
      if (!plan.resolve || between !== undefined) {
        outcomes.push({
          thread,
          outcome: between === undefined ? said : `${said}, not resolved`,
          ...withUrl,
          ...(between !== undefined && { why: between }),
        });
        return;
      }
      const resolved = await ghWrite($, [
        'api',
        'graphql',
        '-f',
        `id=${thread}`,
        '-f',
        `query=${RESOLVE_MUTATION}`,
        '--jq',
        '.data.resolveReviewThread.thread.isResolved',
      ]);
      if ('why' in resolved || resolved.out !== 'true') {
        const why = 'why' in resolved ? resolved.why : `GitHub answered isResolved ${resolved.out}`;
        const unknown = 'why' in resolved && resolved.unsure;
        outcomes.push({
          thread,
          outcome: `${said}, ${unknown ? 'resolve unknown' : 'not resolved'}`,
          ...withUrl,
          why,
        });
        return;
      }
      if (plan.unasked) tally(facts.pull, 'resolved');
      outcomes.push({ thread, outcome: `${said} and resolved`, ...withUrl });
    } finally {
      replying.delete(thread);
    }
  }
  // Shown whatever the notice setting says, as a push to an open pull request
  // is: a reply goes out under the user's own name.
  if (ran.size > 0) {
    const links = outcomes.flatMap((o) => (o.url === undefined ? [] : [o.url])).join(' ');
    const what = [...ran].map(([pull, n]) => {
      const maybe = n.unknown > 0 ? `, ${n.unknown} may have posted` : '';
      return `#${pull}: ${n.replied} repl${n.replied === 1 ? 'y' : 'ies'}, ${n.resolved} resolved${maybe}`;
    });
    $.ui.log(
      `review-cycle: answered review threads without asking, since the prUpdates setting is ${prUpdates} (${what.join('; ')}): ${links}`,
    );
  }
  const questions = [...asks].map((pull) =>
    offerQuestion({ step: 'comment', pulls: [String(pull)] }),
  );
  const ask = questions.flatMap((q) => ('question' in q ? [q.question] : []));
  const note =
    ask.length === 0
      ? ''
      : ` For the refused ones, end your reply with this question, word for word, alone in its last paragraph, and run the same call after a yes: ${ask.join(' ')}`;
  return { result: `${JSON.stringify({ preview, outcomes })}${note}` };
}

const THREAD_ID = /^PRRT_[A-Za-z0-9_-]+$/;

function replyItemsOf(value: unknown): ReplyItem[] | { why: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { why: 'reply takes replies: [{ thread, body, commit?, resolve? }]' };
  }
  if (value.length > MAX_REPLIES) {
    return {
      why: `nothing posted: at most ${MAX_REPLIES} threads a call, and this asked ${value.length}`,
    };
  }
  const items: ReplyItem[] = [];
  for (const v of value) {
    const r = (v ?? {}) as {
      thread?: unknown;
      body?: unknown;
      commit?: unknown;
      resolve?: unknown;
    };
    if (typeof r.thread !== 'string' || !THREAD_ID.test(r.thread)) {
      return { why: 'nothing posted: each reply needs a review thread id, "PRRT_…"' };
    }
    if (typeof r.body !== 'string') return { why: 'nothing posted: each reply needs a body' };
    items.push({
      thread: r.thread,
      body: r.body,
      ...(typeof r.commit === 'string' && { commit: r.commit }),
      ...(typeof r.resolve === 'boolean' && { resolve: r.resolve }),
    });
  }
  if (new Set(items.map((i) => i.thread)).size !== items.length) {
    return { why: 'nothing posted: a thread appears twice' };
  }
  return items;
}

// A gh call that writes: run once, never retried, so a post that timed out
// after landing is not posted twice.
async function ghWrite(
  $: $,
  args: string[],
): Promise<{ out: string } | { why: string; unsure: boolean }> {
  try {
    const r = await $.process.run(['gh', ...args], {
      timeoutMs: 20_000,
      env: { GH_PROMPT_DISABLED: '1' },
    });
    if (r.exitCode === 0) return { out: r.stdout.trim() };
    const why = firstLine(r.stderr) || `gh exited ${r.exitCode}`;
    // Only a write GitHub refused, or one never sent, surely did not land.
    const sure = r.exitCode === 4 || REFUSED.test(why) || NEVER_SENT.test(why);
    return { why, unsure: !sure };
  } catch (error) {
    const why = messageOf(error);
    return { why, unsure: TIMED_OUT.test(why) };
  }
}

const REFUSED = /\bHTTP 4\d\d\b/;
// Measured: a refused proxy prints `Post "…": proxyconnect tcp: dial tcp …: connection refused`.
// TLS alerts after the handshake ("local error: tls: bad record MAC") may follow a sent request.
const NEVER_SENT =
  /dial tcp|no such host|connection refused|proxyconnect|x509: |tls: failed to verify|remote error: tls: handshake failure/;
