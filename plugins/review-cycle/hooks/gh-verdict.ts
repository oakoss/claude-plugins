// Whether the GitHub writes in a call may run on the stop-before ladder, and
// the refusals when they may not. Pure: what it needs from gh or the settings
// comes through `GhLookups`, which register.ts builds.

import {
  covers,
  NAMED_ELSEWHERE,
  NO_GRANT,
  type Grant,
  type HoldReason,
  type HoldStep,
  type UnreadOffer,
} from './consent';
import type { GhAction, PushRef, Unlookable } from './github';
import { asks, atOrAbove, type Ladder, type Step } from './ladder';
import {
  askingReason,
  pushOutcome,
  unnamedTarget,
  type DefaultBranch,
  type DryRunRef,
  type Unnamed,
} from './push-verdict';
import { type MergeSet, mergeSet, type readStack } from './stack';

// `unreadable` names the settings file that could not be read, and why.
export type InForce = Ladder & { unreadable?: string };
// A step that runs without the user asking for it directly, by the ladder.
// `ready` says why a merge asked for once the pull request is ready ran now.
export type Unasked = { step: Step; ladder: Ladder; ready?: string };

// What a gh read printed, or why the step asks instead; `slow` when gh never
// answered, so running the step again may get through.
export type Lookup =
  | { out: string; asks?: never; slow?: never }
  | { asks: string; out?: never; slow?: true };

export type PullRequest = { cross: boolean; repo: string; branch: string };

export const PR_FIELDS = 'url,isCrossRepository,headRefName';
export const PR_JQ = String.raw`"\(.isCrossRepository) \(.url) \(.headRefName)"`;

export function parsePullRequest(out: string, what: string): PullRequest | { asks: string } {
  const read = /^(true|false) https?:\/\/([^/\s]+\/[^/\s]+\/[^/\s]+)\/pull\/\d+ (\S+)$/.exec(out);
  if (read === null) return { asks: `looking up ${what} printed \`${out}\`` };
  const [, cross = '', repo = '', branch = ''] = read;
  // The repository from the pull request's URL, so an Enterprise host survives.
  return { cross: cross === 'true', repo, branch };
}

export type GhLookups = {
  ladder: () => Promise<InForce>;
  // The pull request `gh pr view <lookup>` names: "<url> <state> <mergeStateStatus>".
  mergeTarget: (lookup: readonly string[]) => Promise<Lookup>;
  // The current repository's URL.
  repoUrl: () => Promise<Lookup>;
  // The branch the checkout is on, empty when HEAD is on none.
  branch: () => Promise<Lookup>;
  // The default branch and the rolled-up state of its head commit's checks and
  // statuses: "<branch> <SUCCESS|PENDING|EXPECTED|FAILURE|ERROR|NONE>".
  mainChecks: () => Promise<Lookup>;
  // This repository's version pull requests, newest first: "<n>:<STATE> …".
  versionPulls: () => Promise<Lookup>;
  // The pull request `gh pr view <lookup>` names, `what` saying which in a failure.
  pullRequest: (
    lookup: readonly string[],
    what: string,
  ) => Promise<PullRequest | { asks: string; slow?: true }>;
  // The default branch of `repo` (HOST/OWNER/NAME or OWNER/NAME), or of the
  // repository gh picks when it is null.
  defaultBranch: (repo: string | null) => Promise<Lookup>;
  stack: (n: number) => ReturnType<typeof readStack>;
  // Whether gh-stack's leased push of the current stack to `remote` (null:
  // the one gh-stack picks) can only overwrite what this agent pushed.
  stackLease: (
    step: 'push' | 'sync' | 'submit',
    remote: string | null,
  ) => Promise<{ ok: true } | { asks: string }>;
};

// A read's text without surrounding space; one that printed nothing names
// nothing, so the step asks.
function read(r: Lookup, what: string): Lookup {
  if (r.asks !== undefined) return r;
  const out = r.out.trim();
  return out === '' ? { asks: `looking up ${what} printed nothing` } : { out };
}

// Steps the model check read the user's latest message as asking for. They
// let a step through as the ladder does, so every always-ask check still
// applies, and a hold raised by mention does not stop them.
export type ModelSteps = Readonly<Partial<Record<Step, true>>>;

// A reply on GitHub sits above every rung: any hold holds one, and a hold of
// one holds only another.
export function holds(held: Hold, step: Step | 'comment'): boolean {
  if (held === null || step === 'commit') return false;
  if (step === 'comment') return true;
  return held.step !== 'comment' && atOrAbove(step, held.step);
}

// The hold that holds more, so a later hold never frees what an earlier one held.
export function lowerHold(a: Hold, b: Hold): Hold {
  if (a === null || b === null) return a ?? b;
  return holds(a, b.step) ? a : b;
}

// What may run: what the user asked for, and what the ladder or the model
// check lets through.
type Allowed = Readonly<Record<Step, boolean>>;
export function permitted(
  granted: Grant,
  ladder: Ladder,
  held: Hold,
  model: ModelSteps = {},
): Allowed {
  const free = (step: Step) => (!holds(held, step) && !asks(ladder, step)) || model[step] === true;
  return {
    commit: granted.commit || !asks(ladder, 'commit'),
    push: covers(granted, 'push') || free('push'),
    pr: granted.pr || free('pr'),
    merge: granted.merge || free('merge'),
    approve: granted.approve || free('approve'),
    release: granted.release || free('release'),
  };
}

