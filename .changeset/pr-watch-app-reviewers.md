---
pr-watch: minor
---

pr-watch now follows the GitHub App checks a merge does not wait on, such as an AI reviewer's. While one runs, the line names it (`#84 ✓ ready to merge · pullfrog ●`) and marks it `✗` if it fails, and the ready toast and what Claude is told say it is still running, so Claude stops calling a pull request done while its reviewer works. When one that ran a minute or more finishes, Claude is told how it ended, with a link, once per run on a head commit, so it can read the review without polling. A check that finishes in seconds, such as the CodeQL App's, says nothing, and a check suite an App leaves queued with no runs is ignored.
