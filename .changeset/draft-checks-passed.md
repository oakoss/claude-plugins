---
pr-watch: minor
---

pr-watch now tells Claude when every check on a draft pull request finishes without a failure. A draft never turns ready to merge, so until now only a failing check reached Claude, and a draft opened to try something against CI ended with no word that it passed. The note, "The checks on owner/repo#N, a draft, passed.", comes with your next message rather than waking Claude, once per head commit, so each new commit that passes is told again, as is a re-run that passes after a failure. A required check from a GitHub App that finished without passing holds it back. A failing check still wakes Claude at once, and the `watch` tool's `wake` makes the passing wake Claude too.
