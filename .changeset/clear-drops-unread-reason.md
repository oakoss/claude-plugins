---
review-cycle: patch
---

`/clear` and a resume now drop everything a grant came from, not only the grant:

- A push or pull request the model check allowed for a message before the clear is refused after it, as one the grammar granted already was.
- The first message after the clear is read against no offer, so a yes there no longer grants the last step the agent offered before it. After a resume this includes the resumed conversation's last offer, which the gate does not carry across the resume: ask again, or name the step.
- A refused commit, push, pull request, merge or release no longer quotes why a yes from before the clear granted nothing.
- An epic job started with "do epic <id>" ends, so the fresh conversation can start something else; say "do epic <id>" again to carry on.
