// Decides whether a human prompt asks for a push. Pure.
//
// A grant needs the verb in a request the grammar below recognises: only
// request words before it ("ok, please commit", "can you push?", "I want you
// to commit") and only an object, a destination or a courtesy after it
// ("commit the changes", "push to main now"). Anything else grants nothing:
// "the commit gate", "agents would commit", "I'll push later", "commit to this
// approach", "push the button". Missing a request costs one question; reading
// one that was not made costs a push nobody asked for.
//
// A bare affirmative ("yes", "go ahead") grants what the previous answer's
// closing question offered to do.

// How far the user's message lets a push go; each level covers those before
// it.
const PUSH_LEVELS = ['none', 'push', 'lease', 'bare'] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];
export const pushRank = (level: PushLevel): number => PUSH_LEVELS.indexOf(level);

// What the user's message asked for. `push` is only what they asked to push:
// the push a pull request needs is judged by the gate, which still asks
// before a tag or default-branch push it would carry. `comment` is a reply on
// a pull request, asked for by addressing its review. `autoMerge` is a merge
// asked for once the pull request is ready ("merge it when CI passes"), which
// only `gh pr merge --auto` leaves to GitHub.
export type Grant = Readonly<{
  commit: boolean;
  push: PushLevel;
  pr: boolean;
  merge: boolean;
  autoMerge: boolean;
  approve: boolean;
  release: boolean;
  comment: boolean;
}>;

export const NO_GRANT: Grant = Object.freeze({
  commit: false,
  push: 'none',
  pr: false,
  merge: false,
  autoMerge: false,
  approve: false,
  release: false,
  comment: false,
});

// Compared by rank, so a level added between two others keeps its meaning.
export function covers(grant: Grant, level: PushLevel): boolean {
  return pushRank(grant.push) >= pushRank(level);
}

type Verb = 'commit' | 'push' | 'force' | 'pr' | 'merge' | 'approve' | 'release' | 'comment';
type MutableGrant = { -readonly [K in keyof Grant]: Grant[K] };

const fresh = (): MutableGrant => ({ ...NO_GRANT });

function raise(g: MutableGrant, level: PushLevel): void {
  if (pushRank(level) > pushRank(g.push)) g.push = level;
}

// A verb family: the word a request uses and the one an offer uses ("push",
// "pushing"), what it grants, and what may follow it.
type Family = Readonly<
  {
    forms: readonly [request: string, offer: string];
    grants: readonly Verb[];
    // What the tail must name for the verb to ask.
    object?: (tail: readonly string[]) => boolean;
  } &
    // A merge or approval names a pull request, and nothing else.
    (
      | { tail: 'pull-request'; numbered?: never; packaged?: never; from?: never }
      // A publish names a version or a registry, never git work.
      | { tail: 'publish'; numbered: true; packaged: true; from?: never }
      | {
          tail?: never;
          // A number or "on": "Release 0.25.0?", "Reply to the review on #116?".
          numbered?: true;
          // A package or registry: "release the crate", "cut a release to npm".
          packaged?: true;
          // "from" names a pull request's head; after a push it names a source.
          from?: true;
        }
    )
>;

// Replying names the review it answers, so "address the TODO comments" asks
// for nothing on GitHub.
const REVIEW = new Set(['review', 'reviews', 'reviewer', 'reviewers', 'feedback', 'pr']);
const reply = (forms: Family['forms']): Family => ({
  forms,
  grants: ['comment'],
  numbered: true,
  object: (tail) => tail.some((x) => REVIEW.has(x)),
});
const releasing = (forms: Family['forms']): Family => ({
  forms,
  grants: ['release'],
  numbered: true,
  packaged: true,
});

