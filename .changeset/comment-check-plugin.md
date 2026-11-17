---
comment-check: minor
---

A new plugin, `comment-check`, flags comment slop in each file the agent writes: after every Edit or Write it scans the file for section markers, restate-the-code phrasings, hedge prefixes, ticketless TODOs, hedge words and change-history narration, and checks the comment density of the text just written. On a hit it tells the agent to fix the comments with a follow-up Edit before it carries on. It is review-cycle's comment-slop check, moved into a plugin of its own, so installing it is the opt-in: `claude plugin install comment-check@oakoss`.
