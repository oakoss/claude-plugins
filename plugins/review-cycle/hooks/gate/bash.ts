import type { Caught, CatchHandler, MatchedHook } from 'claude-code';

import { covers, type Grant } from '../consent/consent';
import { where } from '../consent/ladder';
import { OPEN_PULL_FIELDS } from '../consent/pr-updates';
import { deny } from '../consent/refusal';
import { marketplaceOf } from '../consent/settings';
import { SWITCHED_BY_USER, withNote, type BashHook } from '../edits/hooks';
import { recordRounds, roundsOf } from '../review/rounds';
import { EMPTY_TREE, uncoveredOf, type Row } from '../review/witness';
import { loadShellAliases } from '../shell/aliases-io';
import { committingAlias, readCommand, shownCommand, type Classification } from '../shell/command';
import type { Finishes } from '../shell/git-args';
import {
  ensureRoot,
  ghRead,
  gitOf,
  MERGE_LOOKUP_MS,
  run,
  STORE_TAG,
  storeOf,
  within,
  type $,
  type Input,
  type NextOf,
  type Output,
} from '../state/engine';
import { explain, held, runningLeg, state } from '../state/gate-state';
import { keep } from '../state/keep';
import { added, madeBy, MARK, resolutionOf, type Entry } from './attribution';
import { containmentReport, repoStateOf, UNREAD, type Capture } from './containment';
import {
  askThem,
  ASKED_FOR,
  judgeGh,
  notAsked,
  permitted,
  type GhConsent,
  type InForce,
  type Used,
  RELEASE_ASK,
} from './gh-verdict';
import {
  coverageOf,
  firstLine,
  headOf,
  parentTree,
  prospectTree,
  headLog,
  headLogCount,
  messageOf,
  pushedRefs,
  remoteRefs,
  repoAt,
  treeOf,
  type Git,
  type Refs,
  type Repo,
} from './git';
import { mcpAction, shownCall } from './github';
import { ghLookups, ladderOf, leaseIoOf, overtaken, prUpdatesInForce, SUBAGENT } from './judge';
import {
  judgePush,
  stackLayerPushed,
  type PrUpdating,
  type PushConsent,
  type Unasked,
} from './push-judge';

type GithubHook = MatchedHook<'tool.call', { tool: RegExp }>;

// What a merge that ran under a standing ask fulfils ends that ask.
function spend(used: Used | undefined): void {
  if (used === undefined) return;
  const done = new Set([...used.ready, ...(used.release ? [RELEASE_ASK] : [])]);
  state.standing = {
    ready: state.standing.ready.filter((n) => !done.has(n)),
    release: used.release ? null : state.standing.release,
    main: state.standing.main.filter((n) => !done.has(n)),
  };
}

function pointedNow(): readonly string[] {
  const { named, answer, unplaced } = state.message.pointed;
  return unplaced ? named : [...new Set([...named, ...answer])];
}

// A GitHub MCP tool is judged as the gh command it stands for would be.
export async function onGithubTool(
  $: $,
  e: Input<GithubHook>,
  next: NextOf<GithubHook>,
): Promise<Output<GithubHook>> {
  const action = mcpAction(e.tool, e);
  if (action === null) return next(e);
  if (e.agentId) return deny(SUBAGENT);
  const message = state.messages;
  const shown = shownCall(e.tool, e);
  const gh = await judgeGh(shown, [action], ghConsent(state.message.grant), ghLookups($));
  if ('deny' in gh) return deny(gh.deny, gh.step);
  const stale = overtaken(message, next.signal, 'call');
  if (stale !== null) return stale;
  const r = await next(e);
  if (r.deny !== undefined) return r;
  // A merge that failed fulfilled nothing, so its ask stands.
  if (r.isError !== true) spend(gh.used);
  const notes = [...unaskedNotes($, gh.ran), ...(gh.notes ?? [])];
  return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] };
}

// The notes for the steps a call ran unasked; a push a requested pull request
// needs is not noted.
function unaskedNotes($: $, ran: readonly Unasked[]): string[] {
  return ran.filter((step) => !step.forPr).map((step) => ranUnasked($, step));
}

export function onGithubToolError(
  $: $,
  e: Input<GithubHook>,
  next: NextOf<GithubHook> & Caught,
): ReturnType<CatchHandler<GithubHook>> {
  if (next.called) return next(e);
  const why =
    next.error.message ??
    (next.error.kind === 'timeout'
      ? 'it ran out of time; calling it again may work'
      : next.error.kind);
  return deny(gateFailed('could not check this call', why, 'making the change on GitHub'));
}