const FAMILIES: readonly Family[] = [
  { forms: ['commit', 'committing'], grants: ['commit'] },
  { forms: ['push', 'pushing'], grants: ['push'] },
  { forms: ['ship', 'shipping'], grants: ['commit', 'push', 'pr'] },
  // Deleting a remote branch is a push; only with "branch" last.
  { forms: ['delete', 'deleting'], grants: ['push'], object: (tail) => tail.at(-1) === 'branch' },
  // "force push" and "force-push", read as one word by `forcePhrase`.
  { forms: ['forcepush', 'forcepushing'], grants: ['push', 'force'] },
  // "open a PR", read as one word by `prPhrase`.
  { forms: ['openpr', 'openingpr'], grants: ['pr'], from: true },
  { forms: ['merge', 'merging'], grants: ['merge'], tail: 'pull-request' },
  { forms: ['approve', 'approving'], grants: ['approve'], tail: 'pull-request' },
  releasing(['release', 'releasing']),
  // "cut a release", read as one word by `prPhrase`.
  releasing(['cutrelease', 'cuttingrelease']),
  {
    forms: ['publish', 'publishing'],
    grants: ['release'],
    tail: 'publish',
    numbered: true,
    packaged: true,
  },
  // "mark it ready for review", read as one word by `prPhrase`.
  { forms: ['markready', 'markingready'], grants: ['pr'] },
  reply(['address', 'addressing']),
  reply(['reply', 'replying']),
  reply(['respond', 'responding']),
];

// Every verb form, request and offer, as a copy the table never reads.
export const VERB_FORMS: readonly string[] = FAMILIES.flatMap((f) => f.forms);

const REQUESTED: Readonly<Record<string, Family>> = Object.fromEntries(
  FAMILIES.map((f) => [f.forms[0], f]),
);
const OFFERED: Readonly<Record<string, Family>> = Object.fromEntries(
  FAMILIES.flatMap((f) => f.forms.map((form) => [form, f])),
);

// "open a PR", "create the pull request", "opening a new draft PR"; "cut a
// release", "publish the new release"; "mark it ready for review", "ready for
// review".
function prPhrase(text: string): string {
  return text
    .replaceAll(
      /\b(?:(mark)|(marking))\s+(?:(?:it|this|the|pr|pull[\s-]request|draft|#?\d+)\s+)*(?:as\s+)?ready(?:\s+for\s+review)?\b/gi,
      (_m: string, verb?: string) => (verb ? 'markready' : 'markingready'),
    )
    .replaceAll(/\bready for review\b/gi, 'markready')
    .replaceAll(
      /\b(?:(open|create|make|raise|submit)|(opening|creating|making|raising|submitting))\s+(?:(?:a|an|the|new)\s+)*(?:draft\s+)?(?:pr|pull[\s-]request)\b/gi,
      (_m: string, verb?: string) => (verb ? 'openpr' : 'openingpr'),
    )
    .replaceAll(
      /\b(?:(cut|create|make|publish|do)|(cutting|creating|making|publishing|doing))\s+(?:(?:a|an|the|new)\s+)*release\b/gi,
      (_m: string, verb?: string) => (verb ? 'cutrelease' : 'cuttingrelease'),
    );
}

// A bare --force named apart from a lease ("`--force`", "bare force push",
// "without a lease") becomes the word `nolease`, which counts only in the
// tail of a push the grammar grants. Run before quotes are read, since
// `--force` is usually backticked; "without" would make the clause conditional.
function forcePhrase(text: string): string {
  return text
    .replaceAll(/`--force`|(?<![\w-])--force(?![\w-])/g, 'nolease')
    .replaceAll(/\bbare force[\s-]?push(ing)?\b/gi, (_m: string, ing?: string) =>
      ing ? 'forcepushing nolease' : 'forcepush nolease',
    )
    .replaceAll(/\s*[,-]?\s*\bwithout (?:a |the )?lease\b/gi, ' nolease')
    .replaceAll(/\bforce[\s-]?push(ing)?\b/gi, (_m: string, ing?: string) =>
      ing ? 'forcepushing' : 'forcepush',
    );
}

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
  'we',
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
  'tag',
  'tags',
  'up',
  'to',
  'into',
  'against',
  'from',
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
  'lease',
  'nolease',
  'version',
  'review',
  'reviews',
  'reviewer',
  'reviewers',
  'feedback',
  'comments',
  'comment',
]);

// What a publish or release may also name: "publish the package to npm". Kept
// out of TAIL, so "push to npm" asks for no git push.
const PACKAGE = new Set(['package', 'packages', 'crate', 'crates', 'npm', 'registry']);
const PUBLISH_TAIL = new Set([
  'it',
  'this',
  'that',
  'them',
  'these',
  'those',
  'all',
  'of',
  'my',
  'our',
  'your',
  'me',
  'as',
  'well',
  'the',
  'a',
  'version',
  // A backticked name: "Publish `review-cycle@0.25.0`?".
  'quoted',
  'to',
  'now',
  'please',
  'thanks',
  'too',
  'again',
  'right',
  'away',
]);

