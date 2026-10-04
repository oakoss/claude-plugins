---
review-cycle: minor
---

A request to merge now covers merging oakum's version pull request, since merging it is the only way to release. "merge it" or "merge #130" lets the agent merge the version pull request. Before, the gate classed that merge as a release and refused it, so the agent asked "Release `x`?" after you had already said to merge.

These still need you to ask for a release:

- a merge request that names other pull requests: "merge 131", "merge it; do not merge 130", or "merge it" answering "Merge #131?" do not merge #130 ("merge 131 and 130" does);
- a merge asked for once the pull request is ready (`--auto`);
- a merge request in a message that also holds off a release ("merge 131. don't release yet");
- a stop-before setting that lets merges through;
- the other release steps (`gh release create`, `npm publish`, `oakum release`).
