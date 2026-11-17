// Programs that run code they are given, by name, for every reader of a
// command: the commit gate, the settings guard and the edits note. Pure.

// A program's name as the shell finds it: its path's last part, without a
// Windows `.exe`.
export function programName(text: string): string {
  return text.slice(text.lastIndexOf('/') + 1).replace(/\.exe$/i, '');
}

// Shells, which run the script on their standard input when given none.
export const SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);

// Programs that hand an argument, or the rest of their words, to a shell.
export const SHELL_RUNNERS: ReadonlySet<string> = new Set([
  'eval',
  'watch',
  'parallel',
  'flock',
  'script',
  'su',
  'tmux',
  'screen',
]);

// Languages that run code given as an argument, a file or their input.
export function runsLanguage(name: string): boolean {
  return /^(python[0-9.]*|node|deno|bun|tsx|ts-node|lua|perl|ruby|php|osascript)$/.test(name);
}

// Whether a program runs a command line or code it is given.
export function takesCode(name: string): boolean {
  return SHELLS.has(name) || SHELL_RUNNERS.has(name) || runsLanguage(name);
}
