// What counts as a review, and which paths of a commit one covers. Pure.
//
// A review is a review-cycle leg that delivered its receipt. It covers a path
// only where the working tree held the same content when the leg was spawned
// and when its turn completed: an edit made while it ran, by the leg itself or
// anyone else, is content it may never have read. A committed path is covered
// when some review covers exactly the content being committed there. Anything
// edited after the last reviewer saw it is unreviewed until a reviewer sees it
// again: inline fixes included.

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// State and editor preferences, not reviewable code: changes here never need a
// review, and never count against a commit.
export const EXCLUDES = [
  ':(exclude,glob).beads/**',
  ':(exclude,glob)**/.beads/**',
  ':(exclude,glob).trekker/**',
  ':(exclude,glob)**/.trekker/**',
  ':(exclude,glob).vscode/**',
  ':(exclude,glob)**/.vscode/**',
  ':(exclude,glob).idea/**',
  ':(exclude,glob)**/.idea/**',
  ':(exclude,glob).zed/**',
  ':(exclude,glob)**/.zed/**',
  ':(exclude,glob).cursor/**',
  ':(exclude,glob)**/.cursor/**',
  ':(exclude,glob).fleet/**',
  ':(exclude,glob)**/.fleet/**',
];

// The config is always reviewable: an unreviewed `ignore` entry could hide the
// very change it was added alongside.
export const CONFIG_PATH = '.claude/review-cycle.json';

export function ignoresOf(configText: string | null): string[] {
  if (!configText) return [];
  try {
    const cfg = JSON.parse(configText) as { ignore?: unknown };
    if (!Array.isArray(cfg.ignore)) return [];
    return cfg.ignore
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map((p) => `:(exclude,glob)${p}`);
  } catch {
    return [];
  }
}

// cleanup edits the tree it is given; it is never a reviewer.
export function isReviewerType(type?: string): boolean {
  return (
    typeof type === 'string' && type.startsWith('review-cycle:') && type !== 'review-cycle:cleanup'
  );
}

// The two receipt lines, together, near the top of the report: a heading or a
// sentence may come first, a receipt buried in the body does not count.
export function hasReceipt(answer: string): boolean {
  const lines = answer
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  return lines.some(
    (l, i) =>
      l.startsWith('execution:') && (lines[i + 1] ?? '').startsWith('attempted-but-failed:'),
  );
}

export type Review = {
  type: string;
  // The working tree at spawn and at completion; both must match a path.
  trees: readonly [spawn: string, completed: string];
  // Paths the reviewed tree changed against HEAD at the time: what the
  // reviewer was shown. A review covers only these.
  reviewedPaths: readonly string[];
};

export type PathState = 'covered' | 'edited-after-review' | 'never-reviewed';
export type Row = { path: string; state: PathState };

// `differing` maps each reviewed tree to the committed paths where it and the
// tree being committed disagree.
export function coverage(
  changed: readonly string[],
  reviews: readonly Review[],
  differing: ReadonlyMap<string, ReadonlySet<string>>,
): Row[] {
  return changed.map((path) => {
    const agrees = (tree: string) => !(differing.get(tree)?.has(path) ?? true);
    // The reviewer must have been shown the path, not merely held it unchanged.
    if (reviews.some((r) => r.reviewedPaths.includes(path) && r.trees.every(agrees))) {
      return { path, state: 'covered' };
    }
    return {
      path,
      state: reviews.some((r) => r.reviewedPaths.includes(path))
        ? 'edited-after-review'
        : 'never-reviewed',
    };
  });
}

export function uncoveredOf(rows: readonly Row[]): Row[] {
  return rows.filter((r) => r.state !== 'covered');
}

export function describeUncovered(rows: readonly Row[]): string {
  const edited = rows.filter((r) => r.state === 'edited-after-review').map((r) => r.path);
  const never = rows.filter((r) => r.state === 'never-reviewed').map((r) => r.path);
  const parts: string[] = [];
  if (edited.length > 0) parts.push(`edited after the last review: ${edited.join(', ')}`);
  if (never.length > 0) parts.push(`never reviewed: ${never.join(', ')}`);
  return parts.join('; ');
}
