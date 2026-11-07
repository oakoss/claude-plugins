// review-cycle's `prUpdates` setting: what the agent may do to a pull request
// already open, apart from how far `stopBefore` lets new work go. Pure, but for
// the GitHub reads a caller passes in.

import type { Lookup } from './gh-verdict';
import type { DryRunRef } from './push-verdict';

// Ordered: each value allows what the ones before it do.
export const PR_UPDATES = [
  'ask',
  'push fixes',
  'push and reply',
  'push, reply and resolve',
] as const;
export type PrUpdates = (typeof PR_UPDATES)[number];
export const DEFAULT_PR_UPDATES: PrUpdates = 'ask';

export function allows(setting: PrUpdates, at: PrUpdates): boolean {
  return PR_UPDATES.indexOf(setting) >= PR_UPDATES.indexOf(at);
}

export type PrSource = 'default' | 'user' | 'project' | 'local';
export type PrUpdatesInForce = Readonly<{ prUpdates: PrUpdates; source: PrSource }>;

const PLUGIN = /^review-cycle(@|$)/;
const rank = (v: PrUpdates): number => PR_UPDATES.indexOf(v);

export function prUpdatesOf(value: unknown): PrUpdates | null {
  return PR_UPDATES.find((v) => v === value) ?? null;
}

// As `configured` reads `stopBefore`: a value outside the options asks, so a
// typo never loosens the setting.
export function configuredPrUpdates(pluginConfigs: unknown): PrUpdates | null {
  if (pluginConfigs === null || typeof pluginConfigs !== 'object') return null;
  let found: PrUpdates | null = null;
  for (const [name, entry] of Object.entries(pluginConfigs)) {
    if (!PLUGIN.test(name) || entry === null || typeof entry !== 'object') continue;
    const options: unknown = (entry as { options?: unknown }).options;
    if (options === null || typeof options !== 'object' || !('prUpdates' in options)) continue;
    const value = prUpdatesOf(options.prUpdates) ?? DEFAULT_PR_UPDATES;
    if (found === null || rank(value) < rank(found)) found = value;
  }
  return found;
}

// The local file may set any value; a committed project file only one that asks more.
export function effectivePrUpdates(
  user: PrUpdates | null,
  project: PrUpdates | null,
  local: PrUpdates | null,
): PrUpdatesInForce {
  if (local !== null) return { prUpdates: local, source: 'local' };
  const mine: PrUpdatesInForce =
    user === null || user === DEFAULT_PR_UPDATES
      ? { prUpdates: DEFAULT_PR_UPDATES, source: 'default' }
      : { prUpdates: user, source: 'user' };
  if (project !== null && rank(project) < rank(mine.prUpdates)) {
    return { prUpdates: project, source: 'project' };
  }
  return mine;
}

// Branches their own tools rebuild, as pr-kit's ship skill leaves them.
const TOOL_BRANCH = /(?:^|\/)version-packages$|^changeset-release\/|^renovate\/|^dependabot\//;

export const OPEN_PULL_FIELDS = 'number,url,author,isCrossRepository,reviewDecision';

export type PrReads = {
  // `gh pr list --head <branch> --state open --json OPEN_PULL_FIELDS`.
  openPulls: (branch: string) => Promise<Lookup>;
  // `gh api --hostname <host> user --jq .login`, on the pull request's host.
  viewer: (host: string) => Promise<Lookup>;
};

