import type { Caught, CatchHandler, HookFor, MatchedHook, Register, Timer } from 'claude-code';

import { covers, liftsHold, NAMED_ELSEWHERE, UNGRANTED, type Grant } from './consent/consent';
import { besideOf, mandateAfter } from './consent/exact';
import { holdAfter } from './consent/hold';
import { stopBeforeOf, where } from './consent/ladder';
import { countsOf } from './consent/misses';
import { OFFER_STEPS, OPERATIONS, offerQuestion } from './consent/offers';
import { OPEN_PULL_FIELDS, prUpdatesOf } from './consent/pr-updates';
import { consentJoined, consentOf, ownWords, readMessage } from './consent/reading';
import { deny, MAX_MISSES } from './consent/refusal';
import { marketplaceOf } from './consent/settings';
import {
  onBashEdits,
  onEdit,
  onEditContained,
  onEditError,
  onEditSlop,
  onMonitor,
  onMonitorError,
  onNotebookEdit,
  onWrite,
  onWriteContained,
  onWriteError,
  onWriteSlop,
  SWITCHED_BY_USER,
  withNote,
  type BashHook,
} from './edits/hooks';
import { added, madeBy, MARK, resolutionOf, type Entry } from './gate/attribution';
import { containmentReport, repoStateOf, UNREAD, type Capture } from './gate/containment';
import {
  askThem,
  ASKED_FOR,
  besideNote,
  judgeGh,
  notAsked,
  parsePullRequest,
  permitted,
  PR_FIELDS,
  PR_JQ,
  type GhConsent,
  type GhLookups,
  type InForce,
  type Standing,
  type Used,
  NO_STANDING,
  RELEASE_ASK,
  shownNamed,
  standsFor,
  VERSION_BRANCH,
} from './gate/gh-verdict';
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
  snapshotOf,
  treeOf,
  worktreeTree,
  type Git,
  type Refs,
  type Repo,
} from './gate/git';
import { MCP_GITHUB, mcpAction, shownCall } from './gate/github';
import { ladderOf, overtaken, prUpdatesInForce, SUBAGENT } from './gate/judge';
import {
  judgePush,
  stackLayerPushed,
  type PrUpdating,
  type PushConsent,
  type Unasked,
} from './gate/push-judge';
import { onReply, onThreads, registerReply } from './gate/reply';
import { onLedger, onLedgerRecord, registerLedger } from './ledger/tools';
import { onCodexCommand, onCodexLog, registerCodexLog } from './review/codex-io';
import { readCycles, rollupOf } from './review/cycles';
import { onAgentSpawn, onTurnComplete } from './review/legs';
import { nudgeWanted, reminderFor } from './review/nudge-io';
import { readRounds, recordRounds, roundsOf } from './review/rounds';
import { onScratch, onSweep, registerScratch } from './review/scratch';
import { onCompact, onReviewSkill, onSkill, onSubagentSkill } from './review/skills';
import { isSpend, NO_SPEND, spentWith } from './review/spend';
import { SUMMARY_TOOL, summaryHeader } from './review/summary';
import { onSummary, registerSummary } from './review/summary-io';
import { EMPTY_TREE, uncoveredOf, type Row } from './review/witness';
import { loadShellAliases, readOwnAliases } from './shell/aliases-io';
import { committingAlias, readCommand, shownCommand, type Classification } from './shell/command';
import type { Finishes } from './shell/git-args';
import { type LeaseIo, readStack, stackLease } from './shell/stack';
import {
  currentText,
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
} from './state/engine';
import { explain, held, HUMAN, runningLeg, state } from './state/gate-state';
import { clearOffGate, keep, keepGate, keptMisses, recallOnce } from './state/keep';

// The gate watches Bash with a function hook, not the classic PreToolUse
// bridge. While any `tool.call { tool: "Bash" }` hook is loaded, Bash inside an
// `isolation: "worktree"` subagent is refused (anthropics/claude-code#92533);
// the bridge avoids that at the cost of a stub script, should it matter.

