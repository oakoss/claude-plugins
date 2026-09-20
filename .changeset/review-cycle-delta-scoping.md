---
review-cycle: patch
---

### Added

`review-sentinel delta` lists every path whose content differs from the marked tree, which after a branch switch or a pull mixes work you have not reviewed with the difference between two branches. Measured: a two-file change on a switched branch reported nine files; a one-file change after a merge reported five, four of them the other branch's already-reviewed work. The cycle hands that list to reviewers as their scope.

The delta now adds one line on stderr when the marked tree and HEAD differ, naming how many paths that covers, so the reader knows some of the list reflects history this session did not author. `/review-cycle:review` relays that instead of claiming the rest of the diff matches the reviewed state. When it cannot tell, it says so; that is distinguished from "no differences", because a failed probe and an empty result both produce an empty stream.

**The list itself is untouched — deliberately.** An earlier attempt filtered it down to paths git reports as modified, staged or untracked. Two rounds of review kept finding files that filtering dropped: pathnames git C-quotes (`é`, tab, `"`, `\`), a file untracked at the mark and then deleted, a truncated record stream, a partial write to the path set, and every path at all when the membership test errored — each at exit 0 with nothing on stderr, while the consumer contract told reviewers the rest of the diff was already reviewed. It was also quadratic: 26 seconds at 2000 changed paths, against 0 before.

Filtering can lose work; annotating cannot. A failed probe now costs a line of advice rather than a file.