// The agent asks in its reply, naming the step and its target, and ends its turn.
// `shown` is the call as the refusal quotes it.
export function askThem(naming: string, example: string, shown: string): string {
  return `stop and ask them in your reply, naming ${naming} with branch and version names in backticks (for example ${example}), and end your turn; their answer decides. The command: ${shown}`;
}

// Why the steps are held, or null when nothing holds them.
export type Hold = HoldReason | null;

const STEP_NAME: Record<HoldStep, string> = {
  push: 'a push',
  pr: 'a pull request',
  merge: 'a merge',
  approve: 'an approval',
  release: 'a release',
  comment: 'a reply on GitHub',
};

// What held the steps, so the agent can tell the user.
function heldWhy(held: HoldReason): string {
  const step = STEP_NAME[held.step];
  return held.how === 'mentioned'
    ? `their message mentioned ${step} without asking for one`
    : `they put off ${step} the agent offered`;
}

// Why a reply granted nothing, when the refused step is one its offer named;
// merging the version pull request is the release a merge offer covers.
function unreadFor(unread: UnreadOffer | null, step: HoldStep | 'commit'): string | null {
  if (unread === null) return null;
  const named =
    unread.steps.includes(step) || (step === 'release' && unread.steps.includes('merge'));
  return named ? unread.why : null;
}

const ASKED_FOR: Record<Step | 'comment', string> = {
  commit: 'a commit',
  push: 'a push',
  pr: 'a pull request',
  merge: 'a merge',
  approve: 'an approval',
  release: 'a release',
  comment: 'a comment on GitHub',
};

// Why the user's latest message does not cover the step, the setting
// included when its files could not be read.
export function notAsked(
  step: Step | 'comment',
  ladder: InForce,
  held: Hold,
  offered: UnreadOffer | null = null,
): string {
  const what = ASKED_FOR[step];
  const unread = unreadFor(offered, step);
  const offer = unread === null ? '' : ` (${unread})`;
  const why =
    held !== null && holds(held, step)
      ? `the user held off (${heldWhy(held)}) and hasn't asked for ${what} since`
      : `the user's latest message doesn't ask for ${what}${offer}`;
  return ladder.unreadable === undefined
    ? why
    : `could not read ${ladder.unreadable}, so the gate stops before every step, and ${why}`;
}

function prRefusal(shown: string, ladder: InForce, held: Hold, unread: UnreadOffer | null): string {
  return `${notAsked('pr', ladder, held, unread)}, so nothing ran. To open one, ${askThem('the branch and the base it targets', '"Open a PR from `fix/x` into `main`?"', shown)}`;
}

function submitRefusal(
  shown: string,
  ladder: InForce,
  held: Hold,
  unread: UnreadOffer | null,
): string {
  return `${notAsked('pr', ladder, held, unread)}, and \`gh stack submit\` also pushes every active branch of the stack with --force-with-lease, so nothing ran. To run it, ${askThem('the stack, that it force-pushes its branches with a lease and that it opens their pull requests,', '"Force-push the stack `feat/a`, `feat/b` with a lease and open its PRs?"', shown)}`;
}

// The branch oakum's version pull request comes from: merging it is the release.
export const VERSION_BRANCH = 'oakum/version-packages';

const CANNOT: Record<'elsewhere' | 'unnamed', string> = {
  elsewhere:
    'something outside the words the gate looks up picks where it merges (a `--repo` built at run time, `GH_REPO=`, `GIT_DIR=`, `env -C`, `--hostname`, a URL on another host), so the gate cannot tell a release from a merge',
  unnamed:
    'it does not name the pull request by number and repository, so the gate cannot tell a release from a merge',
};

// The merge states GitHub merges at once, which is all `--auto` waits for:
// required checks passed and nothing blocks (pr-watch reads ready the same).
const READY = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

type Target = { number: string; state: string; mergeState: string };

// Why the gate cannot tell which pull request a merge reaches, and the fix.
const UNTOLD: Record<'elsewhere' | 'unnamed' | 'beside', { asks: string; remedy: string }> = {
  beside: {
    asks: 'other steps in the same command can change which pull request it reaches',
    remedy: 'Run the merge as its own command.',
  },
  elsewhere: {
    asks: 'something outside its words picks where it merges (`GH_REPO=`, `GH_HOST=`, `GIT_DIR=`, `env -C`, `--hostname`, a `--repo` built at run time, a URL on another host)',
    remedy:
      'If the user meant a pull request on another host or repository, give them the command to run themselves; otherwise run it from this repository without those.',
  },
  unnamed: { asks: 'it does not name the pull request', remedy: 'Name it by number.' },
};

// What `gh stack merge <target>` merges, or why the gate cannot tell and the
// fix (null: ask the user).
async function stackSetOf(
  lookups: GhLookups,
  target: number | Unlookable,
): Promise<MergeSet | { asks: string; remedy: null }> {
  if (typeof target !== 'number') {
    if (target.cannot !== 'unnamed') return UNTOLD[target.cannot];
    return {
      asks: 'with no number it merges the current branch’s stack, which the gate does not look up',
      remedy: 'Name the stack or pull request: `gh stack merge <number> --yes`.',
    };
  }
  const read = await lookups.stack(target);
  if (read.asks !== undefined) return { asks: read.asks, remedy: read.slow ? SLOW : null };
  return mergeSet(target, read);
}

