// Which commits a Bash command made, read from HEAD's reflog. Pure.
//
// Every command that moves HEAD logs why: `commit: …`, `checkout: moving …`,
// `merge x: Fast-forward`. An entry counts as recording a commit unless git's
// own action prefix says it only moved HEAD, so an unknown or empty message
// counts too. A commit built with plumbing and then reached by `reset` logs
// only the reset, so it is not seen.

// One HEAD reflog entry: the commit HEAD moved to, and the line git printed,
// which identifies the entry.
export type Entry = { id: string; line: string; message: string };

// id, date, identity and message, NUL-separated: an identity may hold a tab.
export const REFLOG_FORMAT = '%H%x00%gd%x00%gn <%ge>%x00%gs';

// How many of HEAD's newest entries mark where a command began. More than one,
// since a repeated operation within one second logs an identical line.
export const MARK = 3;

export function parseReflog(stdout: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of stdout.split('\n')) {
    const fields = line.split('\0');
    const id = fields[0] ?? '';
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(id)) continue;
    entries.push({ id, line, message: fields.slice(3).join('\0') });
  }
  return entries;
}

// The `count` newest entries of `after`, the ones the command added, provided
// the entries below them are the ones recorded before it (`before`, newest
// first). Null when they are not: the log was expired, rewritten, or read too
// short.
export function added(
  after: readonly Entry[],
  before: readonly Entry[],
  count: number,
): Entry[] | null {
  if (count < 0 || count > after.length) return null;
  if (!before.every((b, j) => after[count + j]?.line === b.line)) return null;
  return after.slice(0, count);
}

// Whether an entry records a commit rather than only moving HEAD, judged by
// the action git writes before `: `, never by the commit subject after it. A
// cherry-pick whose subject is `fast-forward` reads as git's own fast-forward
// message would, so a cherry-pick fast-forward counts as a commit.
export function recordsCommit(message: string): boolean {
  const colon = message.indexOf(': ');
  const action = colon === -1 ? message : message.slice(0, colon);
  const rest = colon === -1 ? '' : message.slice(colon + 2);
  // A fetch never records a commit; with --update-head-ok it can move HEAD.
  if (/^(checkout|reset|clone|branch|fetch)\b/i.test(action)) return false;
  if (message === 'am --abort' || message === 'initial pull') return false;
  if (/^(rebase|pull)\b.*\((start|finish|abort|reset)\)$/.test(action)) return false;
  if (/^(merge|pull)\b/.test(action) && /^fast-forward\b/i.test(rest)) return false;
  return !(action === 'rebase' && (rest === 'fast-forward' || rest.startsWith('checkout ')));
}

// A run of commits recorded one on top of another: `base` is HEAD before the
// first, `tip` the last.
export type Lineage = { base: string; tip: string };

// The commits `entries` (newest first) recorded, grouped into lineages: a
// move between two commits starts a new one, so a commit on another branch is
// judged apart from one on this. `start` is HEAD before the command.
export function madeBy(entries: readonly Entry[], start: string): Lineage[] {
  const oldestFirst = entries.toReversed();
  const lineages: Lineage[] = [];
  let current: Lineage | null = null;
  for (const [i, entry] of oldestFirst.entries()) {
    if (!recordsCommit(entry.message)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { base: oldestFirst[i - 1]?.id ?? start, tip: entry.id };
      lineages.push(current);
    } else {
      current.tip = entry.id;
    }
  }
  return lineages;
}