// The open pull request whose fixes `push fixes` lets this push carry, or why
// not. Every ref must update a branch heading the viewer's own open pull
// request in the repository it is pushed to, not yet approved: a push can
// dismiss a stale approval.
export async function prUpdateOf(
  refs: readonly DryRunRef[],
  reads: PrReads,
): Promise<{ pull: number; branches: string[] } | { why: string }> {
  if (refs.length === 0) return { why: 'its dry run named no branch it updates' };
  // The user's login on each host, since an Enterprise account is another login.
  const logins = new Map<string, string | { why: string }>();
  let pull: number | null = null;
  const branches: string[] = [];
  for (const r of refs) {
    if (!r.to.startsWith('refs/heads/')) return { why: `it updates \`${r.to}\`, not a branch` };
    const branch = r.to.slice('refs/heads/'.length);
    if (TOOL_BRANCH.test(branch)) return { why: `\`${branch}\` is a branch its own tool rebuilds` };
    const read = await reads.openPulls(branch);
    if (read.asks !== undefined) return { why: read.asks };
    const found = openPullOf(read.out, branch, r.url);
    if ('why' in found) return found;
    if (!logins.has(found.host)) logins.set(found.host, loginOf(await reads.viewer(found.host)));
    const login = logins.get(found.host);
    if (typeof login !== 'string') return login ?? { why: 'your GitHub login could not be read' };
    if (found.author !== login) return { why: `#${found.pull} is not one you opened` };
    if (pull !== null && pull !== found.pull) {
      return { why: 'it updates more than one pull request' };
    }
    pull = found.pull;
    branches.push(branch);
  }
  return pull === null ? { why: 'it updates no branch' } : { pull, branches };
}

const LOGIN = /^[A-Za-z0-9-]+$/;

function loginOf(read: Lookup): string | { why: string } {
  if (read.asks !== undefined) return { why: read.asks };
  const login = read.out.trim();
  return LOGIN.test(login) ? login : { why: 'your GitHub login could not be read' };
}
// The decisions measured on a pull request a push cannot un-approve; anything
// else, a missing one included, asks.
const UNAPPROVED = new Set(['', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED']);

// The open pull request `branch` heads, short of whose it is, which
// `prUpdateOf` asks the pull request's own host.
function openPullOf(
  out: string,
  branch: string,
  url: string,
): { pull: number; author: string; host: string } | { why: string } {
  const unread = { why: `the open pull request for \`${branch}\` could not be read` };
  let pulls: unknown;
  try {
    pulls = JSON.parse(out);
  } catch {
    return unread;
  }
  if (!Array.isArray(pulls)) return unread;
  if (pulls.length === 0) return { why: `\`${branch}\` heads no open pull request` };
  if (pulls.length > 1) return { why: `\`${branch}\` heads more than one open pull request` };
  const first: unknown = pulls[0];
  if (typeof first !== 'object' || first === null) return unread;
  const p = first as {
    number?: unknown;
    url?: unknown;
    author?: { login?: unknown };
    isCrossRepository?: unknown;
    reviewDecision?: unknown;
  };
  const number = typeof p.number === 'number' && Number.isSafeInteger(p.number) ? p.number : null;
  const home = typeof p.url === 'string' ? repoOf(p.url.replace(/\/pull\/\d+\/?$/, '')) : null;
  if (
    number === null ||
    home === null ||
    typeof p.isCrossRepository !== 'boolean' ||
    typeof p.author?.login !== 'string' ||
    typeof p.reviewDecision !== 'string'
  ) {
    return unread;
  }
  if (p.isCrossRepository) return { why: `#${number} comes from another repository` };
  if (repoOf(url) !== home) {
    return { why: `the push goes to a remote other than #${number}'s repository` };
  }
  if (!UNAPPROVED.has(p.reviewDecision)) {
    return { why: `#${number} is approved, and a push can dismiss the approval` };
  }
  return { pull: number, author: p.author.login, host: home.slice(0, home.indexOf('/')) };
}

// `host/owner/name`, lowercased, from `git@github.com:o/r.git`,
// `https://github.com/o/r` or `ssh://git@github.com/o/r.git`; null for a local
// path or anything else, which names no repository a pull request lives on.
function repoOf(url: string): string | null {
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url);
  let host: string;
  let path: string;
  if (scp !== null && !url.includes('://')) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    try {
      const u = new URL(url);
      if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol)) return null;
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  const parts = path
    .replace(/^\/+/, '')
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
    .split('/');
  if (host === '' || parts.length !== 2 || parts.some((x) => x === '')) return null;
  return `${host}/${parts.join('/')}`.toLowerCase();
}
