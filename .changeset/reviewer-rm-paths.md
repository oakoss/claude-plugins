---
review-cycle: patch
---

Reviewers guard every variable in an `rm` path, as in `"${DIR:?}/…"` rather than `"$DIR/…"`. Claude Code's Bash safety check stops to ask you about an `rm -rf` whose path starts with a variable that could be empty, even under `set -u`, so a reviewer cleaning up its temp directory used to interrupt you with a "Dangerous rm operation" prompt. The rule is in every reviewer's containment instructions and in the spawn prompts of `/review-cycle:review` and `/review-cycle:review-pr`.
