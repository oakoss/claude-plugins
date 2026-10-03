// What a GitHub write is on the stop-before ladder, read from a `gh api` call
// or a GitHub MCP tool call. Pure: no `$`, no I/O.

import type { Word } from './shell';

// `asks` says why the push asks whatever the setting; a `force` one needs a
// request for a bare force, since the API has no lease.
export type PushRef =
  | { branch: string; repo: string | null }
  | 'head'
  | { asks: string; force?: true };

export type Unnamed = { cannot: 'elsewhere' | 'beside' | 'unnamed' };

export type GhAction =
  | { kind: 'pr' }
  | { kind: 'merge'; admin: boolean; lookup: readonly string[] | Unnamed }
  | { kind: 'approve' }
  | { kind: 'comment' }
  | { kind: 'release' }
  | { kind: 'push'; ref: PushRef }
  | { kind: 'unread'; why: string; remedy?: string };

export type GhContext = 'fixed' | 'elsewhere' | 'beside';

// `gh api`'s options that take a value (gh 2.102.0's `gh api --help`), and
// the short ones among them, which take the rest of a cluster (`-XPOST`).
const API_VALUE = new Set([
  '-F',
  '--field',
  '-f',
  '--raw-field',
  '-H',
  '--header',
  '-q',
  '--jq',
  '-X',
  '--method',
  '-p',
  '--preview',
  '-t',
  '--template',
  '--cache',
  '--hostname',
  '--input',
]);
const API_SHORT_VALUE = 'FfHqXpt';
const FIELD = new Set(['-F', '--field', '-f', '--raw-field']);

// A field's value, or null when it is built at run time or read from a file
// (`-F body=@notes.md`).
type Fields = Map<string, string | null>;

type ApiCall = {
  // The method `-X` names, upper-cased; `?` when it is built at run time.
  method: string | null;
  endpoint: Word | null;
  // A word built at run time that may be options (`"$ARGS"`, `$X`), not a
  // value or an endpoint with a written-out start.
  opaque: boolean;
  fields: Fields;
  // A field whose name is built at run time, so any field may hide in it.
  unnamed: boolean;
  input: boolean;
  hostname: boolean;
};

// The option a word is and its value, when it takes one: `-X POST`, `-XPOST`,
// `-X=POST`, `--method=POST`, `-iXPOST`.
function optionAt(words: Word[], i: number): { name: string; value: Word | null; next: number } {
  const w = words[i]!;
  const t = w.text;
  const long = /^(--[^=]+)=([\s\S]*)$/.exec(t);
  if (long?.[1] !== undefined) {
    return { name: long[1], value: { ...w, text: long[2] ?? '' }, next: i + 1 };
  }
  if (t.startsWith('--')) {
    return API_VALUE.has(t)
      ? { name: t, value: words[i + 1] ?? null, next: i + 2 }
      : { name: t, value: null, next: i + 1 };
  }
  for (let at = 1; at < t.length; at++) {
    const letter = t.charAt(at);
    if (!API_SHORT_VALUE.includes(letter)) continue;
    const rest = t.slice(at + 1).replace(/^=/, '');
    return rest === ''
      ? { name: `-${letter}`, value: words[i + 1] ?? null, next: i + 2 }
      : { name: `-${letter}`, value: { ...w, text: rest }, next: i + 1 };
  }
  return { name: t, value: null, next: i + 1 };
}

