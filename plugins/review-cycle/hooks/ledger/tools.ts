import type { MatchedHook } from 'claude-code';

import {
  ensureRoot,
  gitOf,
  storeOf,
  type $,
  type Input,
  type NextOf,
  type Output,
} from '../state/engine';
import {
  KINDS,
  MAX_CLASS,
  MAX_LEDGER_BYTES,
  MAX_READ,
  MAX_REPOS,
  MAX_TEXT,
  parseRecord,
  RECUR_DATES,
  type Recording,
} from './ledger';
import { blobsAt, readLedger, recordInto } from './ledger-store';

type LedgerHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__ledger' }>;
type RecordHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__ledger_record' }>;

// The ledger gates nothing, so its tools are served whether or not the gate is on.
export async function registerLedger($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'ledger',
      description: `Findings earlier review cycles in this repository settled without fixing: deferred, rebutted, left alone on purpose, or raised as questions. Each entry has an id, path, line, kind, finding, reason, source, \`date\` (when a cycle last settled it), \`changed\` (whether its file differs from what the last cycle to carry it reviewed; null when the working tree could not be read), and \`stale\` (settled more than 90 days ago); unless \`changed\` is false it also has \`blob\` and \`current\`, short ids for \`git diff <blob> <current>\`. Entries come ranked, in an answer of at most ${MAX_READ} characters unless its first entry and the answer's header together are longer: first every stale entry, query or not, since it is open again, then those holding the most \`query\` words, then the newest. \`reopened\` counts the stale entries, \`matched\` the rest, and \`next\`, when present, is the \`offset\` that reads on. \`unreadable\` counts stored entries this version cannot read; the next record drops them. An entry may have a \`class\`, the general rule it is an instance of; a read from the start lists \`classes\`, the ledger's classes with their entry counts, most used first, whatever \`paths\` selects, and \`classesOmitted\` counts those that did not fit. Read-only.`,
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only the entries for these repository-relative paths.',
          },
          query: {
            type: 'string',
            description:
              'Only the entries whose finding, reason or class holds any of these words (three characters or more), plus every stale one, ranked first.',
          },
          offset: { type: 'integer', minimum: 0, description: 'Where to start: a `next` value.' },
        },
      },
    });
    await $.tool.register({
      name: 'ledger_record',
      description: `Records what a review cycle settled without fixing into this repository's findings ledger. \`entries\` adds findings, each stamped with its file's blob in the working tree and today's date, so every path must be a file there; text is collapsed to one line and clipped at ${MAX_TEXT} characters, and the same finding at the same path replaces its entry. \`keep\` carries entries by id: each gets its file's current blob and keeps its date, and one whose file is gone is dropped. \`move\` does the same for an entry whose code moved to another file, giving it that path and a new id; it needs no \`keep\`. \`resolve\` removes entries by id. When a \`class\` reaches entries settled on ${RECUR_DATES} different dates by this record, the answer's \`propose\` lists it with its newest instances: a finding that keeps recurring, which the project could encode as code, a check, or a line in its \`AGENTS.md\` or \`CLAUDE.md\`. A class already there is not proposed again unless its entries fall below ${RECUR_DATES} dates, as when they are resolved, and reach it again. The ledger keeps the newest entries that fit in ${MAX_LEDGER_BYTES / 1024} KiB per repository, and ledgers for the ${MAX_REPOS} most recently recorded repositories.`,
      inputSchema: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Repository-relative path.' },
                line: { type: ['integer', 'null'], minimum: 1 },
                kind: { type: 'string', enum: [...KINDS] },
                finding: { type: 'string' },
                reason: {
                  type: 'string',
                  description:
                    'Why it was not fixed: the deferral criterion, the measurement or documentation that rebutted it, or why it was left alone.',
                },
                source: { type: 'string', description: 'The reviewer that raised it.' },
                class: {
                  type: 'string',
                  maxLength: MAX_CLASS,
                  description:
                    "The general rule this finding is an instance of, when it has one, such as 'evasion outside the gate threat model': the words of a class in the read's `classes` when one fits, else a new short phrase. Compared lowercased with spacing collapsed. Left out, an entry recorded again keeps its class.",
                },
              },
              required: ['path', 'kind', 'finding', 'reason', 'source'],
            },
          },
          resolve: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of entries to remove.',
          },
          keep: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of carried entries settled again unchanged.',
          },
          move: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'The carried entry to move.' },
                path: {
                  type: 'string',
                  description: 'Repository-relative path of the file its code moved to.',
                },
                line: { type: ['integer', 'null'], minimum: 1 },
              },
              required: ['id', 'path'],
            },
            description: 'Carried entries whose code moved to another file, still settled.',
          },
        },
      },
    });
  } catch {
    // Without the tools the skill says the ledger was unavailable.
  }
}

export async function onLedger(
  $: $,
  e: Input<LedgerHook>,
  _next: NextOf<LedgerHook>,
): Promise<Output<LedgerHook>> {
  const { paths, query, offset } = e as { paths?: unknown; query?: unknown; offset?: unknown };
  if (paths !== undefined && !(Array.isArray(paths) && paths.every((p) => typeof p === 'string'))) {
    return {
      result: 'review-cycle ledger: `paths` must be an array of repository-relative paths.',
    };
  }
  if (query !== undefined && typeof query !== 'string') {
    return { result: 'review-cycle ledger: `query` must be a string.' };
  }
  if (offset !== undefined && !(Number.isInteger(offset) && (offset as number) >= 0)) {
    return { result: 'review-cycle ledger: `offset` must be a whole number, 0 or more.' };
  }
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'review-cycle ledger: not in a git repository.' };
    const blobs = (ps: string[]) => blobsAt(gitOf($), root.top, ps);
    const read = { paths, query, offset: offset as number | undefined };
    const status = await readLedger(storeOf($), blobs, root.common, read, await $.clock.now());
    return { result: JSON.stringify(status) };
  } catch (error) {
    return {
      result: `review-cycle ledger: could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Records run one at a time: each reads the ledger, merges, and writes it
// back. A record waits for the one before it for at most this long and then
// refuses, so a store call that never settles cannot hang every later record,
// nor finish late over one that ran past it. Well under the hook's 10-second
// budget, which the sleep spends: a wait that reached it would lose the
// refusal to the engine's own answer.
const RECORD_WAIT_MS = 5000;
let recording: Promise<unknown> = Promise.resolve();

export async function onLedgerRecord(
  $: $,
  e: Input<RecordHook>,
  _next: NextOf<RecordHook>,
): Promise<Output<RecordHook>> {
  const rec = parseRecord(e);
  if ('error' in rec) return { result: `review-cycle ledger: nothing recorded: ${rec.error}` };
  const before = recording;
  const ready = Promise.race([
    before.then(
      () => true,
      () => true,
    ),
    $.clock.sleep(RECORD_WAIT_MS).then(() => false),
  ]);
  const task = ready.then((go) =>
    go
      ? recordNow($, rec)
      : {
          result: `review-cycle ledger: nothing recorded: an earlier record has not finished after ${RECORD_WAIT_MS / 1000} seconds`,
        },
  );
  recording = Promise.allSettled([before, task]);
  return task;
}

async function recordNow($: $, rec: Recording): Promise<Output<RecordHook>> {
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'review-cycle ledger: not in a git repository; nothing recorded.' };
    const blobs = (ps: string[]) => blobsAt(gitOf($), root.top, ps);
    return {
      result: await recordInto(storeOf($), blobs, root.common, rec, await $.clock.now()),
    };
  } catch (error) {
    return {
      result: `review-cycle ledger: nothing recorded: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
