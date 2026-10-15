// Whether review-cycle's stop-before setting lets Claude merge unasked. Pure.
//
// The same precedence review-cycle applies, repeated because a module imports
// only its own plugin's files: the local file's value, else the user's (or a
// managed one), made earlier by the project file's. No value is review-cycle's
// default, `push`, which asks before a merge, as does pr-watch without it.

const RUNGS = ['commit', 'push', 'open PR', 'merge', 'release', 'never stop'] as const;
type Rung = (typeof RUNGS)[number];

const PLUGIN = /^review-cycle(@|$)/;
const DEFAULT: Rung = 'push';

const rank = (r: Rung): number => RUNGS.indexOf(r);

// A settings file's value for review-cycle, under its bare or qualified name;
// a value outside the options stops before every step, as review-cycle reads it.
export function configured(pluginConfigs: unknown): Rung | null {
  if (pluginConfigs === null || typeof pluginConfigs !== 'object') return null;
  let found: Rung | null = null;
  for (const [name, entry] of Object.entries(pluginConfigs)) {
    if (!PLUGIN.test(name) || entry === null || typeof entry !== 'object') continue;
    const options: unknown = (entry as { options?: unknown }).options;
    if (options === null || typeof options !== 'object' || !('stopBefore' in options)) continue;
    const value = RUNGS.find((r) => r === options.stopBefore) ?? RUNGS[0];
    if (found === null || rank(value) < rank(found)) found = value;
  }
  return found;
}

export function mergesUnasked({
  user,
  project,
  local,
}: Record<'user' | 'project' | 'local', Rung | null>): boolean {
  let rung = local ?? user ?? DEFAULT;
  if (local === null && project !== null && rank(project) < rank(rung)) rung = project;
  return rank('merge') < rank(rung);
}
