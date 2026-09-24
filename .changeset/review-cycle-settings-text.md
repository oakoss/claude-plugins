---
review-cycle: patch
---

The settings guard no longer treats a plugin's `.claude-plugin/` directory as Claude's `.claude` directory. So a command such as `cp plugins/review-cycle/.claude-plugin/plugin.json plugins/review-cycle/hooks/settings.ts /tmp/copy/` now runs. Before, it was refused because it named `.claude` and "settings" together, which happens constantly in a plugin repository. Every write to a real `.claude` settings file is refused as before.
