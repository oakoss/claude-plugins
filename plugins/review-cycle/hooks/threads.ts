// Replies to a pull request's review threads, and resolving them, decided
// per thread. Pure: register.ts reads GitHub, asks this, then writes.

import { allows, type PrUpdates } from './pr-updates';

// What one GitHub lookup of a review thread says, by its node id.
export type ThreadFacts = Readonly<{
  thread: string;
  // The pull request's repository, "owner/name": a node id names a thread anywhere.
  repo: string;
  pull: number;
  prAuthor: string;
  isCrossRepository: boolean;
  state: string;
  reviewDecision: string;
  // Who opened the thread: GitHub's account type, never the login, since
  // GraphQL drops REST's `[bot]` suffix (`pullfrog`, not `pullfrog[bot]`).
  starterIsBot: boolean;
  isResolved: boolean;
  // The pull request's commits as GitHub has them, so a reply never cites
  // one that is not pushed.
  commits: readonly string[];
  last: Readonly<{ author: string; body: string }> | null;
}>;

export type ReplyItem = Readonly<{
  thread: string;
  body: string;
  commit?: string;
  resolve?: boolean;
}>;

export type ReplyContext = Readonly<{
  // The user's latest message, or the offer it answered, asked for a reply.
  asked: boolean;
  held: boolean;
  setting: PrUpdates;
  viewer: string;
  repo: string;
}>;

// `post` false resolves a thread whose reply already landed. A refusal the
// user's yes would lift is `ask`.
export type ReplyPlan =
  | { post: boolean; resolve: boolean; unasked: boolean }
  | { skip: string }
  | { refuse: string; ask: boolean };

