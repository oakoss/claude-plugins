// The findings ledger: what earlier review cycles in a repository settled
// without fixing, carried into the next cycle's briefs so reviewers do not
// re-litigate it. Pure.
//
// A fixed finding is never an entry: the code changed, so raising it again
// means it came back. An entry leaves the ledger when a cycle resolves it, when
// its file is gone, or when newer entries push it past the cap. One settled
// longer ago than EXPIRY_DAYS reads as stale, so a cycle judges it again.

export const KINDS = ['deferred', 'rebutted', 'left-alone', 'question'] as const;
export type Kind = (typeof KINDS)[number];

export type Entry = {
  id: string;
  path: string;
  line: number | null;
  kind: Kind;
  finding: string;
  reason: string;
  source: string;
  // The path's blob in the working tree the latest cycle to carry it reviewed,
  // so a reader can tell whether the file changed since.
  blob: string;
  // When a cycle last settled it; carrying it forward does not move this.
  date: string;
};

export type NewEntry = Omit<Entry, 'id' | 'blob' | 'date'>;

// One repository's ledger as read. `unreadable` counts what this version could
// not write back unchanged, such as entries a newer version wrote; the next
// record drops them and says how many.
export type Stored = { entries: Entry[]; unreadable: number; updated: number };

// The store holds every repository's ledger in 4 MiB of JSON. A full ledger of
// plain text measured about 137 KiB, and about twice that when JSON escapes
// much of it, so 10 repositories stay under the limit.
export const MAX_ENTRIES = 100;
export const MAX_TEXT = 400;
export const MAX_PATH = 1024;
export const MAX_REPOS = 10;
export const EXPIRY_DAYS = 90;
export const PREFIX = 'ledger:';

const ENTRY_KEYS = [
  'id',
  'path',
  'line',
  'kind',
  'finding',
  'reason',
  'source',
  'blob',
  'date',
] as const;
const BLOB = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function keyOf(common: string): string {
  return `${PREFIX}${common}`;
}

