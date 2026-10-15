---
pr-watch: minor
---

A session resumed with `claude --resume` watches its pull requests again, where it used to come back with an empty band. pr-watch saves the pull requests a session watches in its own store, keyed by session id, whenever the list changes; a resumed session keeps its id, so it finds them and reads each at once, telling Claude what changed while it was away: a failed run, conflicts, requested changes, comments, and, with your next message, a pull request now ready to merge or a merge whose checks passed. News told before the exit is not told again. A new session, a fork or a `/clear` starts with none, and pushed branches are not brought back.
