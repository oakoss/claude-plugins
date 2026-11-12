// Whether a git push may run, and the refusal when it may not. What it needs
// from git comes through a `Git` runner and the setting through `ladderOf`,
// which register.ts builds.

import { covers, type Grant, type UnreadOffer } from './consent';
import {
  askThem,
  offerThem,
  notAsked,
  permitted,
  type InForce,
  type Unasked as GhUnasked,
} from './gh-verdict';
import { firstLine, type Git } from './git';
import type { PushSpec } from './git-args';
import { holds, type Hold } from './hold';
import type { OfferStep } from './offers';
import { allows, prUpdateOf, type PrReads, type PrUpdatesInForce } from './pr-updates';
import {
  askingReason,
  parseDryRun,
  pushOutcome,
  unasked,
  unnamedTarget,
  type DefaultBranch,
  type DryRunRef,
  type Needed,
  type Unnamed,
} from './push-verdict';
import { anonymized, layerOf, parseCatalog, remoteOf, type LeaseIo } from './stack';

// A push a requested pull request needs (`forPr`) runs unasked, not noted;
// one `prUpdates` let through names the pull request it updates.
export type Unasked = GhUnasked & {
  forPr?: true;
  prUpdate?: {
    pull: number;
    branches: string[];
    setting: PrUpdatesInForce['prUpdates'];
    source: PrUpdatesInForce['source'];
  };
};

// The `prUpdates` setting and the GitHub reads it needs.
export type PrUpdating = { setting: () => Promise<PrUpdatesInForce>; reads: PrReads };

export const LEASE = '`--force-with-lease --force-if-includes`';

// The user's hold, the offer their reply did not read, and the command as the
// refusal quotes it; read again at each use, since a message can arrive while
// git answers.
export type PushConsent = () => Readonly<{ held: Hold; unread: UnreadOffer | null; shown: string }>;

// Git's own credential prompt fails instead of waiting, so the push asks.
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0' };
// Also after the push's options, to beat a -q or --verify; the leading
// --dry-run is the one no option value can swallow. Measured on git 2.56.
// A submodule push runs that submodule's hooks, which --no-verify misses.
const DRY_RUN = [
  '--dry-run',
  '--porcelain',
  '--no-verify',
  '--no-quiet',
  '--recurse-submodules=no',
];

const DELETES = 'it deletes a remote branch';

// Why a push asks whatever the setting, or null. Off the ladder: a push that
// changes a remote's default branch, pushes a tag, deletes or force-updates a
// ref, and one the gate cannot see the targets of. Git itself names the refs
// a push updates, with its own push config applied, through a dry run.
async function alwaysAsks(git: Git, top: string, spec: PushSpec): Promise<string | null> {
  if (spec.deletes) return DELETES;
  if (spec.every) return 'it pushes every branch';
  if (spec.tags) return 'it pushes tags';
  if (spec.argv === null) return 'its remote or branch is built at run time';
  if (spec.after !== null) {
    return `\`git ${spec.after}\` runs before it in the same command, which can change where it goes (run that step on its own first, and the push is judged after it)`;
  }
  const targets = await pushTargets(git, top, spec.argv);
  if (targets.failed !== null) {
    return `a dry run of it, which shows what it would push, failed (${targets.failed})`;
  }
  return askingReason(targets.refs, targets.defaults);
}

export type PushTargets = {
  refs: DryRunRef[];
  defaults: Map<string, DefaultBranch>;
  failed: string | null;
};

// One dry run per push judged, shared by every check that reads its targets.
const targetsRead = new WeakMap<object, Promise<PushTargets>>();

export function pushTargets(
  git: Git,
  top: string,
  argv: NonNullable<PushSpec['argv']>,
): Promise<PushTargets> {
  const known = targetsRead.get(argv);
  if (known !== undefined) return known;
  const read = readPushTargets(git, top, argv);
  targetsRead.set(argv, read);
  return read;
}

// The refs a push updates, from a dry run with git's own push config applied,
// and the default branch of each remote it goes to. A dry run that fails
// still lists the refs it would update: one ref rejected does not stop the rest.
async function readPushTargets(
  git: Git,
  top: string,
  argv: NonNullable<PushSpec['argv']>,
): Promise<PushTargets> {
  const { config, args, end } = argv;
  const probe = ['--dry-run', ...args.slice(0, end), ...DRY_RUN, ...args.slice(end)];
  const dry = await git(['git', ...config, 'push', ...probe], { cwd: top, env: NO_PROMPT });
  const failed = dry.exitCode === 0 ? null : firstLine(dry.stderr) || `exit ${dry.exitCode}`;
  const refs = parseDryRun(dry.stdout);
  const defaults = new Map<string, DefaultBranch>();
  for (const url of new Set(refs.map((r) => r.url))) {
    const head = await git(['git', 'ls-remote', '--symref', url, 'HEAD'], {
      cwd: top,
      env: NO_PROMPT,
    });
    const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(head.stdout)?.[1];
    if (head.exitCode === 0 && branch !== undefined) defaults.set(url, { branch });
    else defaults.set(url, { unreadable: firstLine(head.stderr) || 'no default branch named' });
  }
  return { refs, defaults, failed };
}