// Offering another route as the next step would skip the check that failed.
function gateFailed(what: string, why: string, elsewhere: string): string {
  return `the gate ${what} (${why}), so it is refused. Tell the user what failed and stop; suggest ${elsewhere} only if they ask.`;
}

// A reviewer's Bash is not refused, since it cannot be read for where it
// writes; the repository is compared around it instead, and what changed is
// put to the reviewer and kept for the status tool.
export async function onBash(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  const leg = runningLeg(e.agentId);
  if (!leg) return judgeBash($, e, next);
  let root: Repo | null = null;
  let lookup: string | null = null;
  try {
    root = await ensureRoot($);
  } catch (error) {
    lookup = error instanceof Error ? error.message : String(error);
  }
  if (root === null && lookup === null) return judgeBash($, e, next);
  const capture = async (): Promise<Capture> => {
    if (root === null) return { state: UNREAD, why: lookup };
    try {
      return await repoStateOf(gitOf($), root.top);
    } catch (error) {
      return { state: UNREAD, why: error instanceof Error ? error.message : String(error) };
    }
  };
  const before = await capture();
  const report = async (): Promise<string[]> => {
    const { notes, records } = containmentReport({
      type: leg.type,
      command: e.command,
      before,
      after: await capture(),
      background: e.run_in_background === true,
      capped: leg.capped,
    });
    state.reviewerChanges.push(...records);
    return notes;
  };
  let r: Output<BashHook>;
  try {
    r = await judgeBash($, e, next);
  } catch (error) {
    // The gate's failure handler answers a call that threw, so no note can
    // ride along; the record still reaches the status tool. A separate hook
    // would never see this case, which is why the comparison wraps the gate.
    await report();
    throw error;
  }
  if (r.deny !== undefined) return r;
  const notes = await report();
  return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] };
}

// The consent a GitHub call is judged against.
function ghConsent(grant: Grant): GhConsent {
  return {
    grant,
    held: held(),
    unread: state.message.unread,
    pointed: pointedNow(),
    standing: state.standing,
  };
}

function pushConsent(command: string): PushConsent {
  return () => ({ held: held(), unread: state.message.unread, shown: quote(command) });
}

