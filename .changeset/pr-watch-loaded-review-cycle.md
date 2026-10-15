---
pr-watch: patch
---

A ready pull request wakes Claude only while review-cycle is loaded with its commit gate on and its stop-before setting past `merge`. pr-watch now reads that setting from review-cycle's own `/config` rows rather than from every review-cycle entry in your settings, so a leftover value from an uninstalled review-cycle, or from another copy of it such as a `--plugin-dir` one, no longer decides; `.claude/settings.json` and `.claude/settings.local.json` still apply as before. With review-cycle absent or its gate switched off, a ready pull request waits for your next message, as it does in a headless `claude -p` session, where `/config` lists no plugin's settings.
