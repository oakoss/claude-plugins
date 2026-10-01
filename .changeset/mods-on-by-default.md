---
review-cycle: patch
---

`/review-cycle:init` no longer tells you to set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` when the commit gate is not loaded. Claude Code loads mods, the gate among them, by default from v2.1.287 and ignores that variable, so the advice fixed nothing. Init now names the real causes: a Claude Code older than v2.1.287, a session started with `--bare`, `disableAllHooks` in your settings, or an organization policy that stops user-installed mods. If you set the variable during early access, remove it from your settings. The gate also stops refusing edits that change it, since it no longer switches anything.
