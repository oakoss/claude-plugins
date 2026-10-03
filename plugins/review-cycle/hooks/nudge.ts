// Whether the gate nudges the agent to review at the end of a turn. Pure.

const PLUGIN = /^review-cycle(@|$)/;

// A value that is not a boolean sets nothing. Off wins between a bare and a
// marketplace-qualified entry.
export function nudgeOf(pluginConfigs: unknown): boolean | null {
  if (pluginConfigs === null || typeof pluginConfigs !== 'object') return null;
  let found: boolean | null = null;
  for (const [name, entry] of Object.entries(pluginConfigs)) {
    if (!PLUGIN.test(name) || entry === null || typeof entry !== 'object') continue;
    const options: unknown = (entry as { options?: unknown }).options;
    if (options === null || typeof options !== 'object' || !('nudge' in options)) continue;
    if (typeof options.nudge !== 'boolean') continue;
    found = found === false ? false : options.nudge;
  }
  return found;
}

// The local file is the user's own, so it decides; a committed project file
// can only turn the nudge off.
export function nudgeOn(user: boolean, project: boolean | null, local: boolean | null): boolean {
  if (local !== null) return local;
  return user && project !== false;
}

// A turn that ends by asking the user is waiting on their answer.
export function asksUser(answer: string): boolean {
  return answer.replace(/[\s*_]+$/, '').endsWith('?');
}
