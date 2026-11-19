---
review-cycle: patch
---

The commit gate reads `gh event`, built into GitHub CLI since 2.105.0, as one of gh's own commands. It had refused every `gh event` command, `gh event listen` and `--help` included, as an alias or extension it cannot read; they now run like the other gh commands it does not gate.
