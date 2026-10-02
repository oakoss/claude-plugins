---
review-cycle: minor
---

A Bash command that changes files in the repository now gets a note naming them and telling the agent to make file changes with Edit or Write instead. The comment-slop check and the precise settings check attach to Edit and Write, so an edit made through Bash skipped both: one month's sessions ran 3,178 Bash calls against 218 Edits.

A command that could write is measured by comparing the working tree before and after it: a redirect, `tee`, `sed`, `perl`, `cp`, `mv`, an interpreter (`python`, `node`, `tsx`, …), a script run by its path or with `source`, a nested shell, `xargs` or `find`, even behind an assignment, `if`, `time`, `env` or an alias. So a `cd`, a glob or a script's own logic cannot hide an edit. The comparison covers the files a review covers: tracked or not-ignored files in the repository, apart from the review exclusions (`.beads/`, editor folders) and the `ignore` patterns. A gitignored file or one outside the repository is not seen. Each measured command costs two working-tree snapshots, about 35 ms each in a repository of 145 files, and some read-only commands (`sed -n`, `find`, `node --version`) are measured too. A command that names none of these is not measured.

A file saved by something else while the command ran is named too, so the note says which files changed while the command ran rather than claiming the command changed them. It never refuses the command, which has already run, and when git cannot take the measurement the agent is told the check was skipped. It runs only while the gate is on, and not for background commands or review subagents, whose writes into the repository the gate reports separately.
