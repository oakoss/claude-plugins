// Whether a Bash command may change files, and the note when one did. Pure.
//
// The comment-slop check and the precise settings check attach to Edit and
// Write, so an edit made through Bash skips both. The hook measures what a
// command changed by comparing the working tree around it; this only picks
// the commands worth measuring, so a false yes costs time, not accuracy.

import { assignmentName, parse, type ShellAliases, type Statement, type Word } from './shell';

// Commands that write files, run code that may, or run another command line.
const MAY_WRITE = new Set([
  'tee',
  'sed',
  'gsed',
  'perl',
  'ruby',
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
  'node',
  'bun',
  'deno',
  'tsx',
  'ts-node',
  'php',
  'lua',
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'eval',
  'xargs',
  'find',
  'parallel',
]);
const PYTHON = /^python[0-9.]*$/;
// The paths a note lists before it counts the rest.
const SHOWN = 10;

function flatten(list: Statement[]): Statement[] {
  return list.flatMap((st) => [st, ...st.inner.flatMap((inner) => flatten(inner))]);
}

// A redirect whose target the shell computes may land anywhere.
const writesFile = (w: Word): boolean => w.dynamic || !w.text.startsWith('/dev/');

function names(w: Word): boolean {
  const name = w.text.slice(w.text.lastIndexOf('/') + 1).replace(/\.exe$/i, '');
  return MAY_WRITE.has(name) || PYTHON.test(name);
}

// Words that run the command after them.
const PREFIXES = new Set([
  'time',
  'env',
  'exec',
  'command',
  'nohup',
  'nice',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
]);

// A script run by its path, or read into the shell with `source` or `.`,
// behind any assignments and prefixes.
function runsScript(st: Statement): boolean {
  for (const w of st.words) {
    if (assignmentName(w) !== null || PREFIXES.has(w.text) || w.text.startsWith('-')) continue;
    return w.text === 'source' || w.text === '.' || w.text.includes('/');
  }
  return false;
}

// Any word counts, not only the first, so a writer behind `if`, `time`,
// `env`, `xargs` or a wrapper still counts. A command it cannot read counts.
export function mayWrite(command: string, aliases: ShellAliases = new Map()): boolean {
  const parsed = parse(command, aliases);
  if ('error' in parsed) return true;
  if (parsed.bareWrites.some(writesFile)) return true;
  return flatten(parsed.statements).some(
    (st) => st.writes.some(writesFile) || st.words.some(names) || runsScript(st),
  );
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
