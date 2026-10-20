---
pr-kit: minor
---

Adds `/pr-kit:merge`, which merges the pull request you asked to merge with the repository's merge method, asking which when it allows several, and reports the merge commit and what is left. It stops on a closed, draft, blocked, behind or conflicted pull request, and asks before merging past a failing check that is not required. On a github/gh-stack layer it merges with `gh stack merge`, which merges every unmerged layer below too, so it names them all and asks when your message did not, and checks each is ready; "merge the stack" merges every open layer from any of them. It checks that the number names no stack, since `gh stack merge` reads a stack's number first, and offers `gh stack sync` for the layers left open. `/pr-kit:ship` now reads a stack sync's output, since a diverged stack prints `Sync aborted` and still exits 0.
