---
review-cycle: patch
---

Typing pr-kit's `/pr-kit:do-epic <id>` now starts a job on that epic, as "do epic <id>" does, and so does "do epic <id> as drafts" (or "as a draft", "in draft"). Before, the slash command and a drafts request started nothing, so the job's first push stopped to ask.
