---
pr-watch: minor
---

A new plugin: a line above the prompt for each pull request Claude opens with `gh pr create`. While the workflows the merge waits on run, the line shows a progress bar for the longest of them, measured against that workflow's last successful run, with the other workflows as marks. Once they finish, it reads ready to merge, names the job that failed with a link to its log, or says what blocks it: conflicts, changes requested, or a branch behind its base. A toast says when a pull request turns ready or a job fails in a workflow the merge waits on. Hover a line and press × to stop watching it; a pull request that merges or closes leaves on its own. Needs `gh` logged in; built and tested against Claude Code 2.1.289.
