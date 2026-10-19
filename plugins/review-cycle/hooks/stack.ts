// github/gh-stack: what `gh stack merge <n>` merges, and when its own leased
// pushes may run. register.ts passes in the reads.

import type { Lookup } from './gh-verdict';

// `stack`: `GET repos/{o}/{r}/stacks/<n>`, one stack. `pr`: `GET
// repos/{o}/{r}/stacks?pull_request=<n>`, the stacks holding that pull request.
export type StackRead = { by: 'stack' | 'pr'; out: string; asks?: never };

// gh-stack reads a bare number as a stack first, then as a pull request; any
// failure but a 404 cannot tell the two apart, so it asks.
export async function readStack(
  n: number,
  ghApi: (args: string[], what: string) => Promise<Lookup>,
): Promise<StackRead | Exclude<Lookup, { out: string }>> {
  const whole = await ghApi([`repos/{owner}/{repo}/stacks/${n}`], `stack #${n}`);
  if (whole.asks === undefined) return { by: 'stack', out: whole.out };
  // gh 2.x prints `gh: Not Found (HTTP 404)` for a number that is no stack.
  if (!whole.asks.includes('(HTTP 404)')) return whole;
  const held = await ghApi(
    ['-X', 'GET', 'repos/{owner}/{repo}/stacks', '-f', `pull_request=${n}`],
    `the stack holding #${n}`,
  );
  return held.asks === undefined ? { by: 'pr', out: held.out } : held;
}
// `stack` when GitHub read the number as a stack's, not a pull request's.
export type MergeSet =
  | { prs: [number, ...number[]]; stack: boolean }
  | { asks: string; remedy: string };

type Layer = { number: number; merged: boolean };

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// A stack's pull requests bottom up, merged ones included, or null when it is
// not a shape this reads. The order is measured, not documented: the
// 2026-10-18 spike listed [1, 2, 3] as created, and `gh stack merge 3`
// merged #2 and #3.
function layersOf(x: unknown): Layer[] | null {
  if (!isRecord(x) || !Array.isArray(x.pull_requests)) return null;
  const layers: Layer[] = [];
  for (const p of x.pull_requests) {
    if (!isRecord(p) || !Number.isSafeInteger(p.number) || (p.number as number) < 1) return null;
    if (p.merged_at !== null && (typeof p.merged_at !== 'string' || p.merged_at === '')) {
      return null;
    }
    if (layers.some((l) => l.number === p.number)) return null;
    layers.push({ number: p.number as number, merged: p.merged_at !== null });
  }
  return layers;
}

const UNREAD = {
  asks: 'GitHub answered in a shape the gate does not read',
  remedy: 'Give the user the command to run themselves.',
};

// gh-stack reads a bare number as a stack first, then as a pull request: a
// stack merges every unmerged layer, a pull request itself and every
// unmerged one below it.
export function mergeSet(n: number, read: StackRead): MergeSet {
  let doc: unknown;
  try {
    doc = JSON.parse(read.out);
  } catch {
    return UNREAD;
  }
  let layers: Layer[] | null;
  if (read.by === 'stack') {
    layers = layersOf(doc);
    if (layers === null) return UNREAD;
  } else {
    if (!Array.isArray(doc)) return UNREAD;
    if (doc.length === 0) {
      return {
        asks: `#${n} is neither a stack nor a pull request in one`,
        remedy: '`gh stack view` shows the stack and its pull requests; name one of those.',
      };
    }
    if (doc.length > 1) {
      return {
        asks: `#${n} is in more than one stack`,
        remedy: 'Name the stack by its number instead.',
      };
    }
    const all = layersOf(doc[0]);
    const at = all?.findIndex((l) => l.number === n) ?? -1;
    if (all === null || at === -1) return UNREAD;
    if (all[at]?.merged) {
      return {
        asks: `#${n} has already merged`,
        remedy: 'Tell the user; nothing is left to merge.',
      };
    }
    layers = all.slice(0, at + 1);
  }
  const [first, ...rest] = layers.filter((l) => !l.merged).map((l) => l.number);
  return first === undefined
    ? {
        asks: `stack #${n} has merged every layer`,
        remedy: 'Tell the user; nothing is left to merge.',
      }
    : { prs: [first, ...rest], stack: read.by === 'stack' };
}

// A stack in gh-stack's local catalog, `<git common dir>/gh-stack`.
export type CatalogStack = Readonly<{
  number: number | null;
  trunk: string;
  branches: readonly Readonly<{ branch: string; merged: boolean }>[];
}>;