// FNV-1a: the same finding at the same path gets the same id in every cycle.
export function entryId(path: string, finding: string): string {
  let h = 0x81_1c_9d_c5;
  for (const ch of `${path}\0${finding}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Never cuts a surrogate pair in half.
function clip(s: string): string {
  const t = s.trim().replaceAll(/\s+/g, ' ');
  if (t.length <= MAX_TEXT) return t;
  const head = t.slice(0, MAX_TEXT - 1);
  return `${/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head}…`;
}

function isKind(k: unknown): k is Kind {
  return typeof k === 'string' && (KINDS as readonly string[]).includes(k);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function normalPath(p: string): string {
  return p.trim().replace(/^(\.\/)+/, '');
}

// A path as git's changed-path list spells it, or why it is not one: Phase 3
// selects entries by that list, so any other spelling is never read back.
function pathOf(v: unknown): string | { error: string } {
  if (typeof v !== 'string') return { error: 'path is required' };
  if (/\p{Cc}/u.test(v)) return { error: 'path holds a control character' };
  const p = normalPath(v);
  if (p === '') return { error: 'path is empty' };
  if (p.length > MAX_PATH) return { error: `path is over ${MAX_PATH} characters` };
  // Normalizing again must change nothing, or the stored path reads back as
  // another one.
  if (normalPath(p) !== p) return { error: `path starts or ends with whitespace: ${p}` };
  const segments = p.split(/[/\\]/);
  if (/^[A-Za-z]:/.test(p) || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { error: `path must be repository-relative, as git spells it: ${p}` };
  }
  return p;
}

// One finding as the record tool takes it, or its first fault.
function newEntryOf(raw: unknown): NewEntry | { error: string } {
  const e = (raw ?? {}) as Record<string, unknown>;
  if (e.kind === 'fixed') {
    return {
      error:
        'a fixed finding is not recorded; pass the id of the entry it settled in `resolve` instead',
    };
  }
  if (!isKind(e.kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };
  const path = pathOf(e.path);
  if (typeof path !== 'string') return path;
  const finding = text(e.finding);
  const reason = text(e.reason);
  const source = text(e.source);
  if (!finding || !reason || !source) {
    return { error: 'finding, reason and source are all required' };
  }
  const line = e.line ?? null;
  if (line !== null && !(Number.isSafeInteger(line) && (line as number) > 0)) {
    return { error: 'line must be a positive integer' };
  }
  return {
    path,
    line: line as number | null,
    kind: e.kind,
    finding: clip(finding),
    reason: clip(reason),
    source: clip(source),
  };
}

// A stored entry, or null unless this version would write it back exactly as
// stored: every key known, every value one the record tool produces.
function storedEntryOf(raw: unknown): Entry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !(ENTRY_KEYS as readonly string[]).includes(k))) return null;
  const n = newEntryOf(r);
  if ('error' in n) return null;
  const { blob, date } = r;
  if (typeof blob !== 'string' || !BLOB.test(blob)) return null;
  if (typeof date !== 'string' || !DATE.test(date)) return null;
  const e: Entry = { id: entryId(n.path, n.finding), ...n, blob, date };
  return ENTRY_KEYS.every((k) => e[k] === r[k]) ? e : null;
}

// The `updated` stamp of any stored value, ledger or not, so pruning orders a
// ledger this version cannot read by when it was written.
export function updatedOf(value: unknown): number {
  const u = (value as { updated?: unknown } | null | undefined)?.updated;
  return typeof u === 'number' ? u : 0;
}

// Whatever the store holds under one repository's key.
export function storedOf(value?: unknown): Stored {
  if (value === undefined) return { entries: [], unreadable: 0, updated: 0 };
  const updated = updatedOf(value);
  const v = (value ?? {}) as { entries?: unknown; updated?: unknown };
  const known = new Set(['entries', 'updated']);
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray(v.entries) ||
    typeof v.updated !== 'number' ||
    Object.keys(value).some((k) => !known.has(k))
  ) {
    // Every entry is lost with the ledger around it, so each one counts.
    const lost = Array.isArray(v.entries) ? v.entries.length : 0;
    return { entries: [], unreadable: Math.max(1, lost), updated };
  }
  const entries: Entry[] = [];
  const ids = new Set<string>();
  let unreadable = 0;
  for (const raw of v.entries) {
    const e = storedEntryOf(raw);
    if (e && !ids.has(e.id)) {
      ids.add(e.id);
      entries.push(e);
    } else {
      unreadable++;
    }
  }
  return { entries, unreadable, updated };
}

// `keep` carries entries a cycle settled again unchanged: each is stamped with
// its file as that cycle reviewed it, and its date stays.
export type Recording = { add: NewEntry[]; resolve: string[]; keep: string[] };

function ids(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((r) => typeof r === 'string' && /^[0-9a-f]{8}$/.test(r));
}

// The record tool's input, whole or not at all: a batch half-written is
// harder to read back than one refused with its first fault named.
export function parseRecord(input: unknown): Recording | { error: string } {
  const i = (input ?? {}) as { entries?: unknown; resolve?: unknown; keep?: unknown };
  const rawEntries = i.entries ?? [];
  const rawResolve = i.resolve ?? [];
  const rawKeep = i.keep ?? [];
  if (!Array.isArray(rawEntries)) return { error: '`entries` must be an array' };
  if (!ids(rawResolve)) return { error: '`resolve` must be an array of entry ids' };
  if (!ids(rawKeep)) return { error: '`keep` must be an array of entry ids' };
  const add: NewEntry[] = [];
  for (const [n, raw] of rawEntries.entries()) {
    const e = newEntryOf(raw);
    if ('error' in e) return { error: `entries[${n}]: ${e.error}` };
    add.push(e);
  }
  if (add.length === 0 && rawResolve.length === 0 && rawKeep.length === 0) {
    return { error: 'nothing to record: pass `entries`, `keep` or `resolve`' };
  }
  return { add, resolve: rawResolve, keep: rawKeep };
}

export type Merged = {
  entries: Entry[];
  added: number;
  updated: number;
  resolved: number;
  kept: number;
  // Kept entries whose file is no longer in the working tree, so dropped.
  gone: number;
  // Ids in `resolve` or `keep` that named no entry.
  unknown: string[];
  evicted: number;
};

// Resolves first, then keeps, then adds, so a batch that resolves an entry and
// records the same finding again keeps the new one. A kept or re-recorded
// entry moves to the newest end, so eviction takes what no cycle has touched
// longest. `blobs` must hold every added path; a kept entry whose path it
// lacks is gone.
export function merge(
  existing: Entry[],
  rec: Recording,
  blobs: ReadonlyMap<string, string>,
  date: string,
): Merged {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const unknown: string[] = [];
  let resolved = 0;
  for (const id of rec.resolve) {
    if (byId.delete(id)) resolved++;
    else unknown.push(id);
  }
  let kept = 0;
  let gone = 0;
  for (const id of rec.keep) {
    const e = byId.get(id);
    if (!e) {
      unknown.push(id);
      continue;
    }
    byId.delete(id);
    const blob = blobs.get(e.path);
    if (blob === undefined) {
      gone++;
    } else {
      byId.set(id, { ...e, blob });
      kept++;
    }
  }
  let added = 0;
  let updated = 0;
  for (const n of rec.add) {
    const blob = blobs.get(n.path);
    if (blob === undefined) throw new Error(`no blob for ${n.path}`);
    const id = entryId(n.path, n.finding);
    if (byId.delete(id)) updated++;
    else added++;
    byId.set(id, { id, ...n, blob, date });
  }
  const all = [...byId.values()];
  const evicted = Math.max(0, all.length - MAX_ENTRIES);
  return { entries: all.slice(evicted), added, updated, resolved, kept, gone, unknown, evicted };
}

export function isStale(date: string, now: number): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return now - Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) > EXPIRY_DAYS * 86_400_000;
}

export function select(entries: Entry[], paths?: readonly string[]): Entry[] {
  if (paths === undefined) return entries;
  const want = new Set(paths.map((p) => normalPath(p)));
  return entries.filter((e) => want.has(e.path));
}

// `git ls-tree -r -z` output as path to blob id.
export function blobsOf(lsTree: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const rec of lsTree.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(rec);
    if (m?.[1] && m[2]) blobs.set(m[2], m[1]);
  }
  return blobs;
}

// The other repositories' ledgers to drop so that, with this one, the store
// holds at most MAX_REPOS: the least recently updated go first.
export function staleKeys(
  ledgers: readonly { key: string; updated: number }[],
  keep: string,
): string[] {
  const others = ledgers.filter((l) => l.key !== keep).toSorted((a, b) => a.updated - b.updated);
  return others.slice(0, Math.max(0, others.length - (MAX_REPOS - 1))).map((l) => l.key);
}
