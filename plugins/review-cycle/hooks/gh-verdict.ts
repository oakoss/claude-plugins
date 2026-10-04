// Whether the GitHub writes in a call may run on the stop-before ladder, and
// the refusals when they may not. Pure: what it needs from gh or the settings
// comes through `GhLookups`, which register.ts builds.

import { covers, type Grant, type HoldReason, type HoldStep } from './consent';
import type { GhAction, PushRef } from './github';
import { asks, type Ladder, type Step } from './ladder';
import { askingReason, pushOutcome } from './push-verdict';

// `unreadable` names the settings file that could not be read, and why.
export type InForce = Ladder & { unreadable?: string };
// A step that runs without the user asking for it directly, by the ladder.
export type Unasked = { step: Step; ladder: Ladder };

// What a gh read printed, or why the step asks instead.
export type Lookup = { out: string; asks?: never } | { asks: string; out?: never };

export type PullRequest = { cross: boolean; repo: string; branch: string };

export const PR_FIELDS = 'url,isCrossRepository,headRefName';
export const PR_JQ = String.raw`"\(.isCrossRepository) \(.url) \(.headRefName)"`;

export function parsePullRequest(out: string): PullRequest | { asks: string } {
  const read = /^(true|false) https:\/\/([^/\s]+\/[^/\s]+\/[^/\s]+)\/pull\/\d+ (\S+)$/.exec(out);
  if (read === null) return { asks: `looking up the pull request it updates printed \`${out}\`` };
  const [, cross = '', repo = '', branch = ''] = read;
  // The repository from the pull request's URL, so an Enterprise host survives.
  return { cross: cross === 'true', repo, branch };
}

export type GhLookups = {
  ladder: () => Promise<InForce>;
  // The head branch of the pull request `gh pr view <lookup>` names.
  mergeHead: (lookup: readonly string[]) => Promise<Lookup>;
  pullRequest: (head: readonly string[]) => Promise<PullRequest | { asks: string }>;
  // The default branch of `repo` (HOST/OWNER/NAME or OWNER/NAME), or of the
  // repository gh picks when it is null.
  defaultBranch: (repo: string | null) => Promise<Lookup>;
};

// A read's text without surrounding space; one that printed nothing names
// nothing, so the step asks.
function read(r: Lookup, what: string): Lookup {
  if (r.asks !== undefined) return r;
  const out = r.out.trim();
  return out === '' ? { asks: `looking up ${what} printed nothing` } : { out };
}

// What may run: what the user asked for, and what the ladder lets through.
// A hold stops every step but a commit.
type Allowed = Readonly<Record<Step, boolean>>;
export function permitted(granted: Grant, ladder: Ladder, held: boolean): Allowed {
  const free = (step: Step) => !asks(ladder, step);
  return {
    commit: granted.commit || free('commit'),
    push: covers(granted, 'push') || (!held && free('push')),
    pr: granted.pr || (!held && free('pr')),
    merge: granted.merge || (!held && free('merge')),
    approve: granted.approve || (!held && free('approve')),
    release: granted.release || (!held && free('release')),
  };
}

