---
review-cycle: minor
---

The sentinel now stores a git tree of the reviewed state, and the review cycle scopes itself to the unreviewed delta instead of re-reviewing the whole diff.

mark and accept-state capture a tree object of the exact reviewed content (real adds into a scratch index — measured: intent-to-add entries are silently omitted from write-tree, so the capture stages for real; the repository's own index is untouched, byte-compared), protect it with a per-worktree ref under refs/review-cycle/trees/ (measured: gc prunes an unreferenced tree, a single shared name lets one worktree's mark orphan another's tree, and the ref pollutes no porcelain), and write it as a third sentinel line that older versions ignore. A new delta verb prints the changed paths and line counts against that tree — untracked files included, and independent of commits moving HEAD. /review-cycle:review runs it in Phase 1: when a marked tree exists, the tier and the reviewers' changed-file focus come from the delta, so a 20-line follow-up to a converged review gets a proportionate small review instead of forcing the choice between a full-tier re-run and /review-cycle:accept. Without a stored tree (old sentinel, first review) behavior is unchanged, and the summary names which scope ran. The accept escape hatch stays user-only.
