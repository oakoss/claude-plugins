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
] as const;
type OfferStep = (typeof OFFER_STEPS)[number];

const PULL = /^(?:[\w.-]+\/[\w.-]+#)?[1-9]\d*$/;
const BRANCH = /^(?!-)[\w./-]+$/;
const REMOTE = /^(?!-|\.{1,2}$)[\w.-]+$/;
const METHODS: Record<string, string> = {
  merge: 'Merge',
  squash: 'Squash-merge',
  rebase: 'Rebase-merge',
};

// A pull request as the gate's grammar reads it: #316, or owner/name#53.
const ref = (pull: string): string => (pull.includes('#') ? pull : `#${pull}`);
function refs(pulls: readonly string[]): string {
  const named = pulls.map((p) => ref(p));
  return named.length === 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

// Each question is one the grammar reads a yes to exactly (pinned in offers.spec.ts).
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
  // The grammar reads a bare number beside a named repository as unplaced.
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
  const one = (what: string): string | { error: string } =>
    pulls.length === 1 ? what : { error: `${step} takes one pull request` };
  const onBranch = (what: (b: string) => string): string | { error: string } =>
    typeof branch === 'string' ? what(branch) : { error: `${step} needs a branch` };
  const questions: Record<OfferStep, () => string | { error: string }> = {
    merge: () =>
      pulls.length === 0
        ? { error: 'merge needs at least one pull request' }
        : `${METHODS[method]} ${refs(pulls)}?`,
    release: () => one(`Release ${refs(pulls)}?`),
    approve: () => one(`Approve ${refs(pulls)}?`),
    comment: () => one(`Reply to the review on ${refs(pulls)}?`),
    stack: () => (pulls.length === 0 ? 'Merge the stack?' : one(`Merge up to ${refs(pulls)}?`)),
    push: () => onBranch((b) => `Push \`${b}\` to \`${remote}\`?`),
    'force-push': () => onBranch((b) => `Force-push \`${b}\` to \`${remote}\` with a lease?`),
    'push-pr': () => onBranch((b) => `Push \`${b}\` to \`${remote}\` and open a pull request?`),
    pr: () => 'Open a pull request?',
  };
  const question = questions[step as OfferStep]();
  return typeof question === 'string' ? { question } : question;
}
