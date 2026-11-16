import type { Watch } from '../types';
import { isDraftPassed, isSettled, lineOf, untilText, verdictOf } from './watch';

const TOOL_COLUMNS = 80;

export function textOf(w: Watch, now: number, known: Record<string, number>): string {
  return lineOf(w, now, known, TOOL_COLUMNS)
    .map((s) => s.text)
    .join('');
}

export type ToolInput = { pull: string; repo: string | null; wake: boolean };

export const named = (x: unknown) => typeof x === 'string' && x.trim() !== '';

// Agents often name the pull request `pr`, so it stands in for `pull`; an
// empty `pull` beside it counts as absent, as a live call sent one.
export function toolInputOf(e: unknown): ToolInput | string {
  const given = e as { pull?: unknown; pr?: unknown; repo?: unknown; wake?: unknown };
  const { repo, wake } = given;
  const pull = named(given.pull) ? given.pull : (given.pr ?? given.pull);
  if (typeof pull !== 'string' || pull.trim() === '') {
    return 'pr-watch: `pull` names a pull request: its number, URL or head branch.';
  }
  if (repo !== undefined && repo !== null && typeof repo !== 'string') {
    return 'pr-watch: `repo` is the repository as owner/name.';
  }
  if (wake !== undefined && wake !== null && typeof wake !== 'boolean') {
    return 'pr-watch: `wake` is true or false.';
  }
  return {
    pull: pull.trim(),
    repo: typeof repo === 'string' && repo !== '' ? repo : null,
    wake: wake === true,
  };
}

export function answerOf({
  head,
  after,
  config,
  input,
  now,
  known,
}: {
  head: string;
  after: Watch;
  config: { isAwake: boolean };
  input: Pick<ToolInput, 'wake'>;
  now: number;
  known: Record<string, number>;
}): string {
  // With waking off the closing quotes the line, which already says why.
  const waits = !config.isAwake
    ? ''
    : after.limitedUntil !== undefined
      ? ` GitHub's rate limit pauses its reads until ${untilText(after.limitedUntil)}.`
      : after.offline !== undefined
        ? ' GitHub could not be reached; pr-watch keeps trying.'
        : after.error !== undefined
          ? ` Its last read failed (${after.error}); pr-watch tries again.`
          : '';
  // Already there, it was told before and will not wake: the answer says it now.
  // A passed merge counts only once settled, as a read tells it.
  const verdict = after.pull ? verdictOf(after.pull, known, after.host, now) : null;
  const isPassed =
    verdict?.kind === 'merged-passed' && after.pull && isSettled(verdict, after.pull, now);
  const isDraftDone =
    verdict !== null && after.pull !== undefined && isDraftPassed(after.pull, verdict);
  // With waking off nothing tells the agent later, so the line is the answer.
  const closing = !config.isAwake
    ? `Waking Claude is off in /config: it shows ${textOf(after, now, known)}, and the watches tool reads it again.`
    : !input.wake
      ? 'It tells you when that changes, at once or with the next message, so there is no need to poll gh.'
      : verdict?.kind === 'ready' || isPassed || isDraftDone
        ? `${isPassed ? "Its merge's checks have passed" : isDraftDone ? 'Its checks have passed' : 'It is ready to merge'} now. pr-watch wakes you if that happens again after new checks, and tells you the rest when it changes.`
        : 'It wakes you when it turns ready to merge or its checks pass, and tells you the rest when it changes, so there is no need to poll gh.';
  return `${head}${waits} ${closing}`;
}

export const numberOf = (pull: string) => /^#?(\d+)$/.exec(pull)?.[1];

// The watches a tool's `pull` and `repo` name without asking gh.
export function matchesOf(
  list: readonly Watch[],
  input: Pick<ToolInput, 'pull' | 'repo'>,
): Watch[] {
  const number = numberOf(input.pull);
  const inRepo = (w: Watch) => input.repo === null || w.repo === input.repo;
  return list.filter(
    (w) =>
      w.url === input.pull ||
      (!w.push && number !== undefined && w.number === Number(number) && inRepo(w)) ||
      (w.push?.branch === input.pull && inRepo(w)),
  );
}

export const WILL_ASK =
  '; pr-watch wakes you to ask about its merge once it is ready with nothing running or failed';

const PULL_INPUT = {
  type: 'object',
  properties: {
    pull: { type: 'string', description: 'The pull request: its number, URL or head branch.' },
    repo: {
      type: 'string',
      description: "owner/name, when it is not the current directory's repository.",
    },
  },
  required: ['pull'],
};

export const TOOLS = [
  {
    name: 'watch',
    description:
      "Watches a GitHub pull request in pr-watch and answers in one line, saying why when a read failed or waits. Its line above the prompt follows its checks, and pr-watch tells you in this conversation, as /config allows, when a check fails, it has conflicts or requested changes, or someone comments or reviews. That it turned ready to merge, its checks passed as a draft, or its merge's checks passed, comes with the user's next message, unless you pass wake or review-cycle lets you merge unasked; a release pull request, whose merge is the release, never wakes you unasked, nor for its conflicts. One you opened in this session wakes you once it is ready with nothing still running, to ask the user about its merge. Pull requests you open with gh pr create, or merge with gh pr merge and a number, URL or branch, are watched already: call this for one of them only to pass wake. Call it for any other you are waiting on, instead of polling gh pr checks or sleeping.",
    inputSchema: {
      ...PULL_INPUT,
      properties: {
        ...PULL_INPUT.properties,
        wake: {
          type: 'boolean',
          description:
            "Wake you as soon as it turns ready to merge or its merge's checks pass, for an ask like 'merge it once it's green' or 'tell me when main passes'. Once set, it lasts while it is watched in this session.",
        },
      },
    },
  },
  {
    name: 'unwatch',
    description:
      'Stops pr-watch watching a pull request (its number, URL or head branch) or a pushed branch, once you no longer need its news.',
    inputSchema: PULL_INPUT,
  },
  {
    name: 'watches',
    description:
      'Lists what pr-watch is watching, each with what its line shows now, and whether pr-watch wakes you to ask about its merge. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
];
