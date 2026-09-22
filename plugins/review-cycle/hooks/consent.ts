// Decides whether a human prompt asks for a commit or a push. Pure.
//
// A grant needs the verb in a request the grammar below recognises: only
// request words before it ("ok, please commit", "can you push?", "I want you
// to commit") and only an object, a destination or a courtesy after it
// ("commit the changes", "push to main now"). Anything else grants nothing:
// "the commit gate", "agents would commit", "I'll push later", "commit to this
// approach", "push the button". Missing a request costs one question; reading
// one that was not made costs a commit nobody asked for.
//
// A bare affirmative ("yes", "go ahead") grants what the previous answer's
// closing question offered to do.

export type Grant = Readonly<{ commit: boolean; push: boolean }>;

export const NO_GRANT: Grant = Object.freeze({ commit: false, push: false });

type Verb = keyof Grant;
type MutableGrant = { commit: boolean; push: boolean };

const REQUESTED: Record<string, Verb[]> = {
  commit: ['commit'],
  push: ['push'],
  ship: ['commit', 'push'],
};

const OFFERED: Record<string, Verb[]> = {
  ...REQUESTED,
  committing: ['commit'],
  pushing: ['push'],
  shipping: ['commit', 'push'],
};

// Words that may come before the verb in a request.
const REQUEST_LEAD = new Set([
  'ok',
  'okay',
  'alright',
  'great',
  'cool',
  'nice',
  'perfect',
  'awesome',
  'good',
  'fine',
  'thanks',
  'yes',
  'yeah',
  'sure',
  'lgtm',
  'now',
  'then',
  'also',
  'just',
  'please',
  'go',
  'ahead',
  'lets',
  "let's",
  'let',
  'us',
  'can',
  'could',
  'would',
  'will',
  'you',
  'feel',
  'free',
  'to',
  'i',
  "i'd",
  'want',
  'need',
  'like',
  'we',
]);

// Words that may come before the verb in the agent's offer.
const OFFER_LEAD = new Set([
  'ok',
  'okay',
  'so',
  'now',
  'then',
  'want',
  'me',
  'to',
  'should',
  'shall',
  'can',
  'may',
  'i',
  "i'll",
  'do',
  'you',
  'would',
  'like',
  'go',
  'ahead',
  'with',
  'the',
  'ready',
  'proceed',
  'and',
]);

// Words that may follow the verb: its object, where it goes, and courtesies.
const TAIL = new Set([
  'it',
  'this',
  'that',
  'them',
  'these',
  'those',
  'everything',
  'all',
  'of',
  'the',
  'my',
  'your',
  'our',
  'changes',
  'change',
  'code',
  'commits',
  'fix',
  'fixes',
  'work',
  'files',
  'file',
  'edits',
  'diff',
  'stuff',
  'branch',
  'up',
  'to',
  'main',
  'master',
  'origin',
  'remote',
  'upstream',
  'github',
  'pr',
  'now',
  'please',
  'thanks',
  'too',
  'again',
  'as',
  'well',
  'right',
  'away',
  'me',
  'with',
  'a',
  'message',
  'msg',
  'quoted',
]);

// After "to", only a destination: "push to main", not "commit to this approach".
const DESTINATION = new Set([
  'main',
  'master',
  'origin',
  'remote',
  'upstream',
  'github',
  'the',
  'it',
  'pr',
  'branch',
]);

// Opening a part joined by "and" or "then", these carry over to the parts
// after it: "I didn't ask you to review and commit", "they review then commit".
const MOOD =
  /^(don'?t|dont|not|never|no|didn'?t|won'?t|can'?t|cannot|shouldn'?t|wouldn'?t|doesn'?t|i'll|i'm|i've|we'll|we're|they|he|she|agents?|claude|who|which|would|might|should|if|when|whether|once|unless|until|before|after|without)$/;

// Opening a part, these describe something rather than ask for it: "the flow
// is review, then commit". Later parts and continuing clauses grant nothing.
const DESCRIBES = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'our',
  'my',
  'their',
  'its',
  "it's",
  'it',
  'there',
  'here',
]);

// Anywhere in a part, these make it a statement about how work goes ("usually
// I review", "the flow is review"), so the parts after it are description too.
const STATEMENT = new Set([
  'is',
  'are',
  'was',
  'were',
  'i',
  'we',
  'they',
  'he',
  'she',
  'agents',
  'agent',
  'claude',
  'usually',
  'normally',
  'typically',
  'always',
  'often',
  'sometimes',
  'generally',
]);

