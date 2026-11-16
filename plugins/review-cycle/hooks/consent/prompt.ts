import type { HookFor, MatchedHook } from 'claude-code';

import {
  besideNote,
  NO_STANDING,
  RELEASE_ASK,
  shownNamed,
  standsFor,
  type Standing,
} from '../gate/gh-verdict';
import { worktreeTree } from '../gate/git';
import { ghLookups } from '../gate/judge';
import { reminderFor } from '../review/nudge-io';
import { ensureRoot, gitOf, type $, type Input, type NextOf, type Output } from '../state/engine';
import { HUMAN, state } from '../state/gate-state';
import { recallOnce } from '../state/keep';
import { liftsHold, NAMED_ELSEWHERE, type Grant } from './consent';
import { besideOf, mandateAfter } from './exact';
import { holdAfter } from './hold';
import { offerQuestion } from './offers';
import { consentJoined, consentOf, ownWords, readMessage } from './reading';

type OfferHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__offer' }>;

export function onOffer(_$: $, e: Input<OfferHook>, _next: NextOf<OfferHook>): Output<OfferHook> {
  const offer = offerQuestion(e);
  if ('error' in offer) return { result: `review-cycle: no question: ${offer.error}` };
  return { result: `End your answer with this line, word for word: ${offer.question}` };
}

export async function onPromptSubmit(
  $: $,
  e: Input<HookFor<'prompt.submit'>>,
  next: NextOf<HookFor<'prompt.submit'>>,
): Promise<Output<HookFor<'prompt.submit'>>> {
  await recallOnce($);
  if (HUMAN.has(e.origin.kind)) {
    state.messages++;
    const typed = ownWords(e.text);
    const reading = readMessage(typed, state.lastAnswer);
    state.said = { text: typed, before: state.lastAnswer, origin: e.origin.kind };
    // What a held message asks for still runs: "push it; don't open a PR yet".
    state.hold = holdAfter(state.hold, liftsHold(reading.grant, state.hold), reading.hold);
    state.mandate = mandateAfter(state.mandate, typed, state.lastAnswer);
    const ended = reading.ends ? endedNote(state.standing) : null;
    state.standing = await standingAfter(
      $,
      reading.ends ? NO_STANDING : state.standing,
      reading.grant,
    );
    if (ended !== null) e = { ...e, context: [...(e.context ?? []), ended] };
    const beside = besideOf(typed, state.lastAnswer);
    if (beside.length > 0) e = { ...e, context: [...(e.context ?? []), besideNote(beside)] };
    // A prompt queued into a running turn neither ends a review-pr run nor
    // replaces that turn's starting tree. Updated in place: nudgeReview tells
    // a new message from this one by identity.
    if (e.turnId !== undefined) {
      Object.assign(state.message, consentJoined(state.message, reading));
      // An owed reminder already covers this turn's changes.
      state.message.nudged = state.owed !== null;
    } else {
      let tree: string | null = null;
      try {
        const root = await ensureRoot($);
        if (root !== null) tree = await worktreeTree(gitOf($), root.top);
      } catch {
        // No starting tree means no nudge this message; the commit gate still holds.
      }
      // Read after the awaits, so a reminder armed meanwhile rides on this prompt.
      const owed = state.owed;
      const reviews = e.command?.name === 'review-cycle:review';
      // A slash command may never reach the agent, so the reminder waits for
      // the next message; typing the review skill is the review itself.
      const waits = owed !== null && e.command !== undefined && !reviews;
      state.message = { ...consentOf(reading), tree, nudged: waits || reviews, prWindow: false };
      if (owed === null || waits) return next(e);
      const reminder = reviews ? null : await reminderFor($, owed.since, tree);
      const r = await next(
        reminder === null ? e : { ...e, context: [...(e.context ?? []), reminder] },
      );
      // Consumed once the prompt is accepted, and only if nothing has since
      // replaced or retired it: a refused or failed prompt leaves it owed.
      if (!('drop' in r && r.drop !== undefined) && state.owed === owed) state.owed = null;
      return r;
    }
  }
  return next(e);
}

// The standing asks after a message: a merge once ready of the pull requests it
// named, and of the version pull request. An unnamed one binds to what its own
// message pointed at, so it ends with that message.
async function standingAfter($: $, prior: Standing, grant: Grant): Promise<Standing> {
  const named = grant.readyNamed.filter((n) => n !== NAMED_ELSEWHERE);
  const bound = grant.readyRelease ? await releaseOf($) : null;
  const release = bound ?? prior.release;
  // A main condition binds to this message's own asks, not to earlier ones.
  const releasing = grant.readyRelease && release !== null;
  const waits = grant.readyMain ? [...named, ...(releasing ? [RELEASE_ASK] : [])] : [];
  return {
    ready: [...new Set([...prior.ready, ...named])],
    release,
    main: [...new Set([...prior.main, ...waits])],
  };
}

// The version pull request a standing release covers: the open one, or the
// first opened after the newest. Null when GitHub cannot say.
async function releaseOf($: $): Promise<Standing['release']> {
  const r = await ghLookups($).versionPulls();
  if (r.asks !== undefined) return null;
  const pulls = r.out
    .trim()
    .split(/\s+/)
    .map((x) => /^(\d+):(\w+)$/.exec(x))
    .filter((m) => m !== null);
  const open = pulls.find((m) => m[2] === 'OPEN');
  if (open?.[1] !== undefined) return { pr: open[1] };
  return { after: Math.max(0, ...pulls.map((m) => Number(m[1]))) };
}

function endedNote(s: Standing): string | null {
  if (!standsFor(s)) return null;
  const which = [
    ...s.ready.map((n) => shownNamed(n)),
    ...(s.release === null ? [] : ["oakum's version pull request"]),
  ].join(' and ');
  return `review-cycle: this message ended the user's standing ask to merge ${which} once ready. Ask them before merging it.`;
}