type GithubHook = MatchedHook<'tool.call', { tool: RegExp }>;
type StatusHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__status' }>;
type MissesHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__misses' }>;
type OfferHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__offer' }>;
type ConfigHook = MatchedHook<
  'config.set',
  {
    key:
      | 'review-cycle.enabled'
      | 'review-cycle.stopBefore'
      | 'review-cycle.prUpdates'
      | 'review-cycle.nudge'
      | 'review-cycle.unaskedNotice';
  }
>;

let ticker: Timer | undefined;

// The hooks that change what the gate remembers keep it once they have answered.
type Args<F extends (...args: never[]) => unknown> = Parameters<F>;

async function keptScratch($: $, e: Args<typeof onScratch>[1], next: Args<typeof onScratch>[2]) {
  try {
    return await onScratch($, e, next);
  } finally {
    void keep($);
  }
}

async function keptSweep($: $, e: Args<typeof onSweep>[1], next: Args<typeof onSweep>[2]) {
  try {
    return await onSweep($, e, next);
  } finally {
    void keep($);
  }
}

async function keptPromptSubmit(
  $: $,
  e: Args<typeof onPromptSubmit>[1],
  next: Args<typeof onPromptSubmit>[2],
) {
  try {
    return await onPromptSubmit($, e, next);
  } finally {
    void keep($);
  }
}

async function keptAgentSpawn(
  $: $,
  e: Args<typeof onAgentSpawn>[1],
  next: Args<typeof onAgentSpawn>[2],
) {
  try {
    return await onAgentSpawn($, e, next);
  } finally {
    void keep($);
  }
}

async function keptTurnComplete(
  $: $,
  e: Args<typeof onTurnComplete>[1],
  next: Args<typeof onTurnComplete>[2],
) {
  try {
    return await onTurnComplete($, e, next);
  } finally {
    void keep($);
  }
}

async function keptSkill($: $, e: Args<typeof onSkill>[1], next: Args<typeof onSkill>[2]) {
  try {
    return await onSkill($, e, next);
  } finally {
    void keep($);
  }
}

async function keptBash($: $, e: Args<typeof onBash>[1], next: Args<typeof onBash>[2]) {
  try {
    return await onBash($, e, next);
  } finally {
    void keep($);
  }
}

async function keptGithubTool(
  $: $,
  e: Args<typeof onGithubTool>[1],
  next: Args<typeof onGithubTool>[2],
) {
  try {
    return await onGithubTool($, e, next);
  } finally {
    void keep($);
  }
}

