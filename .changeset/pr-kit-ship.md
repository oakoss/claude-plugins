---
pr-kit: minor
---

New `/pr-kit:ship` skill takes the current branch to a pull request when you say "ship it", and updates the open one when you say "push it". It reviews and commits leftover work, merges in the default branch when behind, runs the project's full checks and stops on a failure, closes the beads the branch finishes and pushes the task graph, then pushes and writes the title and body. The body follows the repository's own pull request template when there is one, else the new `reference/pr-body.md`: a short lead, one line per change, the checks that ran and what they printed, and known issues. Drafts, auto-merge and agent attribution happen only when you ask, and it stops on a repository that is not yours.