// What a push the user asked for still needs: their naming of the default
// branch or tag it pushes, or a word to the agent that its targets went
// unread. One whose targets a step before it can change asks.
async function coveredAsks(
  git: Git,
  top: string,
  consent: PushConsent,
  commits: boolean,
  spec: PushSpec,
  named: readonly string[],
): Promise<{ deny: string } | { note: string } | null> {
  const asked = "the user's latest message asks for a push, but";
  if (spec.after !== null) {
    return {
      deny: `${asked} \`git ${spec.after}\` runs before it in the same command, which can change where it goes, so nothing ran. Run that step on its own first, and the push is judged after it.`,
    };
  }
  if (spec.argv === null) {
    return {
      deny: `${asked} its remote or branch is built at run time, so the gate cannot tell where it goes, and nothing ran. Write the remote and branch out.`,
    };
  }
  const t = await pushTargets(git, top, spec.argv);
  // Exit 1 is a detached HEAD; any other failure leaves the branch unknown.
  const branch = commits ? await git(['git', 'symbolic-ref', '-q', 'HEAD'], { cwd: top }) : null;
  const moved =
    branch === null
      ? null
      : branch.exitCode === 0
        ? branch.stdout.trim()
        : branch.exitCode === 1
          ? 'HEAD'
          : '*';
  const u = unnamedTarget(t.refs, t.defaults, named, moved);
  if (u !== null) return { deny: unnamedRefusal(consent().shown, commits, u) };
  const unread = [...t.defaults].filter(([, head]) => 'unreadable' in head);
  const why =
    t.refs.length === 0
      ? t.failed === null
        ? 'its dry run named no ref it would update'
        : `a dry run of it failed (${t.failed})`
      : unread.length > 0
        ? `the default branch of ${unread[0]?.[0]} could not be read, so only \`main\` and \`master\` were checked`
        : null;
  if (why === null) return null;
  return {
    note: `review-cycle ran the push the user asked for without fully checking where it goes: ${why}. If it may have reached the default branch or a tag they did not name, tell them.`,
  };
}

export type PushVerdict = { deny: string; step?: 'push' } | { ran: Unasked | null; note?: string };

// What the push may run, or why not: a grant covers it, or a plain push the
// ladder or a requested pull request lets through, unless it always asks.
export async function judgePush(
  git: Git,
  ladderOf: () => Promise<InForce>,
  top: string,
  consent: PushConsent,
  commits: boolean,
  spec: PushSpec,
  granted: Grant,
  prs?: PrUpdating,
): Promise<PushVerdict> {
  const missing = unasked(spec, granted);
  if (missing === null) {
    const c = await coveredAsks(git, top, consent, commits, spec, granted.pushNamed);
    if (c === null) return { ran: null };
    return 'deny' in c ? { deny: c.deny } : { ran: null, note: c.note };
  }
  const ladder = await ladderOf();
  const forPr = granted.pr && !holds(consent().held, 'push');
  const bySetting = forPr || permitted(granted, ladder, consent().held).push;
  const update =
    missing === 'push' && !bySetting && !holds(consent().held, 'push')
      ? await prUpdateFor(git, top, spec, prs)
      : null;
  const byUpdate = update !== null && 'pull' in update;
  const outcome = await pushOutcome(missing, bySetting || byUpdate, () =>
    alwaysAsks(git, top, spec),
  );
  if (outcome.kind === 'covered') return { ran: null };
  if (outcome.kind === 'refused') {
    const unmet = update !== null && 'why' in update ? update : null;
    return {
      deny: pushRefusal(consent, commits, outcome.missing, granted, ladder, outcome.always, unmet),
      step: 'push',
    };
  }
  if (byUpdate && !bySetting) {
    return {
      ran: {
        step: 'push',
        ladder,
        prUpdate: {
          pull: update.pull,
          branches: update.branches,
          setting: update.setting,
          source: update.source,
        },
      },
    };
  }
  if (!bySetting) return { ran: null };
  return { ran: forPr ? { step: 'push', ladder, forPr: true } : { step: 'push', ladder } };
}

type Update =
  | {
      pull: number;
      branches: string[];
      setting: PrUpdatesInForce['prUpdates'];
      source: PrUpdatesInForce['source'];
    }
  | { why: string; source: PrUpdatesInForce['source'] };