async function onSessionStart(
  $: $,
  e: Input<HookFor<'session.start'>>,
  next: NextOf<HookFor<'session.start'>>,
): Promise<Output<HookFor<'session.start'>>> {
  await registerLedger($);
  await registerScratch($);
  await registerCodexLog($);
  await registerSummary($);
  // A new session owes no reminder for an old one's turns.
  state.owed = null;
  if (!state.gateOn) {
    await clearOffGate($);
    return next(e);
  }
  await recallOnce($);
  // What callbacks outside a hook change (a nudge, a capped leg) is kept here.
  ticker?.cancel();
  ticker = $.clock.every(1000, () => void keep($));
  try {
    await ensureRoot($);
  } catch {
    // Resolved again on first use; a gated command refuses if it still fails.
  }
  // Not awaited: the first Bash call waits on it instead of the session start.
  state.ownRead ??= readOwnAliases($);
  try {
    await $.tool.register({
      name: 'status',
      description:
        "review-cycle's view of the working tree: which changed paths a reviewer has seen, which were edited after the last review or never reviewed, and whether a push or a pull request may run now: asked for in the user's latest message, or below their stop-before setting. `rounds` counts the trees reviewed for each recent commit, confirmation passes included; `cycles` totals the review cycles whose summaries this repository kept: their loop iterations, how they ended, the findings fixed and deferred by leg and by side of Phase 6's bar, how many later findings the cycles' own fixes caused, what the cycles that stated a cost spent (minutes, leg runs, subagent tokens, the legs' steps and token counts, Codex tokens), and the newest cycles one by one with their commit, cost and findings. `legSpend` lists each reviewer leg's model calls since the last kept summary, by agent id: its steps and the input, cache-write, cache-read and output tokens they used. Read-only.",
      inputSchema: { type: 'object', properties: {} },
    });
  } catch {
    // The gate works without its status tool; the skill notes when it is missing.
  }
  try {
    await $.tool.register({
      name: 'misses',
      description:
        "The gate's refusals of a push, pull request, merge or release that the user's latest message, or the offer it answered, named: candidate rows for the consent corpus. Each has the message, the offer (the answer's last lines, when the message replied to it), the steps named and the refusal. `misses` is this session's; `recorded` the newest 20 from every session and repository, each with its date and repository, and `counts` covers the 200 kept. Read-only; nothing leaves the machine.",
      inputSchema: { type: 'object', properties: {} },
    });
  } catch {
    // The misses skill says when the tool is missing.
  }
  try {
    await $.tool.register({
      name: 'offer',
      description:
        "Returns the one question to ask for a held step you are about to offer the user, or that the gate refused (a commit, finishing a rebase, merge, cherry-pick or revert, a push, force-push, remote branch delete, pull request, merge, stack merge or push, release, approval, or a reply to a pull request's review, resolving its threads included). End your answer with it, word for word, on a line of its own, with nothing after it: the gate reads a yes to that question exactly, and to no other. Reword it and a yes may be held.",
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'string', enum: [...OFFER_STEPS] },
          pulls: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Pull requests: "316", or "owner/name#53" in another repository. merge takes one or more; release, merge-release, approve, comment and stack (up to) one.',
          },
          method: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
          branch: {
            type: 'string',
            description:
              'For commit, finish, push, force-push, force-push-bare, delete and push-pr.',
          },
          remote: { type: 'string', description: 'For a push or delete; origin when left out.' },
          operation: {
            type: 'string',
            enum: [...OPERATIONS],
            description: 'For finish.',
          },
          version: {
            type: 'string',
            description:
              'For a release with no pull request, or push-tag: its tag or <package>@<version>, "v0.25.0".',
          },
          versions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'For a release of several at once, in place of version: one question, whose yes covers pushing each tag and creating each release.',
          },
        },
        required: ['step'],
      },
    });
  } catch {
    // Without the tool, offers are read from the answer's prose.
  }
  await registerReply($);
  return next(e);
}

function onOffer(_$: $, e: Input<OfferHook>, _next: NextOf<OfferHook>): Output<OfferHook> {
  const offer = offerQuestion(e);
  if ('error' in offer) return { result: `review-cycle: no question: ${offer.error}` };
  return { result: `End your answer with this line, word for word: ${offer.question}` };
}