// The decisions a reply cannot un-approve; anything else asks, as for a push.
const UNAPPROVED = new Set(['', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED']);

const SHA = /^[0-9a-f]{7,40}$/i;

// THREAD_QUERY reads this many of a pull request's latest commits, so a full
// list may leave out an older pushed one.
const COMMITS_READ = 250;

// A refusal only the agent can fix: a yes would not change it.
const fix = (refuse: string) => ({ refuse, ask: false });

export function planReply(item: ReplyItem, f: ThreadFacts, c: ReplyContext): ReplyPlan {
  if (f.repo.toLowerCase() !== c.repo.toLowerCase()) {
    return fix(`#${f.pull} is in ${f.repo}, not this repository`);
  }
  const body = item.body.trim();
  if (body === '') return fix('the reply has no text');
  const commit = item.commit?.trim() ?? '';
  if (commit !== '') {
    if (!SHA.test(commit)) return fix(`\`${commit}\` is not a commit id`);
    const lower = commit.toLowerCase();
    if (!f.commits.some((oid) => oid.toLowerCase().startsWith(lower))) {
      return fix(
        f.commits.length >= COMMITS_READ
          ? `\`${commit}\` is not among the last ${COMMITS_READ} commits of #${f.pull}`
          : `\`${commit}\` is not on #${f.pull} yet: push it first`,
      );
    }
  }
  if (item.resolve === true && commit === '')
    return fix('resolving needs the commit that fixed it');
  const block = c.held ? 'the user held off replying' : unaskedBlock(f, c);
  // A request outranks a hold for the reply, as "push it" does. Resolving
  // follows the setting alone, asked or not: a person resolves their own thread.
  if (!c.asked && block !== null) return { refuse: block, ask: true };
  const resolve =
    item.resolve === true &&
    !f.isResolved &&
    block === null &&
    allows(c.setting, 'push, reply and resolve');
  // The same reply again, or one citing the same fix, is not posted twice; a
  // resolve it still needs goes ahead.
  const last = f.last;
  const repeat =
    last !== null &&
    last.author === c.viewer &&
    (last.body.trim() === body || (commit !== '' && citesSame(last.body, commit, f.commits)));
  if (repeat && !resolve) return { skip: "the thread's last reply is already yours and says this" };
  return { post: !repeat, resolve, unasked: !c.asked };
}

// Whether `text` cites the pushed commit `commit` names, by any abbreviation.
function citesSame(text: string, commit: string, commits: readonly string[]): boolean {
  const full = (sha: string) => commits.find((o) => o.toLowerCase().startsWith(sha.toLowerCase()));
  const cited = full(commit);
  return (text.match(/\b[0-9a-f]{7,40}\b/gi) ?? []).some((t) => full(t) === cited);
}

// Why a reply may not run unasked, or null when the setting lets it.
function unaskedBlock(f: ThreadFacts, c: ReplyContext): string | null {
  if (!allows(c.setting, 'push and reply')) return 'the user has not asked for a reply';
  if (f.isCrossRepository) return `#${f.pull} comes from a fork`;
  if (f.state !== 'OPEN') return `#${f.pull} is not open`;
  if (f.prAuthor !== c.viewer) return `#${f.pull} is not one you opened`;
  if (!UNAPPROVED.has(f.reviewDecision)) return `#${f.pull} is already approved`;
  if (!f.starterIsBot) return 'a person opened this thread';
  return null;
}

// GitHub's answer to THREAD_QUERY for one thread, or why it cannot be read.
export function threadFactsOf(thread: string, out: string): ThreadFacts | { why: string } {
  const unread = { why: `thread \`${thread}\` could not be read` };
  let doc: unknown;
  try {
    doc = JSON.parse(out);
  } catch {
    return unread;
  }
  const node = (doc as { data?: { node?: unknown } } | null)?.data?.node;
  if (typeof node !== 'object' || node === null) return unread;
  // Another kind of node answers `{}` (measured).
  if (!('isResolved' in node)) return { why: `\`${thread}\` names no review thread` };
  const n = node as {
    isResolved?: unknown;
    pullRequest?: {
      repository?: { nameWithOwner?: unknown } | null;
      number?: unknown;
      state?: unknown;
      isCrossRepository?: unknown;
      reviewDecision?: unknown;
      author?: { login?: unknown } | null;
      commits?: { nodes?: ({ commit?: { oid?: unknown } } | null)[] };
    };
    first?: { nodes?: ({ author?: { __typename?: unknown } | null } | null)[] };
    last?: { nodes?: ({ author?: { login?: unknown } | null; body?: unknown } | null)[] };
  };
  const pr = n.pullRequest;
  const pull = pr?.number;
  if (
    typeof n.isResolved !== 'boolean' ||
    typeof pull !== 'number' ||
    typeof pr?.state !== 'string' ||
    typeof pr.isCrossRepository !== 'boolean' ||
    typeof pr.author?.login !== 'string' ||
    typeof pr.repository?.nameWithOwner !== 'string'
  ) {
    return unread;
  }
  const starter = n.first?.nodes?.[0]?.author?.__typename;
  const lastNode = n.last?.nodes?.[0];
  const lastAuthor = lastNode?.author?.login;
  return {
    thread,
    repo: pr.repository.nameWithOwner,
    pull,
    prAuthor: pr.author.login,
    isCrossRepository: pr.isCrossRepository,
    state: pr.state,
    reviewDecision: typeof pr.reviewDecision === 'string' ? pr.reviewDecision : '',
    starterIsBot: starter === 'Bot',
    isResolved: n.isResolved,
    commits: (pr.commits?.nodes ?? []).flatMap((c) =>
      typeof c?.commit?.oid === 'string' ? [c.commit.oid] : [],
    ),
    last:
      typeof lastAuthor === 'string' && typeof lastNode?.body === 'string'
        ? { author: lastAuthor, body: lastNode.body }
        : null,
  };
}

// One read gives every fact planReply needs. GitHub lists at most 250 commits
// on a pull request, and this connection accepts last:250 (measured).
export const THREAD_QUERY = `query($id:ID!){node(id:$id){... on PullRequestReviewThread{isResolved pullRequest{repository{nameWithOwner} number state isCrossRepository reviewDecision author{login} commits(last:${COMMITS_READ}){nodes{commit{oid}}}} first:comments(first:1){nodes{author{__typename}}} last:comments(last:1){nodes{author{login} body}}}}}`;

export const REPLY_MUTATION =
  'mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}';

export const RESOLVE_MUTATION =
  'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}';

// A batch larger than this asks: a loop gone wrong should not flood a pull request.
export const MAX_REPLIES = 10;

// gh fills {owner} and {repo} in -F fields from the current repository (measured).
export const OPEN_THREADS_QUERY =
  'query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved isOutdated path line first:comments(first:1){nodes{author{__typename login} body}} last:comments(last:1){nodes{author{login}}}}}}}}';

export type OpenThread = Readonly<{
  thread: string;
  path: string;
  line: number | null;
  // A later push changed the lines the thread was left on.
  outdated: boolean;
  byBot: boolean;
  author: string;
  body: string;
  lastBy: string;
}>;

const BODY_SHOWN = 600;

// The unresolved threads in GitHub's answer to OPEN_THREADS_QUERY, and whether
// GitHub has threads past the first 100 it read.
export function openThreadsOf(
  out: string,
  pull: number,
): { threads: OpenThread[]; more: boolean } | { why: string } {
  const unread = { why: `the review threads of #${pull} could not be read` };
  let doc: unknown;
  try {
    doc = JSON.parse(out);
  } catch {
    return unread;
  }
  type Node = {
    id?: unknown;
    isResolved?: unknown;
    isOutdated?: unknown;
    path?: unknown;
    line?: unknown;
    first?: {
      nodes?: ({
        author?: { __typename?: unknown; login?: unknown } | null;
        body?: unknown;
      } | null)[];
    };
    last?: { nodes?: ({ author?: { login?: unknown } | null } | null)[] };
  };
  const pr = (
    doc as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: { pageInfo?: { hasNextPage?: unknown }; nodes?: (Node | null)[] };
          } | null;
        };
      };
    } | null
  )?.data?.repository?.pullRequest;
  if (pr === null) return { why: `#${pull} is no pull request here` };
  const nodes = pr?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) return unread;
  const more = pr?.reviewThreads?.pageInfo?.hasNextPage === true;
  const threads = nodes.flatMap((n) => {
    if (n === null || typeof n.id !== 'string' || n.isResolved !== false) return [];
    const first = n.first?.nodes?.[0];
    const body = typeof first?.body === 'string' ? first.body : '';
    const lastBy = n.last?.nodes?.[0]?.author?.login;
    return [
      {
        thread: n.id,
        path: typeof n.path === 'string' ? n.path : '',
        line: typeof n.line === 'number' ? n.line : null,
        outdated: n.isOutdated === true,
        byBot: first?.author?.__typename === 'Bot',
        author: typeof first?.author?.login === 'string' ? first.author.login : '',
        body: body.length > BODY_SHOWN ? `${body.slice(0, BODY_SHOWN)}…` : body,
        lastBy: typeof lastBy === 'string' ? lastBy : '',
      },
    ];
  });
  return { threads, more };
}
