---
pr-kit: patch
---

Merge now checks for open pull requests built on the one being merged when GitHub knows no stack for it. A plain squash merge can leave each such pull request conflicting with the default branch, needing a rebase and a force-push, so merge stops, names them, and gives the user the `gh stack link` command to run in their own terminal; asking to merge again once they are linked takes the stack path, and asking again without linking them merges the one alone, as before. Ship's `gh stack submit` and `gh stack sync`, merge's `gh stack merge` and `gh stack sync`, and fix-ci's `gh stack push` now say to run each as its own command with nothing before it, not even a `cd`, since review-cycle's commit gate can refuse a stack push or merge that runs beside other commands.
