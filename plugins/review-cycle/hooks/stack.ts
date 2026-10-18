// What `gh stack merge <n>` merges, read from GitHub's stacks API. Pure;
// register.ts makes the reads.

// `stack`: `GET repos/{o}/{r}/stacks/<n>`, one stack. `pr`: `GET
// repos/{o}/{r}/stacks?pull_request=<n>`, the stacks holding that pull request.
export type StackRead = { by: 'stack' | 'pr'; out: string; asks?: never };
export type MergeSet = { prs: [number, ...number[]] } | { asks: string; remedy: string };

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
    : { prs: [first, ...rest] };
}
