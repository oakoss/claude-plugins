---
pr-kit: patch
---

`ship` leaves the merge question to pr-watch where pr-watch will ask it. With pr-watch installed, pr-watch has Claude ask once a pull request it opened is ready to merge with nothing still running or failed, so ship's own question at the end of its report came first and too early: a yes to it could merge before a reviewer the merge does not wait on had finished. Ship now calls pr-watch's `watches` tool and asks nothing where that says pr-watch will ask, saying it will ask once the pull request is clean. Everywhere else it reports as before: without pr-watch, and where pr-watch will not ask (Wake Claude `off`, a resumed session), it ends with the merge question; a stack still gets its one `stack` question, and a draft none. If you resume the session before the pull request is clean, pr-watch no longer asks: its ready line comes with your next message instead.
