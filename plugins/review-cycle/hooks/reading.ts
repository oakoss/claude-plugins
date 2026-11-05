// What a typed message says to the gate, read once against the answer it
// follows, and how it moves the consent of the turn it starts or joins.

import {
  combine,
  dropsGrant,
  endsReady,
  grantOf,
  holdOf,
  joinPointed,
  pointedBy,
  unreadOffer,
  type Grant,
  type Pointed,
  type UnreadOffer,
} from './consent';
import type { Hold } from './hold';

export type MessageReading = Readonly<{
  text: string;
  grant: Grant;
  hold: Hold;
  unread: UnreadOffer | null;
  pointed: Pointed;
  // Typed into a running turn, it replaces that turn's consent rather than joining it.
  drops: boolean;
  ends: boolean;
}>;

// A paste is what the user shows, not their request. Claude Code puts each tag on
// its own line, so tags typed mid-line stay the user's words.
const PASTED =
  /(?<=^|\n)<pasted_content id="([^"]*)">\n[\s\S]*?\n<\/pasted_content id="\1">(?=\n|$)/g;
export const ownWords = (text: string): string => text.replaceAll(PASTED, '');

export function readMessage(text: string, before: string): MessageReading {
  const grant = grantOf(text, before);
  return {
    text,
    grant,
    hold: holdOf(text, before),
    unread: unreadOffer(text, before),
    pointed: pointedBy(text, before, grant),
    drops: dropsGrant(text, before),
    ends: endsReady(text, before),
  };
}

export type Consent = {
  grant: Grant;
  // Why the reply granted nothing the agent's offer named, for refusals.
  unread: UnreadOffer | null;
  // The one message its grant came from; null once a queued one joined it.
  said: string | null;
  // The pull requests a merge naming none may reach, kept apart from the
  // grant since combining an unnamed merge with a named one names none.
  pointed: Pointed;
};

export function consentOf(r: MessageReading): Consent {
  return { grant: r.grant, unread: r.unread, said: r.text, pointed: r.pointed };
}

export function consentJoined(current: Consent, r: MessageReading): Consent {
  // A retraction takes the reason with the yes it explained.
  if (r.drops) return { ...consentOf(r), unread: null };
  return {
    grant: combine(current.grant, r.grant),
    unread: current.unread ?? r.unread,
    said: null,
    pointed: joinPointed(current.pointed, r.pointed),
  };
}