async function onPromptSubmit(
  $: $,
  e: Input<HookFor<'prompt.submit'>>,
  next: NextOf<HookFor<'prompt.submit'>>,
): Promise<Output<HookFor<'prompt.submit'>>> {
  await recallOnce($);
  if (HUMAN.has(e.origin.kind)) {
    state.messages++;
    const typed = ownWords(e.text);
    const reading = readMessage(typed, state.lastAnswer);
    state.said = { text: typed, before: state.lastAnswer, origin: e.origin.kind };
    // What a held message asks for still runs: "push it; don't open a PR yet".
    state.hold = holdAfter(state.hold, liftsHold(reading.grant, state.hold), reading.hold);
    state.mandate = mandateAfter(state.mandate, typed, state.lastAnswer);
    const ended = reading.ends ? endedNote(state.standing) : null;
    state.standing = await standingAfter(
      $,
      reading.ends ? NO_STANDING : state.standing,
      reading.grant,
    );
    if (ended !== null) e = { ...e, context: [...(e.context ?? []), ended] };
    const beside = besideOf(typed, state.lastAnswer);
    if (beside.length > 0) e = { ...e, context: [...(e.context ?? []), besideNote(beside)] };
    // A prompt queued into a running turn neither ends a review-pr run nor
    // replaces that turn's starting tree. Updated in place: nudgeReview tells
    // a new message from this one by identity.
    if (e.turnId !== undefined) {
      Object.assign(state.message, consentJoined(state.message, reading));
      // An owed reminder already covers this turn's changes.
      state.message.nudged = state.owed !== null;
    } else {
      let tree: string | null = null;
      try {
        const root = await ensureRoot($);
        if (root !== null) tree = await worktreeTree(gitOf($), root.top);
      } catch {
        // No starting tree means no nudge this message; the commit gate still holds.
      }
      // Read after the awaits, so a reminder armed meanwhile rides on this prompt.
      const owed = state.owed;
      const reviews = e.command?.name === 'review-cycle:review';
      // A slash command may never reach the agent, so the reminder waits for
      // the next message; typing the review skill is the review itself.
      const waits = owed !== null && e.command !== undefined && !reviews;
      state.message = { ...consentOf(reading), tree, nudged: waits || reviews, prWindow: false };
      if (owed === null || waits) return next(e);
      const reminder = reviews ? null : await reminderFor($, owed.since, tree);
      const r = await next(
        reminder === null ? e : { ...e, context: [...(e.context ?? []), reminder] },
      );
      // Consumed once the prompt is accepted, and only if nothing has since
      // replaced or retired it: a refused or failed prompt leaves it owed.
      if (!('drop' in r && r.drop !== undefined) && state.owed === owed) state.owed = null;
      return r;
    }
  }
  return next(e);
}

// The standing asks after a message: a merge once ready of the pull requests it
// named, and of the version pull request. An unnamed one binds to what its own
// message pointed at, so it ends with that message.
async function standingAfter($: $, prior: Standing, grant: Grant): Promise<Standing> {
  const named = grant.readyNamed.filter((n) => n !== NAMED_ELSEWHERE);
  const bound = grant.readyRelease ? await releaseOf($) : null;
  const release = bound ?? prior.release;
  // A main condition binds to this message's own asks, not to earlier ones.
  const releasing = grant.readyRelease && release !== null;
  const waits = grant.readyMain ? [...named, ...(releasing ? [RELEASE_ASK] : [])] : [];
  return {
    ready: [...new Set([...prior.ready, ...named])],
    release,
    main: [...new Set([...prior.main, ...waits])],
  };
}

// The version pull request a standing release covers: the open one, or the
// first opened after the newest. Null when GitHub cannot say.
async function releaseOf($: $): Promise<Standing['release']> {
  const r = await ghLookups($).versionPulls();
  if (r.asks !== undefined) return null;
  const pulls = r.out
    .trim()
    .split(/\s+/)
    .map((x) => /^(\d+):(\w+)$/.exec(x))
    .filter((m) => m !== null);
  const open = pulls.find((m) => m[2] === 'OPEN');
  if (open?.[1] !== undefined) return { pr: open[1] };
  return { after: Math.max(0, ...pulls.map((m) => Number(m[1]))) };
}

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

function endedNote(s: Standing): string | null {
  if (!standsFor(s)) return null;
  const which = [
    ...s.ready.map((n) => shownNamed(n)),
    ...(s.release === null ? [] : ["oakum's version pull request"]),
  ].join(' and ');
  return `review-cycle: this message ended the user's standing ask to merge ${which} once ready. Ask them before merging it.`;
}

function pointedNow(): readonly string[] {
  const { named, answer, unplaced } = state.message.pointed;
  return unplaced ? named : [...new Set([...named, ...answer])];
}