// The words after `gh api`.
function readApi(words: Word[]): ApiCall {
  const call: ApiCall = {
    method: null,
    endpoint: null,
    opaque: false,
    fields: new Map(),
    unnamed: false,
    input: false,
    hostname: false,
  };
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    // A written-out start (`repos/…/$PR`) makes the word the endpoint.
    if (w.dynamic && /^[$`]/.test(w.text)) {
      call.opaque = true;
      i++;
      continue;
    }
    if (!w.text.startsWith('-') || w.text === '-') {
      call.endpoint ??= w;
      i++;
      continue;
    }
    const { name, value, next } = optionAt(words, i);
    i = next;
    if (name === '-X' || name === '--method') {
      call.method = value === null || value.dynamic ? '?' : value.text.toUpperCase();
    } else if (FIELD.has(name) && value !== null) {
      const eq = value.text.indexOf('=');
      const key = eq === -1 ? value.text : value.text.slice(0, eq);
      if (/[$`]/.test(key)) call.unnamed = true;
      const raw = eq === -1 ? '' : value.text.slice(eq + 1);
      // A typed field reads a file (`@f`) or fills in `{branch}` and the like.
      const typed = (name === '-F' || name === '--field') && /^@|\{\w+\}/.test(raw);
      call.fields.set(key, value.dynamic || typed ? null : raw);
    } else if (name === '--input') call.input = true;
    else if (name === '--hostname') call.hostname = true;
  }
  return call;
}

