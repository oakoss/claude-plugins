---
pr-watch: patch
---

A merged layer of a gh-stack stack now reads `merged into main` (the stack's trunk) rather than naming the layer below it. GitHub keeps a merged layer based on the branch beneath it even though its commit landed on the trunk, so pr-watch asks GitHub's stacks API for the trunk, at most once a minute until it answers, then keeps it. A pull request in no stack keeps its base, as does one on a host without the stacks API, and one whose lookup failed until a later try gets an answer. The lookup is a REST call, so its rate limit pauses none of the host's other reads.