// A GitHub MCP tool is judged as the gh command it stands for would be.
async function onGithubTool(
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

function onGithubToolError(
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
async function onBash($: $, e: Input<BashHook>, next: NextOf<BashHook>): Promise<Output<BashHook>> {
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

// The gh reads GitHub judging needs, each failing into a reason to ask.
function ghLookups($: $): GhLookups {
  return {
    ladder: () => ladderOf($),
    mergeTarget: (lookup) =>
      ghRead(
        $,
        [
          'pr',
          'view',
          ...lookup,
          '--json',
          'url,state,mergeStateStatus',
          '--jq',
          String.raw`"\(.url) \(.state) \(.mergeStateStatus)"`,
        ],
        'the pull request it merges',
        MERGE_LOOKUP_MS,
      ),
    repoUrl: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'url', '--jq', '.url'],
        'the current repository',
        MERGE_LOOKUP_MS,
      ),
    branch: async () => {
      try {
        const r = await $.process.run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
          timeoutMs: 5000,
        });
        if (r.exitCode === 0) return { out: r.stdout };
        // --quiet leaves a detached HEAD exit 1 with nothing on stderr.
        const why = r.stderr.trim().split('\n')[0] ?? '';
        if (r.exitCode === 1 && why === '') return { out: '' };
        return { asks: `reading the current branch printed \`${why}\` (exit ${r.exitCode})` };
      } catch (error) {
        return { asks: `reading the current branch failed (${messageOf(error)})` };
      }
    },
    // GitHub's rollup counts check runs and commit statuses alike, unpaged.
    mainChecks: () =>
      ghRead(
        $,
        [
          'api',
          'graphql',
          '-F',
          'owner={owner}',
          '-F',
          'name={repo}',
          '-f',
          'query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name target{... on Commit{statusCheckRollup{state}}}}}}',
          '--jq',
          String.raw`"\(.data.repository.defaultBranchRef.name) \(.data.repository.defaultBranchRef.target.statusCheckRollup.state // "NONE")"`,
        ],
        "the default branch's checks",
        MERGE_LOOKUP_MS,
      ),
    versionPulls: () =>
      ghRead(
        $,
        [
          'pr',
          'list',
          '--head',
          VERSION_BRANCH,
          '--state',
          'all',
          '--limit',
          '50',
          '--json',
          'number,state,isCrossRepository',
          '--jq',
          String.raw`[.[] | select(.isCrossRepository | not) | "\(.number):\(.state)"] | if length == 0 then "none" else join(" ") end`,
        ],
        "oakum's version pull requests",
        MERGE_LOOKUP_MS,
      ),
    pullRequest: async (lookup, what) => {
      const args = ['pr', 'view', ...lookup, '--json', PR_FIELDS, '--jq', PR_JQ];
      const r = await ghRead($, args, what);
      if (r.asks === undefined) return parsePullRequest(r.out, what);
      return r.slow ? { asks: r.asks, slow: true } : { asks: r.asks };
    },
    defaultBranch: (repo) =>
      ghRead(
        $,
        [
          'repo',
          'view',
          ...(repo === null ? [] : [repo]),
          '--json',
          'defaultBranchRef',
          '--jq',
          '.defaultBranchRef.name',
        ],
        'the default branch',
      ),
    stack: (n) => readStack(n, (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS)),
    stackLease: (step, remote) => stackLeaseOf($, step, remote),
  };
}

// How long the remote may take to list its branches before the push asks.
const LS_REMOTE_MS = 15_000;

async function stackLeaseOf(
  $: $,
  step: 'push' | 'sync' | 'submit',
  remote: string | null,
): Promise<{ ok: true } | { asks: string }> {
  const root = await ensureRoot($);
  if (root === null) return { asks: 'the gate cannot find the repository' };
  return stackLease(step, remote, leaseIoOf($, root));
}

