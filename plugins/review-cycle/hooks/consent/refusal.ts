import type { MissStep } from '../gate/gh-verdict';
import { state, type Miss } from '../state/gate-state';
import { covers, type Grant } from './consent';
import { closingOf, grantOf, isReply, stepsNamed } from './exact';

// `step` is the step the refusal asks the user to decide, kept as a miss when
// their message named it.
export function deny(reason: string, step?: MissStep): { deny: string } {
  if (step !== undefined) noteMiss(reason, step);
  return { deny: `review-cycle: ${reason}` };
}

export const MAX_MISSES = 20;
const MISS_TEXT = 300;
const clip = (s: string) => s.slice(0, MISS_TEXT);

// The question the answer's closing lines end on, which a reply like "yes" answers.
// Sentences split at a mark before a space, so "Release `v0.25.0`?" stays whole.
function questionOf(closing: string): string {
  const sentences = closing.split(/(?<=[.!?])\s+/);
  return sentences.findLast((s) => s.trim().endsWith('?'))?.trim() ?? '';
}

function grants(grant: Grant, step: MissStep): boolean {
  if (step === 'push') return covers(grant, 'push');
  if (step === 'merge') return grant.merge || grant.autoMerge || grant.mergeStack.length > 0;
  // A merge the user asked for covers the version pull request too.
  if (step === 'release') return grant.release || grant.merge || grant.mergeStack.length > 0;
  if (step === 'comment') return grant.comment;
  return grant.pr;
}

// Not a hold step's word: "fix the comment in foo.ts" holds nothing, but a
// refused comment that message named is still worth keeping.
const COMMENT_NAMED = /\b(?:comment|reply|replies|respond|post)(?:s|ed|ing)?\b/i;

function noteMiss(refusal: string, step: MissStep): void {
  const { text, before } = state.said;
  // The whole closing is kept, so a spec row drafted from it reads as the gate did.
  // A comment is kept with its offer either way: "ok, do the codex pass"
  // answers "Should I post `@bot review` on #99?" without naming it.
  const offer = isReply(text) || step === 'comment' ? closingOf(before) : '';
  const commented = step === 'comment' && COMMENT_NAMED.test(`${text}\n${questionOf(offer)}`);
  const steps = [
    ...new Set([
      ...stepsNamed(text),
      ...stepsNamed(questionOf(offer)),
      ...(commented ? (['comment'] as const) : []),
    ]),
  ];
  // Merging the version pull request is a release, so naming the merge counts.
  const named = steps.includes(step) || (step === 'release' && steps.includes('merge'));
  // A message queued while the gate judged may grant what an older one did not.
  if (!named || grants(grantOf(text, before), step)) return;
  recordMiss({
    message: clip(text),
    offer: clip(offer),
    steps,
    refusal: clip(refusal),
    kind: 'refused',
  });
}

function recordMiss(miss: Omit<Miss, 'saved' | 'key'>): void {
  const known = state.misses.find((m) => sameMiss(m, miss));
  const entry = { ...miss, saved: known?.saved ?? false, key: known?.key ?? null };
  state.misses = [...state.misses.filter((m) => !sameMiss(m, miss)), entry].slice(-MAX_MISSES);
}

export const sameMiss = (
  a: Pick<Miss, 'message' | 'refusal'>,
  b: Pick<Miss, 'message' | 'refusal'>,
) => a.message === b.message && a.refusal === b.refusal;