// A branch as GitHub's ref APIs take it, or why the push it names asks.
function branchOf(name: string | null | undefined, missing: string): string | { asks: string } {
  if (name?.startsWith('refs/tags/')) return { asks: 'it pushes a tag' };
  const branch = name?.replace(/^refs\/heads\//, '');
  if (branch === undefined || branch === '') return { asks: missing };
  if (branch.startsWith('refs/')) return { asks: `it writes \`${branch}\`, which is no branch` };
  return branch;
}

// Where a push lands: `moved` when something outside its words picks the
// repository, `beside` when another step in the command may.
function pushRef(
  name: string | null | undefined,
  missing: string,
  repo: string | null,
  where: 'fixed' | 'moved' | 'beside',
): PushRef {
  if (where === 'moved') return { asks: 'where it pushes is picked outside its words' };
  const branch = branchOf(name, missing);
  if (typeof branch !== 'string') return branch;
  if (where === 'beside' && repo === null) {
    return { asks: 'another step in the command can change which repository it reaches' };
  }
  return { branch, repo };
}

// What a REST write to `repos/<owner>/<repo>/<path>` is on the ladder.
function restAction(
  method: string,
  path: string,
  repo: string | null,
  call: ApiCall,
  where: 'fixed' | 'moved' | 'beside',
): GhAction | null {
  const field = (key: string) => (call.unnamed || call.input ? null : call.fields.get(key));
  const unknown = (key: string) => call.input || call.unnamed || call.fields.get(key) === null;
  const push = (name: string | null | undefined, missing: string): GhAction => ({
    kind: 'push',
    ref: pushRef(name, missing, repo, where),
  });
  if (path === 'pulls') return method === 'POST' ? { kind: 'pr' } : null;
  if (path === 'releases' || path.startsWith('releases/')) return { kind: 'release' };
  const pull = /^pulls\/([^/]+)\/(.+)$/.exec(path);
  if (pull?.[2] === 'merge') {
    const number = pull[1] ?? '';
    const lookup: readonly string[] | Unnamed =
      where === 'moved'
        ? { cannot: 'elsewhere' }
        : where === 'beside'
          ? { cannot: 'beside' }
          : /^\d+$/.test(number)
            ? [number, ...(repo === null ? [] : ['--repo', repo])]
            : { cannot: 'unnamed' };
    return { kind: 'merge', admin: false, lookup };
  }
  if (pull?.[2] === 'update-branch') return { kind: 'push', ref: 'head' };
  if (pull?.[2] === 'reviews' || pull?.[2]?.startsWith('reviews/')) {
    if (unknown('event')) {
      return {
        kind: 'unread',
        why: 'the review event of this `gh api` call is built at run time or read from a file',
        remedy: 'Write the event out with `-f event=…`.',
      };
    }
    return { kind: field('event')?.toUpperCase() === 'APPROVE' ? 'approve' : 'comment' };
  }
  if (/^(pulls|issues)\/[^/]+\/comments(\/|$)|^(pulls|issues)\/comments(\/|$)/.test(path)) {
    return { kind: 'comment' };
  }
  if (path.startsWith('contents/')) {
    return push(field('branch'), 'it names no branch, so it commits to the default branch');
  }
  if (path === 'merges') return push(field('base'), 'its base branch is not written out');
  if (path === 'merge-upstream') {
    return push(field('branch'), 'the branch it updates is not written out');
  }
  if (/^branches\/.+\/rename$/.test(path)) {
    return { kind: 'push', ref: { asks: 'it renames a branch' } };
  }
  if (path === 'git/refs' && method === 'POST') {
    const ref = field('ref');
    const named = ref?.startsWith('refs/') ? ref : null;
    return push(named, 'the ref it creates is not written out');
  }
  const ref = /^git\/refs\/(heads|tags)\/(.+)$/.exec(path);
  if (ref) {
    const name = ref[2] ?? '';
    if (ref[1] === 'tags') return { kind: 'push', ref: { asks: 'it pushes a tag' } };
    if (method === 'DELETE') return { kind: 'push', ref: { asks: `it deletes \`${name}\`` } };
    const force = field('force');
    if (force === null || (force !== undefined && force !== 'false')) {
      return { kind: 'push', ref: { asks: `it force-updates \`${name}\``, force: true } };
    }
    return push(name, '');
  }
  return null;
}

// GraphQL mutations that are ladder steps (GitHub's schema, read 2026-10-03);
// GitHub has none that writes a release. A review approves when its event
// says APPROVE.
const BY_ID: GhAction = { kind: 'merge', admin: false, lookup: { cannot: 'unnamed' } };
const MUTATIONS: Record<string, Readonly<GhAction> | 'review' | 'ref'> = {
  createPullRequest: { kind: 'pr' },
  markPullRequestReadyForReview: { kind: 'pr' },
  revertPullRequest: { kind: 'pr' },
  mergePullRequest: BY_ID,
  enablePullRequestAutoMerge: BY_ID,
  enqueuePullRequest: BY_ID,
  addPullRequestReview: 'review',
  submitPullRequestReview: 'review',
  updatePullRequestBranch: { kind: 'push', ref: 'head' },
  ...Object.fromEntries(
    [
      'addComment',
      'addPullRequestReviewComment',
      'addPullRequestReviewThread',
      'addPullRequestReviewThreadReply',
      'updateIssueComment',
      'updatePullRequestReview',
      'updatePullRequestReviewComment',
      'deleteIssueComment',
      'deletePullRequestReview',
      'deletePullRequestReviewComment',
      'dismissPullRequestReview',
      'resolveReviewThread',
      'unresolveReviewThread',
      'minimizeComment',
      'unminimizeComment',
    ].map((name) => [name, { kind: 'comment' } as const]),
  ),
  ...Object.fromEntries(
    [
      'createCommitOnBranch',
      'createLinkedBranch',
      'createRef',
      'updateRef',
      'updateRefs',
      'deleteRef',
      'mergeBranch',
    ].map((name) => [name, 'ref' as const]),
  ),
};

const unreadEvent: GhAction = {
  kind: 'unread',
  why: 'the review event of this GraphQL mutation is built at run time or read from a file',
  remedy: 'Write the event out.',
};

const approves = (v: string | null | undefined) => v?.toUpperCase() === 'APPROVE';

// A review approves only by its `event` argument, written in the query or
// passed in a variable (`-f event=…`, `-f input[event]=…`).
function reviewOf(query: string, call: ApiCall): GhAction {
  // Every review in the query counts, so one that approves is never read as a
  // comment. `(?<!\$)` skips a variable's definition (`$event: …Event`).
  const args = [...query.matchAll(/(?<!\$)\bevent\s*:\s*(\$?\w+)/g)].map((m) => m[1] ?? '');
  const values = args.map((arg) => {
    if (!arg.startsWith('$')) return arg;
    const name = arg.slice(1);
    return call.fields.has(name)
      ? call.fields.get(name)
      : new RegExp(String.raw`\$${name}\s*:\s*[\w!]+\s*=\s*(\w+)`).exec(query)?.[1];
  });
  const keys = [...call.fields.keys()].filter((k) => /(^|\[)event\]?$/.test(k));
  if (values.some((v) => approves(v)) || keys.some((k) => approves(call.fields.get(k)))) {
    return { kind: 'approve' };
  }
  if (values.some((v) => v === undefined || v === null)) return unreadEvent;
  // A review given a whole input object (`input: $input`) carries its event in
  // that variable or its `[event]` key, either of which may be read at run time.
  const objects = [...query.matchAll(/\binput\s*:\s*\$(\w+)/g)].map((m) => m[1]);
  const hidden = [...call.fields].some(
    ([k, v]) => v === null && objects.some((o) => k === o || k === `${o}[event]`),
  );
  return hidden ? unreadEvent : { kind: 'comment' };
}

// The query with its strings and comments blanked, so text inside them names
// no operation or mutation.
const bare = (query: string) =>
  query.replaceAll(/"""(?:\\"""|[\s\S])*?"""|"(?:\\.|[^"\\])*"|#[^\n]*/g, ' ');

function graphqlActions(call: ApiCall): GhAction[] {
  const query = call.unnamed || call.input ? null : call.fields.get('query');
  if (query === undefined) return [];
  if (query === null) {
    return [
      {
        kind: 'unread',
        why: 'the GraphQL query of this `gh api` call is built at run time or read from a file',
        remedy: 'Write the query out with `-f query=…`.',
      },
    ];
  }
  const ops = bare(query);
  if (!/(^|[\s}])mutation\b/.test(ops)) return [];
  const found: GhAction[] = [];
  for (const [name, action] of Object.entries(MUTATIONS)) {
    if (!new RegExp(String.raw`\b${name}\s*\(`).test(ops)) continue;
    if (action === 'review') found.push(reviewOf(ops, call));
    else if (action === 'ref') {
      const force =
        /\bforce\s*:(?!\s*false\b)/.test(ops) ||
        [...call.fields].some(([k, v]) => /(^|\[)force\]?$/.test(k) && v !== 'false');
      const asks = 'the gate does not read which branch a GraphQL mutation writes';
      found.push({ kind: 'push', ref: force ? { asks, force: true } : { asks } });
    } else found.push(action);
  }
  return found;
}

// What a `gh api` call writes on the ladder, from the words after `api`. A
// read, or a write to an endpoint no ladder step covers, is nothing.
export function apiActions(words: Word[], context: GhContext, fed: boolean): GhAction[] {
  const call = readApi(words);
  if (call.method === 'GET' || call.method === 'HEAD') return [];
  if (call.opaque || call.method === '?') {
    return [
      {
        kind: 'unread',
        why: 'the arguments of `gh api` are built at run time',
        remedy: 'Write its options out; a read can name `--method GET`.',
      },
    ];
  }
  if (call.endpoint === null) {
    return fed ? [{ kind: 'unread', why: 'its `gh api` endpoint comes from its input' }] : [];
  }
  // As gh's api.go decides it: POST once fields or --input are given.
  const written = call.fields.size > 0 || call.input || call.unnamed;
  const method = call.method ?? (written ? 'POST' : 'GET');
  if (method === 'GET' || method === 'HEAD') return [];
  if (fed) return [{ kind: 'unread', why: 'the arguments of `gh api` come from its input' }];
  if (call.endpoint.dynamic) {
    return [
      {
        kind: 'unread',
        why: 'the endpoint of this `gh api` write is built at run time',
        remedy: 'Write the endpoint out.',
      },
    ];
  }
  // gh sends a full URL as written: another host is another repository.
  // GitHub Enterprise serves REST under /api/v3/ and GraphQL at /api/graphql.
  const url = /^https?:\/\/([^/]+)\/(?:api\/v3\/|api\/(?=graphql\b))?/i.exec(call.endpoint.text);
  const host = url !== null && url[1]?.toLowerCase() !== 'api.github.com';
  const endpoint = call.endpoint.text
    .slice(url?.[0].length ?? 0)
    .replace(/^\//, '')
    .replace(/\?.*$/, '');
  if (endpoint === 'graphql') return graphqlActions(call);
  const m = /^repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(endpoint);
  if (!m) return [];
  const [owner = '', name = '', path = ''] = m.slice(1);
  const placeholder = owner === '{owner}' && name === '{repo}';
  const elsewhere =
    context === 'elsewhere' || call.hostname || host || (!placeholder && /[{}]/.test(owner + name));
  const where = elsewhere ? 'moved' : context === 'beside' ? 'beside' : 'fixed';
  const action = restAction(method, path, placeholder ? null : `${owner}/${name}`, call, where);
  return action === null ? [] : [action];
}

// The GitHub MCP server's write tools that are ladder steps (its README,
// read 2026-10-03), matched by name under any server name. It has no tool
// that writes a release.
const MCP_COMMENT = new Set([
  'add_comment_to_pending_review',
  'add_reply_to_pull_request_comment',
  'add_issue_comment',
  'update_issue_comment',
]);
const MCP_PUSH = new Set(['push_files', 'create_or_update_file', 'delete_file', 'create_branch']);
const MCP_TOOLS = [
  'create_pull_request',
  'create_pull_request_with_copilot',
  'merge_pull_request',
  'pull_request_review_write',
  'update_pull_request_branch',
  'update_pull_request',
  ...MCP_COMMENT,
  ...MCP_PUSH,
];

// Matches the tool names mcpAction reads.
export const MCP_GITHUB = new RegExp(String.raw`^mcp__.+__(${MCP_TOOLS.join('|')})$`);

// The arguments a refusal quotes: those naming where the write goes.
const SHOWN = new Set([
  'owner',
  'repo',
  'pullNumber',
  'issue_number',
  'comment_id',
  'commentId',
  'branch',
  'from_branch',
  'base',
  'head',
  'path',
  'method',
  'event',
  'merge_method',
]);

// The tool call as a refusal quotes it: its name and the arguments naming
// where it writes, with characters that could hide or reorder text replaced.
export function shownCall(tool: string, input: Record<string, unknown>): string {
  const args = Object.entries(input).filter(
    ([key, v]) => SHOWN.has(key) && ['string', 'number', 'boolean'].includes(typeof v),
  );
  const shown = `${tool} ${JSON.stringify(Object.fromEntries(args))}`;
  return shown.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '\u{FFFD}');
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
// An owner or repository name gh reads as one, never as an option.
const named = (s: string | null): s is string => s !== null && /^\w[\w.-]*$/.test(s);

// What a GitHub MCP tool call is on the ladder, or null for any other tool.
export function mcpAction(tool: string, input: Record<string, unknown>): GhAction | null {
  const name = MCP_TOOLS.find((t) => tool.endsWith(`__${t}`));
  if (name === undefined) return null;
  const owner = text(input.owner);
  const repoName = text(input.repo);
  const repo = named(owner) && named(repoName) ? `${owner}/${repoName}` : null;
  if (name === 'create_pull_request' || name === 'create_pull_request_with_copilot') {
    return { kind: 'pr' };
  }
  if (name === 'merge_pull_request') {
    const number = text(input.pullNumber);
    const lookup =
      number !== null && /^\d+$/.test(number) && repo !== null
        ? [number, '--repo', repo]
        : { cannot: 'unnamed' as const };
    return { kind: 'merge', admin: false, lookup };
  }
  if (name === 'pull_request_review_write') {
    return { kind: text(input.event)?.toUpperCase() === 'APPROVE' ? 'approve' : 'comment' };
  }
  if (name === 'update_pull_request_branch') return { kind: 'push', ref: 'head' };
  // Marking a draft ready for review is the pull request step; other edits are not.
  if (name === 'update_pull_request') {
    return input.draft === false || input.draft === 'false' ? { kind: 'pr' } : null;
  }
  if (MCP_COMMENT.has(name)) return { kind: 'comment' };
  // gh's lookup of the default branch needs the repository spelled out.
  if (repo === null) return { kind: 'push', ref: { asks: 'it does not name its repository' } };
  const branch = branchOf(text(input.branch), 'it names no branch');
  return { kind: 'push', ref: typeof branch === 'string' ? { branch, repo } : branch };
}
