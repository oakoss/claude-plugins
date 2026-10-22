// Decides whether a change to a settings file switches or configures
// review-cycle. Pure.
//
// Claude Code reloads a plugin when user settings change, so an agent that
// edits `enabledPlugins` or `pluginConfigs` mid-session turns the gate off or
// loosens it without passing through `config.set`. Any JSON file counts,
// because a settings file can be passed with `--settings` under any name.

import { assignmentName, parse, type ShellAliases, type Statement, type Word } from './shell';

const PLUGIN = /^review-cycle(@|$)/;
const SWITCHES = ['enabledPlugins', 'pluginConfigs'] as const;
// The key outside the plugin tables that stops every installed mod loading.
const HOOKS_OFF = 'disableAllHooks';

export function isJsonPath(path: string): boolean {
  return /\.json[c5]?$/i.test(path);
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// What in the text switches the gate. Claude Code skips a settings file that is
// not a strict JSON object (comments included; a byte-order mark is fine). It
// also skips one whose known key fails its schema, which this does not model.
function gateEntries(text: string): string {
  let parsed: Record<string, unknown> | null;
  try {
    const bom = String.fromCodePoint(0xfe_ff);
    parsed = objectOf(JSON.parse(text.startsWith(bom) ? text.slice(1) : text));
  } catch {
    parsed = null;
  }
  if (parsed === null) return '[]';
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

// Whether text names a switch, for an edit whose result the gate cannot rebuild.
export function namesSwitch(text: string): boolean {
  return /"(?:enabledPlugins|pluginConfigs|disableAllHooks|review-cycle[^"]*)"/.test(text);
}

// Whether replacing `before` (null when the file does not exist) with `after`
// changes how review-cycle is switched. Only the user makes that change.
export function touchesGate(before: string | null, after: string): boolean {
  return gateEntries(before ?? '') !== gateEntries(after);
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
  /(^|[^<&0-9])>|\b(rm|mv|cp|ln|tee|truncate|sponge|install|dd|rsync|python3?|node|bun|deno|tsx|ts-node|lua|osascript)\b|\b(sed|perl|ruby)\b[^|;&]*\s(-[a-zA-Z0-9]*i|--in-place)/;
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
const INTERPRETERS = /^(python[0-9.]*|node|bun|deno|tsx|ts-node|lua|osascript)$/;
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
// Read as typed and through the user's aliases, refusing on either: an alias
// can hide a removal (`cpu='claude plugin uninstall'`) or rename a writer the
// check knows (`sed=gsed`).
export function bashTouchesGate(
  command: string,
  marketplace: string | null = null,
  aliases: ShellAliases = new Map(),
): boolean {
  if (touchesGateAs(command, marketplace, new Map())) return true;
  return aliases.size > 0 && touchesGateAs(command, marketplace, aliases);
}

function touchesGateAs(
  command: string,
  marketplace: string | null,
  aliases: ShellAliases,
): boolean {
  const parsed = parse(command, aliases);
  if ('error' in parsed) return textTouchesGate(command);
  const all = flatten(parsed.statements);
  if (all.some((st) => removesPlugin(st, marketplace))) return true;
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

// `claude [options] plugin[s] [marketplace] disable|uninstall|remove|rm` that
// reaches review-cycle: naming it, the marketplace it came from (or any, when
// that is unknown), nothing at all, every plugin, or a name only the shell
// resolves. The CLI matches names case-insensitively; `--help` removes nothing.
function removesPlugin(st: Statement, marketplace: string | null): boolean {
  const at = names(st).findIndex((n) => CLAUDE.test(n));
  if (at === -1) return false;
  const rest = st.words.slice(at + 1);
  const plugin = rest.findIndex((w) => /^plugins?$/.test(w.text));
  if (plugin === -1) return false;
  let args = rest.slice(plugin + 1);
  const market = /^market(place)?$/.test(args[0]?.text ?? '');
  if (market) args = args.slice(1);
  if (!/^(disable|uninstall|remove|rm)$/.test(args[0]?.text ?? '')) return false;
  const operands: Word[] = [];
  let flags = true;
  let all = false;
  for (let i = 1; i < args.length; i++) {
    const w = args[i]!;
    if (!flags || !w.text.startsWith('-')) operands.push(w);
    else if (w.text === '--') flags = false;
    else if (/^(-h|--help)$/.test(w.text)) return false;
    else if (/^(-a|--all)$/.test(w.text)) all = true;
    else if (/^(-s|--scope)$/.test(w.text)) i += 1;
  }
  if (all || operands.length === 0) return true;
  const own = market ? marketplace?.toLowerCase() : null;
  return operands.some((w) => {
    const name = w.text.toLowerCase();
    if (w.dynamic || w.pattern) return true;
    return market ? marketplace === null || name === own : /^review-cycle(@|$)/.test(name);
  });
}

// The marketplace an installed copy came from, read from its cache path
// (`…/plugins/cache/<marketplace>/review-cycle/<version>`); null for a copy
// loaded from a directory, such as `--plugin-dir`.
export function marketplaceOf(root: string): string | null {
  return /\/plugins\/cache\/([^/]+)\/review-cycle\/[^/]+\/?$/.exec(root)?.[1] ?? null;
}

function writes(st: Statement): boolean {
  if (st.writes.some(writesFile)) return true;
  // `claude` runs none of its arguments: the `install` in `claude plugin
  // install` is a subcommand, not the program that writes files.
  const command = st.words.find((w) => assignmentName(w) === null);
  if (command !== undefined && CLAUDE.test(basename(command.text))) return false;
  const n = names(st);
  if (n.some((name) => WRITERS.has(name) || INTERPRETERS.test(name))) return true;
  const inPlace = st.words.some((w) => /^(-[a-zA-Z0-9]*i|--in-place)/.test(w.text));
  return inPlace && n.some((name) => IN_PLACE.has(name));
}
