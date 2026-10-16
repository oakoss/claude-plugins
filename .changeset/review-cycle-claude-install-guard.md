---
review-cycle: patch
---

The settings guard no longer refuses `claude plugin install …` because the command also names a settings file. It counted the subcommand `install` as a program that writes files, so a test install checked in the same command, such as `CLAUDE_CONFIG_DIR=<dir>/claude claude plugin install x && cat <dir>/.claude/settings.local.json`, was refused with "review-cycle is switched on and off only by the user". A `claude` command's arguments no longer count as writers; its redirects still do, and disabling or removing a plugin is refused as before.
