---
review-cycle: patch
---

### Reviewers keep their copies separate from your checkout

Reviewer agents and the review prompts now forbid symlinking anything from your checkout into a reviewer's copy, and running package-manager installs there. One reviewer's install went through a symlinked `node_modules` and emptied the real one. Every script a reviewer writes must start with `set -u` and `cd <dir> &&` into its own directory before running git. A reviewer once ran git from an unset directory and created `~/.git`.
