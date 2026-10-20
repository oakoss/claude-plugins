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

import type { Finishes } from './git-args';

// How far the user's message lets a push go; each level covers those before
// it.
const PUSH_LEVELS = ['none', 'push', 'lease', 'bare'] as const;
export type PushLevel = (typeof PUSH_LEVELS)[number];
export const pushRank = (level: PushLevel): number => PUSH_LEVELS.indexOf(level);

// What the user's message asked for. `push` is only what they asked to push:
// the push a pull request needs is judged by the gate, which still asks
// before a tag or default-branch push it would carry. `pushNamed` holds where
// a push request or the offer it answered said the push goes: a branch, a
// tag as `tag:<name>`, or `tag:*` for any. `comment` is a reply on
// a pull request, asked for by addressing its review. `autoMerge` is a merge
// asked for once the pull request is ready ("merge it when CI passes"), which
// only `gh pr merge --auto` leaves to GitHub. `mergeNamed` holds the pull
// request numbers a merge request named ("merge 131"), empty for "merge it";
// `readyNamed` those a merge asked for once ready named, kept apart so they
// never cover a merge now. `mergeStack` holds the gh-stack merges a request
// named, which cover `gh stack merge` alone: `stack` for the whole stack,
// `stack:<n>` for stack <n>, `upto:<n>` for the layers up to pull request <n>.
// `finish` holds the history commands a request to finish named ("finish the
// rebase"): a commit of that command's `--continue` only.
export type Grant = Readonly<{
  commit: boolean;
  finish: readonly Finishes[];
  push: PushLevel;
  pushNamed: readonly string[];
  pr: boolean;
  merge: boolean;
  mergeNamed: readonly string[];
  autoMerge: boolean;
  readyNamed: readonly string[];
  mergeStack: readonly string[];
  approve: boolean;
  release: boolean;
  comment: boolean;
}>;

export const NO_GRANT: Grant = Object.freeze({
  commit: false,
  finish: [],
  push: 'none',
  pushNamed: [],
  pr: false,
  merge: false,
  mergeNamed: [],
  autoMerge: false,
  readyNamed: [],
  mergeStack: [],
  approve: false,
  release: false,
  comment: false,
});

// Compared by rank, so a level added between two others keeps its meaning.
export function covers(grant: Grant, level: PushLevel): boolean {
  return pushRank(grant.push) >= pushRank(level);
}