async function judgeBash(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  // A newer message overtakes anything decided from this one.
  const message = state.messages;
  const granted = state.message.grant;
  await loadShellAliases($);
  const reading = readCommand(e.command, state.shellAliases, marketplaceOf($.plugin.root));
  if (reading.touchesGate) return deny(SWITCHED_BY_USER);
  const cls = reading.classification;
  if (cls.kind === 'refuse') return deny(cls.reason);
  // A gh command beside a commit or push is refused by classify.
  if (cls.kind === 'none') {
    const actions = reading.gh;
    // A call the gate cannot read may be a read: judgeGh refuses it with how
    // to write it out.
    if (e.agentId && actions.some((a) => a.kind !== 'unread')) return deny(SUBAGENT);
    // It replays commits as `git rebase` does, so it is watched as history,
    // and alone, so no commit beside it goes unchecked.
    const rewrite = reading.stackRewrite;
    if (rewrite === 'joined') {
      return deny(
        '`gh stack rebase` and `gh stack sync` rewrite commits, so the gate checks them only as their own command. Run it alone.',
      );
    }
    const gh = await judgeGh(quote(e.command), actions, ghConsent(granted), ghLookups($));
    if ('deny' in gh) return deny(gh.deny, gh.step);
    // Only a merge that succeeded ends a standing ask, and a filter's status hides that.
    const standing = gh.used !== undefined && (gh.used.ready.length > 0 || gh.used.release);
    if (standing && reading.endsInFilter) {
      return deny(
        `this merge would end the user's standing ask to merge once ready, which only a merge that succeeded ends, and the pipe at its end reports the filter's exit status, not gh's, so nothing ran. Run it without the pipe. The command: ${quote(e.command)}`,
      );
    }
    // Only a GitHub step is stopped by a newer message; other commands run.
    const since = actions.length > 0 ? message : null;
    if (reading.aliasCalls.length > 0) {
      const configured = await run($, ['git', 'config', '--get-regexp', String.raw`^alias\.`]);
      if (configured.exitCode > 1)
        throw new Error(`git config failed: ${firstLine(configured.stderr)}`);
      const sub = committingAlias(configured.stdout, reading.aliasCalls);
      if (sub !== null) {
        return deny(
          `\`git ${sub}\` is an alias that commits or pushes. Run the git command directly so the gate can check it.`,
        );
      }
    }
    const checked = rewrite === 'alone' ? 'history' : 'unchecked';
    const ran = await watch($, await ensureRoot($), e, next, checked, granted, since, gh.ran);
    if (ran.deny === undefined && ran.isError !== true) spend(gh.used);
    const notes = gh.notes ?? [];
    const r =
      notes.length === 0 || ran.deny !== undefined
        ? ran
        : { ...ran, context: [...(ran.context ?? []), ...notes] };
    if (state.aliasError === null || state.aliasErrorShown || r.deny !== undefined) return r;
    state.aliasErrorShown = true;
    return {
      ...r,
      context: [
        ...(r.context ?? []),
        `review-cycle could not read the user's shell aliases (${state.aliasError}), so an aliased git commit or push is not checked. Tell the user.`,
      ],
    };
  }

  const root = await ensureRoot($);
  if (root === null) return next(e);
  const target = await repoAt(gitOf($), cls.dir);
  if (target === 'none' || target.common !== root.common) return next(e);
  if (target.top !== root.top) {
    return deny(
      `this commits or pushes from another worktree of this repository (${target.top}). Do it from ${root.top}, where the gate can check it.`,
    );
  }
  if (e.agentId) return deny(SUBAGENT);

  // A commit needs only a review: it stays local, and undoing one costs a reset.
  const unreviewed = await reviewed($, root.top, cls);
  if (unreviewed !== null) return deny(unreviewed);

  const finishes = cls.commit?.finishes ?? null;
  // "finish the rebase" asks for that `--continue`'s commit and no other.
  const asked = granted.commit || (finishes !== null && granted.finish.includes(finishes));
  if (cls.commit && !cls.commit.dryRun && !asked) {
    const ladder = await ladderOf($);
    if (!permitted(granted, ladder, held()).commit) {
      return deny(commitRefusal(e.command, ladder, finishes));
    }
  }
  const ran: Unasked[] = [];
  let note: string | null = null;
  if (cls.push) {
    const commits = cls.commit !== null && finishes === null;
    const verdict = await judgePush(
      gitOf($),
      () => ladderOf($),
      root.top,
      pushConsent(e.command),
      commits,
      cls.push,
      granted,
      prUpdating($),
    );
    if ('deny' in verdict) return deny(verdict.deny, verdict.step);
    // Only a push that would run is steered, so its own refusals come first.
    const layer = await stackLayerPushed(gitOf($), root.top, cls.push, leaseIoOf($, root));
    if (layer !== null) {
      return deny(
        `\`${layer}\` is a layer of a gh-stack stack, and a plain \`git push\` of it leaves gh-stack's record of the stack behind, so nothing ran. Push the stack with \`gh stack push\`, which runs on the user's push request while each of its branches is where this agent last pushed it. The command: ${quote(e.command)}`,
      );
    }
    if (verdict.ran !== null) ran.push(verdict.ran);
    if (verdict.note !== undefined) note = verdict.note;
  }
  const checked: Checked =
    finishes !== null
      ? { finishes }
      : cls.commit
        ? 'commit'
        : cls.history !== null
          ? 'history'
          : 'push';
  const r = await watch($, root, e, next, checked, granted, message, ran);
  if (note === null || r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), note] };
}

