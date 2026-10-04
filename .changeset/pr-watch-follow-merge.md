---
pr-watch: minor
---

A merged pull request now stays in the band and follows its merge commit's runs on the base branch, such as a Release workflow on main: `#128 merged · ● Release` with the same progress bar and marks, then `✓ main checks passed` or the job that failed, with a toast. It keeps reading for 90 seconds after the merge in case a later run starts, and the settled line then stays until your next message. Before, a pull request left the band the moment it merged, so what the merge started on the base branch went unseen. A merge whose commit starts no runs within 90 seconds still leaves, as does a pull request closed without merging. The same `gh api graphql` read carries the merge commit's runs; the only extra call is the one that learns a base-branch workflow's usual length, once.
