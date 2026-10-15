// Whether the user's request covers a push the gate is judging. Pure.

import { covers, type Grant, type PushLevel } from './consent';
import type { PushSpec } from './git-args';

export type Needed = Exclude<PushLevel, 'none'>;

// A bare force needs a bare-force request, a lease a force request, and any
// other push a push request.
export function neededFor(spec: PushSpec): Needed {
  return spec.force === 'none' ? 'push' : spec.force;
}

// One remote ref a `git push --dry-run --porcelain` would update: its flag
// (` ` fast-forward, `+` forced, `-` deleted, `*` new, `!` rejected, `=` up
// to date), the local source and full destination refs, and the remote's URL.
export type DryRunRef = { flag: string; from?: string; to: string; url: string };

export function parseDryRun(stdout: string): DryRunRef[] {
  const refs: DryRunRef[] = [];
  let url = '';
  for (const line of stdout.split('\n')) {
    if (line.startsWith('To ')) {
      url = line.slice(3).trim();
      continue;
    }
    const m = /^(.)\t([^\t]*)\t/.exec(line);
    if (!m) continue;
    const [, flag = '', refspec = ''] = m;
    const colon = refspec.indexOf(':');
    refs.push({ flag, from: refspec.slice(0, colon), to: refspec.slice(colon + 1), url });
  }
  return refs;
}

// A remote's default branch, or why it could not be read.
export type DefaultBranch = { branch: string } | { unreadable: string };

// Why a push asks whatever the setting, from the refs git says it updates and
// each remote's default branch. An up-to-date ref still counts: a commit in
// the same command lands before the push but after the dry run.
export function askingReason(
  refs: readonly DryRunRef[],
  defaults: ReadonlyMap<string, DefaultBranch>,
): string | null {
  // A quiet push prints no ref lines, so none read is not none pushed.
  if (refs.length === 0) return 'its dry run named no ref it would update';
  for (const { flag, to, url } of refs) {
    const name = to.replace(/^refs\/(heads|tags)\//, '');
    if (flag === '-') return `it deletes \`${name}\``;
    if (flag === '+') return `it force-updates \`${name}\``;
    if (to.startsWith('refs/tags/')) return `it pushes the tag \`${name}\``;
    const head = defaults.get(url) ?? { unreadable: 'not read' };
    if ('unreadable' in head) {
      return `the default branch of ${url} could not be read (${head.unreadable})`;
    }
    if (to === `refs/heads/${head.branch}`) {
      return `it pushes to \`${head.branch}\`, the default branch`;
    }
  }
  return null;
}

const bare = (name: string) => name.toLowerCase().replace(/^v(?=\d)/, '');

// Whether a request names a tag: `tag:*` any, else `tag:<name>`, with or
// without a leading v ("push the v1 tag" names `1`).
export function namesTag(named: readonly string[], tag: string): boolean {
  return named.some(
    (n) => n === 'tag:*' || (n.startsWith('tag:') && bare(n.slice(4)) === bare(tag)),
  );
}

// Why a push the user asked for still asks, and the offer whose yes covers it;
// none for deleting the default branch, which no answer covers.
export type Unnamed = { why: string; offer: string | null };

// A rejected ref lands nothing, nor does an up-to-date one unless it is
// `moved`, the branch a commit in the same command advances. An unreadable
// default branch is taken to be `main` or `master`.
export function unnamedTarget(
  refs: readonly DryRunRef[],
  defaults: ReadonlyMap<string, DefaultBranch>,
  named: readonly string[],
  moved: string | null,
): Unnamed | null {
  for (const { flag, from, to, url } of refs) {
    if (flag === '!') continue;
    // A revision like `HEAD~0` moves with the commit as `HEAD` does; `*` is a
    // commit whose branch could not be read, which may move any of them.
    const follows = from === undefined || !from.startsWith('refs/') || from === moved;
    if (flag === '=' && (moved === null || (moved !== '*' && !follows))) continue;
    if (to.startsWith('refs/tags/')) {
      const tag = to.slice('refs/tags/'.length);
      if (namesTag(named, tag)) continue;
      return {
        why: `it pushes the tag \`${tag}\`, which the request did not name`,
        offer: `"Push the \`${tag}\` tag?"`,
      };
    }
    const branch = to.replace(/^refs\/heads\//, '');
    const head = defaults.get(url);
    const isDefault =
      head === undefined || 'unreadable' in head
        ? /^(?:main|master)$/.test(branch)
        : branch === head.branch;
    if (isDefault && flag === '-') {
      return { why: `it deletes \`${branch}\`, the default branch`, offer: null };
    }
    if (isDefault && !named.includes(branch.toLowerCase())) {
      return {
        why: `it pushes to \`${branch}\`, the default branch, which the request did not name`,
        offer: `"Push to \`${branch}\`?"`,
      };
    }
  }
  return null;
}

// The level the push needs and the grant falls short of; null when covered.
export function unasked(spec: PushSpec, grant: Grant): Needed | null {
  const needed = neededFor(spec);
  return covers(grant, needed) ? null : needed;
}

// What a push may do, git's or GitHub's: run when the grant covers it, run
// unasked when something lets a plain push through and nothing makes it ask,
// or be refused for the level it is missing. `alwaysAsks` runs only for a
// push something would let through.
export type PushOutcome =
  | { kind: 'covered' }
  | { kind: 'unasked' }
  | { kind: 'refused'; missing: 'push'; always: string | null }
  | { kind: 'refused'; missing: Exclude<Needed, 'push'>; always: null };

export async function pushOutcome(
  missing: Needed | null,
  letsThrough: boolean,
  alwaysAsks: () => Promise<string | null>,
): Promise<PushOutcome> {
  if (missing === null) return { kind: 'covered' };
  if (missing !== 'push') return { kind: 'refused', missing, always: null };
  const always = letsThrough ? await alwaysAsks() : null;
  if (letsThrough && always === null) return { kind: 'unasked' };
  return { kind: 'refused', missing, always };
}