// The clone, its remotes and GitHub as gh-stack's lease boundary reads them.
function leaseIoOf($: $, root: Repo): LeaseIo {
  const git = async (args: string[], timeoutMs = 10_000) => {
    try {
      const r = await run($, ['git', ...args], {
        cwd: root.top,
        env: { GIT_TERMINAL_PROMPT: '0' },
        timeoutMs,
      });
      return { code: r.exitCode, out: r.stdout, why: firstLine(r.stderr) || `exit ${r.exitCode}` };
    } catch (error) {
      return { code: -1, out: '', why: messageOf(error) };
    }
  };
  const prefix = `${root.common}\t`;
  const pushed = new Map(
    state.pushed
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, id]) => [k.slice(prefix.length), id]),
  );
  return {
    catalog: async () => {
      try {
        return await within(
          $,
          currentText($, `${root.common}/gh-stack`),
          'reading the stack catalog',
        );
      } catch (error) {
        return { asks: `gh-stack's catalog could not be read (${messageOf(error)})` };
      }
    },
    branch: async () => {
      const r = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
      return r.code === 0 ? r.out.trim() : { asks: 'HEAD is on no branch' };
    },
    config: async (key) => {
      const r = await git(['config', '--get', key]);
      // git config exits 1 for a key that is not set.
      if (r.code === 1) return null;
      if (r.code !== 0) return { asks: `reading ${key} failed (${r.why})` };
      return r.out.trim() === '' ? null : r.out.trim();
    },
    urls: async (name) => {
      const fetch = await git(['remote', 'get-url', '--all', name]);
      const push = await git(['remote', 'get-url', '--push', '--all', name]);
      if (fetch.code !== 0 || push.code !== 0) {
        return {
          asks: `reading ${name}'s URLs failed (${fetch.code === 0 ? push.why : fetch.why})`,
        };
      }
      return { fetch: fetch.out, push: push.out };
    },
    remotes: async () => {
      const r = await git(['remote']);
      return r.code === 0
        ? r.out.split(/\s+/).filter(Boolean)
        : { asks: `listing remotes failed (${r.why})` };
    },
    heads: async (name) => {
      const r = await git(['ls-remote', '--heads', name], LS_REMOTE_MS);
      return r.code === 0 ? r.out : { asks: `listing ${name}'s branches failed (${r.why})` };
    },
    defaultBranch: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
        'the default branch',
      ),
    ghApi: (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS),
    pushed,
  };
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

async function onStatus(
  $: $,
  _e: Input<StatusHook>,
  _next: NextOf<StatusHook>,
): Promise<Output<StatusHook>> {
  const last = state.reviews.at(-1);
  const status: Record<string, unknown> = {
    // The tree the latest counting reviewer was given: the delta from it is
    // everything that reviewer may not have read.
    lastReviewedTree: last?.trees[0] ?? null,
    reviews: state.reviews.length,
    droppedReviews: state.dropped.map((d) => d.text),
    cappedReviews: state.capped,
    legSpend: [...state.legs].flatMap(([agentId, l]) =>
      l.spend === undefined ? [] : [{ agentId, type: l.type, ...l.spend }],
    ),
    reviewerChanges: state.reviewerChanges,
    shellAliases: state.aliasError ?? state.shellAliases.size,
    pushRequested: covers(state.message.grant, 'push'),
    prRequested: state.message.grant.pr,
    error: null,
    worktreeTree: null,
  };
  const ladder = await ladderOf($);
  const may = permitted(state.message.grant, ladder, held());
  const from = ladder.unreadable === undefined ? where(ladder.source) : 'unreadable settings';
  status.stopBefore = {
    ...ladder,
    from,
    held: state.hold !== null,
    heldBy: held(),
    mandate: state.mandate,
  };
  const updates = await prUpdatesInForce($);
  status.prUpdates = {
    ...updates,
    from: updates.unreadable === undefined ? where(updates.source) : 'unreadable settings',
    // A fix is a commit first, which only stop-before lets through.
    ...(updates.prUpdates !== 'ask' &&
      !may.commit && { waitsOn: 'commits, which stop-before holds' }),
  };
  status.mayCommit = may.commit;
  status.mayPush = may.push;
  status.mayOpenPr = may.pr;
  status.mayMerge = may.merge;
  status.mayRelease = may.release;
  status.commentRequested = state.message.grant.comment;
  const g = state.message.grant;
  status.autoMergeRequested = g.autoMerge || g.readyRelease || standsFor(state.standing);
  const kept = await keptMisses($);
  status.misses = kept.recorded && { ...countsOf(kept.recorded), unsaved: kept.unsaved };
  if (kept.error !== null) status.missesError = kept.error;
  try {
    const root = await ensureRoot($);
    if (!root) return { result: 'Not in a git repository; review-cycle gates nothing here.' };
    const head = await headOf(gitOf($), root.top);
    const tree = await worktreeTree(gitOf($), root.top);
    const c = await coverageOf(gitOf($), root.top, head, tree, state.reviews);
    status.worktreeTree = tree;
    status.snapshot = await snapshotOf(gitOf($), root.top, head, tree);
    status.changed = c?.rows.length ?? null;
    status.uncovered = c ? uncoveredOf(c.rows) : null;
    status.unreadReviews = c?.unread ?? null;
    status.roundsSinceCommit = roundsOf(state.reviews.slice(state.roundsFrom));
    // The newest last: how many rounds each recent commit took to converge.
    // Unreadable, it is null with the reason; the rest of the status still holds.
    try {
      const rounds = await within($, readRounds(storeOf($), root.common), 'reading review rounds');
      status.rounds = rounds.slice(-10);
    } catch (error) {
      status.rounds = null;
      status.roundsError = messageOf(error);
    }
    try {
      const cycles = await within($, readCycles(storeOf($), root.common), 'reading review cycles');
      status.cycles = rollupOf(cycles);
    } catch (error) {
      status.cycles = null;
      status.cyclesError = messageOf(error);
    }
    if (c === null) status.error = 'could not diff the working tree';
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }
  return { result: JSON.stringify(status, null, 2) };
}