// The stacks the catalog lists, or null when it is not one this reads
// (schemaVersion 1, gh-stack 0.2).
export function parseCatalog(text: string): CatalogStack[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.stacks)) return null;
  const stacks: CatalogStack[] = [];
  for (const s of doc.stacks) {
    if (!isRecord(s) || !isRecord(s.trunk) || typeof s.trunk.branch !== 'string') return null;
    if (!Array.isArray(s.branches)) return null;
    const branches: { branch: string; merged: boolean }[] = [];
    for (const b of s.branches) {
      if (!isRecord(b) || typeof b.branch !== 'string') return null;
      const pr = isRecord(b.pullRequest) ? b.pullRequest : null;
      branches.push({ branch: b.branch, merged: pr?.merged === true });
    }
    if (s.number !== undefined && !(Number.isSafeInteger(s.number) && (s.number as number) > 0)) {
      return null;
    }
    const number = s.number === undefined ? null : (s.number as number);
    stacks.push({ number, trunk: s.trunk.branch, branches });
  }
  return stacks;
}

// A remote URL as git prints it after `To`: without its user and password
// (`git@github.com:o/r.git` prints as `github.com:o/r.git`).
export function anonymized(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@(.*)$/i.exec(url);
  if (scheme) return `${scheme[1]}${scheme[2]}`;
  const scp = /^[^/:@]+@([^/:]+:.*)$/.exec(url);
  return scp?.[1] ?? url;
}

// The first branch of `pushed` that is an unmerged layer of a stack, which
// `gh stack push` keeps in step with its pull request and the stack on GitHub.
export function layerOf(stacks: readonly CatalogStack[], pushed: readonly string[]): string | null {
  const layers = new Set(
    stacks.flatMap((s) =>
      s.branches.filter((b) => !b.merged && b.branch !== s.trunk).map((b) => b.branch),
    ),
  );
  return pushed.find((b) => layers.has(b)) ?? null;
}

// The stack `gh stack push`, `sync` and `submit` act on: the one holding the
// current branch, its trunk included.
export function stackOf(
  stacks: readonly CatalogStack[],
  current: string,
): CatalogStack | { asks: string } {
  const holding = stacks.filter(
    (s) => s.trunk === current || s.branches.some((b) => b.branch === current),
  );
  const [only, ...more] = holding;
  if (only === undefined) return { asks: `\`${current}\` is in no stack this clone tracks` };
  if (more.length > 0) return { asks: `\`${current}\` is in more than one stack` };
  return only;
}

// The head branches GitHub lists for stack <n>, or none when GitHub has no
// such stack.
export async function stackHeads(
  n: number,
  ghApi: (args: string[], what: string) => Promise<Lookup>,
): Promise<string[] | { asks: string }> {
  const r = await ghApi([`repos/{owner}/{repo}/stacks/${n}`], `stack #${n} on GitHub`);
  if (r.asks !== undefined) return r.asks.includes('(HTTP 404)') ? [] : { asks: r.asks };
  let doc: unknown;
  try {
    doc = JSON.parse(r.out);
  } catch {
    return { asks: UNREAD.asks };
  }
  if (!isRecord(doc) || !Array.isArray(doc.pull_requests)) return { asks: UNREAD.asks };
  const heads: string[] = [];
  for (const p of doc.pull_requests) {
    if (!isRecord(p) || !isRecord(p.head) || typeof p.head.ref !== 'string') {
      return { asks: UNREAD.asks };
    }
    heads.push(p.head.ref);
  }
  return heads;
}

export type LeaseFacts = Readonly<{
  stack: CatalogStack;
  defaultBranch: string;
  remote: string;
  // Each branch's tip on the remote now, from `git ls-remote`: every branch
  // on the URL gh-stack pushes to, since one it lacks reads as new there.
  tips: ReadonlyMap<string, string>;
  // `<remote>/<branch>` to the commit the gate last saw this agent push there.
  pushed: ReadonlyMap<string, string>;
  // The heads GitHub lists for the stack, read for `sync`, which pulls any
  // the catalog lacks and pushes them rebased.
  github: readonly string[] | null;
}>;

// Whether gh-stack's own `--force-with-lease` push may run on a plain push
// grant: every branch it pushes is in the catalog, none is the trunk or the
// default branch, and each is absent from the remote or still at the commit
// this agent pushed. gh-stack fetches before it pushes and leases against what
// it fetched (gitops.go, v0.2.1), so its lease alone keeps nothing it did not
// see.
export function leaseHolds(f: LeaseFacts): { ok: true } | { asks: string } {
  const listed = new Set(f.stack.branches.map((b) => b.branch));
  const extra = (f.github ?? []).filter((h) => !listed.has(h));
  if (extra.length > 0) {
    return {
      asks: `GitHub's stack holds ${extra.map((b) => `\`${b}\``).join(', ')}, which this clone's catalog lacks`,
    };
  }
  for (const { branch, merged } of f.stack.branches) {
    if (merged) continue;
    if (branch === f.stack.trunk || branch === f.defaultBranch) {
      return { asks: `\`${branch}\` is the stack's trunk or the default branch` };
    }
    const tip = f.tips.get(branch);
    if (tip === undefined) continue;
    const mine = f.pushed.get(`${f.remote}/${branch}`);
    if (mine !== tip) {
      return {
        asks: `\`${f.remote}/${branch}\` is at ${tip.slice(0, 7)}, which the gate ${mine === undefined ? 'never saw this agent push' : `did not see this agent push (it pushed ${mine.slice(0, 7)})`}`,
      };
    }
  }
  return { ok: true };
}