// After these, only a destination: "push to main", not "commit to this approach".
const TOWARD = new Set(['to', 'into', 'against', 'from']);
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
  'review',
  'reviewer',
  'reviewers',
  'feedback',
  'comments',
]);

// A merge or approval names a pull request: "merge it", "merge the PR",
// "approve 116". A tail naming branches or a destination ("merge main into
// it") asks for a local `git merge`, which the push checks judge.
const PULL_REQUEST = new Set([
  'it',
  'this',
  'that',
  'the',
  'pr',
  'now',
  'please',
  'thanks',
  'too',
  'again',
  'right',
  'away',
]);
// A pull request first, then at most the base it goes into: "merge 116 into
// main", but not "merge main into it" or "merge this into the PR", which
// name branches to merge locally.
const BASE = new Set(['main', 'master', 'base', 'default']);
function namesPullRequest(tail: string[]): boolean {
  const into = tail.findIndex((x) => TOWARD.has(x) || x === 'on');
  const named = into === -1 ? tail : tail.slice(0, into);
  if (!named.every((x) => PULL_REQUEST.has(x) || /^\d+$/.test(x))) return false;
  if (into === -1) return true;
  const where = tail.slice(into + 1);
  const pr = named.some((x) => /^\d+$/.test(x) || x === 'pr' || x === 'it' || x === 'this');
  return (
    pr &&
    /^(into|to|against)$/.test(tail[into] ?? '') &&
    where.some((x) => BASE.has(x)) &&
    where.every((x) => BASE.has(x) || x === 'the' || x === 'branch')
  );
}

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

// A clause that only agrees: "ok", "sounds good".
const AGREE =
  /^\s*(ok|okay|alright|yes|yeah|yep|sure|great|cool|perfect|lgtm|sounds good|looks good)\s*$/i;