// The refusal when a reviewer has not seen all of what a real commit would
// record; null otherwise.
async function reviewed(
  $: $,
  top: string,
  cls: Extract<Classification, { kind: 'gated' }>,
): Promise<string | null> {
  if (!cls.commit || cls.commit.dryRun) return null;
  const { amend } = cls.commit;
  const head = await headOf(gitOf($), top);
  // An amend replaces HEAD, so what it records is judged against HEAD's parent.
  const base = amend && head !== EMPTY_TREE ? await parentTree(gitOf($), top) : head;
  if (base === null)
    throw new Error("could not read the tree of HEAD's parent, which an amend replaces");
  let prospect: string;
  try {
    prospect = await prospectTree(gitOf($), top, cls);
  } catch (error) {
    // git names one unmerged path per line; the error keeps the first.
    const unmerged = /write-tree failed: (.+): unmerged \(/.exec(messageOf(error))?.[1];
    if (unmerged === undefined) throw error;
    return `conflicts are still unresolved, starting with ${unmerged} (paths are from the repository root; \`git status\` lists the rest). Resolve them and \`git add\` or \`git rm\` them; once a reviewer has seen the resolution, run the command again.`;
  }
  const c = await coverageOf(gitOf($), top, base, prospect, state.reviews);
  if (c === null) {
    const against = base === EMPTY_TREE ? 'the empty tree' : amend ? "HEAD's parent" : 'HEAD';
    throw new Error(`could not compare the tree this commit would record with ${against}`);
  }
  if (uncoveredOf(c.rows).length > 0) {
    return `no reviewer has seen what this commit records (${explain(c)}). Invoke /review-cycle:review via the Skill tool so a reviewer sees the current tree, then ${cls.commit.finishes === undefined ? 'commit' : 'continue'}.`;
  }
  return null;
}

// Longer than this, the refusal quotes only the start of the command.
const MAX_SHOWN = 300;

function prUpdating($: $): PrUpdating {
  return {
    setting: () => prUpdatesInForce($),
    reads: {
      openPulls: (branch) =>
        ghRead(
          $,
          ['pr', 'list', '--head', branch, '--state', 'open', '--json', OPEN_PULL_FIELDS],
          `the open pull request for \`${branch}\``,
          MERGE_LOOKUP_MS,
        ),
      viewer: (host) =>
        ghRead(
          $,
          ['api', '--hostname', host, 'user', '--jq', '.login'],
          `your GitHub login on ${host}`,
          MERGE_LOOKUP_MS,
        ),
    },
  };
}

// Told to the agent, so the step is never silent. Worded as having run, not
// succeeded: the command may still fail.
function ranUnasked($: $, { step, ladder, ready, prUpdate }: Unasked): string {
  const line =
    prUpdate !== undefined
      ? `review-cycle: ran a push of ${prUpdate.branches.map((b) => `\`${b}\``).join(', ')} to #${prUpdate.pull} without asking, since the prUpdates setting is ${prUpdate.setting} (${where(prUpdate.source)}) and #${prUpdate.pull} is the user's own open pull request. If git rejects it, stop and tell the user rather than force it.`
      : ready === undefined
        ? `review-cycle: ran ${ASKED_FOR[step]} without asking, since the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)}).`
        : `review-cycle: ran ${ASKED_FOR[step]} now, though the user asked for it once the pull request is ready: ${ready}.`;
  // A step the setting lets through repeats a choice the user made once; a
  // push to a pull request already open is shown whatever the notice says.
  if (ready !== undefined || prUpdate !== undefined || state.unaskedNotice) $.ui.log(line);
  return line;
}

function quote(command: string): string {
  const shown = shownCommand(command, state.shellAliases);
  return shown.length > MAX_SHOWN ? `${shown.slice(0, MAX_SHOWN)}…` : shown;
}

function commitRefusal(command: string, ladder: InForce, finishes: Finishes | null): string {
  const setting =
    ladder.unreadable === undefined
      ? `, and the stop-before setting is ${ladder.stopBefore} (${where(ladder.source)})`
      : '';
  const ask =
    finishes === null
      ? `To commit, ${askThem({ step: 'commit', branch: 'fix/x' }, quote(command))}`
      : `To finish the ${finishes}, which commits the resolution, ${askThem({ step: 'finish', branch: 'fix/x', operation: finishes }, quote(command))}`;
  return `${notAsked('commit', ladder, held(), state.message.unread)}${setting}, so nothing ran. ${ask}`;
}

// `finishes`: a `--continue` of that history command.
type Checked = 'commit' | 'history' | 'push' | 'unchecked' | { finishes: Finishes };
// HEAD's newest reflog entries and the log's length before a command, so the
// entries it added can be told apart afterwards.
type Start = { head: string; refs: Refs; log: Entry[]; count: number };

// More entries than this in one command are not read; the command is then
// reported as unchecked.
const MAX_ADDED = 200;

