---
review-cycle: patch
---

The commit check no longer refuses a `for` or `select` loop whose word list names git (`for x in git push; do …`) or a `[[ … ]]` test that does, matching how the GitHub check already reads them: neither runs those words. A loop body, a substitution in the list or the test, and zsh's `for x (a b) git push`, which runs what follows, are still judged as before. zsh's multi-name `for x y in …` is still read as running its words.