type Failed = { asks: string };
const failed = (x: unknown): x is Failed => typeof x === 'object' && x !== null && 'asks' in x;

// The reads `stackLease` makes; each failure says why.
export type LeaseIo = Readonly<{
  // `<git common dir>/gh-stack`, null when there is none.
  catalog: () => Promise<string | null | Failed>;
  branch: () => Promise<string | Failed>;
  // A git config value, null when unset.
  config: (key: string) => Promise<string | null | Failed>;
  remotes: () => Promise<string[] | Failed>;
  // What `git remote get-url --all` and `--push --all` print for `remote`.
  urls: (remote: string) => Promise<{ fetch: string; push: string } | Failed>;
  // What `git ls-remote --heads <remote>` printed.
  heads: (remote: string) => Promise<string | Failed>;
  defaultBranch: () => Promise<Lookup>;
  ghApi: (args: string[], what: string) => Promise<Lookup>;
  pushed: ReadonlyMap<string, string>;
}>;

// The remote gh-stack pushes to unprompted (`pickRemote`, v0.2.1).
export async function remoteOf(
  branch: string,
  io: Pick<LeaseIo, 'config' | 'remotes'>,
): Promise<string | Failed> {
  const keys = [
    `branch.${branch}.pushRemote`,
    'remote.pushDefault',
    `branch.${branch}.remote`,
    'gh-stack.remote',
  ];
  for (const key of keys) {
    const value = await io.config(key);
    if (value !== null) return value;
  }
  const remotes = await io.remotes();
  if (failed(remotes)) return remotes;
  const [only, ...more] = remotes;
  if (only === undefined) return { asks: 'the clone has no remote' };
  if (more.length > 0) return { asks: 'gh-stack would have to pick among several remotes' };
  return only;
}

// Each branch's tip in `git ls-remote --heads` output, SHA-1 or SHA-256, or
// null when a line is neither.
function tipsOf(listed: string): Map<string, string> | null {
  const tips = new Map<string, string>();
  for (const line of listed.split('\n')) {
    if (line === '') continue;
    const m = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\trefs\/heads\/(.+)$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) return null;
    tips.set(m[2], m[1]);
  }
  return tips;
}

// Whether gh-stack's leased push of the current branch's stack may run on a
// plain push grant, read as `leaseHolds` needs it.
export async function stackLease(
  step: 'push' | 'sync' | 'submit',
  named: string | null,
  io: LeaseIo,
): Promise<{ ok: true } | Failed> {
  const text = await io.catalog();
  if (text === null) return { asks: 'this clone tracks no stack' };
  if (failed(text)) return text;
  const stacks = parseCatalog(text);
  if (stacks === null) return { asks: "gh-stack's catalog is in a shape the gate does not read" };
  const branch = await io.branch();
  if (failed(branch)) return branch;
  const stack = stackOf(stacks, branch);
  if ('asks' in stack) return stack;
  const remote = named ?? (await remoteOf(branch, io));
  if (failed(remote)) return remote;
  if (remote.startsWith('-')) return { asks: `the remote \`${remote}\` reads as an option` };
  // `ls-remote` lists the first URL the remote fetches from; a `pushurl`,
  // `pushInsteadOf` or second `url` sends the push elsewhere too.
  const urls = await io.urls(remote);
  if (failed(urls)) return urls;
  if (urls.fetch.trim() !== urls.push.trim() || urls.push.trim().includes('\n')) {
    return { asks: `\`${remote}\` pushes to a URL other than the one it lists branches from` };
  }
  // A pack program of its own can serve either side from another repository.
  for (const pack of ['receivepack', 'uploadpack']) {
    const set = await io.config(`remote.${remote}.${pack}`);
    if (failed(set)) return set;
    if (set !== null) return { asks: `\`${remote}\` sets its own ${pack} program` };
  }
  const base = await io.defaultBranch();
  if (base.asks !== undefined) return base;
  const listed = await io.heads(remote);
  if (failed(listed)) return listed;
  const tips = tipsOf(listed);
  if (tips === null) return { asks: `\`git ls-remote\` printed a line the gate does not read` };
  const github =
    step === 'sync' && stack.number !== null ? await stackHeads(stack.number, io.ghApi) : null;
  if (failed(github)) return github;
  return leaseHolds({ stack, defaultBranch: base.out, remote, tips, pushed: io.pushed, github });
}