const AGREE_WORD = new Set([
  'ok',
  'okay',
  'alright',
  'yes',
  'yeah',
  'yep',
  'sure',
  'great',
  'cool',
  'perfect',
  'lgtm',
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

// "yes", "Ok, lets do that", "great, go ahead": a yes, a go-ahead, or both,
// and nothing more, since a longer reply may say something else. "great" or
// "looks good" alone may praise the work, so it answers only with a go-ahead.
const YES = String.raw`(?:yes|yep|yeah|yup|y|ok|okay|sure|sounds good|lgtm)`;
const AGREEMENT = String.raw`(?:${YES}|alright|great|cool|perfect|looks good)`;
const GO_AHEAD = String.raw`(?:(?:let['’]?s|let us)\s+(?:do (?:it|that|this)|go(?: ahead| for it)?)|do (?:it|that|this)|go ahead|go for it|please do)`;
const AFFIRMATIVE = new RegExp(
  String.raw`^(?:${YES}|(?:${AGREEMENT}[\s,.!]+)+${GO_AHEAD}|${GO_AHEAD})\b[\s.!,]*(please|thanks|thank you)?[\s.!]*$`,
  'i',
);

// Quoted text is a commit message or a name, never part of the request, even
// when it runs over several lines.
function unquote(text: string): string {
  return text
    .replaceAll(/(^|[\s(:=])(["'`])[\s\S]*?\2(?=$|[\s.,;:!?)])/g, '$1 quoted ')
    .replaceAll(/“[^”]*”|‘[^’]*’/g, ' quoted ');
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
function isTail(tail: string[], family: Family): boolean {
  if (family.tail === 'pull-request') return namesPullRequest(tail);
  const publish = family.tail === 'publish';
  for (const [i, word] of tail.entries()) {
    // A publish goes to or on a registry: "publish to npm", not "publish to it".
    const where = word === 'to' || word === 'on';
    const after = tail.slice(i + 1).find((x) => !/^(the|a|my|our|your)$/.test(x)) ?? '';
    if (publish && where && !PACKAGE.has(after)) return false;
    if (family.numbered && (word === 'on' || /^\d+$/.test(word))) continue;
    if (family.packaged && PACKAGE.has(word)) continue;
    // "Publish branch" is a first push in editors, so a publish names no git work.
    if (publish && !PUBLISH_TAIL.has(word)) return false;
    if (!TAIL.has(word)) return false;
    if (word === 'from' && !family.from) return false;
    const next = tail[i + 1] ?? '';
    if (TOWARD.has(word) && !DESTINATION.has(next) && !(family.packaged && PACKAGE.has(after))) {
      return false;
    }
    if ((word === 'message' || word === 'msg') && !tail.slice(0, i).includes('with')) return false;
  }
  return true;
}

// "we can push" after an agreement ("ok, we can push") answers, rather than
// describes ("CI is green, we can push").
function isLead(lead: string[], allowed: Set<string>, agreed: boolean): boolean {
  if (!lead.every((x) => allowed.has(x) || x === 'to')) return false;
  // The user's own plan unless addressed to the agent: "I want you to push".
  if (allowed === REQUEST_LEAD) {
    if (lead.some((x) => x === 'i' || x === "i'd") && !lead.includes('you')) return false;
    const we = lead.indexOf('we');
    const agreeing =
      (agreed || (we > 0 && lead.slice(0, we).every((x) => AGREE_WORD.has(x)))) &&
      /^(can|could)$/.test(lead[we + 1] ?? '');
    if (we !== -1 && !agreeing && !/^(can|could|let'?s?)$/.test(lead[we - 1] ?? '')) return false;
  }
  // "Should we push?" offers; "Do we push to main?" asks how the repo works.
  if (allowed === OFFER_LEAD) {
    const we = lead.indexOf('we');
    if (we !== -1 && !/^(should|shall)$/.test(lead[we - 1] ?? '')) return false;
  }
  return true;
}

// A condition GitHub's auto-merge waits on itself: "when it's ready", "once
// CI passes", "after the checks are green".
const READY =
  /^(?:(?:it|it's|its|this|that|(?:the )?pr|(?:the )?ci|everything|(?:(?:the|its|all) )?(?:checks|tests))(?: is| are)? )?(?:ready(?: to merge)?|green|passing|passes|pass|succeeds|succeed|goes green|go green|turns green|turn green)(?: please| thanks| now)?$/;

// "merge it when it's ready": one merge request, then a condition only
// auto-merge waits on. Anything else conditional asks for nothing.
function isReadyMerge(
  w: string[],
  verbs: Readonly<Record<string, Family>>,
  lead: Set<string>,
  agreed: boolean,
): boolean {
  const soon = w.findIndex((x, i) => x === 'as' && w[i + 1] === 'soon' && w[i + 2] === 'as');
  const k = soon === -1 ? w.findIndex((x) => SUBORDINATE.has(x)) : soon;
  const after = soon === -1 ? k + 1 : k + 3;
  if (k === -1 || (soon === -1 && !/^(when|once|after|if)$/.test(w[k] ?? ''))) return false;
  if (!READY.test(w.slice(after).join(' '))) return false;
  // "go ahead and merge it": only request words before the last "and".
  const joined = w.slice(0, k).findLastIndex((x) => x === 'and' || x === 'then');
  const before = w.slice(0, joined + 1).filter((x) => x !== 'and' && x !== 'then');
  const request = w.slice(joined + 1, k);
  const at = request.findIndex((x) => Object.hasOwn(verbs, x));
  const family = verbs[request[at] ?? ''];
  return (
    family?.forms[0] === 'merge' &&
    isLead([...before, ...request.slice(0, at)], lead, agreed) &&
    namesPullRequest(request.slice(at + 1))
  );
}

// What a clause leaves for the clauses after it in the sentence: a mood
// withholds all of them, a description those that continue it with "and" or
// "then". `ready` withholds the rest, which may wait on its condition too.
type Carry = 'none' | 'mood' | 'described' | 'ready';

// The verbs a clause asks for, reading each part joined by "and" or "then" as
// its own request: "fix the parser and commit it".
function grammarGrant(
  clause: string,
  verbs: Readonly<Record<string, Family>>,
  lead: Set<string>,
  into: MutableGrant,
  agreed = false,
): Carry {
  const w = words(clause);
  if (isReadyMerge(w, verbs, lead, agreed)) {
    into.autoMerge = true;
    return 'ready';
  }
  if (w.some((x) => SUBORDINATE.has(x))) return 'mood';
  const parts: string[][] = [[]];
  for (const word of w) {
    if (word === 'and' || word === 'then') parts.push([]);
    else parts.at(-1)?.push(word);
  }
  let described = false;
  for (const part of parts) {
    const at = part.findIndex((x) => Object.hasOwn(verbs, x));
    const family = verbs[part[at] ?? ''];
    const tail = part.slice(at + 1);
    const asks =
      family !== undefined &&
      !described &&
      isLead(part.slice(0, at), lead, agreed) &&
      isTail(tail, family) &&
      (family.object?.(tail) ?? true);
    if (asks) {
      const granted = family.grants;
      if (granted.includes('commit')) into.commit = true;
      if (granted.includes('push')) raise(into, 'push');
      if (granted.includes('force')) raise(into, 'lease');
      if (granted.includes('pr')) into.pr = true;
      if (granted.includes('merge')) into.merge = true;
      if (granted.includes('approve')) into.approve = true;
      if (granted.includes('release')) into.release = true;
      if (granted.includes('comment')) into.comment = true;
      // "push it with `--force`", "force push it without a lease"; not a
      // `--force` given as the commit message.
      const bare = tail.indexOf('nolease');
      const message = tail.findIndex((x) => x === 'message' || x === 'msg');
      if (bare !== -1 && (message === -1 || message > bare) && granted.includes('push')) {
        raise(into, 'bare');
      }
    }
    const opening = part.find((x) => !lead.has(x));
    if (opening !== undefined && MOOD.test(opening)) return 'mood';
    if (opening !== undefined && DESCRIBES.has(opening) && opening === part[0]) described = true;
    // A part shaped as a request is not a description, even when its tail
    // is not one the grammar reads: "I want you to commit separately and push".
    const requestShaped = at !== -1 && isLead(part.slice(0, at), lead, agreed);
    if (!requestShaped && part.some((x) => STATEMENT.has(x))) described = true;
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

function settled(g: MutableGrant): Grant {
  return Object.freeze({ ...g });
}

// Each step a grant can name besides the push level.
const STEPS = ['commit', 'pr', 'merge', 'autoMerge', 'approve', 'release', 'comment'] as const;

function merged(into: MutableGrant, from: MutableGrant): void {
  for (const step of STEPS) into[step] ||= from[step];
  raise(into, from.push);
}

// Any step beyond the push the grant names.
function asksBeyondPush(g: Grant): boolean {
  return g.pr || g.merge || g.autoMerge || g.approve || g.release || g.comment;
}

// The verbs the previous answer's closing questions offered to do.
function asked(answer: string): Grant {
  const g = fresh();
  // A semicolon before "then" or "and" joins clauses as a comma does: "Do we commit; then push?".
  // Elsewhere it ends a sentence: "I'll leave the docs alone; should I push?".
  // A name the offer gives, as in "Push fix/x to `origin`?", reads as "it": an
  // object or destination a push may take, but not the branch a delete needs.
  // Only here, in the agent's offer: a user's "push it to `later`" defers. A
  // ref ends on a word character, so a sentence's closing period stays, and
  // one joining hand-back words ("rather/prefer") stays words.
  const named = forcePhrase(answer.trim().split('\n').filter(Boolean).slice(-3).join('\n'))
    // A backticked hand-back stays a word: "or would you `rather` do it?".
    .replaceAll(/`([\w./-]+)`/g, (_m: string, name: string) =>
      words(name).some((x) => HANDBACK.has(x)) ? name.replaceAll('/', ' ') : 'it',
    );
  const tail = prPhrase(unquote(named))
    .replaceAll(/[\w.-]+\/[\w./-]*[\w-]/g, (m) =>
      words(m).some((x) => HANDBACK.has(x)) ? m.replaceAll('/', ' ') : 'it',
    )
    .replaceAll(/;(?=\s*(and|then)\b)/gi, ',');
  for (const q of sentences(tail)) {
    if (!q.trim().endsWith('?') || words(q).some((x) => HANDBACK.has(x))) continue;
    // "Do we commit, then push?" asks how work goes; its "then push" offers nothing.
    let carry: Carry = 'none';
    for (const part of clauses(q)) {
      const c = part.replace(CONTRAST, '');
      if (carry !== 'none' && continues(c)) continue;
      const left = grammarGrant(c, OFFERED, OFFER_LEAD, g);
      // "Should I fix it, then push?" offers the push; only a commit or push clause carries.
      if (left !== 'none' && words(c).some((x) => Object.hasOwn(OFFERED, x))) carry = left;
    }
  }
  return settled(g);
}

const PUSH_WORD =
  /\b(push|pushes|pushing|pushed|ship|ships|shipping|shipped|forcepush|forcepushing)\b/i;
const PR_WORD = /\b(openpr|openingpr|markready|markingready)\b/i;
const MERGE_WORD = /\b(merge|merges|merging|merged)\b/i;
const APPROVE_WORD = /\b(approve|approves|approving|approved)\b/i;
const RELEASE_WORD =
  /\b(release|releases|releasing|released|cutrelease|cuttingrelease|publish|publishes|publishing|published)\b/i;

// A step mentioned without being asked for holds every step but a commit, read
// by mention rather than grammar since a hold only makes the agent ask.
export function holdsOf(prompt: string, previousAnswer = ''): boolean {
  const grant = grantOf(prompt, previousAnswer);
  const text = prPhrase(unquote(forcePhrase(prompt)));
  if (PUSH_WORD.test(text) && !covers(grant, 'push')) return true;
  if (PR_WORD.test(text) && !grant.pr) return true;
  if (MERGE_WORD.test(text) && !grant.merge && !grant.autoMerge) return true;
  if (APPROVE_WORD.test(text) && !grant.approve) return true;
  if (RELEASE_WORD.test(text) && !grant.release) return true;
  const offered = asked(previousAnswer);
  return (
    HOLD.test(text) &&
    !covers(grant, 'push') &&
    !asksBeyondPush(grant) &&
    (covers(offered, 'push') || asksBeyondPush(offered))
  );
}

// Whether a message asks for a step on the way out: a push, a pull request, a
// merge or a release. An approval or a reply asks for none of them.
export function liftsHold(grant: Grant): boolean {
  return covers(grant, 'push') || grant.pr || grant.merge || grant.autoMerge || grant.release;
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
  let g = fresh();
  // What the previous sentence left: "we commit; then push" describes across
  // the semicolon as "we commit, then push" does across the comma.
  let prev: Carry = 'none';
  for (const sentence of sentences(prPhrase(unquote(forcePhrase(typed))))) {
    // A retraction ("no wait", "never mind") cancels what came before it.
    if (RETRACT.test(sentence)) {
      g = fresh();
      prev = 'none';
      continue;
    }
    if (isQuestion(sentence)) {
      prev = 'none';
      continue;
    }
    if (prev !== 'none' && continues(sentence)) {
      if (!sentence.trim().endsWith(';')) prev = 'none';
      continue;
    }
    // One clause that withholds withholds its whole sentence: "push it, but
    // not until CI passes" grants nothing.
    const mine = fresh();
    let carry: Carry = 'none';
    let withheld = false;
    let agreed = false;
    for (const part of clauses(sentence)) {
      const c = part.replace(CONTRAST, '');
      if (CONDITION.test(c)) return NO_GRANT;
      if (HOLD.test(c)) withheld = true;
      if (withheld) break;
      if (carry === 'described' && continues(c)) continue;
      // After a ready-merge a clause can still withhold, but grants nothing.
      const into = carry === 'ready' ? fresh() : mine;
      const left = grammarGrant(c, REQUESTED, REQUEST_LEAD, into, agreed);
      agreed = AGREE.test(c);
      if (left === 'mood') withheld = true;
      else if (left !== 'none' && carry !== 'ready') carry = left;
    }
    if (!withheld) merged(g, mine);
    // Only a semicolon ties two sentences together, and only around the verbs:
    // "I fixed it. Then push it." asks.
    const tied =
      sentence.trim().endsWith(';') && words(sentence).some((x) => Object.hasOwn(REQUESTED, x));
    prev = tied ? (withheld ? 'mood' : carry) : 'none';
  }
  return settled(g);
}
