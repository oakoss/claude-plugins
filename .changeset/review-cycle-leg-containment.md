---
review-cycle: patch
---

Reviewer legs now keep more of their work inside their own scratch directory. Each reviewer agent makes that directory with `D=$(mktemp -d …) && cd "$D" && …` and stops when `mktemp` fails, where a leg once carried on and wrote its files into the repository under review; it never falls back to a fixed path like `/tmp/x` either. Legs spell that directory's path out in every command, since the Bash tool keeps neither the directory nor `$D` between calls. They edit files there with Edit or Write rather than an interpreter, which the commit gate refuses whenever its code names a git commit, or `sed -i`. And they run any `claude plugin install` from that directory with `CLAUDE_CONFIG_DIR` pointed into it, so a test install no longer lands in your own Claude Code config.
