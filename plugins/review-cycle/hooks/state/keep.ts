import { atom, read, update } from 'claude-code';

import { pruneMisses, readMisses, type RecordedMiss, saveMiss } from '../consent/misses';
import { sameMiss } from '../consent/refusal';
import { messageOf } from '../gate/git';
import { overBudget } from '../review/legs';
import { STORE_TAG, storeOf, within, type $ } from './engine';
import { LEG_BUDGET_MS, state, type GateState } from './gate-state';
import { entryName } from './journal';
import { isKept, keptOf, offKept, restoredOf, type Restored } from './kept';

// The gate's memory as the host keeps it: module variables start over when the
// module reloads (a saved hooks file, a /config change), so what the gate
// remembers is copied here after each change and read back at the start, the
// latest message's grant included, so a reload mid-step does not ask twice.
// Bump the shape whenever Kept changes, so a reload into new code starts fresh.
const gate = atom({ plugin: 'review-cycle', key: 'gate' } as const, null, {
  shape: 'gate-11',
});
let keptText = '';
let isKeepFailing = false;
// Nothing is kept until what a reload left has been taken back, so an early
// save cannot overwrite it.
let isRecalled = false;
// Once per load, at the session start or the first message, whichever comes
// first: a message read before the take-back would be overwritten by it.
let recalling: Promise<void> | null = null;
export function recallOnce($: $): Promise<void> {
  return (recalling ??= recallOrSay($).then(() => {
    isRecalled = true;
  }));
}
let saving: Promise<void> = Promise.resolve();
let saves = 0;

// One write at a time, each taking what the gate holds as it runs, so an older
// copy never lands after a newer one. Never throws: the gate's decisions do not
// wait on it.
export function keep($: $): Promise<void> {
  void flushMisses($);
  return keepGate($);
}

export function keepGate($: $): Promise<void> {
  saving = saving.then(() => write($));
  return saving;
}

async function write($: $): Promise<void> {
  if (!isRecalled) return;
  try {
    const kept = keptOf(state);
    const text = JSON.stringify(kept);
    if (text === keptText) return;
    // A save that timed out is not cancelled, and `update` retries it; once a
    // newer save has started, it writes back what is stored rather than its own.
    const save = ++saves;
    await within(
      $,
      update($, gate, (stored) => (save === saves ? kept : stored)),
      'saving the gate',
    );
    keptText = text;
    isKeepFailing = false;
  } catch (error) {
    if (!isKeepFailing) {
      $.ui.toast(
        `review-cycle could not keep its record for a reload, so one would forget its reviews or bring back an earlier message's grant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    isKeepFailing = true;
  }
}

// After a reload, the gate takes back what it remembered, and each leg still
// running gets the rest of its budget. A record it cannot read is set aside
// whole: nothing is taken back from it, so no part of an old record mixes with
// a fresh start.
async function recall($: $): Promise<void> {
  const kept = await within($, read($, gate), 'reading the gate');
  if (kept !== null) {
    if (!isKept(kept)) {
      $.ui.toast(
        'review-cycle could not read the reviews it kept, so it starts this load with none',
      );
    } else {
      const now = await $.clock.now();
      const restored: Pick<GateState, keyof Restored> = restoredOf(kept);
      Object.assign(state, restored);
      for (const [id, leg] of state.legs) {
        if (leg.done || leg.capped) continue;
        const left = Math.max(0, LEG_BUDGET_MS - (now - leg.spawnedAt));
        leg.timer = $.clock.after(left, () => overBudget($, id, leg));
      }
      keptText = JSON.stringify(kept);
    }
  }
}

// Switched off, the gate watches nothing, so what only watching kept true
// goes; a completed review stays true of the tree it saw.
export async function clearOffGate($: $): Promise<void> {
  try {
    const kept = await within($, read($, gate), 'reading the gate');
    await within(
      $,
      update($, gate, () => (isKept(kept) ? offKept(kept) : null)),
      'clearing the gate',
    );
  } catch (error) {
    $.ui.toast(
      `review-cycle could not clear what it was watching, so switching it back on may bring back a stale question or hold: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// A take-back that fails is not tried again: by then the session may have moved
// on, and an older record taken back late would undo it. It starts fresh.
async function recallOrSay($: $): Promise<void> {
  try {
    await recall($);
  } catch (error) {
    $.ui.toast(
      `review-cycle could not take back its reviews after a reload, so it starts this load with none: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let missesAt = 0;
// The last write the store refused, while a miss it was for is still unsaved.
let missesError: string | null = null;
let missesSaving: Promise<void> = Promise.resolve();

function flushMisses($: $): Promise<void> {
  missesSaving = missesSaving.then(() => saveMisses($));
  return missesSaving;
}

// Never throws: a miss the store does not take stays unsaved for the next
// flush, and a reload keeps it with the gate. It is written only once the gate
// has kept its key, so a late or repeated write, or one a reload repeats,
// replaces the entry rather than adding one.
async function saveMisses($: $): Promise<void> {
  let wrote = false;
  for (const miss of state.misses.filter((m) => !m.saved)) {
    try {
      const now = await $.clock.now();
      let { key } = miss;
      if (key === null) {
        missesAt = Math.max(now, missesAt + 1);
        const named = entryName(missesAt, STORE_TAG);
        key = named;
        state.misses = state.misses.map((m) => (sameMiss(m, miss) ? { ...m, key: named } : m));
      }
      if (!keptText.includes(JSON.stringify(key))) {
        await within($, keepGate($), 'saving the gate');
        if (!keptText.includes(JSON.stringify(key))) {
          throw new Error('the gate could not keep its record, so the miss waits to be written');
        }
      }
      const recorded: RecordedMiss = {
        message: miss.message,
        offer: miss.offer,
        steps: miss.steps,
        refusal: miss.refusal,
        kind: miss.kind,
        date: new Date(now).toISOString().slice(0, 10),
        repo: state.root?.top ?? null,
      };
      await within($, saveMiss(storeOf($), key, recorded), 'recording a consent miss');
      state.misses = state.misses.map((m) => (sameMiss(m, miss) ? { ...m, saved: true } : m));
      wrote = true;
    } catch (error) {
      missesError = messageOf(error);
    }
  }
  if (!state.misses.some((m) => !m.saved)) missesError = null;
  if (wrote) {
    void keep($);
    // Untimed and apart from the writes: a prune that fails or stalls loses no miss.
    pruneMisses(storeOf($)).catch(() => null);
  }
}

// What the store holds once this session's unsaved misses are tried, waiting
// at most one STATE_WAIT_MS on them; `unsaved` counts those it still lacks.
export async function keptMisses($: $): Promise<{
  recorded: RecordedMiss[] | null;
  unsaved: number;
  error: string | null;
}> {
  let flushError: string | null = null;
  try {
    await within(
      $,
      flushMisses($),
      "saving consent misses (the gate's save comes first, then the store's)",
    );
  } catch (error) {
    flushError = messageOf(error);
  }
  const unsaved = state.misses.filter((m) => !m.saved).length;
  const error = unsaved > 0 ? (missesError ?? flushError) : null;
  try {
    const recorded = await within($, readMisses(storeOf($)), 'reading consent misses');
    return { recorded, unsaved, error };
  } catch (readError) {
    return { recorded: null, unsaved, error: messageOf(readError) };
  }
}
