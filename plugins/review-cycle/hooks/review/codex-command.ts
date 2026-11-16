// The command a review cycle's Codex leg runs: its scope, its reasoning
// effort, the read-only permission profile, and the brief as one config
// override. Pure: codex-io.ts reads the config file and the scratch path.

// Ascending. The API rejects any other value, and Codex does not check a `-c`
// value before the call.
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export const isEffort = (v: unknown): v is Effort =>
  typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);

// The root table's `model_reasoning_effort`: a `[profiles.*]` key is not what runs.
export function configuredEffort(toml: string | null): Effort | null {
  if (toml === null) return null;
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) return null;
    const m = /^\s*model_reasoning_effort\s*=\s*["']([^"']*)["']/.exec(line);
    if (m) return isEffort(m[1]) ? m[1] : null;
  }
  return null;
}

export type Pass = 'review' | 'confirmation';
export type Tier = 'full' | 'light';

// An explicit effort wins on any tier. Otherwise the full tier keeps the
// user's own, and the light tier and a confirmation pass lower it to `low`,
// never raising one already at or below it.
export function effortOf(
  tier: Tier,
  pass: Pass,
  explicit: Effort | null,
  configured: Effort | null,
): { override: Effort | null; label: string } {
  if (explicit !== null) return { override: explicit, label: `${explicit} (explicit)` };
  if (tier === 'full' && pass === 'review') return { override: null, label: 'inherited' };
  if (configured !== null && EFFORTS.indexOf(configured) <= EFFORTS.indexOf('low')) {
    return { override: null, label: 'inherited' };
  }
  return { override: 'low', label: 'low' };
}

// The brief rides a TOML basic string inside shell double quotes, so these end
// or bend it.
const UNSAFE: readonly [string, string][] = [
  ['"', 'a double quote'],
  ['\\', 'a backslash'],
  ['`', 'a backtick'],
  ['$', 'a dollar sign'],
  ['\n', 'a line break'],
  ['\r', 'a carriage return'],
];

export function unsafeIn(brief: string): string[] {
  return UNSAFE.filter(([c]) => brief.includes(c)).map(([, name]) => name);
}

export type CodexRequest = {
  scope: { uncommitted: true } | { base: string };
  tier: Tier;
  pass: Pass;
  effort: Effort | null;
  brief: string;
  // The project's own checks, as the leg runs them in its copy; empty for none.
  checks: string;
  // The checkout Codex reviews, when not the repository root (a pull request's
  // worktree), and the checkout whose node_modules the copy borrows.
  dir?: string;
  modules?: string;
};

// What a leg is told about the profile it runs under, with where to work.
export function containmentOf(
  scratch: string,
  copyTree: string,
  checks: string,
  from = '<the repository root>',
  modules?: string,
): string {
  const using =
    checks.trim() === '' ? 'ending at tree' : `using the project's own checks: ${checks.trim()}`;
  const copy = `${copyTree} ${from} <your directory>/tree${modules ? ` ${modules}` : ''}`;
  return `The repository is read-only for this review, by design: write only inside ${scratch}, making your own directory there with mktemp -d ${scratch}/codex.XXXXXX and pointing TMPDIR at it. A command that writes inside the repository fails with Operation not permitted, and you have no network; neither is a defect in the change nor a reason to request wider permissions. Run tests and builds in a copy you make with ${copy}, ${using}. A tool mise wraps, such as cargo, runs as the shell finds it; when its wrapper fails, report that rather than reach the tool another way.`;
}

export function codexCommand(
  req: CodexRequest,
  scratch: string,
  copyTree: string,
  configured: Effort | null,
): { command: string; effort: string } | { refused: string } {
  const unsafe = unsafeIn(`${req.brief} ${req.checks}`);
  if (unsafe.length > 0) {
    return {
      refused: `the brief or checks hold ${unsafe.join(', ')}, which break the command's quoting. Rewrite them as plain prose, naming files and identifiers bare, and ask again.`,
    };
  }
  // Single-quoted, so any revision git takes (`HEAD~2`, `feature+fix`) passes.
  if ('base' in req.scope && /['\n\r]/.test(req.scope.base)) {
    return { refused: `the base \`${req.scope.base}\` cannot be quoted safely.` };
  }
  for (const path of [scratch, copyTree, req.dir ?? '', req.modules ?? '']) {
    if (/['"\\$`\n]/.test(path)) return { refused: `the path ${path} cannot be quoted safely.` };
  }
  if (req.dir !== undefined && !req.dir.startsWith('/')) {
    return { refused: `\`dir\` must be an absolute path.` };
  }
  const { override, label } = effortOf(req.tier, req.pass, req.effort, configured);
  const contain = containmentOf(scratch, copyTree, req.checks, req.dir, req.modules);
  const brief = `${req.brief.trim()} ${contain}`;
  const scope = 'base' in req.scope ? `--base '${req.scope.base}'` : '--uncommitted';
  const parts = [
    req.dir === undefined ? 'cd "$(git rev-parse --show-toplevel)" &&' : `cd '${req.dir}' &&`,
    'FORCE_COLOR=1 codex review',
    scope,
    `-c 'default_permissions="review-cycle"'`,
    // One value: a dotted key would split on the dot in the scratch path.
    `-c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "${scratch}"="write"}'`,
    `-c 'permissions.review-cycle.network.enabled=false'`,
    ...(override === null ? [] : [`-c 'model_reasoning_effort="${override}"'`]),
    `-c "developer_instructions=\\"${brief}\\""`,
  ];
  return { command: parts.join(' '), effort: label };
}
