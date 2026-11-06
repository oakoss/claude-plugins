---
pr-watch: patch
---

Resolving a review thread through `gh api graphql`, or submitting a review with `gh pr review`, now makes pr-watch read every watched pull request at once and every 5 seconds for the next minute, as a push does. Before, a pull request blocked only by unresolved threads kept showing `blocked` for up to 5 minutes after the threads were resolved.
