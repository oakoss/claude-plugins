// Reading and recording the findings ledger against the plugin's store. The
// store and the working tree come in as parameters, so this runs under plain
// tests; register.ts binds them to `$`.

import { firstLine, worktreeTree, type Git } from './git';
import {
  blobsOf,
  isStale,
  keyOf,
  MAX_READ,
  merge,
  paged,
  PREFIX,
  ranked,
  select,
  staleKeys,
  storedOf,
  updatedOf,
  type Recording,
} from './ledger';

export type Store = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  keys: () => Promise<string[]>;
  delete: (key: string) => Promise<void>;
};

// Each path's blob in the working tree as it stands, keyed by path.
export type Blobs = (paths: string[]) => Promise<Map<string, string>>;

// Literal pathspecs, so a path that starts with `:` or holds `*` names only
// itself.
export async function blobsAt(
  git: Git,
  top: string,
  paths: string[],
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const tree = await worktreeTree(git, top);
  const r = await git(['git', '--literal-pathspecs', 'ls-tree', '-r', '-z', tree, '--', ...paths], {
    cwd: top,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ls-tree failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`);
  }
  return blobsOf(r.stdout);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Read = { paths?: readonly string[]; query?: string; offset?: number };

// Blob ids as `git diff` takes them, short enough not to dominate a row.
const SHORT = 12;

// The entries for `paths` matching `query`, in ranked order from `offset`, the
// whole answer at most MAX_READ characters of JSON; each says whether its file
// changed or went stale since a cycle settled it.
export async function readLedger(
  store: Store,
  blobs: Blobs,
  common: string,
  read: Read,
  now: number,
): Promise<Record<string, unknown>> {
  const stored = storedOf(await store.get(keyOf(common)));
  const shown = ranked(select(stored.entries, read.paths), read.query);
  const status: Record<string, unknown> = {
    total: stored.entries.length,
    matched: shown.length,
    unreadable: stored.unreadable,
  };
  let current: Map<string, string> | null = null;
  try {
    current = await blobs([...new Set(shown.map((e) => e.path))]);
  } catch (error) {
    // Clipped to 300 characters before JSON escaping, so a long git diagnostic stays small.
    status.note = `changed is null: the working tree could not be read (${messageOf(error).slice(0, 300)})`;
  }
  const rows = shown.map((e) => {
    const file = current ? (current.get(e.path) ?? null) : null;
    const changed = current ? file !== e.blob : null;
    const { blob, ...row } = e;
    return {
      ...row,
      changed,
      stale: isStale(e.date, now),
      // Only where a reader may diff the file since: `git diff <blob> <current>`.
      ...(changed !== false && {
        blob: blob.slice(0, SHORT),
        current: file?.slice(0, SHORT) ?? null,
      }),
    };
  });
  const envelope = JSON.stringify({ ...status, next: rows.length, entries: [] }).length;
  const page = paged(rows, read.offset ?? 0, MAX_READ - envelope);
  if (page.next !== null) status.next = page.next;
  status.entries = page.rows;
  return status;
}

// Records `rec` and returns the tool's answer. Throws when the store or the
// working tree cannot be read, having written nothing.
export async function recordInto(
  store: Store,
  blobs: Blobs,
  common: string,
  rec: Recording,
  now: number,
): Promise<string> {
  const key = keyOf(common);
  const stored = storedOf(await store.get(key));
  const kept = new Set(rec.keep);
  const paths = [
    ...new Set([
      ...rec.add.map((n) => n.path),
      ...stored.entries.filter((e) => kept.has(e.id)).map((e) => e.path),
    ]),
  ];
  const found = await blobs(paths);
  const absent = [...new Set(rec.add.map((n) => n.path))].filter((p) => !found.has(p));
  if (absent.length > 0) {
    return `review-cycle ledger: nothing recorded: not a file in the working tree: ${absent.join(', ')}`;
  }
  const status: Record<string, unknown> = {};
  // Before the write, so a store too full to take it has room made first.
  try {
    const all = await store.keys();
    const ledgers = await Promise.all(
      all
        .filter((k) => k.startsWith(PREFIX))
        .map(async (k) => {
          const value = await store.get(k);
          return { key: k, updated: updatedOf(value) };
        }),
    );
    for (const stale of staleKeys(ledgers, key)) await store.delete(stale);
  } catch (error) {
    status.note = `older repositories' ledgers could not be pruned: ${messageOf(error)}`;
  }
  const m = merge(stored.entries, rec, found, new Date(now).toISOString().slice(0, 10));
  await store.set(key, { entries: m.entries, updated: now });
  const { entries, ...counts } = m;
  return JSON.stringify(
    {
      ...counts,
      total: entries.length,
      ...(stored.unreadable > 0 ? { dropped: stored.unreadable } : {}),
      ...status,
    },
    null,
    2,
  );
}