// The pull requests the user named to merge now and once ready. One the gate
// cannot tell (`?`) names none.
function namedOf(granted: Grant): { now: string[]; ready: string[] } {
  return { now: knownOf(granted.mergeNamed), ready: knownOf(granted.readyNamed) };
}
const knownOf = (named: readonly string[]) => named.filter((n) => n !== NAMED_ELSEWHERE);

// A merge the user asked for whose lookup GitHub was too slow to answer is
// retried, not put back to them.
const SLOW =
  'GitHub did not answer in time. Run the same command again, and the gate checks it once GitHub answers; ask the user only if it fails the same way again.';

// The pull request a merge reaches in this repository, as GitHub resolves its
// selector (a number, branch or URL), or why the gate cannot tell and the fix
// (null: retry, or ask the user).
async function targetOf(
  lookups: GhLookups,
  lookup: readonly string[] | { cannot: 'elsewhere' | 'unnamed' | 'beside' },
): Promise<Target | { asks: string; remedy: string | null }> {
  if ('cannot' in lookup) return UNTOLD[lookup.cannot];
  const r = read(await lookups.mergeTarget(lookup), 'the pull request it merges');
  if (r.asks !== undefined) return { asks: r.asks, remedy: r.slow ? SLOW : null };
  const m = /^(https?:\/\/\S+)\/pull\/(\d+) ([A-Z]+) ([A-Z_]+)$/.exec(r.out);
  if (m === null) {
    return {
      asks: `looking up the pull request it merges printed ${JSON.stringify(r.out)}`,
      remedy: null,
    };
  }
  const [, repo = '', number = '', state = '', mergeState = ''] = m;
  const home = read(await lookups.repoUrl(), 'the current repository');
  if (home.asks !== undefined) return { asks: home.asks, remedy: home.slow ? SLOW : null };
  if (home.out.toLowerCase() !== repo.toLowerCase()) {
    // The grammar names no repository, so asking again grants the same.
    return {
      asks: `it merges a pull request in ${repo}, not in this repository`,
      remedy: 'If the user meant that one, give them the command to run themselves.',
    };
  }
  return { number, state, mergeState };
}

// Whether a merge asked for once the pull request is ready may run now: why
// not, or why it may.
function readyNow(t: Target): { asks: string; closed?: true } | { ready: string } {
  // GitHub reports a merged pull request UNKNOWN for good.
  if (t.state !== 'OPEN') return { asks: `#${t.number} is ${t.state.toLowerCase()}`, closed: true };
  if (t.mergeState === 'UNKNOWN') {
    return {
      asks: `GitHub has not worked out yet whether #${t.number} can merge; try again shortly`,
    };
  }
  if (!READY.has(t.mergeState)) {
    return { asks: `GitHub reports #${t.number}'s merge state as ${t.mergeState}` };
  }
  return {
    ready: `GitHub reports #${t.number} ${t.mergeState}, which is all \`--auto\` waits for`,
  };
}

// Whether a merge that named no pull request reaches one the conversation
// pointed at: a number the messages or the answer named, or one from this
// repository headed by the current branch or oakum's version branch; a fork's
// branch can share either name. A lookup that fails says why.
async function pointedAt(
  lookups: GhLookups,
  lookup: readonly string[],
  target: Target,
  pointed: readonly string[],
): Promise<boolean | { asks: string; remedy: string | null }> {
  if (pointed.includes(target.number)) return true;
  const pr = await lookups.pullRequest(lookup, MERGED);
  if ('asks' in pr) return { asks: pr.asks, remedy: pr.slow ? SLOW : null };
  if (pr.cross) return false;
  if (pr.branch === VERSION_BRANCH) return true;
  const here = await lookups.branch();
  return here.asks === undefined
    ? here.out.trim() === pr.branch
    : { asks: here.asks, remedy: null };
}

const MERGED = 'the pull request it merges';

// Why the default branch is not done yet ("when main is done"), or null when
// every check on its head commit finished without failing.
// Whether `t` is the version pull request a standing release covers: the one
// open when the user asked, or the first opened after the newest then. A read
// that fails covers nothing.
async function releaseMatches(
  lookups: GhLookups,
  lookup: readonly string[],
  t: Target,
  release: NonNullable<Standing['release']>,
): Promise<boolean> {
  const which = await mergeStep(lookups, lookup);
  if (!('step' in which) || which.step !== 'release') return false;
  if ('pr' in release) return t.number === release.pr;
  const listed = await lookups.versionPulls();
  if (listed.asks !== undefined) return false;
  const after = listed.out
    .split(/\s+/)
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n > release.after);
  return after.length > 0 && t.number === String(Math.min(...after));
}

async function mainNotDone(lookups: GhLookups): Promise<{ asks: string; retry: boolean } | null> {
  const r = read(await lookups.mainChecks(), "the default branch's checks");
  if (r.asks !== undefined) return { asks: r.asks, retry: false };
  const [branch = '', state = ''] = r.out.split(' ');
  const on = `the checks on \`${branch}\``;
  if (state === 'SUCCESS') return null;
  if (state === 'PENDING' || state === 'EXPECTED') {
    return { asks: `${on} have not finished`, retry: true };
  }
  if (state === 'FAILURE' || state === 'ERROR') return { asks: `${on} failed`, retry: false };
  if (state === 'NONE') {
    return {
      asks: `\`${branch}\` reports no checks, so the gate cannot tell it is done`,
      retry: false,
    };
  }
  return { asks: `looking up ${on} printed \`${r.out}\``, retry: false };
}

