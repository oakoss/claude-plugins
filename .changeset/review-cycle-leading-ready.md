---
review-cycle: patch
---

A readiness condition can now come first: "once PR 133 is ready, lets merge it", "when CI passes, merge it" and "as soon as CI is green, merge it" let the agent run `gh pr merge --auto`, as "merge it once it's ready" already did. Before, a sentence opening with a condition granted nothing, so the agent asked again. Any other leading condition still grants nothing for the whole message: "once it's ready, push it", "once I say so, merge it" or "if CI fails, merge it". So does a sentence that asks for more than the merge under the condition ("once it's ready, release it, merge it"), and one waiting on another pull request than the one it merges ("once PR 133 is ready, merge 134", in either order), since `--auto` waits only on the pull request it merges.
