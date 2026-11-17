// Notes the files a Bash command changed, so its edits go through Edit and
// Write, where the comment-slop and settings checks run. No `$`: the snapshot
// and the comparison are passed in, as git.ts takes its runner.
//
// The working tree is compared around the command; `mayWrite` only picks the
// commands worth measuring, so a false yes costs time, not accuracy.

import { messageOf } from '../gate/git';
import { basename, BUILTIN_RUNNERS, every, interprets, KEYWORDS } from '../shell/command';
import { programName } from '../shell/programs';
import {
  assignmentName,
  parse,
  type ShellAliases,
  type Statement,
  type Word,
} from '../shell/shell';

// Writers and runners the gate does not treat as running code.
const WRITERS = new Set([
  'tee',
  'sed',
  'gsed',
  'awk',
  'gawk',
  'cp',
  'mv',
  'truncate',
  'dd',
  'rsync',
  'sponge',
  'patch',
  'xargs',
]);
// Wrappers that run the command after them, besides the reserved words.
const WRAPPERS = new Set(['time', 'env', 'exec', 'command', 'nohup', 'nice']);
// The paths a note lists before it counts the rest.
const SHOWN = 10;

// A redirect whose target the shell computes may land anywhere.
const writesFile = (w: Word): boolean => w.dynamic || !w.text.startsWith('/dev/');

const nameOf = (w: Word): string => programName(w.text);

// Runners and writers whose names are also ordinary words and paths
// (`git add .`, `rg expect`, `pnpm run watch`, `pnpm install`): they count
// only as the command itself, which runsScript checks.
const COMMAND_ONLY = new Set([
  ...BUILTIN_RUNNERS,
  'install',
  'expect',
  'watch',
  'script',
  'screen',
  'tmux',
  'su',
  'flock',
  'sudo',
  'doas',
  'uv',
  'mise',
  'nix-shell',
]);

function names(w: Word): boolean {
  const name = nameOf(w);
  if (COMMAND_ONLY.has(name)) return false;
  return interprets(name) || WRITERS.has(name);
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

// Formatters, each with the subcommand that formats when it needs one. A
// fixer (`biome check --write`, `eslint --fix`) is not one: it can rewrite code.
const FORMATTERS = new Map<string, string | null>([
  ['oxfmt', null],
  ['prettier', null],
  ['biome', 'format'],
  ['dprint', 'fmt'],
]);
// A formatter by its bare name or its node_modules/.bin path; never a script
// elsewhere that shares the name.
function formats(words: readonly Word[]): boolean {
  const [command, sub] = words;
  if (command === undefined || command.dynamic) return false;
  const path = command.text;
  if (path.includes('/') && !/(^|\/)node_modules\/\.bin\/[^/]+$/.test(path)) return false;
  const wants = FORMATTERS.get(basename(path));
  return wants === null || (wants !== undefined && sub?.text === wants);
}

const isCd = (words: readonly Word[]): boolean => words[0]?.text === 'cd' && words.length <= 2;

const plain = (st: Statement): boolean =>
  st.inner.length === 0 && !st.group && st.heredocs.length === 0 && !st.writes.some(writesFile);

// A command made only of formatter calls, and `cd`, writing nothing else: the
// files it changes are the formatter's, which Phase 2 of the review runs.
function formatsOnly(statements: readonly Statement[], bareWrites: readonly Word[]): boolean {
  if (bareWrites.some((w) => writesFile(w))) return false;
  return (
    statements.every((st) => plain(st)) &&
    statements.some((st) => formats(st.words)) &&
    statements.every((st) => isCd(st.words) || formats(st.words))
  );
}

// Any word counts, not only the first, so a writer behind `if`, `time`,
// `env`, `sudo`, `xargs` or a wrapper still counts. A command it cannot read
// counts.
export function mayWrite(command: string, aliases: ShellAliases = new Map()): boolean {
  const parsed = parse(command, aliases);
  if ('error' in parsed) return true;
  if (formatsOnly(parsed.statements, parsed.bareWrites)) return false;
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
