---
review-cycle: patch
---

A subagent whose `gh` call the gate cannot read is told how to write it out. A reviewer's read-only `gh api "$p"`, with its endpoint built at run time, was refused with "subagents do not commit, push, open, merge…", as if it had tried to write. It now gets the same answer the main session does: the call's arguments are built at run time, write its options out, and a read can name `--method GET`. A subagent's `gh` call the gate can read as a write is refused as before.
