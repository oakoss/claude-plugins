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
// to date), the full destination ref, and the URL of the remote.
export type DryRunRef = { flag: string; to: string; url: string };

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
    refs.push({ flag, to: refspec.slice(refspec.indexOf(':') + 1), url });
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

// The level the push needs and the grant falls short of; null when covered.
export function unasked(spec: PushSpec, grant: Grant): Needed | null {
  const needed = neededFor(spec);
  return covers(grant, needed) ? null : needed;
}
