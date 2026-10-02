---
review-cycle: minor
---

A push you did not ask for no longer opens a dialog. The gate refuses it and tells the agent to stop and ask you in its reply, naming what it would push and where with names in backticks ("Push `fix/x` to `origin`?"), with the command quoted and any shell aliases expanded. You answer in your next message: "yes" allows it, and anything else, such as "not yet, rename the helper first", is simply your next request, which a dialog with fixed choices could not take. If the command also commits, the refusal says to run the commit on its own.

The agent's closing question now counts as offering the push when it names a branch or path ("Push fix/x to origin?", "Committed on fix/x. Push?") or puts the destination in backticks ("to `origin`"), so a "yes" to it grants the push; a "yes" to deleting a path ("Should I delete src/old.ts?") still grants nothing. The dialog's limits are gone with it: no 500-character cap, no "already asking" refusal, and no decline that blocked asking again. A `-p` run, with no one to answer, stays refused.