// Runs the command, then reports a commit the gate did not check (a script),
// one whose content changed after the check (a pre-commit hook restaging),
// and a push the user did not ask for. A history command records existing
// commits, so only a `--continue`'s resolution commit is judged afterwards,
// not the picks it replays. A commit made in another worktree is not seen:
// each worktree has its own HEAD.
async function watch(
  $: $,
  root: Repo | null,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
  checked: Checked,
  // What the user allowed for this call: their message, or their pick.
  granted: Grant = state.message.grant,
  // The message count `granted` was read at; a newer message stops the call.
  message: number | null = null,
  ran: readonly Unasked[] = [],
): Promise<Output<BashHook>> {
  const git = gitOf($);
  let start: Start | null = null;
  let startError: unknown = null;
  if (root !== null) {
    try {
      const head = await headOf(git, root.top);
      const unborn = head === EMPTY_TREE;
      const log = unborn ? [] : await headLog(git, root.top, MARK);
      const count = await headLogCount(git, root.top, unborn);
      start = { head, refs: await remoteRefs(git, root.top), log, count };
    } catch (error) {
      startError = error;
    }
  }
  const stale = message === null ? null : overtaken(message, next.signal, 'command');
  if (stale !== null) return stale;
  const group = root !== null && judgedCommit(checked) ? joinCommits(start?.head ?? null) : null;
  let r: Output<BashHook>;
  try {
    r = await next(e);
  } catch (error) {
    if (group !== null) group.running--;
    throw error;
  }
  const notes = r.deny === undefined ? unaskedNotes($, ran) : [];
  if (root === null) {
    if (notes.length === 0 || r.deny !== undefined) return r;
    return { ...r, context: [...(r.context ?? []), ...notes] };
  }
  const failed = (what: string, error: unknown) => {
    const why = error instanceof Error ? error.message : String(error);
    notes.push(
      `review-cycle could not check whether this command ${what} (${why}). Tell the user.`,
    );
  };
  if (start === null) {
    failed('committed or pushed', startError);
  } else {
    try {
      const after = await remoteRefs(git, root.top);
      const pushed = await pushedRefs(git, root.top, start.refs, after);
      notePushed(root, pushed);
      // A push the gate judged was told already; one from a script was not.
      const judged = ran.some((step) => step.step === 'push');
      if (pushed.length > 0 && !covers(granted, 'push') && !judged) {
        const ladder = await ladderOf($);
        notes.push(
          permitted(granted, ladder, held()).push
            ? ranUnasked($, { step: 'push', ladder })
            : `review-cycle: this command pushed to ${pushed.map((p) => p.name).join(', ')} without the user asking for a push. Tell the user.`,
        );
      }
    } catch (error) {
      failed('pushed', error);
    }
    try {
      notes.push(...(await commitNotes(git, root.top, start, checked)));
    } catch (error) {
      failed('committed', error);
    }
  }
  // The group stays open until here, so a commit that starts while this one
  // is still being checked joins it rather than reading this one's HEAD.
  if (group !== null && --group.running === 0) {
    try {
      await recordCommitRounds($, root, group, r.deny !== undefined);
    } catch (error) {
      notes.push(
        `review-cycle could not record this commit's review rounds (${messageOf(error)}).`,
      );
    }
  }
  if (notes.length === 0 || r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), ...notes] };
}

// The most pushed branches the gate remembers, across repositories.
const PUSHED_MAX = 200;

function notePushed(root: Repo, pushed: readonly { name: string; id: string }[]): void {
  for (const { name, id } of pushed) {
    const key = `${root.common}\t${name}`;
    state.pushed = [...state.pushed.filter(([k]) => k !== key), [key, id]];
  }
  state.pushed = state.pushed.slice(-PUSHED_MAX);
}

// Judged commits whose calls overlap: the rounds before them are the same
// reviews, so the last to finish records one entry for all of them.
type CommitGroup = { before: string | null; running: number; size: number };
let committing: CommitGroup | null = null;

function joinCommits(head: string | null): CommitGroup {
  if (committing === null || committing.running === 0) {
    committing = { before: head, running: 0, size: 0 };
  }
  committing.running++;
  committing.size++;
  return committing;
}

