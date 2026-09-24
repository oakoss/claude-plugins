---
review-cycle: minor
---

### The gate asks you before a commit or push you did not ask for

When your latest message does not ask for a commit or push, the gate no longer just refuses. It asks you in Claude Code's own dialog, with fixed choices: **Commit** / **Don't commit**, **Push** / **Don't push**, or **Commit and push** / **Don't**. It asks only once the review check has passed, so it never asks about a commit the review check already refuses. The question shows the whole command, every line of it, with any shell aliases it uses expanded, and how many reviewed files the commit records. Characters that could hide or reorder text are shown as `�`.

- Picking the first choice allows that one command. The gate checks the review again once you answer, and refuses if what the commit records changed while the dialog was open.
- **Don't…** refuses, and the gate does not ask about that verb again until your next message.
- A message you send while the dialog is open, or while the gate re-checks after your answer, replaces the question, and nothing runs. The same holds for a command your typed request allowed: a newer message stops it if it has not started yet.
- Text typed under "Type something." grants nothing. It is passed to the agent, and a retry asks again.
- Esc, "Chat about this", and a `-p` run, where no one can answer, refuse as before. The refusal names the reason.
- A command longer than 500 characters as shown is refused without asking, because the dialog could not show all of it. So is any command the gate would ask about when your shell defines an alias named `git`, since the gate reads `git` as git and could not show what the alias runs.
- A command that is interrupted while the gate checks it does not run.
- While one question is open, another command that needs one is refused rather than queued, and the agent is told to wait for the answer.

The agent's own question dialogs no longer grant a commit or push. Reading the options the agent wrote let its wording decide what your pick meant: "Commit first (Recommended)" granted nothing, and one question that only mentioned a commit could veto another (cpl-gps). The gate compares your pick with its own labels exactly, and the agent can neither see the question nor answer it. A plugin that answers question dialogs on your behalf can still answer the gate's.

Typed requests ("commit it", "ship it") still grant with no dialog, for the rest of your message.
