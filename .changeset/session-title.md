---
session: minor
---

A new plugin, `session`, titles each Claude Code session after the git branch it works on: on `fix/force-choice-gaps` the session is named `force-choice-gaps`, and checking out another branch retitles it at the next message. The title shows on the prompt bar, as the terminal's title (a Rex tab's name), and in `/resume`, so two sessions in different repositories no longer share an auto-summary like "Next work priorities". A name you set with `/rename`, `/branch <name>` or `--name` stays, including after `claude --resume`, unless it is exactly the title the plugin set last; on the default branch or a detached HEAD the title is left as it is.
