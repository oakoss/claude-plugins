---
pr-watch: patch
---

A release tool's plan comment no longer wakes Claude. With "Bots wake Claude" set to `comments and reviews`, oakum's release-plan comment and changeset-bot's "Changeset detected" were told as news on every pull request, and Claude had to open each to learn it asked for nothing. They are now never told, under any setting; changeset-bot's "No Changeset found" still is, since it asks for a changeset. A bot's news line also names it as a bot, `@oakoss[bot] commented on …`, so the kind of comment is clear without opening it.
