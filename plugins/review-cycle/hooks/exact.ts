// The consent reader: a closed vocabulary, read exactly. A message outside it
// grants nothing, and the refusal hands the agent the question to ask.

import {
  combine,
  EPIC_NAME,
  NAMED_ELSEWHERE,
  NO_GRANT,
  type Grant,
  type UnreadOffer,
} from './consent';
import { FINISHES, type Finishes } from './git-args';
import { HOLD_STEPS, lowerHold, type Hold, type HoldReason, type HoldStep } from './hold';

type Part = Partial<Grant>;

const NUM = String.raw`[1-9]\d*`;
const REPO = String.raw`(?:[a-z\d][\w.-]*\/)?[a-z\d][\w.-]*`;
// A pull request: 316, #316, pr 316, name#53 with or without its owner, or its URL.
const REF = String.raw`(?:${REPO}#${NUM}|(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/${NUM}|(?:(?:pr|pull request) )?#?${NUM})`;
const REFS = String.raw`${REF}(?:(?:, and | and |, )${REF})*`;
const IT = String.raw`(?: it| this| that)?`;
const SEGMENT = String.raw`(?!-)[\w.-]+`;
const BRANCH = String.raw`${SEGMENT}(?:\/${SEGMENT})*`;
const OPERATION = FINISHES.join('|');
const READY = String.raw`(?:when|once) (?:ready|(?:it is|it's|its) (?:ready|green|clean)|ci (?:passes|is green)|(?:the )?checks (?:pass|are green))`;

