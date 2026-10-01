// Decides whether a change to a settings file switches review-cycle off. Pure.
//
// Claude Code reloads a plugin when user settings change, so an agent that
// edits `enabledPlugins` or `pluginConfigs` mid-session turns the gate off
// without passing through `config.set`. Any JSON file counts, because a
// settings file can be passed with `--settings` under any name.

import { parse, type Statement, type Word } from './shell';

const PLUGIN = /^review-cycle(@|$)/;
const SWITCHES = ['enabledPlugins', 'pluginConfigs'] as const;
// The key outside the plugin tables that stops every installed mod loading.
const HOOKS_OFF = 'disableAllHooks';

// Every line of text naming a switch, for files `JSON.parse` rejects: Claude
// Code may still read one with a byte-order mark, comments or a trailing comma.
const SWITCH_TEXT = /"(enabledPlugins|pluginConfigs|disableAllHooks|review-cycle[^"]*)"[^\n]*/g;

export function isJsonPath(path: string): boolean {
  return /\.json[c5]?$/i.test(path);
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Everything in the text that switches the gate, as comparable text. null
// when the text is not a JSON object.
function gateEntries(text: string): string | null {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = objectOf(JSON.parse(text));
  } catch {
    return null;
  }
  if (parsed === null) return null;
  const entries: [string, string, unknown][] = [];
  for (const key of SWITCHES) {
    const raw = parsed[key];
    if (raw === undefined) continue;
    const table = objectOf(raw);
    if (table === null) {
      entries.push([key, '', raw]);
      continue;
    }
    for (const [name, value] of Object.entries(table)) {
      if (PLUGIN.test(name)) entries.push([key, name, value]);
    }
  }
  if (parsed[HOOKS_OFF] !== undefined) entries.push([HOOKS_OFF, '', parsed[HOOKS_OFF]]);
  return JSON.stringify(
    entries.toSorted((a, b) => `${a[0]}\0${a[1]}`.localeCompare(`${b[0]}\0${b[1]}`)),
  );
}

function switchText(text: string): string {
  return JSON.stringify((text.match(SWITCH_TEXT) ?? []).map((l) => l.trim()).toSorted());
}

// Whether replacing `before` (null when the file does not exist) with `after`
// changes how review-cycle is switched. Only the user makes that change.
export function touchesGate(before: string | null, after: string): boolean {
  const was = before === null ? '[]' : gateEntries(before);
  const now = gateEntries(after);
  if (was !== null && now !== null) return was !== now;
  // Either side is not plain JSON: compare the lines that name a switch.
  return switchText(before ?? '') !== switchText(after);
}

// The text an Edit call leaves, or null when `old` does not occur literally
// (the Edit tool also matches normalised quotes, which this does not attempt).
export function applyEdit(
  text: string,
  old: string,
  replacement: string,
  all: boolean,
): string | null {
  if (old === '' || !text.includes(old)) return null;
  return all ? text.replaceAll(old, replacement) : text.replace(old, () => replacement);
}

// `.claude` itself: a plugin's `.claude-plugin/` holds no settings.
const CLAUDE_DIR = /\.claude(?![-\w])|CLAUDE_CONFIG_DIR/i;
const WRITES =
  /(^|[^<&0-9])>|\b(rm|mv|cp|ln|tee|truncate|sponge|install|dd|rsync|python3?|node|bun|deno|osascript)\b|\b(sed|perl|ruby)\b[^|;&]*\s(-[a-zA-Z0-9]*i|--in-place)/;
// Removing a marketplace uninstalls the plugins installed from it.
const PLUGIN_CLI =
  /\bclaude\b[^|;&]*\bplugins?\s+(market(place)?\s+)?(disable|uninstall|remove|rm)\b/;

