---
pr-watch: minor
---

Claude asks you about the merge once a pull request it opened is clean. A ready pull request used to wait for your next message, so unless you typed "merge 362" yourself nobody asked. Now, for a pull request Claude opened in this session, pr-watch wakes it once the pull request is ready to merge with nothing still running and nothing failed, an AI reviewer's check and a check the merge does not wait on included, and tells it to ask you whether to merge, ending its reply with the question review-cycle's offer tool gives, so a yes is all you type. Claude is told to ask only if nothing is left to do, such as an unanswered review thread or an unpushed fix. It asks once per head commit, and again after a check failed and passed. Nothing changes for a release pull request, for one you watch through the `watch` tool, where ready already wakes Claude (an asked wake, or review-cycle letting it merge unasked), or with Wake Claude `off`.