// The recorded misses a draft can read whole; the counts cover every one kept.
const RECORDED_SHOWN = MAX_MISSES;

async function onMisses(
  $: $,
  _e: Input<MissesHook>,
  _next: NextOf<MissesHook>,
): Promise<Output<MissesHook>> {
  const { recorded, unsaved, error } = await keptMisses($);
  return {
    result: JSON.stringify({
      misses: state.misses,
      recorded: recorded?.slice(-RECORDED_SHOWN) ?? null,
      counts: recorded && countsOf(recorded),
      unsaved,
      ...(error === null ? {} : { recordedError: error }),
    }),
  };
}

function onStatusOff(
  _$: $,
  _e: Input<StatusHook>,
  _next: NextOf<StatusHook>,
): ReturnType<StatusHook> {
  return {
    result:
      "review-cycle's commit gate is switched off in /config (review-cycle.enabled), so nothing is gated.",
  };
}

function onConfigSet($: $, e: Input<ConfigHook>, next: NextOf<ConfigHook>): ReturnType<ConfigHook> {
  if (e.origin?.kind !== 'composer') {
    return { deny: "review-cycle's settings are changed only by the user in /config." };
  }
  return e.key === 'review-cycle.nudge' ? nudgeSet($, e, next) : next(e);
}

// The local settings file can keep the nudge on whatever this value says, so
// what is owed goes only when the nudge is off once every setting is read.
async function nudgeSet(
  $: $,
  e: Input<ConfigHook>,
  next: NextOf<ConfigHook>,
): Promise<Output<ConfigHook>> {
  const r = await next(e);
  if (r.deny !== undefined) return r;
  state.nudge = r.value !== false;
  if (state.owed !== null && !(await nudgeWanted($))) state.owed = null;
  return r;
}

