---
review-cycle: patch
---

Review scratch directories no longer get left behind. A session that was resumed or forked forgot the directories its review had made, so the end-of-cycle sweep answered "No scratch directory to sweep" and left the reviewer copies on disk. The sweep now reads those directories back from the scratch tool's answers in the conversation. A directory read back is left alone while the session that made it is still running, as a forked session's parent may be, or while a process is using it. A file or symlink carrying a deny-delete ACL, which blocked `rm` even in your own shell, is now unlocked and the directory removed; only what lies wholly inside the directory is changed, so a symlink's target or a hard-linked file elsewhere keeps its ACL.
