---
review-cycle: patch
---

A yes no longer grants a step the agent offered only on a condition. "Should I merge #168, if the tests pass?", "When CI passes, should I merge #168?", "Should I merge #168? Only if CI passes, though." and "Can we push? Not until CI is green." used to let a plain "yes" run the step at once; now that yes grants nothing. The gate reads the agent's last three lines from their first question on, before rewriting any of it, and any of these words there withholds the offer: "if", "when", "whenever", "once", "until", "unless", "after", "before", "provided", "assuming", "as long as" or "as soon as". A push, pull request, approval or release then goes to the model check, which reads the offer's last six lines; a merge waits until you ask for it outright. This also withholds some offers where the word only orders the steps, such as "Should I push? After that, CI will run.". A condition set before the question, or in other words ("wait for CI, then merge"), is not read.

Two kinds of condition count as met by the yes. An approval phrase that ends its clause: "If that looks right, should I push?", "When you're ready", "If so", "If it looks good", "If you're happy with it", "If that works for you"; "when it's ready" and "once that works" wait on the work and withhold. And a merge once ready, in the question itself: "Should I merge #168 when CI passes?" still grants it with `--auto`. A "not yet" or "hold off" after a conditional offer still holds the step it named.

Typed requests read more of the same words: "merge 168, provided CI passes", "merge 168, assuming CI passes", "merge 168, as long as the tests pass", "merge 168. Only if CI passes." and "push it. But only if CI passes." grant nothing.