// A throw is skipped by the engine and the call proceeds, so a failure while
// judging any step readCommand finds is caught here and refused.
// Anything else runs, with a note that the gate could not watch it.
function onBashError(
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

export const register: Register = (on, options) => {
  state.gateOn = options.enabled !== false;
  state.stopBefore = stopBeforeOf(options.stopBefore);
  state.prUpdates = prUpdatesOf(options.prUpdates);
  state.nudge = options.nudge !== false;
  state.unaskedNotice = options.unaskedNotice === true;
  on('config.set', { key: 'review-cycle.enabled' }, onConfigSet);
  on('config.set', { key: 'review-cycle.stopBefore' }, onConfigSet);
  on('config.set', { key: 'review-cycle.prUpdates' }, onConfigSet);
  on('config.set', { key: 'review-cycle.nudge' }, onConfigSet);
  on('config.set', { key: 'review-cycle.unaskedNotice' }, onConfigSet);
  on('tool.call', { tool: 'Edit' }, onEditSlop);
  on('tool.call', { tool: 'Write' }, onWriteSlop);
  on('session.start', onSessionStart);
  // `/clear` and a resume end the session without a fresh session.start.
  on('session.end', async ($, e, next) => {
    // After a reload, take the record back first, or it would restore what this clears.
    if (state.gateOn) await recallOnce($);
    state.standing = NO_STANDING;
    state.reviewing = null;
    state.message = { ...state.message, ...UNGRANTED, unread: null, said: null };
    // The last offer does not outlast the conversation it was made in.
    state.said = { text: '', before: '', origin: null };
    state.lastAnswer = '';
    // A fresh conversation may start something else, so an epic job ends here too.
    state.mandate = null;
    void keep($);
    return next(e);
  });
  on('tool.call', { tool: 'mcp__review-cycle__ledger' }, onLedger);
  on('tool.call', { tool: 'mcp__review-cycle__ledger_record' }, onLedgerRecord);
  on('tool.call', { tool: 'mcp__review-cycle__scratch' }, keptScratch);
  on('tool.call', { tool: 'mcp__review-cycle__sweep' }, keptSweep);
  on('tool.call', { tool: 'mcp__review-cycle__codex_log' }, onCodexLog);
  on('tool.call', { tool: 'mcp__review-cycle__codex_command' }, onCodexCommand);
  on('tool.call', { tool: SUMMARY_TOOL }, onSummary);
  on('ui.render', { component: 'ToolUse' }, (_$, e, next) =>
    e.props.tool === SUMMARY_TOOL
      ? next({ ...e, props: { ...e.props, input: summaryHeader(e.props.input) } })
      : next(e),
  );
  on('tool.call', { tool: 'Skill' }, onSubagentSkill);
  on('skill.prompt', { skill: 'review-cycle:review' }, onReviewSkill);
  on('skill.prompt', { skill: 'review-cycle:review-pr' }, onReviewSkill);
  on('session.compact', onCompact);
  if (options.enabled === false) {
    // The status tool stays registered from before the switch; say why it is idle.
    on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatusOff);
    return;
  }
  on('prompt.submit', keptPromptSubmit);
  on('agent.spawn', keptAgentSpawn);
  // A leg's notification reports only its final context; its spend is each
  // step's usage, summed here.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e);
    const leg = e.agentId === undefined ? undefined : state.legs.get(e.agentId);
    const spent = leg && r.usage && spentWith(leg.spend ?? NO_SPEND, r.usage);
    // A count off the API's shape would make the kept record one isKept refuses.
    if (leg && spent && isSpend(spent)) {
      leg.spend = spent;
      void keepGate($);
    }
    return r;
  });
  on('turn.complete', keptTurnComplete);
  on('tool.call', { tool: 'Skill' }, keptSkill);
  on('tool.call', { tool: 'Bash' }, keptBash).catch(onBashError);
  on('tool.call', { tool: MCP_GITHUB }, keptGithubTool).catch(onGithubToolError);
  on('tool.call', { tool: 'Bash' }, onBashEdits);
  on('tool.call', { tool: 'Edit' }, onEditContained);
  on('tool.call', { tool: 'Write' }, onWriteContained);
  on('tool.call', { tool: 'Edit' }, onEdit).catch(onEditError);
  on('tool.call', { tool: 'Write' }, onWrite).catch(onWriteError);
  on('tool.call', { tool: 'NotebookEdit' }, onNotebookEdit);
  on('tool.call', { tool: 'Monitor' }, onMonitor).catch(onMonitorError);
  on('tool.call', { tool: 'mcp__review-cycle__status' }, onStatus);
  on('tool.call', { tool: 'mcp__review-cycle__misses' }, onMisses);
  on('tool.call', { tool: 'mcp__review-cycle__offer' }, onOffer);
  on('tool.call', { tool: 'mcp__review-cycle__threads' }, onThreads);
  on('tool.call', { tool: 'mcp__review-cycle__reply' }, onReply);
};
