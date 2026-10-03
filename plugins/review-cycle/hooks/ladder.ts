// Where the agent stops to ask the user before an outward step. Pure.
//
// One setting, review-cycle's `stopBefore`: a step below the chosen rung runs
// without asking, one at or above it needs the user's request. Claude Code
// passes the register options only from user and managed settings, so the
// gate reads the project's and the local file's pluginConfigs itself.

export const RUNGS = ['commit', 'push', 'open PR', 'merge', 'release', 'never stop'] as const;
export type StopBefore = (typeof RUNGS)[number];
export const DEFAULT_STOP: StopBefore = 'push';
// What a setting the gate cannot trust falls back to.
export const STRICTEST: StopBefore = RUNGS[0];

// The steps the gate judges, in rung order.
export type Step = 'commit' | 'push' | 'pr' | 'merge' | 'approve' | 'release';
const STEP_RUNG: Record<Step, StopBefore> = {
  commit: 'commit',
  push: 'push',
  pr: 'open PR',
  merge: 'merge',
  // An approval can be all a merge waits for.
  approve: 'merge',
  release: 'release',
};

export type Source = 'default' | 'user' | 'project' | 'local';
export type Ladder = Readonly<{ stopBefore: StopBefore; source: Source }>;

const PLUGIN = /^review-cycle(@|$)/;

const rank = (r: StopBefore): number => RUNGS.indexOf(r);

// A value outside the options counts as unset, as Claude Code documents for
// the options it passes.
export function stopBeforeOf(value: unknown): StopBefore | null {
  return RUNGS.find((r) => r === value) ?? null;
}

// The value a settings file's pluginConfigs gives review-cycle, under its bare
// name or a marketplace-qualified one (`review-cycle@oakoss`). A value outside
// the options stops before every step: a typo meant to stop earlier must not
// leave a looser rung in force.
export function configured(pluginConfigs: unknown): StopBefore | null {
  if (pluginConfigs === null || typeof pluginConfigs !== 'object') return null;
  let found: StopBefore | null = null;
  for (const [name, entry] of Object.entries(pluginConfigs)) {
    if (!PLUGIN.test(name) || entry === null || typeof entry !== 'object') continue;
    const options: unknown = (entry as { options?: unknown }).options;
    if (options === null || typeof options !== 'object' || !('stopBefore' in options)) continue;
    const value = stopBeforeOf(options.stopBefore) ?? STRICTEST;
    if (found === null || rank(value) < rank(found)) found = value;
  }
  return found;
}

// The local file is the user's own and gitignored, so it may set any rung. A
// committed project file only stops earlier than the user's own value.
export function effective(
  user: StopBefore | null,
  project: StopBefore | null,
  local: StopBefore | null,
): Ladder {
  if (local !== null) return { stopBefore: local, source: 'local' };
  // Claude Code fills in the option's default, so a user value equal to it
  // cannot be told from no value at all.
  const mine: Ladder =
    user === null || user === DEFAULT_STOP
      ? { stopBefore: DEFAULT_STOP, source: 'default' }
      : { stopBefore: user, source: 'user' };
  if (project !== null && rank(project) < rank(mine.stopBefore)) {
    return { stopBefore: project, source: 'project' };
  }
  return mine;
}

// Whether the step needs the user's request under this ladder.
export function asks(ladder: Ladder, step: Step): boolean {
  return rank(STEP_RUNG[step]) >= rank(ladder.stopBefore);
}

export function where(source: Source): string {
  if (source === 'default') return 'the default';
  if (source === 'project') return '.claude/settings.json';
  if (source === 'local') return '.claude/settings.local.json';
  return '/config';
}
