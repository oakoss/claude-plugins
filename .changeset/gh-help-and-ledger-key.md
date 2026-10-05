---
review-cycle: patch
---

A gh command asking for help runs. `gh pr merge --help`, `gh pr merge 5 -h` and `gh -R o/r pr merge --help` print help and write nothing, but the gate refused them as merges, so reviewers checking gh's flags reported them as inferred. `-h` or `--help` counts where gh reads it as help. It does not count after an option, which can take it as a value (`gh pr merge -b --help` merges with that body), after `--`, before a `--help=` value, or with input from `xargs`. Measured on gh 2.102.0. A help word after a flag, as in `gh pr merge --admin --help`, still asks.

The findings ledger works in a repository whose `.git` path is long. Its store key was the path itself, and Claude Code's plugin store refuses a key over 256 characters (measured on 2.1.289), so such a repository could neither read nor record its ledger. A path that does not fit is now keyed by its hash. Every other repository keeps the key it has, so no existing ledger moves.
