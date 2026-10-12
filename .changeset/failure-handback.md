---
review-cycle: patch
---

When the gate itself fails while checking a command or a GitHub tool call, its refusal no longer ends by handing you the step ("The user can run it from their own terminal", "they can make the change on GitHub themselves"). It now tells the agent to report what failed and stop, and to suggest running the step elsewhere only if you ask. A refusal that reads as the next step invites the agent to offer a way around the check: before 0.28.1 the `--continue` refusal did exactly that, and an agent offered a `!` command that skipped the gate. A refused `git rebase --exec` now offers a route that stays checked: run the rebase without `--exec` and each command as its own step afterwards. That runs the command once rather than after every commit, so the agent asks you when a per-commit run matters.