// A pull request named with its repository: `linesmith#53`, `oakoss/linesmith#53`,
// or its GitHub URL.
const QUALIFIED =
  /(?<![\w./-])(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b(?:\/[\w/-]*)?|(?<![\w./#-])((?:[a-z\d][\w.-]*\/)?[a-z\d][\w.-]*)#(\d+)\b/gi;
// Words before `#<n>` that name no repository: "pr#53" is this repository's #53.
const NOT_A_REPO = /^(?:\d+|prs?|pulls?|issues?|request|no|number|it|this|that)$/i;

const lines = (answer: string): string[] =>
  answer.split(/\r?\n/).filter((line) => line.trim() !== '');
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

// The pull requests a text names: with a repository as `<repo>#<n>`, and
// without one (#131, PR 131) as the number.
function pullsIn(text: string): { placed: string[]; bare: string[] } {
  const placed: string[] = [];
  const rest = text.replaceAll(
    QUALIFIED,
    (all, urlRepo?: string, urlN?: string, repo?: string, n?: string) => {
      if (urlRepo === undefined && NOT_A_REPO.test(repo ?? '')) return all;
      placed.push(`${(urlRepo ?? repo ?? '').toLowerCase()}#${Number(urlN ?? n)}`);
      return ' ';
    },
  );
  const bare = [...rest.matchAll(/(?:#|\b(?:pr|pull request)\s+#?)(\d+)\b/gi)].map(
    (m) => m[1] ?? '',
  );
  return { placed: unique(placed), bare: unique(bare) };
}

// A typed list of pull requests. A bare number is the one pull request the
// answer names with it ("merge 313" after a report's link to #313); beside a
// named repository, or when the answer names two, it could be in either, so
// `?#<n>` matches no merge.
function refsOf(list: string, before: string): string[] {
  const named = list.split(/, and | and |, /i).map((r) => r.replace(/^(?:pr|pull request) /i, ''));
  const anyRepo = named.some((r) => pullsIn(r).placed.length > 0);
  const answered = pullsIn(before).placed;
  return unique(
    named.map((r) => {
      const [placed] = pullsIn(r).placed;
      if (placed !== undefined) return placed;
      const n = r.replace('#', '');
      if (anyRepo) return `?#${n}`;
      const same = answered.filter((a) => a.endsWith(`#${n}`));
      if (same.length === 0) return n;
      return same.length === 1 ? (same[0] ?? n) : `?#${n}`;
    }),
  );
}

// The answer's last three lines, which a miss is recorded with.
export const closingOf = (answer: string): string => lines(answer).slice(-3).join('\n');

const allIn = (text: string): string[] => {
  const { placed, bare } = pullsIn(text);
  return [...placed, ...bare];
};

// The pull requests the question a message answers names, or with none there
// the answer's closing.
function offeredPulls(before: string): string[] {
  const last = lines(before).at(-1) ?? '';
  const asked = last.trim().endsWith('?') ? allIn(last) : [];
  return asked.length > 0 ? asked : allIn(closingOf(before));
}

// What "merge it" names: the one pull request offered. Several name none by name.
function offeredPull(before: string): readonly string[] {
  const named = offeredPulls(before);
  return named.length > 1 ? [NAMED_ELSEWHERE] : named;
}

const SHIP: Part = { commit: true, push: 'push', pr: true };

// Where a push goes, named as a branch: main, a name with a slash, or "the x branch".
const TARGET = String.raw`(?: to (?:the )?(?:origin[ /])?(?:(main|master|${SEGMENT}(?:\/${SEGMENT})+)(?: branch)?|(${BRANCH}) branch))?`;
// Lowercase, as the gate compares a branch.
const target = (m: RegExpExecArray): string[] =>
  [m[1] ?? m[2]].filter((b) => b !== undefined).map((b) => b.toLowerCase());

type Clause = readonly [string, (m: RegExpExecArray, before: string) => Part | null];
const whole = (list: readonly Clause[]): readonly Clause[] =>
  list.map(([source, read]): Clause => [`^${source}$`, read]);

const CLAUSES = whole([
  [String.raw`commit(?: it| this| that| the changes)?`, () => ({ commit: true })],
  [String.raw`push${IT}(?: to origin)?`, () => ({ push: 'push' })],
  [String.raw`ship${IT}`, () => SHIP],
  [String.raw`(?:open|create|make) (?:a|the) (?:pr|pull request)`, () => ({ pr: true })],
  [String.raw`merge${IT}`, (_, before) => ({ merge: true, mergeNamed: offeredPull(before) })],
  [
    String.raw`merge (${REFS})`,
    (m, before) => ({ merge: true, mergeNamed: refsOf(m[1] ?? '', before) }),
  ],
  [String.raw`approve(?: it| ${REF})?`, () => ({ approve: true })],
  [String.raw`(?:release|publish)${IT}`, () => ({ release: true })],

  [String.raw`push${IT}${TARGET}`, (m) => ({ push: 'push', pushNamed: target(m) })],
  [
    String.raw`force[- ]push${IT}${TARGET}(?: with (?:a )?lease)?`,
    (m) => ({ push: 'lease', pushNamed: target(m) }),
  ],
  [
    String.raw`force[- ]push${IT}${TARGET} without (?:a )?lease`,
    (m) => ({ push: 'bare', pushNamed: target(m) }),
  ],
  [String.raw`push the ([^\s\`]+) tag`, (m) => ({ push: 'push', pushNamed: [`tag:${m[1]}`] })],
  [String.raw`delete the branch`, () => ({ push: 'push' })],

  // A plain push, which a stack push does not run on.
  [String.raw`push the stack`, () => ({ push: 'push' })],
  [String.raw`force[- ]push the stack(?: with (?:a )?lease)?`, () => ({ push: 'lease' })],
  [String.raw`merge the (?:whole |entire )?stack`, () => ({ mergeStack: ['stack'] })],
  [String.raw`merge stack #?(${NUM})`, (m) => ({ mergeStack: [`stack:${m[1]}`] })],
  [
    String.raw`merge up to (${REF})`,
    (m, before) => ({ mergeStack: [`upto:${refsOf(m[1] ?? '', before)[0]}`] }),
  ],

  [
    String.raw`(?:finish|continue) the (${OPERATION})`,
    (m) => ({ finish: [(m[1] ?? '').toLowerCase() as Finishes] }),
  ],

  [String.raw`reply to the review(?: threads?)?(?: on ${REF})?`, () => ({ comment: true })],

  [String.raw`ship (?:them|both)`, () => SHIP],
  [String.raw`push (?:them|both)`, () => ({ push: 'push' })],
  [String.raw`(?:release|publish) (?:them|both)`, () => ({ release: true })],
  [
    String.raw`merge (?:them|both|all of them)`,
    (m, before) => {
      const picked = offeredPulls(before);
      const enough = /both$/i.test(m[0]) ? picked.length === 2 : picked.length > 1;
      return enough ? { merge: true, mergeNamed: picked } : null;
    },
  ],

  [
    String.raw`merge${IT} ${READY}`,
    (_, before) => ({ autoMerge: true, readyNamed: offeredPull(before) }),
  ],
  [
    String.raw`merge (${REFS}) ${READY}`,
    (m, before) => ({ autoMerge: true, readyNamed: refsOf(m[1] ?? '', before) }),
  ],
  [
    String.raw`(?:release|publish)${IT} (?:when|once) (main and )?the (?:release|version) (?:pr|pull request) (?:is|are) ready`,
    (m) => ({ readyRelease: true, readyMain: m[1] !== undefined }),
  ],
]);

const AGREE_WORD = String.raw`yes|yep|yeah|yup|ok|okay|sure|alright|sounds good|lgtm`;
// An agreeing word ahead of a request; "looks good" alone answers no offer.
const AGREE = new RegExp(
  String.raw`^(?:${AGREE_WORD}|great|perfect|cool|nice|looks good)[,.!]? `,
  'i',
);
const LEAD =
  /^(?:(?:please|well|hey|now|also),? |(?:lets|let's|go ahead and|you can|we can|and|then) )/i;
const TAIL = /,? (?:please|now)$/i;
const GO = String.raw`go ahead|do it|do that|go for it|please do|proceed|(?:lets|let's) do (?:it|that)`;
const YES = new RegExp(String.raw`^(?:(?:${AGREE_WORD})(?:[,.!]? (?:please|${GO}))?|${GO})$`, 'i');
const JOIN = /[,;]? (?:and then|and|then) /gi;

// A word that puts a step off or takes one back.
// Not part of a name: `fix/no-cache` and `wait-for-ci` hold nothing.
// Declines are read generously: one read by mistake costs a question, and one
// missed leaves a push or a job running.
const PHRASE = String.raw`not yet|not now|hold off|hold on|hold up|never ?mind|no thanks|no thank you|scratch that`;
const WORD = String.raw`no|wait|stop|halt|cancel|nvm|nope|nah|abort`;
const EASY = String.raw`no (?:worries|problem|rush|need)|(?:don't|dont|do not) (?:worry|forget)`;
const HOLD_WORD = new RegExp(
  String.raw`(?<![\w/-])(?!${EASY})(?:(?:don't|dont|do not|later|${PHRASE})(?![\w/-])|(?:${WORD})(?=$|[,.!;:]))`,
  'i',
);
// Opening a clause, whatever follows: "wait a sec", "I agree, but wait".
const HOLD_LEAD = new RegExp(
  String.raw`^(?:(?:ok|okay|oh|actually|please|sorry|hmm|hm|um|uh|well|hey|but|and|so)(?:[,.!] ?| ))*(?!${EASY})(?:${PHRASE}|${WORD}|don't|dont|do not)(?![\w/-])`,
  'i',
);
const declining = (text: string): string[] =>
  text.split(/(?<=[.!?;,])\s+|\s+(?=but\s)/i).filter((clause) => HOLD_LEAD.test(clause));
const declines = (text: string): boolean => declining(text).length > 0;
const holds = (text: string): boolean => HOLD_WORD.test(text) || declines(text);
const REPLY_WORD = /\b(?:reply|replies|replying|replied)\b/i;

const spoken = (text: string): string =>
  text
    .trim()
    .replaceAll(/[‘’]/g, "'")
    .replaceAll(/\s+/g, ' ')
    .replace(/[.!]$/, '');

function led(text: string): string {
  let body = text;
  for (let m = LEAD.exec(body); m !== null; m = LEAD.exec(body)) body = body.slice(m[0].length);
  return body;
}

function clause(text: string, before: string): Part | null {
  for (const [source, read] of CLAUSES) {
    const m = new RegExp(source, 'i').exec(text);
    if (m !== null) return read(m, before);
  }
  return null;
}

// One request, or two joined by "and" or "then".
function parts(text: string, before: string): Part[] | null {
  const body = led(text.replace(AGREE, '')).replace(TAIL, '');
  const one = clause(body, before);
  if (one !== null) return [one];
  for (const join of body.matchAll(JOIN)) {
    const first = clause(body.slice(0, join.index), before);
    const second = clause(led(body.slice(join.index + join[0].length)), before);
    if (first === null || second === null) continue;
    if (first.autoMerge !== true && first.readyRelease !== true) return [first, second];
    // What follows a standing ask may wait on the same condition, so only a
    // release joins one, as a release once the version pull request is ready.
    const releases = second.release === true && Object.keys(second).length === 1;
    return releases ? [first, { readyRelease: true }] : null;
  }
  return null;
}

function granting(all: readonly Part[]): Grant {
  let grant = NO_GRANT;
  for (const part of all) grant = combine(grant, { ...NO_GRANT, ...part });
  return grant;
}

// As offers.ts writes one: owner and name, matched by case.
const OFFERED_REPO = String.raw`[A-Za-z\d][\w.-]*\/[A-Za-z\d][\w.-]*`;
const PULL = String.raw`(?:${OFFERED_REPO}#${NUM}|#${NUM})`;
const PULLS = String.raw`${PULL}(?:(?:, | and )${PULL})*`;
const TICKED = '`[^`\\s]+`';
const PUSHED = String.raw`\`(${BRANCH})\` to ${TICKED}`;

// Each question offers.ts writes, and what a yes to it grants (pinned both
// ways in exact.spec.ts).
const QUESTIONS = whole([
  [
    String.raw`(?:Merge|Squash-merge|Rebase-merge) (${PULLS})\?`,
    (m) => ({ merge: true, mergeNamed: allIn(m[1] ?? '') }),
  ],
  [String.raw`Release (?:${PULL}|${TICKED})\?`, () => ({ release: true })],
  [
    String.raw`Merge and release (${PULL})\?`,
    (m) => ({ merge: true, mergeNamed: allIn(m[1] ?? ''), release: true }),
  ],
  [String.raw`Approve ${PULL}\?`, () => ({ approve: true })],
  [String.raw`Reply to the review on ${PULL}\?`, () => ({ comment: true })],
  [String.raw`Merge the stack\?`, () => ({ mergeStack: ['stack'] })],
  [String.raw`Merge up to (${PULL})\?`, (m) => ({ mergeStack: [`upto:${allIn(m[1] ?? '')[0]}`] })],
  [String.raw`Push ${PUSHED}\?`, () => ({ push: 'push' })],
  [String.raw`Force-push ${PUSHED} with a lease\?`, () => ({ push: 'lease' })],
  [String.raw`Force-push ${PUSHED} without a lease\?`, () => ({ push: 'bare' })],
  [String.raw`Push ${PUSHED} and open a pull request\?`, () => ({ push: 'push', pr: true })],
  // The two a push refusal writes itself (push-verdict.ts), which name where
  // the push goes; the offer tool's push questions name nothing.
  [
    String.raw`Push to \`(${BRANCH})\`\?`,
    (m) => ({ push: 'push', pushNamed: [(m[1] ?? '').toLowerCase()] }),
  ],
  [
    String.raw`Push the \`([^\`\s]+)\` tag\?`,
    (m) => ({ push: 'push', pushNamed: [`tag:${m[1]}`] }),
  ],
  [String.raw`Open a pull request\?`, () => ({ pr: true })],
  [String.raw`Commit the changes to ${TICKED}\?`, () => ({ commit: true })],
  [
    String.raw`Commit the resolution to ${TICKED} and finish the (${OPERATION})\?`,
    (m) => ({ finish: [m[1] as Finishes] }),
  ],
  [String.raw`Delete ${TICKED} from ${TICKED}\?`, () => ({ push: 'push' })],
  [String.raw`Force-push the stack with a lease\?`, () => ({ push: 'lease' })],
  [
    String.raw`Force-push the stack with a lease and open its pull requests\?`,
    () => ({ push: 'lease', pr: true }),
  ],
]);

// What a yes to the answer's last line grants: null unless that line is, whole,
// a question the offer tool writes.
export function offered(before: string): Grant | null {
  const all = before.trimEnd().split(/\r?\n/);
  const last = (all.at(-1) ?? '').trim();
  // Alone in its paragraph, under nothing that leads into it ("If CI passes:").
  if ((all.at(-2) ?? '').trim() !== '' || /[:,]$/.test((lines(before).at(-2) ?? '').trim())) {
    return null;
  }
  for (const [source, read] of QUESTIONS) {
    const m = new RegExp(source).exec(last);
    if (m !== null) return granting([read(m, before) ?? {}]);
  }
  return null;
}

// A message that is a yes or a go-ahead and nothing more.
export function isReply(text: string): boolean {
  return YES.test(spoken(text));
}

const unplaced = (n: string): string => n.replace(/^(upto:)?(\d+)$/, '$1?#$2');

export function grantOf(prompt: string, previousAnswer = ''): Grant {
  const text = spoken(prompt);
  if (holds(text)) return NO_GRANT;
  if (YES.test(text)) return offered(previousAnswer) ?? NO_GRANT;
  // No request is this long, and the patterns run on every message.
  if (text.length > 300) return NO_GRANT;
  const all = parts(text, previousAnswer);
  if (all === null) return NO_GRANT;
  const grant = granting(all);
  // Beside a repository named in another request, a bare number is unplaced too.
  if (pullsIn(text).placed.length === 0) return grant;
  return {
    ...grant,
    mergeNamed: grant.mergeNamed.map((n) => unplaced(n)),
    readyNamed: grant.readyNamed.map((n) => unplaced(n)),
    mergeStack: grant.mergeStack.map((n) => unplaced(n)),
  };
}

const STEP_WORDS: readonly (readonly [HoldStep, RegExp])[] = [
  ['push', /\b(?:push|pushes|pushing|pushed|ship|ships|shipping|shipped)\b/i],
  ['push', /\b(?:delete|deletes|deleting|deleted)\b/i],
  [
    'pr',
    /\b(?:open|opens|opening|opened|create|creates|creating|created|make|making)\s+(?:(?:a|an|the|another)\s+)?(?:draft\s+)?(?:pr|pull\s+request)\b/i,
  ],
  ['merge', /\b(?:merge|merges|merging|merged)\b/i],
  ['approve', /\b(?:approve|approves|approving|approved)\b/i],
  [
    'release',
    /\b(?:release|releases|releasing|released|publish|publishes|publishing|published)\b/i,
  ],
];

// The steps a message names by their verbs, asked for or not.
export function stepsNamed(text: string): HoldStep[] {
  return [...new Set(STEP_WORDS.filter(([, word]) => word.test(text)).map(([step]) => step))];
}

const asksAny = (g: Grant): boolean => JSON.stringify(g) !== JSON.stringify(NO_GRANT);

function stepsOf(g: Grant): HoldStep[] {
  const asked: Record<HoldStep, boolean> = {
    push: g.push !== 'none',
    pr: g.pr,
    merge: g.merge || g.autoMerge || g.mergeStack.length > 0,
    approve: g.approve,
    release: g.release || g.readyRelease,
    comment: g.comment,
  };
  return HOLD_STEPS.filter((s) => asked[s]);
}

function lowest(steps: readonly HoldStep[], how: HoldReason['how']): Hold {
  let held: Hold = null;
  for (const step of steps) held = lowerHold(held, { step, how });
  return held;
}

// A hold word declines the steps the message names, or with none named the
// ones the question before it offered. A message that names a step without
// asking for it holds it too ("anything else before we ship?").
export function holdOf(prompt: string, previousAnswer = ''): Hold {
  const text = spoken(prompt);
  const named = stepsNamed(text);
  if (!holds(text)) {
    return asksAny(grantOf(prompt, previousAnswer)) ? null : lowest(named, 'mentioned');
  }
  const declined: HoldStep[] = REPLY_WORD.test(text) ? [...named, 'comment'] : named;
  if (!declines(text)) return lowest(declined, 'declined');
  // A decline needs no exact question: any that names a step is declined too.
  const offer = offered(previousAnswer);
  const last = (lines(previousAnswer).at(-1) ?? '').trim();
  const asked = last.endsWith('?') ? stepsNamed(last) : [];
  return lowest([...declined, ...(offer === null ? asked : stepsOf(offer))], 'declined');
}

// Typed into a running turn, a message that holds or takes back replaces that
// turn's consent.
export function dropsGrant(prompt: string, previousAnswer = ''): boolean {
  return declines(spoken(prompt)) || holdOf(prompt, previousAnswer) !== null;
}

// Whether a message ends a merge or release asked for once ready: one that
// declines without naming a step, or that holds a merge or release.
export function endsReady(prompt: string, previousAnswer = ''): boolean {
  if (!dropsGrant(prompt, previousAnswer)) return false;
  const text = spoken(prompt);
  const named = stepsNamed(text);
  const general = declining(text).some((clause) => stepsNamed(clause).length === 0);
  return general || named.length === 0 || named.includes('merge') || named.includes('release');
}

// Why a yes granted nothing: the answer's last line asked about a step, and
// was not a question the offer tool writes.
export function unreadOffer(reply: string, previousAnswer: string): UnreadOffer | null {
  if (!isReply(reply) || offered(previousAnswer) !== null) return null;
  const last = (lines(previousAnswer).at(-1) ?? '').trim();
  if (!last.includes('?')) return null;
  const steps = [
    ...stepsNamed(last),
    ...(/\bcommit(?:ting)?\b/i.test(last) ? (['commit'] as const) : []),
  ];
  if (steps.length === 0) return null;
  return {
    why: `their yes answered a question the gate does not read ("${last}"); ask again with the question mcp__review-cycle__offer gives, word for word and alone as the answer's last line`,
    steps,
  };
}

// "as drafts" says how the job opens its pull requests, not whether it may.
const EPIC = new RegExp(
  String.raw`^(?:do|run) (?:the )?epic #?(${EPIC_NAME})(?:,? (?:as|in) (?:a )?drafts?(?: (?:prs?|pull requests?))?)?$`,
  'i',
);
const DO_EPIC_COMMAND = /^\/(?:pr-kit:)?do-epic\b/i;

// The epic a message starts a job on: "do epic <id>", whole.
export function mandateOf(typed: string): string | null {
  const text = spoken(typed).replace(DO_EPIC_COMMAND, 'do epic');
  if (HOLD_WORD.test(text)) return null;
  return EPIC.exec(led(text.replace(AGREE, '')).replace(TAIL, ''))?.[1] ?? null;
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
  const epic = mandateOf(prompt);
  return epic === null ? current : { epic };
}