type Verb =
  | 'commit'
  | 'finish'
  | 'push'
  | 'force'
  | 'pr'
  | 'merge'
  | 'approve'
  | 'release'
  | 'comment';
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
      | { tail: 'pull-request'; numbered?: never; packaged?: never; from?: never; on?: never }
      // A publish names a version or a registry, never git work.
      | { tail: 'publish'; numbered: true; packaged: true; from?: never; on?: never }
      | {
          tail?: never;
          // A number or "on": "Release 0.25.0?", "Reply to the review on #116?".
          numbered?: true;
          // A package or registry: "release the crate", "cut a release to npm".
          packaged?: true;
          // "from" names a pull request's head; after a push it names a source.
          from?: true;
          // "on" and no number: "finish the rebase on `fix/x`".
          on?: true;
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

// The operation `prPhrase` reads, its -ing form stripped: "rebasing" is "rebas".
const OPERATION: Readonly<Record<string, string>> = {
  rebase: 'rebase',
  rebas: 'rebase',
  cherrypick: 'cherrypick',
  revert: 'revert',
};

// "finish the rebase", read as one word by `prPhrase`.
const FINISHED: Readonly<Record<string, Finishes>> = {
  finishmerge: 'merge',
  finishcherrypick: 'cherry-pick',
  finishrevert: 'revert',
  finishrebase: 'rebase',
};
// An offer to "finish the rebase on `fix/x`" reads its branch as "on it".
const finishing = (op: string): Family => ({
  forms: [`finish${op}`, `finishing${op}`],
  grants: ['finish'],
  on: true,
});

const FAMILIES: readonly Family[] = [
  { forms: ['commit', 'committing'], grants: ['commit'] },
  ...['merge', 'cherrypick', 'revert', 'rebase'].map((op) => finishing(op)),
  { forms: ['push', 'pushing'], grants: ['push'] },
  { forms: ['ship', 'shipping'], grants: ['commit', 'push', 'pr'] },
  // Deleting a remote branch is a push: the branch is what goes, so "delete it
  // from the branch" (a commit) and "delete the branch comments" ask for none.
  {
    forms: ['delete', 'deleting'],
    grants: ['push'],
    object: (tail) => {
      const at = tail.lastIndexOf('branch');
      if (at === -1 || tail.slice(0, at).some((x) => TOWARD.has(x))) return false;
      const rest = tail.slice(at + 1).filter((x) => !COURTESY.has(x));
      const [toward, ...where] = rest;
      return toward === undefined || (TOWARD.has(toward) && where.every((x) => REMOTE.has(x)));
    },
    from: true,
  },
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
  return (
    text
      // A history command's `--continue` ("carry on rebasing").
      .replaceAll(
        /\b(?:(finish|continue|complete|resume|carry\s+on)|(finishing|continuing|completing|resuming|carrying\s+on))\s+(?:up\s+)?(?:with\s+)?(?:(?:the|this|that|our)\s+)?(?:current\s+)?(rebas(?:e|ing)|cherry[\s-]?pick(?:ing)?|revert(?:ing)?)\b/gi,
        (_m: string, verb: string | undefined, _ing: string | undefined, op: string) =>
          `${verb ? 'finish' : 'finishing'}${OPERATION[op.toLowerCase().replaceAll(/[\s-]|ing$/g, '')]}`,
      )
      // Only the plainest forms of a merge's: "continue merging" or "resume the
      // merge of #12" usually means pull requests, and must keep their hold.
      .replaceAll(
        /\b(?:(finish|continue|complete)|(finishing|continuing|completing))\s+(?:(?:the|this|that|our)\s+)?(?:current\s+)?merge\b/gi,
        (_m: string, verb?: string) => (verb ? 'finishmerge' : 'finishingmerge'),
      )
      // GitHub's merge methods merge: "squash-merge #12", "squash and merge it".
      .replaceAll(/\b(?:squash|rebase)(?:-|\s+(?:and\s+)?)(merg(?:e|ing))\b/gi, '$1')
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
      )
      // Merging the version pull request is the release, but only where the noun
      // ends the clause: "merge the release fixes" names other work.
      .replaceAll(
        /\b(?:(merge)|(merging))\s+(?:(?:the|this|that|our|new)\s+)*(?:release|version(?:[\s-]packages|\s+v?\d+(?:\.\d+)*)?)(?:\s+(?:pr|pull[\s-]request))?(?:\s+#?\d+)?(?=\s*(?:$|[.,;:!?)](?!\d))|(?:\s+(?:now|please|thanks|again|then|and|too|yet|first|next)\b)+(?!\s+(?:now|please|thanks|again|then|and|too|yet|first|next|into|to|against|onto)\b))/gi,
        (_m: string, verb?: string) => (verb ? 'cutrelease' : 'cuttingrelease'),
      )
      // Publishing git work pushes it ("publish the branch", editors' first
      // push), publishing a pull request is the PR step, and pushing a package
      // publishes it ("push to npm"): only when the whole rest of the clause
      // says so, so "publish the changes as a comment" is no push.
      .replaceAll(
        /\b(publish|publishing|push|pushing)\b(?=([^\n]*))/gi,
        (m: string, verb: string, rest: string) => {
          const said = words(clauseOf(rest))
            .filter((x) => !COURTESY.has(x) && x !== 'first')
            .join(' ');
          const ing = /ing$/i.test(verb);
          if (/^publish/i.test(verb)) {
            if (GIT_PUBLISH.test(said)) return ing ? 'pushing' : 'push';
            if (PR_PUBLISH.test(said)) return ing ? 'openingpr' : 'openpr';
          } else if (PACKAGE_PUSH.test(said)) return ing ? 'publishing' : 'publish';
          return m;
        },
      )
  );
}

const GIT_PUBLISH =
  /^(?:(?:the|this|that|my|our) )?(?:branch|changes|commits)(?: to (?:github|origin))?$|^to (?:github|origin)$/;
const PR_PUBLISH =
  /^(?:(?:the|this|that|my|our|a) )?(?:pr|pull request|pull-request)(?: to github)?$/;
const PACKAGE_PUSH =
  /^(?:(?:the|this|that|my|our) )?(?:package|packages|crate|crates)$|^(?:it )?to (?:npm|crates|the registry)$/;

// The rest of a clause: up to its punctuation, or the "and", "then" or "but"
// that starts the next part. A period inside a word ("changes.md") is the word's.
function clauseOf(rest: string): string {
  return rest.split(/[!?;,:\n]|\.(?![a-z0-9])|\b(?:and|then|but)\b/i)[0] ?? '';
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
  'stack',
  'whole',
  'entire',
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
  'as-is',
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

const STACKED = new Set(['stack', 'whole', 'entire']);

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
const COURTESY = new Set(['now', 'please', 'thanks', 'too', 'again']);
// Where a deleted branch goes from.
const REMOTE = new Set(['origin', 'upstream', 'remote', 'github', 'the']);
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
// main" or "merge into main", but not "merge main into it" or "merge this
// into the PR", which name branches to merge locally.
const BASE = new Set(['main', 'master', 'base', 'default']);
function namesPullRequest(tail: string[]): boolean {
  const into = tail.findIndex((x) => TOWARD.has(x) || x === 'on');
  const named = into === -1 ? tail : tail.slice(0, into);
  if (!named.every((x) => PULL_REQUEST.has(x) || /^\d+$/.test(x))) return false;
  if (into === -1) return true;
  const where = tail.slice(into + 1);
  const pr =
    named.every((x) => COURTESY.has(x)) ||
    named.some((x) => /^\d+$/.test(x) || x === 'pr' || x === 'it' || x === 'this');
  return (
    pr &&
    /^(into|to|against)$/.test(tail[into] ?? '') &&
    where.some((x) => BASE.has(x)) &&
    where.every((x) => BASE.has(x) || x === 'the' || x === 'branch' || COURTESY.has(x))
  );
}

// Opening a part joined by "and" or "then", these carry over to the parts
// after it: "I didn't ask you to review and commit", "they review then commit".
// A SUBORDINATE word withholds its clause before any part is read.
const MOOD =
  /^(don'?t|not|never|no|didn'?t|won'?t|can'?t|cannot|shouldn'?t|wouldn'?t|doesn'?t|i'll|i'm|i've|we'll|we're|they|he|she|agents?|claude|who|which|might|should)$/;

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
// In a request only: an offer that names one still names its step for a decline to hold.
const PROVISO = / (?:provided|assuming|as long as) /;

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
const STOP = /^\s*(stop|cancel|abort|halt)\b/i;
// Words that open a sentence ahead of what it says: "ok, wait", "please stop".
const FILLER = /^(\s*(ok|okay|oh|hmm|actually|please|um|uh)\b[\s,.!]*)+/i;
// "oh wait", "sorry, never mind": a filler word may open the retraction.
const RETRACT =
  /^\s*(?:(?:ok|okay|please|oh|sorry|hmm|um|uh|actually)\b[\s,]*)*(no|nope|wait|never ?mind|scratch that|hold on|actually,? (no|don['’]?t))\b/i;
const BARE_RETRACT =
  /^(?:\s*(?:ok|okay|please|oh|sorry|hmm|um|uh)\b[\s,]*)*(?:\s*(?:no|nope|wait|never ?mind|scratch that|hold on|actually|don['’]?t)\b[\s,.!;:…—-]*)+$/i;

// "No problem" and "no worries" agree, and retract nothing; an "nvm" that stands
// alone is "never mind", while "nvm use 20" runs the Node version manager.
function spoken(text: string): string {
  return text
    .replaceAll(/\bno (problem|worries)\b/gi, 'ok')
    .replaceAll(/(?<![\w./~-])nvm\b(?=\s*(?:[,.!?;:…](?!\w)|$))/gim, 'never mind');
}
const DECLINED =
  /^\s*(?:(?:ok|okay|yes|yeah|sure|alright|great|cool|perfect)[\s,]+)*(?:do\s+not|don['’]?t|never)\s+merge\b/i;
// Opening any clause of a typed sentence, these make the whole prompt conditional.
const CLAUSE_CONDITION = /^\s*(if|when|once|after|unless|until|as soon as)\b/i;
// These do only where they open the sentence ("Only if CI passes."): later in
// one ("force push it, but not until CI passes") they withhold that sentence alone.
const SENTENCE_CONDITION =
  /^\s*(?:(?:and|then|but)\s+)*(?:only\s+)?(?:if|when|once|after|unless|until|as soon as|provided|assuming|as long as|not (?:before|until))\b/i;
// Anywhere in an offer's question or after it, a condition a yes does not meet.
const OFFER_CONDITION =
  /\b(?:if|when|whenever|once|until|unless|after|before|provided|assuming|as long as|as soon as)\b/i;
// A condition the yes itself meets: "If that looks right", "When you're ready", "If you're happy with it".
// Not "when it's ready" or "once that works", which wait on the work.
const APPROVAL =
  /\b(?:(?:if|when|once|assuming|provided|as long as)\s+(?:so|yes|you(?:['’](?:re|d)|\s+are)?\s+(?:ready|happy|ok|okay|fine|agree|approve|want|like))|(?:if|assuming|provided|as long as)\s+(?:that|it|this|everything)(?:['’]s|\s+is)?\s+(?:ok|okay|fine|good|right|looks?\s+(?:good|right|ok|okay|fine)|sounds?\s+(?:good|right|ok|okay|fine)|works?\s+for\s+you))(?:\s+(?:with|for|to)\s+(?:it|that|this|you|them))?(?=\s*(?:[,.?!;]|$))(?![\s,]*(?:and|or|but)\b)/gi;
// "merge #168 when CI passes" asks for a merge once ready, which waits on the condition itself.
const READY_MERGE =
  /(\bmerge\b[^,;?.!]*?)\s(?:when|once|after|if|as soon as)\s+(?:(?:it|it['’]s|its|this|that|(?:the\s+)?pr(?:\s+#?\d+)?|#\d+|(?:the\s+)?ci|everything|(?:(?:the|its|all)\s+)?(?:checks|tests))(?:\s+(?:is|are))?\s+)?(?:ready(?:\s+to\s+merge)?|green|passing|passes|pass|succeeds|succeed|goes\s+green|turns\s+green)\b(?![\s,]*(?:and|or|but)\b)/gi;
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
// "ok continue", "keep going": a yes only to an offer to finish an operation.
// Anywhere else "continue" means keep working, so it grants nothing.
const CONTINUE_REPLY = new RegExp(
  String.raw`^(?:${AGREEMENT}[\s,.!]+)*(?:continue|go on|carry on|keep going)\b[\s.!,]*(please|thanks|thank you)?[\s.!]*$`,
  'i',
);

// Quoted text is a commit message or a name, never part of the request, even
// when it runs over several lines.
function unquote(text: string): string {
  return text
    .replaceAll(/(^|[\s(:=])(["'`])[\s\S]*?\2(?=$|[\s.,;:!?)])/g, '$1 quoted ')
    .replaceAll(/“[^”]*”|‘[^’]*’/g, ' quoted ');
}

// A period inside a word stays in it, so "130.5" names no pull request and
// "changes.md" is a file.
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[’‘]/g, "'")
    .split(/(?:[^a-z0-9'.-]|(?<![a-z0-9])\.|\.(?![a-z0-9]))+/)
    .filter(Boolean);
}

// "commit it", "push to main now": nothing but tail words, with "to" naming a
// destination and a message only in "with a message". A request's closing
// "first" orders the step ("merge 168 first"); an offer's stays, since offers
// do not yet read every condition (cpl-pakf).
function isTail(words: string[], family: Family, requested: boolean): boolean {
  const at = requested ? words.lastIndexOf('first') : -1;
  const closing =
    at !== -1 && words[at - 1] !== 'the' && words.slice(at + 1).every((x) => COURTESY.has(x));
  const tail = closing ? words.toSpliced(at, 1) : words;
  if (family.tail === 'pull-request') return namesPullRequest(tail);
  const publish = family.tail === 'publish';
  const tagged = tail.includes('tag') || tail.includes('tags');
  for (const [i, word] of tail.entries()) {
    // A tag's version: "push the v1 tag", "push tag 0.2.0".
    if (tagged && /^v?\d+(?:\.\d+)*$/.test(word)) continue;
    // A publish goes to or on a registry: "publish to npm", not "publish to it".
    const where = word === 'to' || word === 'on';
    const after = tail.slice(i + 1).find((x) => !/^(the|a|my|our|your)$/.test(x)) ?? '';
    if (publish && where && !PACKAGE.has(after)) return false;
    if (family.numbered && (word === 'on' || /^\d+$/.test(word))) continue;
    if (family.on && word === 'on') continue;
    if (family.packaged && PACKAGE.has(word)) continue;
    // "Publish branch" is a first push in editors, so a publish names no git work.
    if (publish && !PUBLISH_TAIL.has(word)) return false;
    // "ship it as is": unchanged, not a description.
    if (word === 'is' && tail[i - 1] === 'as') continue;
    if (!TAIL.has(word)) return false;
    // "push the stack", "ship the whole stack": no other verb's object.
    if (STACKED.has(word) && !family.grants.some((g) => g === 'push' || g === 'force')) {
      return false;
    }
    if (word === 'from' && !family.from) return false;
    const next = tail[i + 1] ?? '';
    if (TOWARD.has(word) && !DESTINATION.has(next) && !(family.packaged && PACKAGE.has(after))) {
      return false;
    }
    if ((word === 'message' || word === 'msg') && !tail.slice(0, i).includes('with')) return false;
  }
  return true;
}

// "we can push" after an agreement ("ok, we can push") or as the whole message
// ("We can merge 91") answers, rather than describes ("CI is green, we can
// push"); a "we could" message only weighs an option.
function isLead(lead: string[], allowed: Set<string>, agreed: boolean, opens = false): boolean {
  if (!lead.every((x) => allowed.has(x) || x === 'to')) return false;
  // The user's own plan unless addressed to the agent: "I want you to push".
  if (allowed === REQUEST_LEAD) {
    if (lead.some((x) => x === 'i' || x === "i'd") && !lead.includes('you')) return false;
    const we = lead.indexOf('we');
    const agreeing =
      (opens && we === 0 && lead[1] === 'can') ||
      ((agreed || (we > 0 && lead.slice(0, we).every((x) => AGREE_WORD.has(x)))) &&
        /^(can|could)$/.test(lead[we + 1] ?? ''));
    if (we !== -1 && !agreeing && !/^(can|could|let'?s?)$/.test(lead[we - 1] ?? '')) return false;
  }
  // "Should we push?" offers; other "we" questions only as HOW_WE's whole sentences.
  if (allowed === OFFER_LEAD) {
    const we = lead.indexOf('we');
    if (we !== -1 && !/^(should|shall)$/.test(lead[we - 1] ?? '')) return false;
  }
  return true;
}

// A question about how a commit or push goes, which a yes agrees to: only these
// whole sentences ("Do we commit, then push?", "Can we push to main?").
const HOW_WE =
  /^\s*(?:(?:do|can)\s+)?we\s+(?:(commit)(?:\s+it)?(?:\s*,?\s*(?:and\s+then|and|then)\s+(push)(?:\s+it)?)?|(push)(?:\s+(?:it|[\w.-]+\/[\w./-]*[\w-]))?(?:\s+to\s+(?:main|master|origin))?)\s*\?\s*$/i;

// A condition GitHub's auto-merge waits on itself: "when it's ready", "once
// CI passes", "after the checks are green".
const READY =
  /^(?:(?:it|it's|its|this|that|(?:the )?pr(?: \d+)?|(?:the )?ci|everything|(?:(?:the|its|all) )?(?:checks|tests))(?: is| are)? )?(?:ready(?: to merge)?|green|passing|passes|pass|succeeds|succeed|goes green|go green|turns green|turn green)(?: please| thanks| now)?$/;

const asSoonAs = (w: readonly string[]): number =>
  w.findIndex((x, i) => x === 'as' && w[i + 1] === 'soon' && w[i + 2] === 'as');

// "merge it when it's ready": one merge request, then a condition only
// auto-merge waits on. Anything else conditional asks for nothing.
function isReadyMerge(
  w: string[],
  verbs: Readonly<Record<string, Family>>,
  lead: Set<string>,
  agreed: boolean,
  opens: boolean,
): boolean {
  const soon = asSoonAs(w);
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
    isLead([...before, ...request.slice(0, at)], lead, agreed, opens) &&
    namesPullRequest(request.slice(at + 1)) &&
    samePullRequest(w.slice(after).join(' '), request.join(' '))
  );
}

// "once it's ready, merge it" read as "merge it once it's ready", the form
// isReadyMerge knows; null unless a readiness condition leads into a merge.
function leadingReady(sentence: string): string | null {
  const lead =
    /^(\s*(?:(?:ok|okay|yes|yeah|sure|alright|great|cool|perfect)[\s,]+)*)(when|once|after|if|as soon as)\s+(.*?)([.!?;]*)$/is.exec(
      sentence,
    );
  if (lead === null) return null;
  const [, agreed = '', when = '', rest = '', end = ''] = lead;
  const tokens = rest.split(/\s+/);
  // The longest condition: "it is ready to merge, merge it" waits on all of it.
  for (let i = tokens.length; i >= 1; i--) {
    const condition = tokens.slice(0, i).join(' ').replace(/,$/, '');
    if (!READY.test(words(condition).join(' '))) continue;
    const request = tokens
      .slice(i)
      .join(' ')
      .replace(/^then\s+/i, '');
    if (!MERGE_WORD.test(request) || !samePullRequest(condition, request)) return null;
    return `${agreed}${request} ${when} ${condition}${end}`;
  }
  return null;
}

// "merge 134 once PR 133 is ready" waits on #133, which `--auto` on #134
// never does, so a condition naming a pull request names the one merged.
function samePullRequest(condition: string, request: string): boolean {
  const waits = /\bpr\s+#?(\d+)\b/i.exec(condition)?.[1];
  const merges = /#?\b(\d+)\b/.exec(request)?.[1];
  return waits === undefined || merges === undefined || waits === merges;
}

// Only a merge once it is ready: anything else the sentence asks for may wait
// on the same condition.
function onlyAutoMerge(g: MutableGrant): boolean {
  return (
    g.autoMerge &&
    g.push === 'none' &&
    g.finish.length === 0 &&
    g.mergeStack.length === 0 &&
    STEPS.every((s) => s === 'autoMerge' || !g[s])
  );
}

// Where a push goes is named only by a whole sentence of one exact form, so no
// clause around it can reject, qualify or redirect the name.
const TICK = '`';
const NAME = `${TICK}?([^${TICK}\\s]+?)${TICK}?`;
const LEAD = String.raw`(?:(?:ok(?:ay)?|yes|yeah|sure|great|please|let'?s|go ahead and)[\s,]+)*`;
const TAIL_WORDS = String.raw`(?:\s+(?:now|please|without a lease))*`;
// "push to main", "push it to origin main", "push the main branch", "push main
// to origin", "force push main".
const TYPED_BRANCH = new RegExp(
  String.raw`^${LEAD}(?:force\s+)?push(?:\s+(?:it|this))?(?:\s+to)?(?:\s+origin)?(?:\s+the)?\s+${TICK}?(main|master)${TICK}?(?:\s+branch)?(?:\s+to\s+origin)?${TAIL_WORDS}$`,
  'i',
);
// "push the tag", "push the tags", "push the v1.2.0 tag", "push tag 0.2.0".
const TYPED_TAG = new RegExp(
  String.raw`^${LEAD}push\s+(?:the\s+)?(?:(tags?)|${NAME}\s+tags?|tags?\s+${NAME})${TAIL_WORDS}$`,
  'i',
);
// The offers a refusal suggests: "Push to `develop`?", "Push the `v1.2.0` tag?".
const OFFERED_BRANCH = new RegExp(
  String.raw`^push(?: it)? to ${TICK}([^${TICK}\s]+)${TICK}\?$`,
  'i',
);
const OFFERED_TAG = new RegExp(String.raw`^push the ${TICK}([^${TICK}\s]+)${TICK} tag\?$`, 'i');

// Names count only when every sentence of the message is one of the exact
// forms (or thanks), so a retraction, a quote or anything else beside them
// names nothing.
function typedTargets(typed: string): string[] {
  const named: string[] = [];
  for (const raw of sentences(typed)) {
    const s = raw.trim().replace(/[.!;]+$/, '');
    if (s === '' || /^(?:thanks|thank you|ty)$/i.test(s)) continue;
    const branch = TYPED_BRANCH.exec(s);
    const tag = TYPED_TAG.exec(s);
    if (branch) named.push((branch[1] ?? '').toLowerCase());
    else if (tag) {
      named.push(tag[1] === undefined ? `tag:${(tag[2] ?? tag[3] ?? '').toLowerCase()}` : 'tag:*');
    } else return [];
  }
  return named;
}

// The answer's last paragraph, whole, in the wording a refusal suggests:
// nothing before it in the paragraph, and nothing after it.
function offeredTargets(answer: string): string[] {
  const asked =
    answer
      .trim()
      .split(/\n[ \t]*\n/)
      .at(-1)
      ?.trim() ?? '';
  const branch = OFFERED_BRANCH.exec(asked);
  if (branch) return [(branch[1] ?? '').toLowerCase()];
  const tag = OFFERED_TAG.exec(asked);
  return tag ? [`tag:${(tag[1] ?? '').toLowerCase()}`] : [];
}

// What a clause leaves for the clauses after it in the sentence: a mood
// withholds all of them, a description those that continue it with "and" or
// "then". `ready` withholds the rest, which may wait on its condition too.
type Carry = 'none' | 'mood' | 'described' | 'ready';

// Where "we can <step>" may ask: as the whole message, or as the last part of a
// SUGGESTS message when it merges a named pull request, read as "let's leave it
// and merge 47" is.
type Opens = 'none' | 'alone' | 'chained';
const SUGGESTS = /^(lets|let's|just)$/;

const MEANS_NOW =
  / (?:(?:when|once|after) (?:you are|you're) (?:done|finished)(?: with (?:it|that|this|them))?|(?:when|whenever) (?:you|we) can|as soon as (?:you can|we can|possible)|before (?:the )?(?:checks|ci|tests) (?:pass|passes|finish|finishes|complete|completes))$/;

// Never in an offer, where "you" is the user. Outside its own request's part,
// or after punctuation, it may lead the next request ("push it -- when you are
// done, merge it").
function withoutNow(
  w: string[],
  verbs: Readonly<Record<string, Family>>,
  clause: string,
): string[] {
  const now = MEANS_NOW.exec(` ${w.join(' ')}`);
  if (now === null || !/^[\w\s'’#]*$/.test(clause.trim().replace(/[.!?;]+$/, ''))) return w;
  const rest = w.slice(0, w.length - now[0].trim().split(' ').length);
  const part = rest.slice(rest.findLastIndex((x) => x === 'and' || x === 'then') + 1);
  const at = part.findIndex((x) => Object.hasOwn(verbs, x));
  const asks =
    at !== -1 &&
    isLead(part.slice(0, at), REQUEST_LEAD, false) &&
    !rest.some((x) => SUBORDINATE.has(x)) &&
    asSoonAs(rest) === -1;
  return asks ? rest : w;
}

// The verbs a clause asks for, reading each part joined by "and" or "then" as
// its own request: "fix the parser and commit it".
function grammarGrant(
  clause: string,
  verbs: Readonly<Record<string, Family>>,
  lead: Set<string>,
  into: MutableGrant,
  agreed = false,
  heard?: Set<Family>,
  now = false,
  // Set when the clause's last part is a merge, so numbers after it name more.
  ends?: { merging: boolean },
  opens: Opens = 'none',
): Carry {
  const w = now ? withoutNow(words(clause), verbs, clause) : words(clause);
  if (isReadyMerge(w, verbs, lead, agreed, opens === 'alone')) {
    into.autoMerge = true;
    into.readyNamed = [...new Set([...into.readyNamed, ...w.filter((x) => /^\d+$/.test(x))])];
    return 'ready';
  }
  if (
    w.some((x) => SUBORDINATE.has(x)) ||
    asSoonAs(w) !== -1 ||
    (verbs === REQUESTED && PROVISO.test(` ${w.join(' ')} `))
  ) {
    return 'mood';
  }
  const parts: string[][] = [[]];
  for (const word of w) {
    if (word === 'and' || word === 'then') parts.push([]);
    else parts.at(-1)?.push(word);
  }
  let described = false;
  let merging = false;
  for (const [i, part] of parts.entries()) {
    // "merge 131 and 130": a list of numbers after a merge names them too.
    if (merging && part.every((x) => /^\d+$/.test(x) || x === 'pr')) {
      into.mergeNamed = [...into.mergeNamed, ...part.filter((x) => /^\d+$/.test(x))];
      continue;
    }
    merging = false;
    const at = part.findIndex((x) => Object.hasOwn(verbs, x));
    const family = verbs[part[at] ?? ''];
    const tail = part.slice(at + 1);
    const stack = family?.grants.includes('merge') ? stackMergeOf(tail) : null;
    const open =
      opens === 'alone' ||
      (opens === 'chained' &&
        i === parts.length - 1 &&
        family?.forms[0] === 'merge' &&
        tail.some((x) => /^\d+$/.test(x)));
    const asks =
      family !== undefined &&
      !described &&
      isLead(part.slice(0, at), lead, agreed, open) &&
      (stack !== null ||
        (isTail(tail, family, verbs === REQUESTED) && (family.object?.(tail) ?? true)));
    if (asks) {
      heard?.add(family);
      const granted = family.grants;
      if (granted.includes('commit')) into.commit = true;
      const finished = FINISHED[(part[at] ?? '').replace(/^finishing/, 'finish')];
      if (granted.includes('finish') && finished) into.finish = [...into.finish, finished];
      if (granted.includes('push')) raise(into, 'push');
      if (granted.includes('force')) raise(into, 'lease');
      if (granted.includes('pr')) into.pr = true;
      if (stack !== null) {
        into.mergeStack = [...new Set([...into.mergeStack, stack])];
      } else if (granted.includes('merge')) {
        into.merge = true;
        into.mergeNamed = [...into.mergeNamed, ...tail.filter((x) => /^\d+$/.test(x))];
        merging = true;
      }
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
  if (ends) ends.merging = merging;
  return described ? 'described' : 'none';
}

// The gh-stack merge a merge's tail names: the whole stack ("merge the
// stack"), stack <n> ("merge stack 4"), or the layers up to pull request <n>
// ("merge everything up to #131"); null for any other tail.
function stackMergeOf(tail: string[]): string | null {
  const t = tail.filter((x) => x !== 'the' && !COURTESY.has(x));
  const [a, b] = t;
  const whole = a === 'whole' || a === 'entire';
  if ((t.length === 1 && a === 'stack') || (t.length === 2 && whole && b === 'stack')) {
    return 'stack';
  }
  if (t.length === 2 && a === 'stack' && /^\d+$/.test(b ?? '')) return `stack:${b}`;
  const up = a === 'everything' || a === 'all' ? t.slice(1) : t;
  if (up.length === 3 && up[0] === 'up' && up[1] === 'to' && /^\d+$/.test(up[2] ?? '')) {
    return `upto:${up[2]}`;
  }
  return null;
}

function continues(clause: string): boolean {
  return /^\s*(and|then)\b/i.test(clause);
}

// A clause that only names more pull requests ("then #130", "132 and 133")
// names them for the merge before it; null for any other clause, so "100%"
// or "10:30" names none. Read token by token: a pasted list stays linear.
function namesOnly(clause: string): string[] | null {
  const named: string[] = [];
  for (const token of clause.replace(/[.!?]+\s*$/, '').split(/[\s,]+/)) {
    if (token === '' || /^(?:and|then|pr)$/i.test(token)) continue;
    const n = /^(?:pr)?#?(\d+)$/i.exec(token)?.[1];
    if (n === undefined) return null;
    named.push(n);
  }
  return named.length > 0 ? named : null;
}

// Sentences keep their closing mark, so a question can be told from a request.
// A period before a digit is a number's: "push tag 0.2.0 but not yet". Before
// a letter it still ends one, so "done.if CI passes, push it" waits.
function sentences(text: string): string[] {
  return text.match(/(?:[^.!?;\n]|(?<=[A-Za-z0-9])\.(?=\d))+[.!?;]*/g) ?? [];
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
  into.finish = [...into.finish, ...from.finish];
  into.pushNamed = [...new Set([...into.pushNamed, ...from.pushNamed])];
  into.mergeNamed = [...into.mergeNamed, ...from.mergeNamed];
  into.readyNamed = [...into.readyNamed, ...from.readyNamed];
  into.mergeStack = [...new Set([...into.mergeStack, ...from.mergeStack])];
  raise(into, from.push);
}

function asksAny(g: Grant): boolean {
  return (
    STEPS.some((step) => g[step]) ||
    g.push !== 'none' ||
    g.finish.length > 0 ||
    g.mergeStack.length > 0
  );
}

// Any step beyond the push the grant names.
function asksBeyondPush(g: Grant): boolean {
  return (
    g.pr || g.merge || g.autoMerge || g.mergeStack.length > 0 || g.approve || g.release || g.comment
  );
}

// A yes takes the first alternative only when the agent offers it ("Should I
// push, or would you rather do it?"), never one the user would do.
function chosen(question: string): string {
  const first = /^([\s\S]*?),\s*or\s/i.exec(question)?.[1];
  if (first === undefined) return question;
  const w = words(first);
  const at = w.findIndex((x) => Object.hasOwn(OFFERED, x));
  const agents =
    at !== -1 && w.slice(0, at).some((x) => x === 'i' || x === 'me') && !w.includes('you');
  return agents ? `${first}?` : question;
}

// Read on the raw words, before a rewrite can split a condition from its question.
function conditional(closing: string): boolean {
  return conditionIn(closing) !== null;
}

// The offer's sentences from its first question on, as `conditional` reads
// them, and as the agent wrote them when the two split alike.
function offerSentences(closing: string): { read: string[]; raw: string[] } | null {
  const read = sentences(closing.replaceAll(/`[^`\n]*`/g, 'it').replaceAll('\n', ' '));
  const first = read.findIndex((s) => s.trim().endsWith('?'));
  if (first === -1) return null;
  const raw = sentences(closing.replaceAll('\n', ' '));
  return {
    read: read.slice(first),
    raw: raw.length === read.length ? raw.slice(first) : read.slice(first),
  };
}

// The sentence whose condition holds the offer, as the agent wrote it; null when none does.
function conditionIn(closing: string): { sentence: string; question: boolean } | null {
  const offer = offerSentences(closing);
  if (offer === null) return null;
  // Only the question itself asks for a merge once ready; a condition after it waits on the work.
  const at = offer.read.findIndex((s) =>
    OFFER_CONDITION.test(
      (s.trim().endsWith('?') ? s.replace(READY_MERGE, '$1') : s).replace(APPROVAL, ''),
    ),
  );
  const sentence = offer.raw[at];
  return sentence === undefined
    ? null
    : { sentence: sentence.trim(), question: sentence.trim().endsWith('?') };
}

// The answer's last three lines, which an offer is read from.
export const closingOf = (answer: string): string =>
  answer.trim().split('\n').filter(Boolean).slice(-3).join('\n');

// What a yes grants: what the offer named, unless it set a condition a yes does not meet.
function accepted(answer: string, heard?: Set<Family>): Grant {
  return conditional(closingOf(answer)) ? settled(fresh()) : asked(answer, heard);
}

export type UnreadOffer = Readonly<{ why: string; steps: readonly (HoldStep | 'commit')[] }>;

const NOTE = /(#\d+)\s*\([^()\n]*\)/g;

// Why a yes to the agent's offer granted nothing, and the steps it offered,
// for their refusals to name so the agent asks again in words the grammar
// reads; null when nothing explains it.
export function unreadOffer(reply: string, previousAnswer: string): UnreadOffer | null {
  if (!isReply(reply) || asksAny(grantOf(reply, previousAnswer))) return null;
  const closing = closingOf(previousAnswer);
  const offer = offerSentences(closing);
  if (offer === null) return null;
  const offered = offer.read.join(' ');
  const steps = [
    ...stepsNamed(offered),
    ...(/\bcommit(?:ting)?\b/i.test(offered) ? (['commit'] as const) : []),
  ];
  if (steps.length === 0) return null;
  // Checked in the order `accepted` reads them: a condition withholds first.
  const held = conditionIn(closing);
  if (held !== null) {
    const why = held.question
      ? `their yes answered an offer whose question sets a condition ("${held.sentence}"); ask again once it is met, or without it`
      : `their yes answered an offer held by a condition word in a sentence after its question ("${held.sentence}"); ask again with any explanation before the question`;
    return { why, steps };
  }
  const notes = offered.match(NOTE) ?? [];
  // Only notes whose removal lets the yes grant are what held it.
  if (notes.length > 0 && asksAny(grantOf(reply, previousAnswer.replaceAll(NOTE, '$1')))) {
    return {
      why: `their yes answered an offer with a note in parentheses beside a pull request (${notes.join(', ')}), which keeps a yes from granting it; ask again without notes`,
      steps,
    };
  }
  return null;
}

// The verbs the previous answer's closing questions offered to do.
function asked(answer: string, heard?: Set<Family>): Grant {
  const g = fresh();
  const closing = closingOf(answer);
  // Matched on the agent's own words, before a backticked name reads as "it":
  // "Can we push `--dry-run` to main?" is no HOW_WE question.
  for (const s of sentences(unquote(closing).replaceAll(/;(?=\s*(and|then)\b)/gi, ','))) {
    const how = HOW_WE.exec(s);
    if (how?.[1]) g.commit = true;
    if (how?.[2] || how?.[3]) raise(g, 'push');
  }
  // A semicolon before "then", "and" or "or" joins clauses as a comma does: "Do we commit; then push?".
  // Elsewhere it ends a sentence: "I'll leave the docs alone; should I push?".
  // A name the offer gives, as in "Push fix/x to `origin`?", reads as "it": an
  // object or destination a push may take; after "delete" it is the branch.
  // Only here, in the agent's offer: a user's "push it to `later`" defers. A
  // ref ends on a word character, so a sentence's closing period stays, and
  // one joining hand-back words ("rather/prefer") stays words.
  const named = forcePhrase(closing)
    // A path is deleted too, so a backticked or slashed name is a branch only
    // beside "branch" or a remote; a plain word is never read as one.
    .replaceAll(
      /\b(delete|deleting)\s+(?:the\s+)?(?:remote\s+)?(?:branch\s+(?:`[\w./-]+`|[\w.-]+\/[\w./-]*[\w-])|(?:`[\w./-]+`|[\w.-]+\/[\w./-]*[\w-])(?=\s+from\s+(?:`[\w-]+`|(?:origin|upstream|remote|github)\b)))/gi,
      '$1 branch',
    )
    // A backticked remote a delete names: `fork` is one, `main` or a file is not.
    .replaceAll(
      /(\bdelet(?:e|ing)\b[^?.!\n]*?\bfrom\s+)`([\w./-]+)`/gi,
      (_m: string, lead: string, name: string) =>
        /^[\w-]+$/.test(name) && !/^(main|master)$/i.test(name)
          ? `${lead}remote`
          : `${lead}\`${name}\``,
    )
    // A backticked pull request is still its number, and the base it goes into
    // its name: "Merge `#163` into `main`?". A named branch or version merged
    // into, to or against a base stays a branch: "Merge `fix/x` to main?" is a
    // local merge.
    .replaceAll(/`(#\d+)`/g, '$1')
    .replaceAll(/(#\d+\s+into\s+)`(main|master)`/gi, '$1$2')
    .replaceAll(
      /(\bmerg(?:e|ing)\s+)(?:`[\w./-]+`|[\w.-]+\/[\w./-]*[\w-])(?=\s+(?:into|to|against)\b)/gi,
      '$1branch',
    )
    // A backticked hand-back stays a word: "or would you `rather` do it?".
    .replaceAll(/`([\w./-]+)`/g, (_m: string, name: string) =>
      words(name).some((x) => HANDBACK.has(x)) ? name.replaceAll('/', ' ') : 'it',
    );
  const tail = prPhrase(unquote(named))
    .replaceAll(/[\w.-]+\/[\w./-]*[\w-]/g, (m) =>
      words(m).some((x) => HANDBACK.has(x)) ? m.replaceAll('/', ' ') : 'it',
    )
    .replaceAll(/;(?=\s*(and|then|or)\b)/gi, ',');
  for (const asked of sentences(tail)) {
    if (!asked.trim().endsWith('?')) continue;
    const q = chosen(asked);
    if (words(q).some((x) => HANDBACK.has(x))) continue;
    let carry: Carry = 'none';
    let merging = false;
    for (const part of clauses(q)) {
      const c = part.replace(CONTRAST, '');
      const more = merging ? namesOnly(c) : null;
      if (more !== null) {
        g.mergeNamed = [...g.mergeNamed, ...more];
        continue;
      }
      if (carry !== 'none' && continues(c)) {
        merging = false;
        continue;
      }
      const ends = { merging: false };
      const left = grammarGrant(c, OFFERED, OFFER_LEAD, g, false, heard, false, ends);
      merging = ends.merging;
      // "Should I fix it, then push?" offers the push; only a commit or push clause carries.
      if (left !== 'none' && words(c).some((x) => Object.hasOwn(OFFERED, x))) carry = left;
    }
  }
  return settled(g);
}

const DELETE_IT = new RegExp(
  String.raw`^(?:${AGREEMENT}[\s,.!]+)*(?:(?:let['’]?s|let us|please|go ahead and)\s+)?delete (?:it|that|them)(?:\s+from\s+\x60?[\w.-]+\x60?)?(?:\s+(?:now|please|too))?\b[\s.!,]*(?:please|thanks|thank you)?[\s.!]*$`,
  'i',
);

function offersDelete(answer: string): boolean {
  const heard = new Set<Family>();
  accepted(answer, heard);
  return [...heard].some((f) => f.forms[0] === 'delete');
}

const PUSH_WORD =
  /\b(push|pushes|pushing|pushed|ship|ships|shipping|shipped|forcepush|forcepushing)\b/i;
const PR_WORD = /\b(openpr|openingpr|markready|markingready)\b/i;
const MERGE_WORD = /\b(merge|merges|merging|merged)\b/i;
const APPROVE_WORD = /\b(approve|approves|approving|approved)\b/i;
const RELEASE_WORD =
  /\b(release|releases|releasing|released|cutrelease|cuttingrelease|publish|publishes|publishing|published)\b/i;

// A step mentioned without being asked for, or an offer of one held off ("not yet").
export type HoldStep = 'push' | 'pr' | 'merge' | 'approve' | 'release' | 'comment';

// Deleting a remote branch is a push.
const STEP_WORDS: readonly (readonly [HoldStep, RegExp])[] = [
  ['push', PUSH_WORD],
  ['push', /\b(delete|deletes|deleting|deleted)\b/i],
  ['pr', PR_WORD],
  ['merge', MERGE_WORD],
  ['approve', APPROVE_WORD],
  ['release', RELEASE_WORD],
];

// A message that is a yes or a go-ahead and nothing more, as the grammar
// reads one: it answers the offer before it.
export function isReply(text: string): boolean {
  return AFFIRMATIVE.test(spoken(text.trim()));
}

// The steps a message names by their verbs, asked for or not.
export function stepsNamed(text: string): HoldStep[] {
  const read = prPhrase(unquote(forcePhrase(text)));
  return [...new Set(STEP_WORDS.filter(([, word]) => word.test(read)).map(([step]) => step))];
}
export type HoldReason = Readonly<{ step: HoldStep; how: 'mentioned' | 'declined' }>;

const ID = String.raw`[a-z][a-z0-9-]*-[a-z0-9]+(?:\.\d+)*`;
export const EPIC_ID = new RegExp(`^${ID}$`, 'i');
const EPIC = new RegExp(String.raw`\b(?:do|run)\s+(?:the\s+)?epic\s+#?(${ID})\b`, 'i');

// Read as the same message asking to push would be, so "don't do epic cpl-x
// yet" and "do epic cpl-x after lunch" start nothing; the push must come from
// the phrase itself, not another sentence ("Don't do epic cpl-x. Push it.").
export function mandateOf(prompt: string, previousAnswer = ''): string | null {
  const m = EPIC.exec(prompt);
  if (m === null || grantOf(prompt, previousAnswer).push !== 'none') return null;
  const asked = grantOf(prompt.replace(m[0], 'push it'), previousAnswer);
  if (asked.push !== 'push' || holdOf(prompt, previousAnswer) !== null) return null;
  return m[1] ?? null;
}

export type Mandate = Readonly<{ epic: string }>;

// The job a typed message leaves running: a hold or a retraction ends it
// rather than pausing it, and "do epic <id>" starts or replaces it.
export function mandateAfter(
  current: Mandate | null,
  prompt: string,
  previousAnswer = '',
): Mandate | null {
  if (dropsGrant(prompt, previousAnswer)) return null;
  const epic = mandateOf(prompt, previousAnswer);
  return epic === null ? current : { epic };
}

// A step mentioned without being asked for holds every step but a commit, read
// by mention rather than grammar since a hold only makes the agent ask.
export function holdOf(prompt: string, previousAnswer = ''): HoldReason | null {
  const grant = grantOf(prompt, previousAnswer);
  const text = prPhrase(unquote(forcePhrase(prompt)));
  const mentioned = (step: HoldStep) => ({ step, how: 'mentioned' }) as const;
  if (PUSH_WORD.test(text) && !covers(grant, 'push')) return mentioned('push');
  if (PR_WORD.test(text) && !grant.pr) return mentioned('pr');
  if (MERGE_WORD.test(text) && !grant.merge && !grant.autoMerge && grant.mergeStack.length === 0) {
    return mentioned('merge');
  }
  if (APPROVE_WORD.test(text) && !grant.approve) return mentioned('approve');
  if (RELEASE_WORD.test(text) && !grant.release) return mentioned('release');
  if (!HOLD.test(text) || covers(grant, 'push') || asksBeyondPush(grant)) return null;
  // The furthest step offered: "merge #116 and delete the branch?" offers a
  // merge, though deleting the branch is a push too.
  const offered = asked(previousAnswer);
  const step: HoldStep | null = offered.release
    ? 'release'
    : offered.merge || offered.autoMerge || offered.mergeStack.length > 0
      ? 'merge'
      : offered.approve
        ? 'approve'
        : offered.pr
          ? 'pr'
          : covers(offered, 'push')
            ? 'push'
            : offered.comment
              ? 'comment'
              : null;
  return step === null ? null : { step, how: 'declined' };
}

// Whether a message typed into the running turn replaces the turn's grant
// rather than adding to it: a sentence holds, retracts or stops, it names a
// step it does not ask for, or it picks fewer merges than were offered.
// Anything else the agent reads before its next step.
export function dropsGrant(prompt: string, previousAnswer = ''): boolean {
  if (holdOf(prompt, previousAnswer) !== null) return true;
  const picked = pickedMerges(spoken(prompt.trim()), previousAnswer);
  if (picked !== null && picked.length < offeredMerges(previousAnswer).length) return true;
  const typed = spoken(unquote(prompt));
  return sentences(typed).some((raw) => {
    const s = raw.replace(FILLER, '');
    return RETRACT.test(raw) || RETRACT.test(s) || HOLD.test(s) || STOP.test(s);
  });
}

// A merge with no pull request named covers any, so adding a named one must not
// narrow it. readyNamed stays whole: it also keeps those pull requests out of an
// open merge-now.
export function combine(a: Grant, b: Grant): Grant {
  const into: MutableGrant = { ...a };
  merged(into, { ...b });
  const open = (g: Grant) => g.merge && g.mergeNamed.length === 0;
  if (open(a) || open(b)) into.mergeNamed = [];
  return settled(into);
}

export function holdsOf(prompt: string, previousAnswer = ''): boolean {
  return holdOf(prompt, previousAnswer) !== null;
}

// Whether a message asks for a step on the way out: a push, a pull request, a
// merge or a release. An approval or a reply asks for none of them.
export function liftsHold(grant: Grant): boolean {
  return (
    covers(grant, 'push') ||
    grant.pr ||
    grant.merge ||
    grant.autoMerge ||
    grant.release ||
    grant.mergeStack.length > 0
  );
}

// The whole replies that pick among offered merges, anchored as a yes is: any
// other wording is read as any other message. Each says "merge", since
// "only #4" may answer another question ("Which one should I leave open?").
const PICK_LEAD = String.raw`^(?:(?:yes|yeah|yep|ok|okay|sure)[\s,]+)?(?:let'?s\s+)?merge\s+`;
const PICK_END = String.raw`(?:[\s,]+please)?[.!]*$`;
const PICK_ALL = new RegExp(
  String.raw`${PICK_LEAD}(both|them(?:\s+(?:both|all))?|all\s+of\s+them)${PICK_END}`,
  'i',
);
const PICK_ONLY = new RegExp(
  String.raw`${PICK_LEAD}(?:only|just)\s+#?(\d+)(?:\s+of\s+(?:them|both))?(?:\s+for\s+now)?${PICK_END}`,
  'i',
);
const PICK_BUT_NOT = new RegExp(
  String.raw`${PICK_LEAD}#?(\d+)(?:[\s,]+but)?[\s,]+not\s+#?(\d+)(?:\s+yet)?${PICK_END}`,
  'i',
);

// Only a plain offer: one question, no "or", and no number but the pull
// requests it offers to merge. After any other ("Merge #3 and #4? Docs or
// tests?") a pick could answer something else.
function offeredMerges(previousAnswer: string): string[] {
  const closing = closingOf(previousAnswer);
  if (closing.split('?').length !== 2 || /\bor\b/i.test(closing)) return [];
  const offered = [...new Set(asked(closing).mergeNamed.filter((n) => /^\d+$/.test(n)))];
  return (closing.match(/\d+/g) ?? []).every((n) => offered.includes(n)) ? offered : [];
}

// The pull requests a reply picks from a merge offer naming them: all
// ("merge both") or some ("merge only #3", "merge #3 but not #4"); null when
// it is no such pick.
function pickedMerges(reply: string, previousAnswer: string): string[] | null {
  const offered = offeredMerges(previousAnswer);
  if (offered.length < 2) return null;
  const text = reply.trim().replaceAll('’', "'");
  const all = PICK_ALL.exec(text)?.[1];
  // "both" after three offered is about something else.
  if (all !== undefined) return /\bboth\b/i.test(all) && offered.length !== 2 ? null : offered;
  const only = PICK_ONLY.exec(text)?.[1];
  if (only !== undefined) return offered.includes(only) ? [only] : null;
  const [, kept, dropped] = PICK_BUT_NOT.exec(text) ?? [];
  if (kept !== undefined && dropped !== undefined)
    return kept !== dropped && offered.includes(kept) && offered.includes(dropped) ? [kept] : null;
  return null;
}

export function grantOf(prompt: string, previousAnswer = ''): Grant {
  const text = spoken(prompt.trim());
  const picked = pickedMerges(text, previousAnswer);
  if (picked !== null) return settled({ ...fresh(), merge: true, mergeNamed: picked });
  if (AFFIRMATIVE.test(text)) {
    const offer = accepted(previousAnswer);
    // Only a bare yes takes the offer's target; a request names its own.
    const targets = offeredTargets(previousAnswer);
    return settled({ ...offer, ...namedFrom(offer, '', previousAnswer, targets) });
  }
  if (CONTINUE_REPLY.test(text))
    return settled({ ...fresh(), finish: accepted(previousAnswer).finish });
  // "delete it", answering an offer to delete a branch, names that branch;
  // only as the whole reply, since "delete it, meaning the TODO" names another.
  const answering = DELETE_IT.test(text) && offersDelete(previousAnswer);
  // Pasted shell sessions and quoted output are not requests.
  const typed = (answering ? text.replace(/\b(delete\s+(?:it|that|them))\b/i, '$1 branch') : text)
    .split('\n')
    .filter((line) => !/^\s*([$>+#]|PS\s|\w+@[\w.-]+[:$])/.test(line))
    // A list item or an emphasised label names a step; it does not ask for it.
    .filter((line) => !/^\s*(\d+[.)]|[-*•])\s|^\s*[*_]+[^*_]+[*_]+\s*$/.test(line))
    .join('\n');
  let g = fresh();
  // What the previous sentence left: "we commit; then push" describes across
  // the semicolon as "we commit, then push" does across the comma.
  let prev: Carry = 'none';
  let declined = false;
  let before = fresh();
  // Each retraction, with the requests it would keep (null when it keeps none).
  const retractions: { at: number; keeps: MutableGrant | null }[] = [];
  const asking = new Set<number>();
  let semicolon = false;
  const all = sentences(prPhrase(unquote(forcePhrase(typed))));
  for (const [at, raw] of all.entries()) {
    const semicolonBefore = semicolon;
    if (raw.trim().endsWith(';')) semicolon = true;
    const flipped = leadingReady(raw);
    const sentence = flipped ?? raw;
    // "once it's ready, do not merge it" declines the merge, so the message
    // merges nothing while the sentences beside it still count.
    if (flipped !== null && DECLINED.test(sentence) && !sentence.trim().endsWith('?')) {
      declined = true;
      // "; then push it" continues it, and waits on the same condition.
      prev = sentence.trim().endsWith(';') ? 'mood' : 'none';
      continue;
    }
    if (flipped !== null && (RETRACT.test(sentence) || isQuestion(sentence))) return NO_GRANT;
    if (RETRACT.test(sentence)) {
      // A semicolon ties requests the retraction cannot tell apart.
      retractions.push({
        at,
        keeps: BARE_RETRACT.test(sentence) && !semicolonBefore ? before : null,
      });
      before = fresh();
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
    let merging = false;
    // Trimmed, so "But only if CI passes." opens its own sentence rather than a second clause.
    const parts = clauses(sentence.trim());
    // "We can merge 91" asks only as the whole message, or ending "Let's leave it
    // and we can merge 91": anything else beside it can make it an option or a
    // question ("We can wait. We can merge 91.", "We can merge 91 and I'd rather
    // wait", "We can merge 91.\n- Or close it.", "?!").
    const said = words(sentence);
    const opener = said.find((x) => !AGREE_WORD.has(x));
    const joined = said.some((x) => x === 'and' || x === 'then');
    const opens: Opens =
      flipped !== null || all.length > 1 || parts.length > 1 || /[\n?]/.test(text.trim())
        ? 'none'
        : !joined
          ? 'alone'
          : SUGGESTS.test(opener ?? '')
            ? 'chained'
            : 'none';
    for (const [i, part] of parts.entries()) {
      const c = part.replace(CONTRAST, '');
      if (CLAUSE_CONDITION.test(c) || (i === 0 && SENTENCE_CONDITION.test(c))) return NO_GRANT;
      if (HOLD.test(c)) withheld = true;
      if (withheld) break;
      const more = merging ? namesOnly(c) : null;
      if (more !== null) {
        mine.mergeNamed = [...mine.mergeNamed, ...more];
        continue;
      }
      if (carry === 'described' && continues(c)) {
        merging = false;
        continue;
      }
      // After a ready-merge a clause can still withhold, but grants nothing.
      const into = carry === 'ready' ? fresh() : mine;
      // A condition that means now counts only where it ends the sentence.
      const now = i === parts.length - 1;
      const ends = { merging: false };
      const left = grammarGrant(
        c,
        REQUESTED,
        REQUEST_LEAD,
        into,
        agreed,
        undefined,
        now,
        ends,
        opens,
      );
      merging = into === mine && ends.merging;
      agreed = AGREE.test(c);
      if (left === 'mood') withheld = true;
      else if (left !== 'none' && carry !== 'ready') carry = left;
    }
    // Any other condition leading a sentence withholds the whole prompt.
    if (flipped !== null && (withheld || !onlyAutoMerge(mine))) return NO_GRANT;
    if (asksAny(mine)) before = { ...g };
    if (!withheld) merged(g, mine);
    if (!withheld && asksAny(mine)) asking.add(at);
    // Only a semicolon ties two sentences together, and only around the verbs:
    // "I fixed it. Then push it." asks.
    const tied =
      sentence.trim().endsWith(';') && words(sentence).some((x) => Object.hasOwn(REQUESTED, x));
    prev = tied ? (withheld ? 'mood' : carry) : 'none';
  }
  // "no wait, never mind" alone cancels only the last request, and only when
  // the next sentence asks again; any other retraction cancels them all.
  let kept = fresh();
  for (const { at, keeps } of retractions) {
    if (keeps !== null && asking.has(at + 1)) merged(kept, keeps);
    else kept = fresh();
  }
  if (asksAny(g)) {
    merged(kept, g);
    g = kept;
  }
  // Merging the version pull request is the release, so a declined merge holds it too.
  if (declined) {
    Object.assign(g, {
      merge: false,
      mergeNamed: [],
      autoMerge: false,
      readyNamed: [],
      mergeStack: [],
      release: false,
    });
  }
  // Read from the message as typed, before quoted or listed lines are dropped.
  return settled({ ...g, ...namedFrom(g, typed, previousAnswer, typedTargets(text)) });
}

// A merge, now or once ready, that named no pull request names the one the
// agent offered, each kind in its own list.
function namedFrom(
  g: Grant,
  typed: string,
  previousAnswer: string,
  targets: readonly string[],
): Pick<Grant, 'pushNamed' | 'mergeNamed' | 'readyNamed'> {
  const unnamed = (asked: boolean, named: readonly string[]) =>
    asked && named.length === 0 ? unnamedMerge(typed, previousAnswer) : named;
  const pushed = g.push === 'none' ? [] : targets;
  return {
    pushNamed: [...new Set([...g.pushNamed, ...pushed])],
    mergeNamed: unnamed(g.merge, g.mergeNamed),
    readyNamed: unnamed(g.autoMerge, g.readyNamed),
  };
}

// Never a pull request number: a merge naming it covers no pull request by name.
export const NAMED_ELSEWHERE = '?';

// The pull request numbers a text names: #131, PR 131, /pull/131.
function numbers(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/(?:#|\b(?:pr|pull request)\s+#?|\/pull\/)(\d+)\b/gi)].map((m) => m[1] ?? ''),
  );
}

// What "merge it" names: the pull requests the end of the previous answer
// names (#131, PR 131, /pull/131), none meaning any. Several, or a message
// naming numbers or the version PR itself ("merge it; do not merge 130"),
// name none by name, so the version PR is looked up and asks.
function unnamedMerge(typed: string, previousAnswer: string): readonly string[] {
  const text = unquote(typed);
  if (/#?\b\d+\b/.test(text) || /\b(version|release)\s+(pr|pull\s+request)\b/i.test(text)) {
    return [NAMED_ELSEWHERE];
  }
  const closing = sentences(closingOf(previousAnswer).replaceAll(/;(?=\s*or\b)/gi, ','))
    .map((q) => (q.trim().endsWith('?') ? chosen(q) : q))
    .join('\n');
  // The question it answers decides first: "Release by merging #130?" after a
  // summary that names #134 too.
  const questions = sentences(closing)
    .filter((q) => q.trim().endsWith('?'))
    .join(' ');
  const asked = numbers(questions);
  // "#134 merged. Merge the version PR?" offers the version PR, not #134.
  if (
    asked.size === 0 &&
    /\b(version|release)\s+(pr|pull\s+request)\b|\bmerge\s+it\s+to\s+release\b/i.test(questions)
  ) {
    return [];
  }
  const offered = asked.size > 0 ? asked : numbers(closing);
  if (offered.size > 1) return [NAMED_ELSEWHERE];
  return [...offered];
}