// Whether `prUpdates` lets this push through, or why not; null when the
// setting asks, so a refusal names it only when it was on.
async function prUpdateFor(
  git: Git,
  top: string,
  spec: PushSpec,
  prs: PrUpdating | undefined,
): Promise<Update | null> {
  if (prs === undefined) return null;
  const { prUpdates, source } = await prs.setting();
  if (!allows(prUpdates, 'push fixes')) return null;
  if (spec.argv === null || spec.after !== null) {
    return { why: 'the gate cannot tell which branch it updates', source };
  }
  const targets = await pushTargets(git, top, spec.argv);
  if (targets.failed !== null) return { why: `a dry run of it failed (${targets.failed})`, source };
  const update = await prUpdateOf(targets.refs, prs.reads);
  return 'why' in update ? { ...update, source } : { ...update, setting: prUpdates, source };
}

// The gate does not ask: the agent asks in its reply, so the user can answer
// with anything at all. Their next message grants through the consent reader.
// `always` is why this push asks whatever the setting, when it does.
function pushRefusal(
  consent: PushConsent,
  commits: boolean,
  missing: Needed,
  granted: Grant,
  ladder: InForce,
  always: string | null,
  unmet: { why: string } | null = null,
): string {
  const { held, unread, shown } = consent();
  const alone = commits ? ' To commit without pushing, run the commit on its own.' : '';
  const update =
    unmet === null
      ? ''
      : ` The prUpdates setting lets a push to the user's own open pull request run, but not this one: ${unmet.why}.`;
  const ask = (step: OfferStep, example: string) => askThem(step, example, shown);
  switch (missing) {
    case 'bare': {
      const leaseToo = covers(granted, 'lease') ? '' : ', which also needs their request';
      return `a bare --force (or a \`+refspec\`) overwrites whatever the remote holds, and the user's latest message doesn't ask for a bare force, so nothing ran.${alone} Use ${LEASE} instead${leaseToo}; if they want a bare --force, ${ask('force-push-bare', '"Force-push `fix/x` to `origin` without a lease?"')}`;
    }
    case 'lease': {
      return `the user's latest message doesn't ask for a force push, so nothing ran.${alone} To force-push, ${ask('force-push', '"Force-push `fix/x` to `origin` with a lease?"')}`;
    }
    case 'push': {
      const asksAnyway = always === null ? '' : ` This push asks whatever the setting: ${always}.`;
      if (always === DELETES) {
        return `${notAsked('push', ladder, held, unread)}, so nothing ran.${asksAnyway}${alone} A merge the user asked for also covers \`gh pr merge --delete-branch\`. To delete it, ${ask('delete', '"Delete `fix/x` from `origin`?"')}`;
      }
      return `${notAsked('push', ladder, held, unread)}, so nothing ran.${asksAnyway}${update}${alone} To push, ${ask('push', '"Push `fix/x` to `origin`?"')}`;
    }
    default: {
      const unhandled: never = missing;
      throw new Error(`no refusal for the push level ${String(unhandled)}`);
    }
  }
}

// A push the user asked for, to a target their request did not name.
function unnamedRefusal(shown: string, commits: boolean, u: Unnamed): string {
  const alone = commits ? ' To commit without pushing, run the commit on its own.' : '';
  const then =
    u.offer === null
      ? `The gate never does that for the user. Give them the command to run themselves, and say why it is needed. The command: ${shown}`
      : `To push there, ${offerThem(u.offer, shown)}`;
  return `the user's latest message asks for a push, but ${u.why}, so nothing ran.${alone} ${then}`;
}

// The unmerged stack layer a `git push` updates, when this clone tracks a
// gh-stack stack. A catalog or dry run it cannot read leaves the push to the
// other checks: this steers to `gh stack push`, and guards nothing they miss.
export async function stackLayerPushed(
  git: Git,
  top: string,
  spec: PushSpec,
  io: Pick<LeaseIo, 'catalog' | 'config' | 'remotes' | 'urls'>,
): Promise<string | null> {
  if (spec.argv === null) return null;
  const text = await io.catalog();
  const stacks = typeof text === 'string' ? parseCatalog(text) : null;
  if (stacks === null || stacks.length === 0) return null;
  const { refs } = await pushTargets(git, top, spec.argv);
  // A deleted ref, or one pushed to a remote other than the one gh-stack
  // pushes the layer to, leaves the stack's record as it was.
  for (const r of refs) {
    if (r.flag === '-' || !r.to.startsWith('refs/heads/')) continue;
    const layer = layerOf(stacks, [r.to.slice('refs/heads/'.length)]);
    if (layer === null) continue;
    const remote = await remoteOf(layer, io);
    if (typeof remote !== 'string') continue;
    const urls = await io.urls(remote);
    if ('asks' in urls) continue;
    if (urls.push.split('\n').some((u) => anonymized(u.trim()) === r.url)) return layer;
  }
  return null;
}
