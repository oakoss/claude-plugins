// Decides whether a change to a settings file switches review-cycle off. Pure.
//
// Claude Code reloads a plugin when user settings change, so an agent that
// edits `enabledPlugins` or `pluginConfigs` mid-session turns the gate off
// without passing through `config.set`. Any JSON file counts, because a
// settings file can be passed with `--settings` under any name.

const PLUGIN = /^review-cycle(@|$)/;
const SWITCHES = ['enabledPlugins', 'pluginConfigs'] as const;
// Keys outside the plugin tables that can stop the gate from loading.
const HOOKS_OFF = 'disableAllHooks';
const MODULES_ENV = 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS';

// Every line of text naming a switch, for files `JSON.parse` rejects: Claude
// Code may still read one with a byte-order mark, comments or a trailing comma.
const SWITCH_TEXT =
  /"(enabledPlugins|pluginConfigs|disableAllHooks|CLAUDE_CODE_ENABLE_FUNCTION_HOOKS|review-cycle[^"]*)"[^\n]*/g;

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
  const env = parsed.env;
  if (env !== undefined) {
    const table = objectOf(env);
    const value = table === null ? env : table[MODULES_ENV];
    if (value !== undefined) entries.push(['env', MODULES_ENV, value]);
  }
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

const CLAUDE_DIR = /\.claude\b|CLAUDE_CONFIG_DIR/i;
const WRITES =
  /(^|[^<&0-9])>|\b(rm|mv|cp|ln|tee|truncate|sponge|install|dd|python3?|node|bun|deno|osascript)\b|\b(sed|perl|ruby)\b[^|;&]*\s(-[a-zA-Z]*i|--in-place)/;
const SWITCH_WORD =
  /\b(enabledPlugins|pluginConfigs|disableAllHooks|CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)\b/;
const PLUGIN_CLI = /\bclaude\b[^|;&]*\bplugins?\b[^|;&]*\b(disable|uninstall|remove|rm)\b/;

// A speed bump, not a wall: it reads text, so a target built at run time gets
// past it. `KEY=1` is not exempt, since the shell can join more onto the `1`.
export function bashTouchesGate(command: string): boolean {
  if (PLUGIN_CLI.test(command)) return true;
  if (!WRITES.test(command)) return false;
  if (SWITCH_WORD.test(command)) return true;
  return CLAUDE_DIR.test(command) && command.toLowerCase().includes('settings');
}