// Anywhere in the clause, these make the verb conditional, not a request.
const SUBORDINATE = new Set([
  'whether',
  'if',
  'unless',
  'when',
  'once',
  'until',
  'before',
  'after',
  'without',
]);

// A clause with no verb that holds off: "not yet, commit later".
const HOLD = /^\s*(not yet|not now|hold off|hold on|wait|don'?t yet)\b/i;
const RETRACT = /^\s*(no|nope|wait|never ?mind|scratch that|hold on|actually,? (no|don'?t))\b/i;
// A clause opening with one of these makes the whole prompt conditional.
const CONDITION = /^\s*(if|when|once|after|unless|until|as soon as)\b/i;
// A sentence opening with one of these asks something rather than asking for it.
const QUESTION = new Set([
  'why',
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'is',
  'are',
  'was',
  'does',
  'do',
  'did',
  'has',
  'have',
  'should',
  'explain',
  'whether',
]);
// Questions that hand the action back to the user, or offer to skip it.
const HANDBACK = new Set(['yourself', "you'd", 'rather', 'skip', 'leave', 'instead', 'terminal']);

const AFFIRMATIVE =
  /^(yes|yep|yeah|yup|y|ok|okay|sure|go ahead|go for it|do it|please do|sounds good|lgtm)\b[\s.!,]*(please|thanks|thank you)?[\s.!]*$/i;

// Quoted text is a commit message or a name, never part of the request.
function unquote(text: string): string {
  return text
    .replaceAll(/(^|[\s(:=])(["'`])[^\n]*?\2(?=$|[\s.,;:!?)])/g, '$1 quoted ')
    .replaceAll(/“[^”\n]*”|‘[^’\n]*’/g, ' quoted ');
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[’‘]/g, "'")
    .split(/[^a-z0-9'-]+/)
    .filter(Boolean);
}

// "commit it", "push to main now": nothing but tail words, with "to" naming a
// destination and a message only in "with a message".
function isTail(tail: string[]): boolean {
  for (const [i, word] of tail.entries()) {
    if (!TAIL.has(word)) return false;
    if (word === 'to' && !DESTINATION.has(tail[i + 1] ?? '')) return false;
    if ((word === 'message' || word === 'msg') && !tail.slice(0, i).includes('with')) return false;
  }
  return true;
}

function isLead(lead: string[], allowed: Set<string>): boolean {
  if (!lead.every((x) => allowed.has(x) || x === 'to')) return false;
  // The user's own plan unless addressed to the agent: "I want you to push".
  if (allowed === REQUEST_LEAD) {
    if (lead.some((x) => x === 'i' || x === "i'd") && !lead.includes('you')) return false;
    const we = lead.indexOf('we');
    if (we !== -1 && !/^(can|could|let'?s?)$/.test(lead[we - 1] ?? '')) return false;
  }
  return true;
}

// What a clause leaves for the clauses after it in the sentence: a mood
// withholds all of them, a description those that continue it with "and" or
// "then".
type Carry = 'none' | 'mood' | 'described';

// The verbs a clause asks for, reading each part joined by "and" or "then" as
// its own request: "fix the parser and commit it".
function grammarGrant(
  clause: string,
  verbs: Record<string, Verb[]>,
  lead: Set<string>,
  into: MutableGrant,
): Carry {
  const w = words(clause);
  if (w.some((x) => SUBORDINATE.has(x))) return 'mood';
  const parts: string[][] = [[]];
  for (const word of w) {
    if (word === 'and' || word === 'then') parts.push([]);
    else parts.at(-1)?.push(word);
  }
  let described = false;
  for (const part of parts) {
    const at = part.findIndex((x) => Object.hasOwn(verbs, x));
    const asks =
      at !== -1 && !described && isLead(part.slice(0, at), lead) && isTail(part.slice(at + 1));
    if (asks) for (const v of verbs[part[at] ?? ''] ?? []) into[v] = true;
    const opening = part.find((x) => !lead.has(x));
    if (opening !== undefined && MOOD.test(opening)) return 'mood';
    if (opening !== undefined && DESCRIBES.has(opening) && opening === part[0]) described = true;
    if (at === -1 && part.some((x) => STATEMENT.has(x))) described = true;
  }
  return described ? 'described' : 'none';
}

function continues(clause: string): boolean {
  return /^\s*(and|then)\b/i.test(clause);
}

// Sentences keep their closing mark, so a question can be told from a request.
function sentences(text: string): string[] {
  return text.match(/[^.!?;\n]+[.!?;]*/g) ?? [];
}

// Clauses split on commas and "but", so "don't push, but commit it" withholds
// the push and grants the commit.
// A clause that opens with "but" contrasts with what came before, so it keeps
// its leading "but" for the caller to see and strip.
function clauses(sentence: string): string[] {
  return sentence.split(/,|\s+(?=but\s)/i);
}

const CONTRAST = /^\s*but\s+/i;

function isQuestion(sentence: string): boolean {
  const first = words(sentence)[0] ?? '';
  if (QUESTION.has(first)) return true;
  if (!sentence.trim().endsWith('?')) return false;
  return !/^\s*(can|could|would|will) (you|we)\b|^\s*(please|mind)\b/i.test(sentence);
}

// The verbs the previous answer's closing questions offered to do.
function asked(answer: string): Grant {
  const g: MutableGrant = { commit: false, push: false };
  const tail = unquote(answer.trim().split('\n').filter(Boolean).slice(-3).join('\n'));
  for (const q of sentences(tail)) {
    if (!q.trim().endsWith('?') || words(q).some((x) => HANDBACK.has(x))) continue;
    for (const c of clauses(q)) grammarGrant(c.replace(CONTRAST, ''), OFFERED, OFFER_LEAD, g);
  }
  return Object.freeze(g);
}

// Answers the user picked in the question dialog, keyed by the question: each
// is read against its own question, as a typed reply is against the last one.
// A verb any answer turns down stays down, whatever another answer grants:
// "Commit and push? Yes" beside "Push now or keep it local? Keep it local".
export function grantOfAnswers(answers: Readonly<Record<string, unknown>>): Grant {
  const granted: MutableGrant = { commit: false, push: false };
  const declined: MutableGrant = { commit: false, push: false };
  for (const [question, answer] of Object.entries(answers)) {
    if (typeof answer !== 'string') continue;
    // The dialog's own marker is not part of the answer.
    const one = grantOf(answer.replace(/\s*\(recommended\)/i, ''), question);
    const named = `${question} ${answer}`;
    for (const verb of ['commit', 'push'] as const) {
      if (one[verb]) granted[verb] = true;
      else if (new RegExp(`\\b${verb}`, 'i').test(named)) declined[verb] = true;
    }
  }
  return Object.freeze({
    commit: granted.commit && !declined.commit,
    push: granted.push && !declined.push,
  });
}

export function grantOf(prompt: string, previousAnswer = ''): Grant {
  // "No problem" and "no worries" agree; they retract nothing.
  const text = prompt.trim().replaceAll(/\bno (problem|worries)\b/gi, 'ok');
  if (AFFIRMATIVE.test(text)) return asked(previousAnswer);
  // Pasted shell sessions and quoted output are not requests.
  const typed = text
    .split('\n')
    .filter((line) => !/^\s*([$>+#]|PS\s|\w+@[\w.-]+[:$])/.test(line))
    // A list item or an emphasised label names a step; it does not ask for it.
    .filter((line) => !/^\s*(\d+[.)]|[-*•])\s|^\s*[*_]+[^*_]+[*_]+\s*$/.test(line))
    .join('\n');
  const g: MutableGrant = { commit: false, push: false };
  for (const sentence of sentences(unquote(typed))) {
    // A retraction ("no wait", "never mind") cancels what came before it.
    if (RETRACT.test(sentence)) {
      g.commit = false;
      g.push = false;
      continue;
    }
    if (isQuestion(sentence)) continue;
    // One clause that withholds withholds its whole sentence: "push it, but
    // not until CI passes" grants nothing.
    const mine: MutableGrant = { commit: false, push: false };
    let carry: Carry = 'none';
    let withheld = false;
    for (const part of clauses(sentence)) {
      const c = part.replace(CONTRAST, '');
      if (CONDITION.test(c)) return NO_GRANT;
      if (HOLD.test(c)) withheld = true;
      if (withheld) break;
      if (carry === 'described' && continues(c)) continue;
      const left = grammarGrant(c, REQUESTED, REQUEST_LEAD, mine);
      if (left === 'mood') withheld = true;
      else if (left !== 'none') carry = left;
    }
    if (!withheld) {
      g.commit ||= mine.commit;
      g.push ||= mine.push;
    }
  }
  return Object.freeze(g);
}
