---
review-cycle: patch
---

Asking for a comment on GitHub in your own words now lets it post. "Comment @pullfrog review this PR on #99", "comment on 99" and "post `@coderabbitai review` on #99" grant the comment, and "ok, post it" answers the agent's "Should I post … on #99?"; before, only "reply to the review" did, so the agent had to ask again. A comment or post counts only as the whole message, ending on its pull request, so "comment out the debug line", "comment on 99 later" and "push it and comment on #99" still ask for no comment; ask for it in a message of its own. A refused comment the message or its offer named now shows up in `/review-cycle:misses`, so the next one can be labeled into the consent corpus instead of disappearing.
