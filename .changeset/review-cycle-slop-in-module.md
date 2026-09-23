---
review-cycle: patch
---

### The comment-slop check moves into the hooks module

The check that flags comment slop after every Edit and Write is now part of review-cycle's hooks module instead of a shell script. What it flags is unchanged: section markers, restate-the-code and AI phrasings, hedge prefixes and words, ticketless TODOs, history narration, and high comment density in the text just written. It still never blocks, and it runs whether or not the commit gate is switched on.

- **It now needs hooks modules**, like the commit gate: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` set to `1`. Without them the check does not run.
- **It no longer needs `jq`**, so `/review-cycle:init` stops checking for it.
- **When git or the file cannot be read**, the agent is told the scan was skipped, where the shell hook printed a line on stderr.
- **A failed or refused Edit or Write is not scanned**: it wrote nothing.

The gate's Bash rule against switching it off now matches settings paths case-insensitively, so `~/.CLAUDE/SETTINGS.JSON` is caught too. It still refuses any command that writes while naming a switch key, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test … > out.log` included: set the variable in your settings `env` block instead of on the command.
