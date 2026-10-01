---
review-cycle: minor
---

The commit gate no longer asks whether you want a commit. A commit still needs a reviewer to have seen everything it records, and nothing else: it stays on your machine, and a `git reset` undoes it. The **Commit** / **Don't commit** dialog is gone, and so is the "landed without the user asking" report after a script commits. A pull, merge, rebase or cherry-pick no longer needs a request either, and is not reported.

Pushes still need a request. When your latest message doesn't ask for one, the gate shows the **Push** / **Don't push** dialog as before, and re-checks the review after you answer when the same command also commits. The request parser now also understands "delete the branch" (a `git push --delete` is a push), and "ok, we can push" or "ok we can ship" after an agreement. Like any push request, these allow every push until your next message. "CI is green, we can push" still asks nothing.

`/review-cycle:review` now ends a clean cycle by committing the reviewed work, unless your message held off a commit ("don't commit", "not yet") or findings remain that need your decision. That hold is the skill's to honor; the gate does not read it. It pushes only when you asked. "ship it" covers the whole run: review, commit, push and the pull request.

The status tool's `consent` field is replaced by `pushRequested`, a boolean.
