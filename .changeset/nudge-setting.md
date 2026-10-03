---
review-cycle: minor
---

The end-of-turn review nudge can be turned off, and it no longer interrupts a question. A new `/config` setting, Review nudge (`review-cycle.nudge`, on by default), turns it off; `{ "options": { "nudge": false } }` under `pluginConfigs` in a project's `.claude/settings.json` turns it off there, and your `.claude/settings.local.json` decides either way, over both. A settings file the gate cannot read, or a `nudge` that is not `true` or `false`, sets nothing, and the other settings decide. Whatever the setting, a turn whose last message ends with a question mark, bold or italic included, is no longer nudged: before, the nudge could fire while the agent waited on your answer. The commit gate is unaffected.