// Records the rounds reviewed since the last entry, once a group's commits land.
// A count the store does not take is named in the error and not carried into
// the next commit's, unless the call was refused and cannot carry the note.
async function recordCommitRounds(
  $: $,
  root: Repo,
  group: CommitGroup,
  refused: boolean,
): Promise<void> {
  const { before } = group;
  if (before === null) return;
  const after = await headOf(gitOf($), root.top);
  if (after === before || after === EMPTY_TREE) return;
  const from = state.roundsFrom;
  const rounds = roundsOf(state.reviews.slice(from));
  state.roundsFrom = state.reviews.length;
  state.reviewing = null;
  // What the legs dropped or changed describes the cycle this commit ends,
  // unless a counted leg still runs: the review skill reads its entries once it
  // finishes. A review-pr leg counts toward nothing, and nothing prunes it.
  if (![...state.legs.values()].some((l) => l.counts && !l.done)) {
    state.dropped = [];
    state.reviewerChanges = [];
  }
  void keep($);
  const now = await $.clock.now();
  roundsAt = Math.max(now, roundsAt + 1);
  const tip = after.slice(0, 12);
  const entry = {
    commit: group.size > 1 && before !== EMPTY_TREE ? `${before.slice(0, 12)}..${tip}` : tip,
    rounds,
    date: new Date(now).toISOString().slice(0, 10),
  };
  try {
    await within(
      $,
      recordRounds(storeOf($), root.common, entry, roundsAt, STORE_TAG),
      'recording review rounds',
    );
  } catch (error) {
    if (refused) {
      state.roundsFrom = Math.min(state.roundsFrom, from);
      void keep($);
    }
    throw new Error(`${rounds} round${rounds === 1 ? '' : 's'}: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

// Orders this session's entries even when the clock does not move between them.
let roundsAt = 0;

function judgedCommit(checked: Checked): boolean {
  return checked === 'commit' || typeof checked === 'object';
}

async function commitNotes(
  git: Git,
  root: string,
  start: Start,
  checked: Checked,
): Promise<string[]> {
  const after = await headOf(git, root);
  if (after === EMPTY_TREE) {
    if (start.head !== EMPTY_TREE) {
      return [
        'review-cycle: HEAD no longer resolves to a commit after this command. Tell the user.',
      ];
    }
    // Unborn before and after, but a commit may have landed in between.
    if ((await headLogCount(git, root, true)) === start.count) return [];
    throw new Error("HEAD's reflog grew while HEAD ended unborn");
  }
  const count = (await headLogCount(git, root, false)) - start.count;
  if (count < 0 || count > MAX_ADDED) {
    throw new Error(`HEAD's reflog changed by ${count} entries, which the gate does not read`);
  }
  const entries = added(await headLog(git, root, count + MARK), start.log, count);
  if (entries === null) throw new Error("HEAD's reflog does not reach where the command began");
  if (entries.length === 0 && after !== start.head) {
    throw new Error('HEAD moved without a reflog entry');
  }
  const finishes = typeof checked === 'object' ? checked.finishes : null;
  const lineages = (finishes === null ? madeBy : resolutionOf)(entries, start.head);
  const tip = lineages.at(-1)?.tip;
  if (tip === undefined) return [];
  const short = tip.slice(0, 12);
  // Each lineage is judged from its own base, so a commit on another branch
  // is not hidden behind the one HEAD ended on.
  const rows: Row[] = [];
  let unread = 0;
  for (const lineage of lineages) {
    const tree = await treeOf(git, root, lineage.tip);
    const baseTree = await treeOf(git, root, lineage.base);
    const c = tree && baseTree ? await coverageOf(git, root, baseTree, tree, state.reviews) : null;
    if (c === null)
      return [`review-cycle could not check commit ${lineage.tip.slice(0, 12)}. Tell the user.`];
    rows.push(...c.rows);
    unread += c.unread;
  }
  const notes: string[] = [];
  const c = { rows, unread };
  if (checked !== 'history' && uncoveredOf(rows).length > 0) {
    // A rebase runs no pre-commit hook (measured on git 2.56).
    const why =
      finishes === 'rebase'
        ? "It changed after the gate's check."
        : checked === 'commit' || finishes !== null
          ? "A pre-commit hook may have changed it after the gate's check."
          : 'It did not go through the commit gate.';
    notes.push(
      `review-cycle: commit ${short} records content no reviewer saw (${explain(c)}). ${why} Tell the user.`,
    );
  }
  return notes;
}

// A throw is skipped by the engine and the call proceeds, so a failure while
// judging any step readCommand finds is caught here and refused.
// Anything else runs, with a note that the gate could not watch it.
export function onBashError(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook> & Caught,
): ReturnType<CatchHandler<BashHook>> {
  if (next.called) return next(e);
  const why =
    next.error.message ??
    (next.error.kind === 'timeout'
      ? 'it ran out of time; running it again may work'
      : next.error.kind);
  const r = readCommand(e.command, state.shellAliases);
  const quiet =
    r.classification.kind === 'none' &&
    r.aliasCalls.length === 0 &&
    r.gh.length === 0 &&
    r.stackRewrite === null;
  if (quiet) {
    return withNote(
      next(e),
      `review-cycle could not watch this command (${why}); a commit it made would not be reported. Tell the user.`,
    );
  }
  return deny(
    gateFailed('failed while checking this command', why, 'running the step outside the gate'),
  );
}