// One verdict reads a pull request at most once: pointing and the release
// check both ask for it.
function pullRequestOnce(lookups: GhLookups): GhLookups {
  const seen = new Map<string, ReturnType<GhLookups['pullRequest']>>();
  return {
    ...lookups,
    pullRequest: (lookup, what) => {
      const key = `${what}\n${lookup.join('\n')}`;
      const read = seen.get(key) ?? lookups.pullRequest(lookup, what);
      seen.set(key, read);
      return read;
    },
  };
}

// Which step a merge is: a release when it merges this repository's version
// pull request. A lookup that fails says why, and the merge asks.
async function mergeStep(
  lookups: GhLookups,
  lookup: readonly string[],
): Promise<{ step: 'merge' | 'release' } | { asks: string }> {
  const pr = await lookups.pullRequest(lookup, MERGED);
  if ('asks' in pr) return { asks: pr.asks };
  return { step: !pr.cross && pr.branch === VERSION_BRANCH ? 'release' : 'merge' };
}

// Why a push the ladder lets through asks anyway, or null: one to the
// default branch, or one whose branch the gate cannot tell.
async function pushAsks(lookups: GhLookups, ref: PushRef): Promise<string | null> {
  const t = await branchOf(lookups, ref);
  if ('asks' in t) return t.asks;
  return askingReason([t.ref], t.defaults);
}

// The branch a GitHub write updates and its repository's default branch.
// `asks` keeps the branch when only the default branch could not be read.
async function branchOf(
  lookups: GhLookups,
  ref: PushRef,
): Promise<
  { ref: DryRunRef; defaults: Map<string, DefaultBranch> } | { asks: string; ref?: DryRunRef }
> {
  if ('asks' in ref) return { asks: ref.asks };
  let target: { branch: string; repo: string | null } = { branch: '', repo: null };
  if ('head' in ref) {
    const head = await lookups.pullRequest(ref.head, 'the pull request it updates');
    if ('asks' in head) return { asks: head.asks };
    if (head.cross) return { asks: "it updates a branch in the pull request's fork" };
    if (head.branch === '') return { asks: 'the pull request it updates names no branch' };
    target = head;
  } else target = ref;
  const url = target.repo ?? '';
  const branch: DryRunRef = { flag: ' ', to: `refs/heads/${target.branch}`, url };
  const r = read(await lookups.defaultBranch(target.repo), 'the default branch');
  if (r.asks !== undefined) return { asks: r.asks, ref: branch };
  return { ref: branch, defaults: new Map([[url, { branch: r.out }]]) };
}

const judged = (u: Unnamed | null) => (u === null ? null : { unnamed: u });

// What a push the user asked for still needs: their naming of the default
// branch or tag it writes, or a word to the agent that its target went
// unchecked. A write that names no branch lands on the default one.
async function coveredAsks(
  lookups: GhLookups,
  ref: PushRef,
  named: readonly string[],
): Promise<{ unnamed: Unnamed } | { asks: string } | { unchecked: string } | null> {
  if ('asks' in ref && ref.tag !== undefined) {
    const tag: DryRunRef = { flag: ' ', to: `refs/tags/${ref.tag}`, url: '' };
    return judged(unnamedTarget([tag], new Map(), named, null));
  }
  if ('asks' in ref && (ref.toDefault || ref.unknown)) return { asks: ref.asks };
  if ('asks' in ref && ref.branch !== undefined) {
    const { name, repo, deletes } = ref.branch;
    const r = read(await lookups.defaultBranch(repo), 'the default branch');
    const url = repo ?? '';
    const defaults = new Map(r.asks === undefined ? [[url, { branch: r.out }]] : []);
    const to: DryRunRef = { flag: deletes ? '-' : '+', to: `refs/heads/${name}`, url };
    const u = unnamedTarget([to], defaults, named, null);
    if (u !== null) return { unnamed: u };
    return r.asks === undefined ? null : { unchecked: r.asks };
  }
  const t = await branchOf(lookups, ref);
  if ('defaults' in t) return judged(unnamedTarget([t.ref], t.defaults, named, null));
  const u = t.ref === undefined ? null : unnamedTarget([t.ref], new Map(), named, null);
  return u === null ? { unchecked: t.asks } : { unnamed: u };
}

// Each example is one the consent grammar grants on a yes (consent.spec.ts).
const GH_ASK: Record<'merge' | 'approve' | 'release' | 'comment' | 'push', [string, string]> = {
  merge: ['the pull request', '"Merge #116?"'],
  approve: ['the pull request', '"Approve #116?"'],
  release: ['the version it releases', '"Release `v0.25.0`?"'],
  comment: ['where it goes and what it says', '"Reply to the review on #116?"'],
  push: ['what it pushes and where', '"Push `fix/x` to `origin`?"'],
};

function ghRefusal(
  shown: string,
  kind: keyof typeof GH_ASK,
  ladder: InForce,
  always: string | null,
  held: Hold,
  unread: UnreadOffer | null,
): string {
  const [naming, example] = GH_ASK[kind];
  const asksAnyway = always === null ? '' : ` This asks whatever the setting: ${always}.`;
  const unreviewed =
    kind === 'push' ? ' It writes to GitHub directly, so no review covers it.' : '';
  return `${notAsked(kind, ladder, held, unread)}, so nothing ran.${asksAnyway}${unreviewed} To go ahead, ${askThem(naming, example, shown)}`;
}