// Commands that write the files they are given.
const WRITERS = new Set([
  'rm',
  'mv',
  'cp',
  'ln',
  'tee',
  'truncate',
  'sponge',
  'install',
  'dd',
  'rsync',
]);
// Commands that edit a file in place when given `-i` or `--in-place`.
const IN_PLACE = new Set(['sed', 'perl', 'ruby']);
// Interpreters, whose writes are in code this reader does not follow.
const INTERPRETERS = /^(python[0-9.]*|node|bun|deno|osascript)$/;
// Shells, and commands that hand an argument to one, run a command line this
// reader does not parse.
const SHELLS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'su',
  'eval',
  'watch',
  'parallel',
  'flock',
  'script',
  'tmux',
  'screen',
]);
// `claude` as installed, or run through npx and the like as its package.
const CLAUDE = /^claude(-code)?(@[^/]*)?$/;
// Discarding output writes nothing anyone reads.
const writesFile = (w: Word): boolean => w.text !== '/dev/null';

const basename = (text: string): string =>
  text.slice(text.lastIndexOf('/') + 1).replace(/\.exe$/i, '');

// The text check's test, with what writes and what runs `claude plugin` read
// from the parsed command: quoted prose that mentions a writer, a redirect or
// a plugin subcommand, such as an issue description, is neither. Whether a
// settings file is named is still read from the whole text, so a path reached
// through `cd`, a variable or a loop counts.
export function bashTouchesGate(command: string): boolean {
  const parsed = parse(command);
  if ('error' in parsed) return textTouchesGate(command);
  const all = flatten(parsed.statements);
  if (all.some((st) => removesPlugin(st))) return true;
  if (all.some((st) => runsShell(st))) return textTouchesGate(command);
  const written = parsed.bareWrites.some(writesFile) || all.some((st) => writes(st));
  return written && namesSettings(command);
}

// So do `sudo -s` and `sudo -i` (clustered too, as `-iu`), `env -S`, and a
// prompt `claude -p` acts on.
function runsShell(st: Statement): boolean {
  const n = names(st);
  if (n.some((name) => SHELLS.has(name))) return true;
  const has = (flag: RegExp): boolean => st.words.some((w) => flag.test(w.text));
  if (n.includes('sudo') && has(/^(-[a-zA-Z]*[si][a-zA-Z]*|--shell|--login)$/)) return true;
  if (n.includes('env') && has(/^(-[a-zA-Z]*S|--split-string)/)) return true;
  return n.some((name) => CLAUDE.test(name)) && has(/^(-[a-zA-Z]*p|--print)$/);
}

// The text check, for a command line this reader cannot parse or a shell runs.
function textTouchesGate(text: string): boolean {
  if (PLUGIN_CLI.test(text)) return true;
  return WRITES.test(text) && namesSettings(text);
}

function namesSettings(text: string): boolean {
  return CLAUDE_DIR.test(text) && text.toLowerCase().includes('settings');
}

function flatten(list: Statement[]): Statement[] {
  return list.flatMap((st) => [st, ...st.inner.flatMap((inner) => flatten(inner))]);
}

function names(st: Statement): string[] {
  return st.words.map((w) => basename(w.text));
}

// `claude [options] plugin[s] [marketplace] disable|uninstall|remove|rm`.
function removesPlugin(st: Statement): boolean {
  const at = names(st).findIndex((n) => CLAUDE.test(n));
  if (at === -1) return false;
  const rest = st.words.slice(at + 1).map((w) => w.text);
  const plugin = rest.findIndex((w) => /^plugins?$/.test(w));
  if (plugin === -1) return false;
  const args = rest.slice(plugin + 1);
  const verb = /^market(place)?$/.test(args[0] ?? '') ? args[1] : args[0];
  return /^(disable|uninstall|remove|rm)$/.test(verb ?? '');
}

function writes(st: Statement): boolean {
  if (st.writes.some(writesFile)) return true;
  const n = names(st);
  if (n.some((name) => WRITERS.has(name) || INTERPRETERS.test(name))) return true;
  const inPlace = st.words.some((w) => /^(-[a-zA-Z0-9]*i|--in-place)/.test(w.text));
  return inPlace && n.some((name) => IN_PLACE.has(name));
}
