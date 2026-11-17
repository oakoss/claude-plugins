---
comment-check: patch
---

A broken git setup, such as `GIT_DIR` pointing at a directory that does not exist, now tells the agent the comment-slop scan was skipped, naming git's error. Before, git's "not a git repository" message for it read as a file outside every repository, so the scan skipped the file without a word.
