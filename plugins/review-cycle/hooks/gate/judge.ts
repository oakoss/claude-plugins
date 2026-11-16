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
import { type LeaseIo, readStack, stackLease } from '../shell/stack';
import {
  currentText,
  ensureRoot,
  ghRead,
  MERGE_LOOKUP_MS,
  run,
  within,
  type $,
} from '../state/engine';
import { state } from '../state/gate-state';
import {
  parsePullRequest,
  PR_FIELDS,
  PR_JQ,
  VERSION_BRANCH,
  type GhLookups,
  type InForce,
} from './gh-verdict';
import { firstLine, messageOf, type Repo } from './git';

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

// The gh reads GitHub judging needs, each failing into a reason to ask.
export function ghLookups($: $): GhLookups {
  return {
    ladder: () => ladderOf($),
    mergeTarget: (lookup) =>
      ghRead(
        $,
        [
          'pr',
          'view',
          ...lookup,
          '--json',
          'url,state,mergeStateStatus',
          '--jq',
          String.raw`"\(.url) \(.state) \(.mergeStateStatus)"`,
        ],
        'the pull request it merges',
        MERGE_LOOKUP_MS,
      ),
    repoUrl: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'url', '--jq', '.url'],
        'the current repository',
        MERGE_LOOKUP_MS,
      ),
    branch: async () => {
      try {
        const r = await $.process.run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
          timeoutMs: 5000,
        });
        if (r.exitCode === 0) return { out: r.stdout };
        // --quiet leaves a detached HEAD exit 1 with nothing on stderr.
        const why = r.stderr.trim().split('\n')[0] ?? '';
        if (r.exitCode === 1 && why === '') return { out: '' };
        return { asks: `reading the current branch printed \`${why}\` (exit ${r.exitCode})` };
      } catch (error) {
        return { asks: `reading the current branch failed (${messageOf(error)})` };
      }
    },
    // GitHub's rollup counts check runs and commit statuses alike, unpaged.
    mainChecks: () =>
      ghRead(
        $,
        [
          'api',
          'graphql',
          '-F',
          'owner={owner}',
          '-F',
          'name={repo}',
          '-f',
          'query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name target{... on Commit{statusCheckRollup{state}}}}}}',
          '--jq',
          String.raw`"\(.data.repository.defaultBranchRef.name) \(.data.repository.defaultBranchRef.target.statusCheckRollup.state // "NONE")"`,
        ],
        "the default branch's checks",
        MERGE_LOOKUP_MS,
      ),
    versionPulls: () =>
      ghRead(
        $,
        [
          'pr',
          'list',
          '--head',
          VERSION_BRANCH,
          '--state',
          'all',
          '--limit',
          '50',
          '--json',
          'number,state,isCrossRepository',
          '--jq',
          String.raw`[.[] | select(.isCrossRepository | not) | "\(.number):\(.state)"] | if length == 0 then "none" else join(" ") end`,
        ],
        "oakum's version pull requests",
        MERGE_LOOKUP_MS,
      ),
    pullRequest: async (lookup, what) => {
      const args = ['pr', 'view', ...lookup, '--json', PR_FIELDS, '--jq', PR_JQ];
      const r = await ghRead($, args, what);
      if (r.asks === undefined) return parsePullRequest(r.out, what);
      return r.slow ? { asks: r.asks, slow: true } : { asks: r.asks };
    },
    defaultBranch: (repo) =>
      ghRead(
        $,
        [
          'repo',
          'view',
          ...(repo === null ? [] : [repo]),
          '--json',
          'defaultBranchRef',
          '--jq',
          '.defaultBranchRef.name',
        ],
        'the default branch',
      ),
    stack: (n) => readStack(n, (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS)),
    stackLease: (step, remote) => stackLeaseOf($, step, remote),
  };
}

// How long the remote may take to list its branches before the push asks.
export const LS_REMOTE_MS = 15_000;

export async function stackLeaseOf(
  $: $,
  step: 'push' | 'sync' | 'submit',
  remote: string | null,
): Promise<{ ok: true } | { asks: string }> {
  const root = await ensureRoot($);
  if (root === null) return { asks: 'the gate cannot find the repository' };
  return stackLease(step, remote, leaseIoOf($, root));
}

// The clone, its remotes and GitHub as gh-stack's lease boundary reads them.
export function leaseIoOf($: $, root: Repo): LeaseIo {
  const git = async (args: string[], timeoutMs = 10_000) => {
    try {
      const r = await run($, ['git', ...args], {
        cwd: root.top,
        env: { GIT_TERMINAL_PROMPT: '0' },
        timeoutMs,
      });
      return { code: r.exitCode, out: r.stdout, why: firstLine(r.stderr) || `exit ${r.exitCode}` };
    } catch (error) {
      return { code: -1, out: '', why: messageOf(error) };
    }
  };
  const prefix = `${root.common}\t`;
  const pushed = new Map(
    state.pushed
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, id]) => [k.slice(prefix.length), id]),
  );
  return {
    catalog: async () => {
      try {
        return await within(
          $,
          currentText($, `${root.common}/gh-stack`),
          'reading the stack catalog',
        );
      } catch (error) {
        return { asks: `gh-stack's catalog could not be read (${messageOf(error)})` };
      }
    },
    branch: async () => {
      const r = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
      return r.code === 0 ? r.out.trim() : { asks: 'HEAD is on no branch' };
    },
    config: async (key) => {
      const r = await git(['config', '--get', key]);
      // git config exits 1 for a key that is not set.
      if (r.code === 1) return null;
      if (r.code !== 0) return { asks: `reading ${key} failed (${r.why})` };
      return r.out.trim() === '' ? null : r.out.trim();
    },
    urls: async (name) => {
      const fetch = await git(['remote', 'get-url', '--all', name]);
      const push = await git(['remote', 'get-url', '--push', '--all', name]);
      if (fetch.code !== 0 || push.code !== 0) {
        return {
          asks: `reading ${name}'s URLs failed (${fetch.code === 0 ? push.why : fetch.why})`,
        };
      }
      return { fetch: fetch.out, push: push.out };
    },
    remotes: async () => {
      const r = await git(['remote']);
      return r.code === 0
        ? r.out.split(/\s+/).filter(Boolean)
        : { asks: `listing remotes failed (${r.why})` };
    },
    heads: async (name) => {
      const r = await git(['ls-remote', '--heads', name], LS_REMOTE_MS);
      return r.code === 0 ? r.out : { asks: `listing ${name}'s branches failed (${r.why})` };
    },
    defaultBranch: () =>
      ghRead(
        $,
        ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
        'the default branch',
      ),
    ghApi: (args, what) => ghRead($, ['api', ...args], what, MERGE_LOOKUP_MS),
    pushed,
  };
}
