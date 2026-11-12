import { FINISHES } from './git-args';

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

// As the reader reads a named repository (exact.ts QUALIFIED): each part
// opens with a letter or digit.
const PULL = /^(?:[a-z\d][\w.-]*\/[a-z\d][\w.-]*#)?[1-9]\d*$/i;
const BRANCH = /^(?!-)[\w./-]+$/;
const REMOTE = /^(?!-|\.{1,2}$)[\w.-]+$/;
const VERSION = /^(?!-)[\w.@/+-]+$/;
export const OPERATIONS: readonly string[] = FINISHES;
const METHODS: Record<string, string> = {
  merge: 'Merge',
  squash: 'Squash-merge',
  rebase: 'Rebase-merge',
};

// A pull request as the gate reads it: #316, or owner/name#53.
const ref = (pull: string): string => (pull.includes('#') ? pull : `#${pull}`);
function refs(pulls: readonly string[]): string {
  const named = pulls.map((p) => ref(p));
  return named.length === 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

// Each question is one exact.ts QUESTIONS reads a yes to (pinned in offers.spec.ts).
export function offerQuestion(input: unknown): { question: string } | { error: string } {
  if (typeof input !== 'object' || input === null) return { error: 'expected an object' };
  const o = input as Record<string, unknown>;
  const step = o.step;
  if (typeof step !== 'string' || !(OFFER_STEPS as readonly string[]).includes(step)) {
    return { error: `step must be one of ${OFFER_STEPS.join(', ')}` };
  }
  const pulls = o.pulls ?? [];
  if (
    !Array.isArray(pulls) ||
    !pulls.every((p) => typeof p === 'string' && PULL.test(p)) ||
    new Set(pulls).size !== pulls.length
  ) {
    return { error: 'pulls must be distinct pull request numbers ("316") or "owner/name#53"' };
  }
  // The reader takes a bare number beside a named repository as unplaced.
  if (new Set(pulls.map((p) => String(p).includes('#'))).size > 1) {
    return { error: 'name every pull request the same way: all "316", or all "owner/name#53"' };
  }
  const branch = o.branch;
  if (branch !== undefined && (typeof branch !== 'string' || !BRANCH.test(branch))) {
    return { error: 'branch must be a branch name' };
  }
  const remote = o.remote ?? 'origin';
  if (typeof remote !== 'string' || !REMOTE.test(remote))
    return { error: 'remote must be a remote name' };
  const method = o.method ?? 'merge';
  if (typeof method !== 'string' || !Object.hasOwn(METHODS, method)) {
    return { error: 'method must be merge, squash or rebase' };
  }
  const version = o.version;
  if (version !== undefined && (typeof version !== 'string' || !VERSION.test(version))) {
    return { error: 'version must be a tag or <package>@<version>' };
  }
  const operation = o.operation;
  const one = (what: string): string | { error: string } =>
    pulls.length === 1 ? what : { error: `${step} takes one pull request` };
  const onBranch = (what: (b: string) => string): string | { error: string } =>
    typeof branch === 'string' ? what(branch) : { error: `${step} needs a branch` };
  const questions: Record<OfferStep, () => string | { error: string }> = {
    merge: () =>
      pulls.length === 0
        ? { error: 'merge needs at least one pull request' }
        : `${METHODS[method]} ${refs(pulls)}?`,
    release: () => {
      if (typeof version !== 'string') {
        return pulls.length === 1
          ? `Release ${refs(pulls)}?`
          : { error: 'release needs one pull request or a version' };
      }
      return pulls.length === 0
        ? `Release \`${version}\`?`
        : { error: 'release takes a pull request or a version, not both' };
    },
    'merge-release': () => one(`Merge and release ${refs(pulls)}?`),
    approve: () => one(`Approve ${refs(pulls)}?`),
    comment: () => one(`Reply to the review on ${refs(pulls)}?`),
    stack: () => (pulls.length === 0 ? 'Merge the stack?' : one(`Merge up to ${refs(pulls)}?`)),
    push: () => onBranch((b) => `Push \`${b}\` to \`${remote}\`?`),
    'force-push': () => onBranch((b) => `Force-push \`${b}\` to \`${remote}\` with a lease?`),
    'push-pr': () => onBranch((b) => `Push \`${b}\` to \`${remote}\` and open a pull request?`),
    pr: () => 'Open a pull request?',
    commit: () => onBranch((b) => `Commit the changes to \`${b}\`?`),
    finish: () =>
      typeof operation === 'string' && OPERATIONS.includes(operation)
        ? onBranch((b) => `Commit the resolution to \`${b}\` and finish the ${operation}?`)
        : { error: `operation must be one of ${OPERATIONS.join(', ')}` },
    delete: () => onBranch((b) => `Delete \`${b}\` from \`${remote}\`?`),
    'force-push-bare': () =>
      onBranch((b) => `Force-push \`${b}\` to \`${remote}\` without a lease?`),
    'stack-push': () => 'Force-push the stack with a lease?',
    'stack-submit': () => 'Force-push the stack with a lease and open its pull requests?',
  };
  const question = questions[step as OfferStep]();
  return typeof question === 'string' ? { question } : question;
}
