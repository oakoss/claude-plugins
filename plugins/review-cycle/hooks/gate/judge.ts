import {
  configured,
  STRICTEST,
  effective,
  where,
  withMandate,
  type StopBefore,
} from '../consent/ladder';
import {
  configuredPrUpdates,
  DEFAULT_PR_UPDATES,
  effectivePrUpdates,
  type PrUpdates,
  type PrUpdatesInForce,
} from '../consent/pr-updates';
import { deny } from '../consent/refusal';
import type { $ } from '../state/engine';
import { state } from '../state/gate-state';
import type { InForce } from './gh-verdict';
import { messageOf } from './git';

// Why a judged call does not run after all: a newer message than the one its
// grant was read at (`message`), or an abort, past which nothing would report
// what ran.
export function overtaken(
  message: number,
  signal: AbortSignal,
  what: string,
): { deny: string } | null {
  if (state.messages !== message) {
    return deny(
      `the user sent a new message while the gate was checking this ${what}, so it did not run. Act on their message.`,
    );
  }
  if (signal.aborted) {
    return deny('the call was interrupted while the gate was checking it, so it did not run.');
  }
  return null;
}

export const SUBAGENT =
  'subagents do not commit, push, open, merge, approve or comment on pull requests, or release, in this repository. Report back to the main session instead.';

// The rung in force: the local file's, else the user's, made earlier by the
// project file's. Settings that cannot be read stop before every step.
export async function ladderOf($: $): Promise<InForce> {
  const rungs: Partial<Record<'project' | 'local', StopBefore | null>> = {};
  for (const source of ['project', 'local'] as const) {
    try {
      const settings = await $.settings.read({ source });
      rungs[source] = configured(settings.pluginConfigs);
    } catch (error) {
      const unreadable = `${where(source)}: ${messageOf(error)}`;
      return { stopBefore: STRICTEST, source: 'default', unreadable };
    }
  }
  const set = effective(state.stopBefore, rungs.project ?? null, rungs.local ?? null);
  return withMandate(set, state.mandate?.epic ?? null);
}

// As ladderOf reads stopBefore. A file that cannot be read asks, and so does a
// session with no one to see the pushes it lets through (-p, the Agent SDK).
export async function prUpdatesInForce($: $): Promise<PrUpdatesInForce & { unreadable?: string }> {
  const values: Partial<Record<'project' | 'local', PrUpdates | null>> = {};
  for (const source of ['project', 'local'] as const) {
    try {
      const settings = await $.settings.read({ source });
      values[source] = configuredPrUpdates(settings.pluginConfigs);
    } catch (error) {
      const unreadable = `${where(source)}: ${messageOf(error)}`;
      return { prUpdates: DEFAULT_PR_UPDATES, source: 'default', unreadable };
    }
  }
  const set = effectivePrUpdates(state.prUpdates, values.project ?? null, values.local ?? null);
  return state.said.origin === 'sdk' ? { prUpdates: DEFAULT_PR_UPDATES, source: 'default' } : set;
}