// The agent asks in its reply, naming the step and its target, and ends its turn.
// `shown` is the call as the refusal quotes it.
export function askThem(naming: string, example: string, shown: string): string {
  return `stop and ask them in your reply, naming ${naming} with names in backticks (for example ${example}), and end your turn; their answer decides. The command: ${shown}`;
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

// Why the user's latest message does not cover the step, the setting
// included when its files could not be read.
export function notAsked(what: string, ladder: InForce, holdable: boolean, held: Hold): string {
  const why =
    holdable && held !== null
      ? `the user held off (${heldWhy(held)}) and hasn't asked for ${what} since`
      : `the user's latest message doesn't ask for ${what}`;
  return ladder.unreadable === undefined
    ? why
    : `could not read ${ladder.unreadable}, so the gate stops before every step, and ${why}`;
}

function prRefusal(shown: string, ladder: InForce, held: Hold): string {
  return `${notAsked('a pull request', ladder, true, held)}, so nothing ran. To open one, ${askThem('the branch and the base it targets', '"Open a PR from `fix/x` into `main`?"', shown)}`;
}

// The branch oakum's version pull request comes from: merging it is the release.
const VERSION_BRANCH = 'oakum/version-packages';

const CANNOT: Record<'elsewhere' | 'unnamed', string> = {
  elsewhere:
    'something outside the words the gate looks up picks where it merges (a `--repo` built at run time, `GH_REPO=`, `GIT_DIR=`, `env -C`, `--hostname`, a URL on another host), so the gate cannot tell a release from a merge',
  unnamed:
    'it does not name the pull request by number and repository, so the gate cannot tell a release from a merge',
};

// The pull request number a merge names (`116`, or a URL ending in it), or
// null when it names none.
function pullNumberOf(lookup: readonly string[] | { cannot: string }): string | null {
  if ('cannot' in lookup) return null;
  const selector = lookup[0];
  if (selector === undefined || selector.startsWith('-')) return null;
  return /(\d+)\/?$/.exec(selector)?.[1] ?? null;
}

// Which step a merge is: a release when it merges the version pull request.
// A lookup that fails says why, and the merge asks.
async function mergeStep(
  lookups: GhLookups,
  lookup: readonly string[],
): Promise<{ step: 'merge' | 'release' } | { asks: string }> {
  const r = read(await lookups.mergeHead(lookup), 'the pull request it merges');
  if (r.asks !== undefined) return { asks: r.asks };
  return { step: r.out === VERSION_BRANCH ? 'release' : 'merge' };
}

// Why a push the ladder lets through asks anyway, or null: one to the
// default branch, or one whose branch the gate cannot tell.
async function pushAsks(lookups: GhLookups, ref: PushRef): Promise<string | null> {
  if ('asks' in ref) return ref.asks;
  let target: { branch: string; repo: string | null } = { branch: '', repo: null };
  if ('head' in ref) {
    const head = await lookups.pullRequest(ref.head);
    if ('asks' in head) return head.asks;
    if (head.cross) return "it updates a branch in the pull request's fork";
    if (head.branch === '') return 'the pull request it updates names no branch';
    target = head;
  } else target = ref;
  const r = read(await lookups.defaultBranch(target.repo), 'the default branch');
  if (r.asks !== undefined) return r.asks;
  const url = target.repo ?? '';
  return askingReason(
    [{ flag: ' ', to: `refs/heads/${target.branch}`, url }],
    new Map([[url, { branch: r.out }]]),
  );
}

// Each example is one the consent grammar grants on a yes (consent.spec.ts).
const GH_ASK: Record<
  'merge' | 'approve' | 'release' | 'comment' | 'push',
  [string, string, string]
> = {
  merge: ['a merge', 'the pull request', '"Merge #116?"'],
  approve: ['an approval', 'the pull request', '"Approve #116?"'],
  release: ['a release', 'the version it releases', '"Release `v0.25.0`?"'],
  comment: [
    'a comment on GitHub',
    'where it goes and what it says',
    '"Reply to the review on #116?"',
  ],
  push: ['a push', 'what it pushes and where', '"Push `fix/x` to `origin`?"'],
};

function ghRefusal(
  shown: string,
  kind: keyof typeof GH_ASK,
  ladder: InForce,
  always: string | null,
  held: Hold,
): string {
  const [what, naming, example] = GH_ASK[kind];
  const asksAnyway = always === null ? '' : ` This asks whatever the setting: ${always}.`;
  const unreviewed =
    kind === 'push' ? ' It writes to GitHub directly, so no review covers it.' : '';
  return `${notAsked(what, ladder, true, held)}, so nothing ran.${asksAnyway}${unreviewed} To go ahead, ${askThem(naming, example, shown)}`;
}

// What the GitHub writes in a call may run, or the refusal of the first one
// that may not. A comment is off the ladder: it needs the user's request. A
// requested pull request lets no push through GitHub's API, which no review
// covers.
export async function judgeGh(
  shown: string,
  actions: readonly GhAction[],
  granted: Grant,
  held: Hold,
  lookups: GhLookups,
): Promise<{ deny: string } | { ran: Unasked[] }> {
  const ran: Unasked[] = [];
  if (actions.length === 0) return { ran };
  const ladder = await lookups.ladder();
  const may = permitted(granted, ladder, held !== null);
  const refuse = (kind: keyof typeof GH_ASK, always: string | null) => ({
    deny: ghRefusal(shown, kind, ladder, always, held),
  });
  for (const action of actions) {
    switch (action.kind) {
      case 'pr': {
        if (!may.pr) return { deny: prRefusal(shown, ladder, held) };
        if (!granted.pr) ran.push({ step: 'pr', ladder });
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
        if (!granted.approve) ran.push({ step: 'approve', ladder });
        break;
      }
      case 'release': {
        if (!may.release) return refuse('release', null);
        if (!granted.release) ran.push({ step: 'release', ladder });
        break;
      }
      case 'push': {
        const { ref } = action;
        const needed = 'asks' in ref && ref.force ? 'bare' : 'push';
        const outcome = await pushOutcome(covers(granted, needed) ? null : needed, may.push, () =>
          pushAsks(lookups, ref),
        );
        if (outcome.kind === 'unasked') ran.push({ step: 'push', ladder });
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
        // A merge asked for once the pull request is ready is what `--auto`
        // does; a merge now goes against that request, whatever the setting.
        if (granted.autoMerge && !granted.merge && !action.auto) {
          return {
            deny: `the user asked to merge only once the pull request is ready, which \`gh pr merge --auto\` leaves to GitHub, so nothing ran. Run \`gh pr merge <number> --auto\`, naming the pull request by number, or ${askThem('the pull request', '"Merge #116 now?"', shown)}`,
          };
        }
        const asked = { ...granted, merge: granted.merge || (action.auto && granted.autoMerge) };
        const mayHere = permitted(asked, ladder, held !== null);
        // A merge the user asked for covers oakum's version pull request too:
        // merging it is the only way to release, so "merge it" asks for that,
        // unless the same message held off a release ("merge 131. don't release yet")
        // or named other pull requests ("merge 131" never merges #130).
        const named = granted.mergeNamed;
        const target = pullNumberOf(action.lookup);
        const covered = named.length === 0 || (target !== null && named.includes(target));
        if (granted.merge && held?.step !== 'release' && covered) break;
        // Allowed either way, a merge needs no lookup to tell which it is.
        if (mayHere.merge && mayHere.release) {
          if (!asked.merge && !asked.release) ran.push({ step: 'merge', ladder });
          break;
        }
        const { lookup } = action;
        let which: Awaited<ReturnType<typeof mergeStep>>;
        if (!('cannot' in lookup)) which = await mergeStep(lookups, lookup);
        else if (lookup.cannot === 'beside') {
          return {
            deny: `other steps in the same command can change which pull request the merge reaches, so the gate cannot tell a release from a merge, and nothing ran. Run the merge as its own command. The command: ${shown}`,
          };
        } else which = { asks: CANNOT[lookup.cannot] };
        if ('asks' in which && mayHere.merge) {
          return {
            deny: `the merge may be a release, which the user has not allowed: ${which.asks}. Nothing ran. To merge it, ${askThem('the pull request', '"Merge and release #62?"', shown)}`,
          };
        }
        if ('asks' in which) return refuse('merge', which.asks);
        const step = which.step;
        if (!mayHere[step]) return refuse(step, null);
        if (!asked[step]) ran.push({ step, ladder });
        break;
      }
      default: {
        const unhandled: never = action;
        throw new Error(`no judgment for the gh action ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return { ran };
}
