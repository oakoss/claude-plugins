import type { HookFor, MatchedHook, Register, Timer } from 'claude-code';

import { covers, UNGRANTED } from './consent/consent';
import { stopBeforeOf, where } from './consent/ladder';
import { countsOf } from './consent/misses';
import { OFFER_STEPS, OPERATIONS } from './consent/offers';
import { prUpdatesOf } from './consent/pr-updates';
import { onOffer, onPromptSubmit } from './consent/prompt';
import { MAX_MISSES } from './consent/refusal';
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
} from './edits/hooks';
import { onBash, onBashError, onGithubTool, onGithubToolError } from './gate/bash';
import { NO_STANDING, permitted, standsFor } from './gate/gh-verdict';
import { coverageOf, headOf, messageOf, snapshotOf, worktreeTree } from './gate/git';
import { MCP_GITHUB } from './gate/github';
import { ladderOf, prUpdatesInForce } from './gate/judge';
import { onReply, onThreads, registerReply } from './gate/reply';
import { onLedger, onLedgerRecord, registerLedger } from './ledger/tools';
import { onCodexCommand, onCodexLog, registerCodexLog } from './review/codex-io';
import { readCycles, rollupOf } from './review/cycles';
import { onAgentSpawn, onTurnComplete } from './review/legs';
import { nudgeWanted } from './review/nudge-io';
import { readRounds, roundsOf } from './review/rounds';
import { onScratch, onSweep, registerScratch } from './review/scratch';
import { onCompact, onReviewSkill, onSkill, onSubagentSkill } from './review/skills';
import { isSpend, NO_SPEND, spentWith } from './review/spend';
import { SUMMARY_TOOL, summaryHeader } from './review/summary';
import { onSummary, registerSummary } from './review/summary-io';
import { uncoveredOf } from './review/witness';
import { readOwnAliases } from './shell/aliases-io';
import {
  ensureRoot,
  gitOf,
  storeOf,
  within,
  type $,
  type Input,
  type NextOf,
  type Output,
} from './state/engine';
import { held, state } from './state/gate-state';
import { clearOffGate, keep, keepGate, keptMisses, recallOnce } from './state/keep';

// The gate watches Bash with a function hook, not the classic PreToolUse
// bridge. While any `tool.call { tool: "Bash" }` hook is loaded, Bash inside an
// `isolation: "worktree"` subagent is refused (anthropics/claude-code#92533);
// the bridge avoids that at the cost of a stub script, should it matter.

type StatusHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__status' }>;
type MissesHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__misses' }>;
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
