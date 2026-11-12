import { FINISHES, type Finishes } from './git-args';

export const OFFER_STEPS = [
  'merge',
  'release',
  'push',
  'force-push',
  'pr',
  'push-pr',
  'approve',
  'stack',
  'comment',
  'commit',
  'finish',
  'delete',
  'force-push-bare',
  'stack-push',
  'stack-submit',
  'merge-release',
] as const;
export type OfferStep = (typeof OFFER_STEPS)[number];

const PULL = /^(?:(?!-)[\w.-]*[a-z\d][\w.-]*\/(?!-)[\w.-]*[a-z\d][\w.-]*#)?[1-9]\d*$/i;
const BRANCH = /^(?!-)[\w./-]+$/;
const REMOTE = /^(?!-|\.{1,2}$)[\w.-]+$/;
const VERSION = /^(?!-)[\w.@/+-]+$/;
export const OPERATIONS: readonly string[] = FINISHES;
const METHODS = { merge: 'Merge', squash: 'Squash-merge', rebase: 'Rebase-merge' } as const;
type Method = keyof typeof METHODS;

// A repository the reader takes as `owner/name#n` (exact.ts QUALIFIED): each
// part opens with a letter or digit. Any other is named by its URL.
const SHORT = /^[a-z\d][\w.-]*\/[a-z\d][\w.-]*$/i;
export const namedShort = (repo: string): boolean => SHORT.test(repo);

// A pull request as the gate reads it: #316, owner/name#53, or its URL.
function ref(pull: string): string {
  const at = pull.lastIndexOf('#');
  if (at === -1) return `#${pull}`;
  const repo = pull.slice(0, at);
  return namedShort(repo) ? pull : `https://github.com/${repo}/pull/${pull.slice(at + 1)}`;
}
function refs(pulls: readonly string[]): string {
  const named = pulls.map((p) => ref(p));
  return named.length === 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

type Pushed = { branch: string; remote?: string };
export type Offer =
  | { step: 'pr' | 'stack-push' | 'stack-submit' }
  | { step: 'merge'; pulls: readonly [string, ...string[]]; method?: Method }
  | { step: 'merge-release' | 'approve' | 'comment'; pull: string }
  | { step: 'release'; pull: string; version?: never }
  | { step: 'release'; version: string; pull?: never }
  | { step: 'stack'; upTo?: string }
  | ({ step: 'push' | 'force-push' | 'force-push-bare' | 'push-pr' | 'delete' } & Pushed)
  | { step: 'commit'; branch: string }
  | { step: 'finish'; branch: string; operation: Finishes };

// Each question is one exact.ts QUESTIONS reads a yes to (pinned in offers.spec.ts).
export function phraseOffer(o: Offer): string {
  const remote = 'remote' in o ? (o.remote ?? 'origin') : 'origin';
  switch (o.step) {
    case 'merge': {
      return `${METHODS[o.method ?? 'merge']} ${refs(o.pulls)}?`;
    }
    case 'release': {
      return 'version' in o ? `Release \`${o.version}\`?` : `Release ${ref(o.pull)}?`;
    }
    case 'merge-release': {
      return `Merge and release ${ref(o.pull)}?`;
    }
    case 'approve': {
      return `Approve ${ref(o.pull)}?`;
    }
    case 'comment': {
      return `Reply to the review on ${ref(o.pull)}?`;
    }
    case 'stack': {
      return o.upTo === undefined ? 'Merge the stack?' : `Merge up to ${ref(o.upTo)}?`;
    }
    case 'push': {
      return `Push \`${o.branch}\` to \`${remote}\`?`;
    }
    case 'force-push': {
      return `Force-push \`${o.branch}\` to \`${remote}\` with a lease?`;
    }
    case 'force-push-bare': {
      return `Force-push \`${o.branch}\` to \`${remote}\` without a lease?`;
    }
    case 'push-pr': {
      return `Push \`${o.branch}\` to \`${remote}\` and open a pull request?`;
    }
    case 'delete': {
      return `Delete \`${o.branch}\` from \`${remote}\`?`;
    }
    case 'pr': {
      return 'Open a pull request?';
    }
    case 'commit': {
      return `Commit the changes to \`${o.branch}\`?`;
    }
    case 'finish': {
      return `Commit the resolution to \`${o.branch}\` and finish the ${o.operation}?`;
    }
    case 'stack-push': {
      return 'Force-push the stack with a lease?';
    }
    case 'stack-submit': {
      return 'Force-push the stack with a lease and open its pull requests?';
    }
  }
}

// The two a push refusal asks, which name where the push goes (push-verdict.ts).
export const pushToQuestion = (branch: string): string => `Push to \`${branch}\`?`;
export const pushTagQuestion = (tag: string): string => `Push the \`${tag}\` tag?`;

type Checked = { offer: Offer } | { error: string };

function checked(input: unknown): Checked {
  if (typeof input !== 'object' || input === null) return { error: 'expected an object' };
  const o = input as Record<string, unknown>;
  const step = o.step;
  if (typeof step !== 'string' || !(OFFER_STEPS as readonly string[]).includes(step)) {
    return { error: `step must be one of ${OFFER_STEPS.join(', ')}` };
  }
  const pulls: unknown = o.pulls ?? [];
  if (
    !Array.isArray(pulls) ||
    !pulls.every((p): p is string => typeof p === 'string' && PULL.test(p)) ||
    new Set(pulls).size !== pulls.length
  ) {
    return { error: 'pulls must be distinct pull request numbers ("316") or "owner/name#53"' };
  }
  // The reader takes a bare number beside a named repository as unplaced.
  if (new Set(pulls.map((p) => p.includes('#'))).size > 1) {
    return { error: 'name every pull request the same way: all "316", or all "owner/name#53"' };
  }
  const branch = o.branch;
  if (branch !== undefined && (typeof branch !== 'string' || !BRANCH.test(branch))) {
    return { error: 'branch must be a branch name' };
  }
  const remote = o.remote ?? 'origin';
  if (typeof remote !== 'string' || !REMOTE.test(remote)) {
    return { error: 'remote must be a remote name' };
  }
  const method = o.method ?? 'merge';
  if (typeof method !== 'string' || !Object.hasOwn(METHODS, method)) {
    return { error: 'method must be merge, squash or rebase' };
  }
  const version = o.version;
  if (version !== undefined && (typeof version !== 'string' || !VERSION.test(version))) {
    return { error: 'version must be a tag or <package>@<version>' };
  }
  const [pull, ...rest] = pulls;
  const one = (): string | null => (pull !== undefined && rest.length === 0 ? pull : null);
  const lone = one();
  const onePull = { error: `${step} takes one pull request` };
  const noBranch = { error: `${step} needs a branch` };
  // Switched on its own name, so each case's `step: s` is checked against the union.
  const s = step as OfferStep;
  switch (s) {
    case 'merge': {
      return pull === undefined
        ? { error: 'merge needs at least one pull request' }
        : { offer: { step: 'merge', pulls: [pull, ...rest], method: method as Method } };
    }
    case 'release': {
      if (typeof version !== 'string') {
        return lone === null
          ? { error: 'release needs one pull request or a version' }
          : { offer: { step: 'release', pull: lone } };
      }
      return pull === undefined
        ? { offer: { step: 'release', version } }
        : { error: 'release takes a pull request or a version, not both' };
    }
    case 'merge-release':
    case 'approve':
    case 'comment': {
      return lone === null ? onePull : { offer: { step: s, pull: lone } };
    }
    case 'stack': {
      if (pull === undefined) return { offer: { step: 'stack' } };
      return lone === null ? onePull : { offer: { step: 'stack', upTo: lone } };
    }
    case 'push':
    case 'force-push':
    case 'force-push-bare':
    case 'push-pr':
    case 'delete': {
      return typeof branch === 'string' ? { offer: { step: s, branch, remote } } : noBranch;
    }
    case 'commit': {
      return typeof branch === 'string' ? { offer: { step: 'commit', branch } } : noBranch;
    }
    case 'finish': {
      if (typeof o.operation !== 'string' || !OPERATIONS.includes(o.operation)) {
        return { error: `operation must be one of ${OPERATIONS.join(', ')}` };
      }
      return typeof branch === 'string'
        ? { offer: { step: 'finish', branch, operation: o.operation as Finishes } }
        : noBranch;
    }
    case 'pr':
    case 'stack-push':
    case 'stack-submit': {
      return { offer: { step: s } };
    }
  }
}

export function offerQuestion(input: unknown): { question: string } | { error: string } {
  const c = checked(input);
  return 'error' in c ? c : { question: phraseOffer(c.offer) };
}
