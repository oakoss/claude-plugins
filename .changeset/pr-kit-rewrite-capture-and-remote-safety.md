---
pr-kit: patch
---

### Fixed

make-pr-easy-to-review no longer leaves three quieter ways for a history rewrite to reach a force-push unverified. The capture steps chain with `&&` and use `--verify`, so a failed fetch stops the run instead of recording the tree of a tracking ref nobody refreshed. The fork remote is named per PR and its URL confirmed before pushing: `git remote add` exits 3 when the name is taken, and the push then goes to whatever repository the leftover name refers to while the PR under work goes untouched. The exit 3 is measured; whether the lease also passes depends on that repository's branch happening to sit at the recorded sha, so the failure is a misdirected push rather than a guaranteed one. And the capture refs are cleared on abort as well as on success, with the invariant stated that they are written once per run from the fetched ref and never from HEAD, because re-capturing from HEAD after a blocked attempt certifies the rewrite against itself.
