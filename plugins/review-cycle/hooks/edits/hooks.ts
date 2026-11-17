import type { Caught, CatchHandler, MatchedHook } from 'claude-code';

import { deny } from '../consent/refusal';
import {
  applyEdit,
  isJsonPath,
  marketplaceOf,
  namesSwitch,
  touchesGate,
} from '../consent/settings';
import { insideRepo } from '../gate/containment';
import { messageOf, reviewablePaths, worktreeTree, type Repo } from '../gate/git';
import { loadShellAliases } from '../shell/aliases-io';
import { readCommand } from '../shell/command';
import {
  currentText,
  ensureRoot,
  gitOf,
  type $,
  type Input,
  type NextOf,
  type Output,
} from '../state/engine';
import { runningLeg, state } from '../state/gate-state';
import { editsSkipped, mayWrite, measureEdits } from './edits';

export type BashHook = MatchedHook<'tool.call', { tool: 'Bash' }>;
type EditHook = MatchedHook<'tool.call', { tool: 'Edit' }>;
type WriteHook = MatchedHook<'tool.call', { tool: 'Write' }>;
type NotebookHook = MatchedHook<'tool.call', { tool: 'NotebookEdit' }>;
type MonitorHook = MatchedHook<'tool.call', { tool: 'Monitor' }>;

export const SWITCHED_BY_USER =
  'review-cycle is switched on and off only by the user, in /config. Ask them; to read a settings file, use the Read tool.';

// A reviewer changing the tree it reviews voids its own review and can land in
// the user's commit; scratch work belongs outside the repository.
async function containedEdit(
  $: $,
  agentId: string | undefined,
  path: string,
): Promise<{ deny: string } | null> {
  if (runningLeg(agentId) === null) return null;
  let root: Repo | null;
  try {
    root = await ensureRoot($);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return deny(
      `the gate could not find the repository under review (${why}), so it refuses a reviewer's edits. Report back instead.`,
    );
  }
  if (root === null || !insideRepo(path, root.top)) return null;
  return deny(
    `reviewers do not edit the repository under review (${root.top}). Copy what you need into a private directory from mktemp -d and change the copy.`,
  );
}

export async function onEditContained(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook>,
): Promise<Output<EditHook>> {
  return (await containedEdit($, e.agentId, e.file_path)) ?? next(e);
}

export async function onWriteContained(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook>,
): Promise<Output<WriteHook>> {
  return (await containedEdit($, e.agentId, e.file_path)) ?? next(e);
}

export async function onNotebookEdit(
  $: $,
  e: Input<NotebookHook>,
  next: NextOf<NotebookHook>,
): Promise<Output<NotebookHook>> {
  return (await containedEdit($, e.agentId, e.notebook_path)) ?? next(e);
}

export async function onEdit(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook>,
): Promise<Output<EditHook>> {
  if (!isJsonPath(e.file_path)) return next(e);
  const before = await currentText($, e.file_path);
  // An edit to a missing file creates it with the new text.
  if (before === null) return touchesGate(null, e.new_string) ? deny(SWITCHED_BY_USER) : next(e);
  const after = applyEdit(before, e.old_string, e.new_string, e.replace_all === true);
  // An edit the gate cannot replay passes only when neither the file, which
  // holds the text it replaces, nor its new text names a switch.
  const touches =
    after === null ? namesSwitch(before) || namesSwitch(e.new_string) : touchesGate(before, after);
  return touches ? deny(SWITCHED_BY_USER) : next(e);
}

export async function onWrite(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook>,
): Promise<Output<WriteHook>> {
  if (!isJsonPath(e.file_path)) return next(e);
  if (touchesGate(await currentText($, e.file_path), e.content)) return deny(SWITCHED_BY_USER);
  return next(e);
}

// A settings file the gate could not read may be switching it off.
function fileCheckFailed(path: string, next: Caught): { deny: string } | null {
  if (next.called || !isJsonPath(path)) return null;
  return deny(
    `the gate could not check whether this changes its own switch (${next.error.message ?? next.error.kind}), so it is refused.`,
  );
}

export function onEditError(
  $: $,
  e: Input<EditHook>,
  next: NextOf<EditHook> & Caught,
): ReturnType<CatchHandler<EditHook>> {
  return fileCheckFailed(e.file_path, next) ?? next(e);
}

export function onWriteError(
  $: $,
  e: Input<WriteHook>,
  next: NextOf<WriteHook> & Caught,
): ReturnType<CatchHandler<WriteHook>> {
  return fileCheckFailed(e.file_path, next) ?? next(e);
}

// Monitor runs a shell command the Bash hooks never see, so one that the gate
// would judge, or that touches its switch, goes through Bash instead.
export async function onMonitor(
  $: $,
  e: Input<MonitorHook>,
  next: NextOf<MonitorHook>,
): Promise<Output<MonitorHook>> {
  if (e.command === undefined) return next(e);
  await loadShellAliases($);
  const r = readCommand(e.command, state.shellAliases, marketplaceOf($.plugin.root));
  const judged =
    r.touchesGate ||
    r.classification.kind !== 'none' ||
    r.gh.length > 0 ||
    r.aliasCalls.length > 0 ||
    r.stackRewrite !== null;
  if (!judged) return next(e);
  return deny(
    'Monitor runs commands the gate does not check. Run a command that commits, pushes, opens, merges, approves or comments on a pull request, releases, rewrites a gh stack, calls a git alias or writes settings with the Bash tool.',
  );
}

export function onMonitorError(
  $: $,
  e: Input<MonitorHook>,
  next: NextOf<MonitorHook> & Caught,
): ReturnType<CatchHandler<MonitorHook>> {
  if (next.called || e.command === undefined) return next(e);
  return deny(
    `the gate could not check this command (${next.error.message ?? next.error.kind}), so it is refused.`,
  );
}

// A note, never a refusal: the command has already run. Reviewer legs are
// compared by the gate already, and a background command is still running
// when the call returns. Never throws, so the gate's own notes always arrive.
export async function onBashEdits(
  $: $,
  e: Input<BashHook>,
  next: NextOf<BashHook>,
): Promise<Output<BashHook>> {
  const skip =
    runningLeg(e.agentId) !== null ||
    e.run_in_background === true ||
    !mayWrite(e.command, state.shellAliases);
  if (skip) return next(e);
  let root: Repo | null;
  // onBash, registered first, has already looked the root up; this guards a
  // registration order where it has not.
  try {
    root = await ensureRoot($);
  } catch (error) {
    return withNote(next(e), editsSkipped(messageOf(error)));
  }
  if (root === null) return next(e);
  const { top } = root;
  const git = gitOf($);
  const { result, note } = await measureEdits(
    () => worktreeTree(git, top),
    (before, after) => reviewablePaths(git, top, before, after),
    () => next(e),
  );
  return note === null ? result : withNote(result, note);
}

export async function withNote(
  result: Output<BashHook> | Promise<Output<BashHook>>,
  note: string,
): Promise<Output<BashHook>> {
  const r = await result;
  if (r.deny !== undefined) return r;
  return { ...r, context: [...(r.context ?? []), note] };
}
