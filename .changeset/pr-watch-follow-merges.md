---
pr-watch: minor
---

A pull request Claude merges with `gh pr merge <number, URL or branch>` now gets a line even when pr-watch was not watching it, such as a version PR a workflow opened: the line follows the merge commit's runs on the base branch, and Claude is told when they pass or fail, as for a pull request it opened. With `--auto`, the line follows the open pull request until it merges. A bare `gh pr merge` of the current branch is not followed, since after `--delete-branch` or on a fork's branch nothing names its pull request; neither is a merge run after a `cd` in the same command, nor a pull request merged before the command started, so a command that only mentions an old merge adds nothing.
