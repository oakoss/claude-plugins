// Whether a git push may run, and the refusal when it may not. What it needs
// from git comes through a `Git` runner and the setting through `ladder`, which
// register.ts builds.

import { covers, type Grant, type UnreadOffer } from './consent';
import {
  askThem,
  notAsked,
  permitted,
  type InForce,
  type ModelSteps,
  type Unasked as GhUnasked,
} from './gh-verdict';
import { firstLine, type Git } from './git';
import type { PushSpec } from './git-args';
import { holds, type Hold } from './hold';
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

// A push a requested pull request needs (`forPr`) runs unasked, not noted.
export type Unasked = GhUnasked & { forPr?: true };

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

export type PushVerdict =
  | { deny: string; step?: 'push'; final?: true }
  | { ran: Unasked | null; note?: string };

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
  model: ModelSteps = {},
): Promise<PushVerdict> {
  const missing = unasked(spec, granted);
  if (missing === null) {
    const c = await coveredAsks(git, top, consent, commits, spec, granted.pushNamed);
    if (c === null) return { ran: null };
    return 'deny' in c ? { deny: c.deny, final: true } : { ran: null, note: c.note };
  }
  const ladder = await ladderOf();
  const forPr = granted.pr && !holds(consent().held, 'push');
  const bySetting = forPr || permitted(granted, ladder, consent().held).push;
  // The model's yes to a push, or to the pull request it needs, lets it through
  // as the setting does, so the pushes that always ask still ask.
  const byModel =
    (model.pr === true && !holds(consent().held, 'push')) ||
    permitted(granted, ladder, consent().held, model).push;
  const outcome = await pushOutcome(missing, bySetting || byModel, () =>
    alwaysAsks(git, top, spec),
  );
  if (outcome.kind === 'covered') return { ran: null };
  if (outcome.kind === 'refused') {
    return {
      deny: pushRefusal(consent, commits, outcome.missing, granted, ladder, outcome.always),
      step: 'push',
    };
  }
  // A push the model's yes to a pull request let through is that pull
  // request's, as a typed request's is.
  if (!bySetting) return { ran: model.pr === true ? { step: 'push', ladder, forPr: true } : null };
  return { ran: forPr ? { step: 'push', ladder, forPr: true } : { step: 'push', ladder } };
}

// The gate does not ask: the agent asks in its reply, so the user can answer
// with anything at all. Their next message grants through the consent grammar.
// `always` is why this push asks whatever the setting, when it does.
function pushRefusal(
  consent: PushConsent,
  commits: boolean,
  missing: Needed,
  granted: Grant,
  ladder: InForce,
  always: string | null,
): string {
  const { held, unread, shown } = consent();
  const alone = commits ? ' To commit without pushing, run the commit on its own.' : '';
  const ask = (example: string) => askThem('what it pushes and where', example, shown);
  switch (missing) {
    case 'bare': {
      const leaseToo = covers(granted, 'lease') ? '' : ', which also needs their request';
      return `a bare --force (or a \`+refspec\`) overwrites whatever the remote holds, and the user's latest message doesn't ask for a bare force, so nothing ran.${alone} Use ${LEASE} instead${leaseToo}; if they want a bare --force, ${ask('"Force-push `fix/x` to `origin` without a lease?"')}`;
    }
    case 'lease': {
      return `the user's latest message doesn't ask for a force push, so nothing ran.${alone} To force-push, ${ask('"Force-push `fix/x` to `origin` with a lease?"')}`;
    }
    case 'push': {
      const asksAnyway = always === null ? '' : ` This push asks whatever the setting: ${always}.`;
      if (always === DELETES) {
        return `${notAsked('push', ladder, held, unread)}, so nothing ran.${asksAnyway}${alone} A merge the user asked for also covers \`gh pr merge --delete-branch\`. To delete it, ${ask('"Delete `fix/x` from `origin`?"')}`;
      }
      return `${notAsked('push', ladder, held, unread)}, so nothing ran.${asksAnyway}${alone} To push, ${ask('"Push `fix/x` to `origin`?"')}`;
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
      : `To push there, ${askThem('where it pushes', u.offer, shown)}`;
  return `the user's latest message asks for a push, but ${u.why}, so nothing ran.${alone} ${then}`;
}
