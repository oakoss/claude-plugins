// Notes the files a Bash command changed, so its edits go through Edit and
// Write, where the comment-slop and settings checks run. No `$`: the snapshot
// and the comparison are passed in, as git.ts takes its runner.
//
// The working tree is compared around the command; `mayWrite` only picks the
// commands worth measuring, so a false yes costs time, not accuracy.

import { basename, BUILTIN_RUNNERS, every, INTERPRETERS, KEYWORDS } from './command';
import { messageOf } from './git';
import { assignmentName, parse, type ShellAliases, type Statement, type Word } from './shell';

// Writers and runners the gate does not treat as running code.
const WRITERS = new Set([
  'tee',
  'sed',
  'gsed',
  'awk',
  'gawk',
  'cp',
  'mv',
  'install',
  'truncate',
  'dd',
  'rsync',
  'sponge',
  'patch',
  'xargs',
]);
const PYTHON = /^python[0-9.]*$/;
// Wrappers that run the command after them, besides the reserved words.
const WRAPPERS = new Set(['time', 'env', 'exec', 'command', 'nohup', 'nice']);
// The paths a note lists before it counts the rest.
const SHOWN = 10;

// A redirect whose target the shell computes may land anywhere.
const writesFile = (w: Word): boolean => w.dynamic || !w.text.startsWith('/dev/');

const nameOf = (w: Word): string => basename(w.text).replace(/\.exe$/i, '');

// Runners whose names are also ordinary words and paths (`git add .`,
// `rg expect`, `pnpm run watch`): they count only as the command itself,
// which runsScript checks.
const COMMAND_ONLY = new Set([
  ...BUILTIN_RUNNERS,
  'expect',
  'watch',
  'script',
  'sudo',
  'doas',
  'uv',
  'mise',
  'nix-shell',
]);

function names(w: Word): boolean {
  const name = nameOf(w);
  if (COMMAND_ONLY.has(name)) return false;
  return INTERPRETERS.has(name) || WRITERS.has(name) || PYTHON.test(name);
}

const beforeCommand = (w: Word): boolean =>
  assignmentName(w) !== null ||
  KEYWORDS.has(w.text) ||
  WRAPPERS.has(w.text) ||
  w.text.startsWith('-');

// A script run by its path, or a command-only runner, behind any
// assignments, flags, reserved words and wrappers.
function runsScript(st: Statement): boolean {
  const command = st.words.find((w) => !beforeCommand(w));
  if (command === undefined) return false;
  return command.text.includes('/') || COMMAND_ONLY.has(nameOf(command));
}

// Any word counts, not only the first, so a writer behind `if`, `time`,
// `env`, `sudo`, `xargs` or a wrapper still counts. A command it cannot read
// counts.
export function mayWrite(command: string, aliases: ShellAliases = new Map()): boolean {
  const parsed = parse(command, aliases);
  if ('error' in parsed) return true;
  if (parsed.bareWrites.some(writesFile)) return true;
  const writes = (st: Statement): boolean =>
    st.writes.some(writesFile) || st.words.some(names) || runsScript(st);
  return every(parsed.statements, (st) => (writes(st) ? 'writes' : null)) !== null;
}

// The comparison sees every change made while the command ran, a parallel
// Edit or the user's own save included, so the note cannot claim the command
// made them.
export function editNote(paths: readonly string[]): string {
  const shown = paths.slice(0, SHOWN).join(', ');
  const more = paths.length > SHOWN ? ` and ${paths.length - SHOWN} more` : '';
  return `review-cycle: files changed while this command ran: ${shown}${more}. If the command made those edits, make file changes with Edit or Write instead: the comment-slop and settings checks run there, not on Bash.`;
}

export function editsSkipped(why: string): string {
  return `review-cycle: could not check which files this command changed (${why}).`;
}

// Runs the command between two snapshots and names what changed. Never
// rejects for a failed measurement: the command runs, and a failure becomes
// the note. `diff` returns null when it cannot compare.
export async function measureEdits<R>(
  snapshot: () => Promise<string>,
  diff: (before: string, after: string) => Promise<string[] | null>,
  run: () => Promise<R>,
): Promise<{ result: R; note: string | null }> {
  let before: string;
  try {
    before = await snapshot();
  } catch (error) {
    return { result: await run(), note: editsSkipped(messageOf(error)) };
  }
  const result = await run();
  try {
    const after = await snapshot();
    if (after === before) return { result, note: null };
    const changed = await diff(before, after);
    if (changed === null) return { result, note: editsSkipped('git could not compare the trees') };
    return { result, note: changed.length === 0 ? null : editNote(changed) };
  } catch (error) {
    return { result, note: editsSkipped(messageOf(error)) };
  }
}