// A refusal no model reading can lift is `final`; `notes` tell the agent what
// ran unchecked.
export type GhVerdict =
  | { deny: string; final?: true }
  | { ran: Unasked[]; notes?: readonly string[]; used?: Used };

// The asks for once ready that a merge allowed here fulfils, so they end.
export type Used = { ready: readonly string[]; release: boolean };

// Asks for once ready that outlast their message, covering no merge now.
// `release` is the version pull request open when asked, or the first after.
// `main` lists the asks that also wait on the default branch: numbers, and
// RELEASE_ASK for the version pull request.
export type Standing = Readonly<{
  ready: readonly string[];
  release: { pr: string } | { after: number } | null;
  main: readonly string[];
}>;

export const RELEASE_ASK = 'release';
export const NO_STANDING: Standing = Object.freeze({ ready: [], release: null, main: [] });

// What the GitHub writes in a call may run, or the refusal of the first one
// that may not. A comment is off the ladder: it needs the user's request. A
// requested pull request lets no push through GitHub's API, which no review
// covers.
export async function judgeGh(
  shown: string,
  actions: readonly GhAction[],
  asked: Grant,
  held: Hold,
  given: GhLookups,
  model: ModelSteps = {},
  unread: UnreadOffer | null = null,
  // The pull request numbers the conversation pointed a merge at.
  pointed: readonly string[] = [],
  standing: Standing = NO_STANDING,
): Promise<GhVerdict> {
  const lookups = pullRequestOnce(given);
  const ran: Unasked[] = [];
  const notes: string[] = [];
  const used = { ready: [] as string[], release: false };
  if (actions.length === 0) return { ran };
  const ladder = await lookups.ladder();
  const refuse = (kind: keyof typeof GH_ASK, always: string | null) => ({
    deny: ghRefusal(shown, kind, ladder, always, held, unread),
  });
  // A stack merge is judged as the merges it expands to, in its place, each
  // under the grant that covered the stack.
  const queue: { action: GhAction; granted?: Grant }[] = actions.map((action) => ({ action }));
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    const { action } = item;
    const granted = item.granted ?? asked;
    const may = permitted(granted, ladder, held, model);
    // Only a step the setting let through is noted as run unasked.
    const bySetting = permitted(granted, ladder, held);
    switch (action.kind) {
      case 'pr': {
        if (!may.pr) return { deny: prRefusal(shown, ladder, held, unread) };
        if (!granted.pr && bySetting.pr) ran.push({ step: 'pr', ladder });
        break;
      }
      case 'unread': {
        const remedy = action.remedy ?? 'Run the gh command itself, written out.';
        return {
          deny: `${action.why}, so the gate cannot tell which step it takes, and nothing ran. ${remedy} The command: ${shown}`,
        };
      }
      case 'comment': {
        if (!granted.comment) return refuse('comment', null);
        break;
      }
      case 'approve': {
        if (!may.approve) return refuse('approve', null);
        if (!granted.approve && bySetting.approve) ran.push({ step: 'approve', ladder });
        break;
      }
      case 'release': {
        if (!may.release) return refuse('release', null);
        if (!granted.release && bySetting.release) ran.push({ step: 'release', ladder });
        break;
      }
      case 'push': {
        const { ref } = action;
        const needed = 'asks' in ref && ref.force ? 'bare' : 'push';
        if (covers(granted, needed)) {
          const c = await coveredAsks(lookups, ref, granted.pushNamed);
          if (c === null) break;
          if ('unchecked' in c) {
            notes.push(
              `review-cycle ran the push the user asked for without checking where it goes: ${c.unchecked}. If it may have reached the default branch or a tag they did not name, tell them.`,
            );
            break;
          }
          const asked = "the user's latest message asks for a push, but";
          if ('asks' in c) {
            return {
              deny: `${asked} ${c.asks}, so nothing ran. Write the branch and repository out in the call, and the push is judged by where it goes.`,
              final: true,
            };
          }
          const then =
            c.unnamed.offer === null
              ? `The gate never does that for the user. Give them the command to run themselves, and say why it is needed. The command: ${shown}`
              : `To push there, ${askThem('where it pushes', c.unnamed.offer, shown)}`;
          return { deny: `${asked} ${c.unnamed.why}, so nothing ran. ${then}`, final: true };
        }
        const outcome = await pushOutcome(needed, may.push, () => pushAsks(lookups, ref));
        if (outcome.kind === 'unasked' && bySetting.push) ran.push({ step: 'push', ladder });
        if (outcome.kind !== 'refused') break;
        if (outcome.missing === 'bare') {
          return {
            deny: `a forced ref update overwrites whatever the branch holds, with no lease, and the user's latest message doesn't ask for a bare force, so nothing ran. If they want one, ${askThem('what it overwrites and where', '"Force-push `fix/x` to `origin` without a lease?"', shown)}`,
          };
        }
        return refuse('push', outcome.always);
      }
      case 'merge': {
        if (action.admin) {
          return {
            deny: `--admin merges past branch protection, which the gate never lets an agent do, so nothing ran. Give the user the command to run themselves, and say why it needs --admin. The command: ${shown}`,
          };
        }
        // Named pull requests bind by the number GitHub resolves, whatever the
        // setting. One the gate cannot tell (`?`) binds `--auto` to none.
        const { now: nowNamed, ready: readyNamed } = namedOf(granted);
        // An unnamed merge now never covers one named for once ready ("merge
        // it, and merge 62 once CI passes").
        const nowAny = granted.merge && nowNamed.length === 0;
        const readyAny =
          granted.autoMerge &&
          (action.auto ? readyNamed.length === 0 : granted.readyNamed.length === 0);
        let covers = { now: nowAny, ready: readyAny };
        let target: Target | null = null;
        // A bare merge reaches this branch's pull request, but not beside
        // `gh pr checkout 62`, so an unlookable one must name a pointed number.
        const unlookable = 'cannot' in action.lookup ? action.lookup : null;
        const bare =
          !('cannot' in action.lookup) &&
          (action.lookup[0] === undefined || action.lookup[0] === '--repo');
        const besidePointed =
          unlookable !== null &&
          unlookable.cannot !== 'elsewhere' &&
          unlookable.selector !== undefined &&
          pointed.includes(unlookable.selector);
        const unnamedMay = nowAny || readyAny;
        const free =
          (bare || besidePointed) &&
          ((nowAny && readyNamed.length === 0) || (readyAny && action.auto));
        // An unnamed merge of one nothing pointed at, or whose lookup failed,
        // is judged as if unasked, so it is never stricter than the setting;
        // a refusal there still names the failure (`lost`).
        const settingMay =
          unnamedMay &&
          permitted({ ...granted, merge: false, autoMerge: false }, ladder, held, model).merge;
        let unasked = false;
        let lost: string | null = null;
        // "release when the PR is ready" covers oakum's version pull request
        // once ready, and the release that merging it is.
        let readyRelease = false;
        // The standing ask that covers the merge, when one does.
        let byStanding: string | null = null;
        const standingAsks = standing.ready.length > 0 || standing.release !== null;
        if ((granted.merge || granted.autoMerge || granted.readyRelease || standingAsks) && !free) {
          const t = await targetOf(lookups, action.lookup);
          if ('asks' in t) {
            const named = [...nowNamed, ...readyNamed].map((n) => `#${n}`).join(', ');
            const remedy =
              t.remedy === null
                ? `To go ahead, ${askThem('the pull request', '"Merge #116?"', shown)}`
                : `${t.remedy} The command: ${shown}`;
            lost = `the user asked to merge ${named || 'a pull request'}, and the gate cannot tell whether this is it: ${t.asks}, so nothing ran. ${remedy}`;
            // It may be one they named, and one merged now on readiness alone
            // waits on GitHub whatever the setting.
            unasked = settingMay && named === '' && (nowAny || (readyAny && action.auto));
            if (!unasked) return { deny: lost };
            covers = { now: false, ready: false };
          } else {
            const unnamedHere = !nowNamed.includes(t.number) && !readyNamed.includes(t.number);
            unasked = settingMay && unnamedHere;
            // A merge naming no pull request covers one the conversation pointed at.
            const pointing =
              unnamedMay && unnamedHere && !('cannot' in action.lookup)
                ? await pointedAt(lookups, action.lookup, t, pointed)
                : false;
            if (typeof pointing === 'object') {
              const remedy =
                pointing.remedy === null
                  ? `To go ahead, ${askThem('the pull request', `"Merge #${t.number}?"`, shown)}`
                  : `${pointing.remedy} The command: ${shown}`;
              lost = `the user named no pull request, and the gate cannot tell whether the conversation pointed at #${t.number}: ${pointing.asks}, so nothing ran. ${remedy}`;
              if (!unasked) return { deny: lost };
            }
            const isPointed = pointing === true;
            target = t;
            covers = {
              now:
                granted.merge &&
                (nowAny
                  ? isPointed && !readyNamed.includes(t.number)
                  : nowNamed.includes(t.number)),
              ready: granted.autoMerge && (readyAny ? isPointed : readyNamed.includes(t.number)),
            };
            const lookable = !('cannot' in action.lookup) ? action.lookup : null;
            if (granted.readyRelease && !covers.now && lookable !== null) {
              const which = await mergeStep(lookups, lookable);
              readyRelease = 'step' in which && which.step === 'release';
              if (readyRelease) covers = { ...covers, ready: true };
            }
            // Any merge allowed of a pull request a standing ask names ends that
            // ask, now or once ready; it covers only once ready.
            const standingRelease =
              standing.release !== null &&
              lookable !== null &&
              (await releaseMatches(lookups, lookable, t, standing.release));
            const standingHere = standing.ready.includes(t.number) || standingRelease;
            if (standingHere && !covers.now && !covers.ready) {
              covers = { ...covers, ready: true };
              byStanding = standingRelease ? RELEASE_ASK : t.number;
              readyRelease ||= standingRelease;
            }
            if (standing.ready.includes(t.number)) used.ready.push(t.number);
            else if (covers.ready && !covers.now && readyNamed.includes(t.number)) {
              used.ready.push(t.number);
            }
            if (standingRelease || (readyRelease && !covers.now)) used.release = true;
          }
        }
        // A pull request both named and bound as the release keeps either's condition.
        const mainAsked =
          byStanding === null
            ? granted.readyMain
            : standing.main.includes(byStanding) || standing.main.includes(target?.number ?? '');
        if (mainAsked && covers.ready && !covers.now) {
          const main = await mainNotDone(lookups);
          if (main !== null) {
            const next = main.retry
              ? 'Run the same command again once they pass; there is nothing to ask the user.'
              : 'Tell the user, and merge nothing until they say.';
            return {
              deny: `the user asked to merge once the default branch is done, and ${main.asks}, so nothing ran. ${next} The command: ${shown}`,
            };
          }
        }
        // A merge now of one asked for once ready runs only when it already is.
        if (target !== null && covers.ready && !covers.now && !action.auto) {
          const now = readyNow(target);
          if ('asks' in now && now.closed) {
            return {
              deny: `the user asked to merge only once the pull request is ready, and ${now.asks}, so nothing ran; \`--auto\` cannot merge it either. Tell the user. The command: ${shown}`,
            };
          }
          // `--auto` on oakum's version pull request is a release too.
          const releases = permitted(
            { ...granted, merge: true, release: granted.release || readyRelease },
            ladder,
            held,
            model,
          ).release;
          if ('asks' in now && !releases && !('cannot' in action.lookup)) {
            const which = await mergeStep(lookups, action.lookup);
            if ('step' in which && which.step === 'release') return refuse('release', null);
          }
          if ('asks' in now) {
            return {
              deny: `the user asked to merge only once the pull request is ready, and ${now.asks}, so nothing ran. Run \`gh pr merge ${target.number} --auto\`, which leaves the waiting to GitHub, or ${askThem('the pull request', '"Merge #116 now?"', shown)}`,
            };
          }
          ran.push({ step: 'merge', ladder, ready: now.ready });
        }
        // "merge 46 and release it" still covers oakum's version pull request.
        let known: Awaited<ReturnType<typeof mergeStep>> | null = null;
        if (target !== null && !covers.now && !covers.ready && !unasked) {
          const named = [...nowNamed, ...readyNamed].map((n) => `#${n}`).join(', ');
          const wanted = named
            ? `the user asked to merge ${named}`
            : unnamedMay
              ? `the user named no pull request, and neither they nor the answer they replied to named #${target.number}, nor is it this branch's or the version pull request`
              : granted.readyRelease
                ? "the user asked to merge only oakum's version pull request, once it is ready"
                : 'the gate cannot tell which pull request the user asked to merge';
          if (granted.release && !('cannot' in action.lookup)) {
            known = await mergeStep(lookups, action.lookup);
          }
          const unread = known !== null && 'asks' in known ? ` (${known.asks})` : '';
          if (known === null || 'asks' in known || known.step !== 'release') {
            return {
              deny: `it merges #${target.number}, and ${wanted}${unread}, so nothing ran. To go ahead, ${askThem('the pull request', `"Merge #${target.number}?"`, shown)}`,
            };
          }
        }
        const asked = {
          ...granted,
          merge: covers.now || covers.ready,
          release: granted.release || readyRelease,
        };
        const mayHere = permitted(asked, ladder, held, model);
        const setHere = permitted(asked, ladder, held);
        // A merge the user asked for covers oakum's version pull request too:
        // merging it is the only way to release, so "merge it" asks for that,
        // unless the same message held off a release ("merge 131. don't release yet")
        // or named other pull requests ("merge 131" never merges #130).
        const covered =
          granted.mergeNamed.length === 0 || (target !== null && nowNamed.includes(target.number));
        if (covers.now && !holds(held, 'release') && covered) break;
        // Allowed either way, a merge needs no lookup to run, except one run
        // now on readiness alone: a release there is noted. One that runs
        // unasked is looked up only so its note names the step it is.
        const readyOnly = target !== null && covers.ready && !covers.now && !action.auto;
        if (mayHere.merge && mayHere.release && !readyOnly) {
          if (!asked.merge && setHere.merge && setHere.release) {
            const it = 'cannot' in action.lookup ? null : await mergeStep(lookups, action.lookup);
            const step = it !== null && 'step' in it ? it.step : 'merge';
            if (!asked[step]) ran.push({ step, ladder });
          }
          break;
        }
        const { lookup } = action;
        let which: Awaited<ReturnType<typeof mergeStep>>;
        if (known !== null) which = known;
        else if (!('cannot' in lookup)) which = await mergeStep(lookups, lookup);
        else if (lookup.cannot === 'beside') {
          return {
            deny: `other steps in the same command can change which pull request the merge reaches, so the gate cannot tell a release from a merge, and nothing ran. Run the merge as its own command. The command: ${shown}`,
          };
        } else which = { asks: CANNOT[lookup.cannot] };
        const refused = 'asks' in which || !mayHere[which.step];
        if (refused && lost !== null) return { deny: lost };
        if ('asks' in which && mayHere.merge) {
          return {
            deny: `the merge may be a release, which the user has not allowed: ${which.asks}. Nothing ran. To merge it, ${askThem('the pull request', '"Merge and release #62?"', shown)}`,
          };
        }
        if ('asks' in which) return refuse('merge', which.asks);
        const step = which.step;
        if (!mayHere[step]) return refuse(step, null);
        if (!asked[step] && setHere[step]) ran.push({ step, ladder });
        break;
      }
      case 'stack': {
        if (action.step === 'submit' || action.step === 'link') {
          // Asked for both at once unless the push runs on the setting alone,
          // so one answer covers the command: a push asked for in this message
          // does not last to the answer.
          if (!may.pr && action.step === 'submit') {
            const isPushSet = permitted(NO_GRANT, ladder, held).push;
            const bound = !isPushSet
              ? null
              : 'unread' in action.where
                ? { asks: action.where.unread }
                : await lookups.stackLease(action.step, action.where.remote);
            if (bound === null || 'asks' in bound) {
              return { deny: submitRefusal(shown, ladder, held, unread) };
            }
          }
          if (!may.pr) return { deny: prRefusal(shown, ladder, held, unread) };
          if (!granted.pr && bySetting.pr) ran.push({ step: 'pr', ladder });
        }
        // `link` pushes plainly; the rest lease every active branch.
        if (action.step === 'link') {
          if (!may.push) return refuse('push', null);
          if ('unread' in action.where) {
            return {
              deny: `\`gh stack link\` pushes the branches it names, and ${action.where.unread}, so the gate cannot tell whether one is the default branch, and nothing ran. Run it on its own, from this repository, with at most one \`--remote\`. The command: ${shown}`,
            };
          }
          const branches = action.branches ?? [];
          if (branches.length > 0) {
            const { remote } = action.where;
            // The default branch gh reads is this repository's, not a named remote's.
            const r =
              remote === null
                ? read(await lookups.defaultBranch(null), 'the default branch')
                : {
                    asks: `it pushes to \`${remote}\`, whose default branch the gate does not read`,
                  };
            const defaults = new Map(r.asks === undefined ? [['', { branch: r.out }]] : []);
            const refs = branches.map((b) => ({ flag: ' ', to: `refs/heads/${b}`, url: '' }));
            const u = unnamedTarget(refs, defaults, granted.pushNamed, null);
            if (u !== null) {
              const then =
                u.offer === null
                  ? `Give the user the command to run themselves. The command: ${shown}`
                  : `To push there, ${askThem('where it pushes', u.offer, shown)}`;
              return {
                deny: `\`gh stack link\` pushes the branches it names, and ${u.why}, so nothing ran. ${then}`,
              };
            }
            // As for `git push`: a push the setting let through asks when its
            // target is unchecked; one the user asked for runs with a note.
            if (r.asks !== undefined && !covers(granted, 'push')) {
              return refuse('push', `the default branch could not be read (${r.asks})`);
            }
            if (r.asks !== undefined) {
              notes.push(
                `review-cycle ran \`gh stack link\` without checking whether a branch it pushes is the default branch: ${r.asks}. If it may have pushed one the user did not name, tell them.`,
              );
            }
          }
          if (!covers(granted, 'push') && bySetting.push) ran.push({ step: 'push', ladder });
          break;
        }
        if (covers(granted, 'lease')) break;
        const ask = askThem(
          'the stack and that it force-pushes its branches with a lease',
          '"Force-push the stack with a lease?"',
          shown,
        );
        if (!may.push) {
          return {
            deny: `\`gh stack ${action.step}\` pushes every active branch of the stack with --force-with-lease, and the user's latest message doesn't ask for a forced push, so nothing ran. If they want it, ${ask}`,
          };
        }
        // A push request covers gh-stack's own leased push while it can only
        // overwrite what this agent pushed.
        const bound =
          'unread' in action.where
            ? { asks: action.where.unread }
            : await lookups.stackLease(action.step, action.where.remote);
        if ('asks' in bound) {
          return {
            deny: `\`gh stack ${action.step}\` pushes every active branch of the stack with --force-with-lease. A push request covers that only while each branch is where this agent last pushed it, and ${bound.asks}, so nothing ran. If they want it, ${ask}`,
          };
        }
        if (!covers(granted, 'push') && bySetting.push) ran.push({ step: 'push', ladder });
        break;
      }
      case 'stack-merge': {
        const set = await stackSetOf(lookups, action.target);
        if ('asks' in set) {
          const remedy = set.remedy ?? 'Give the user the command to run themselves.';
          return {
            deny: `\`gh stack merge\` merges a pull request and every unmerged one below it, and the gate cannot tell which: ${set.asks}, so nothing ran. ${remedy} The command: ${shown}`,
          };
        }
        const listed = set.prs.map((n) => `#${n}`).join(', ');
        // "merge the stack", "merge stack 4" or "merge up to #3" names every
        // layer it merges, each still judged as its own merge.
        const top = set.prs.at(-1);
        const stacked = granted.mergeStack.some(
          (t) =>
            t === 'stack' ||
            (set.stack && typeof action.target === 'number' && t === `stack:${action.target}`) ||
            t === `upto:${top}`,
        );
        const layerGrant = stacked
          ? { ...granted, merge: true, mergeNamed: set.prs.map(String) }
          : granted;
        // One "merge it" names one pull request; a stack merge of several
        // needs each named, now or once ready, unless the setting merges
        // without asking.
        const { now, ready } = namedOf(granted);
        const named = new Set([...now, ...ready]);
        const ladderMerges = permitted({ ...granted, merge: false }, ladder, held).merge;
        if (
          !stacked &&
          set.prs.length > 1 &&
          !ladderMerges &&
          !set.prs.every((n) => named.has(String(n)))
        ) {
          return {
            deny: `\`gh stack merge\` merges ${listed} together, and the user's latest message doesn't name them all, so nothing ran. To merge them, ${askThem('every pull request it merges', `"Merge ${listed}?"`, shown)}`,
          };
        }
        queue.unshift(
          ...set.prs.map((n) => ({
            action: {
              kind: 'merge' as const,
              admin: false,
              auto: false,
              lookup: [String(n)],
            },
            granted: layerGrant,
          })),
        );
        break;
      }
      default: {
        const unhandled: never = action;
        throw new Error(`no judgment for the gh action ${JSON.stringify(unhandled)}`);
      }
    }
  }
  const done = used.release || used.ready.length > 0 ? { used } : {};
  return notes.length === 0 ? { ran, ...done } : { ran, notes, ...done };
}
