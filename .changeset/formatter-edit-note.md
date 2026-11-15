---
review-cycle: patch
---

Running a formatter from `node_modules/.bin` no longer draws the note that files changed during a Bash command. The note asks for edits through Edit and Write, where the comment and settings checks run, and it fired whenever a review formatted its changed files by path, which is what the review is told to do. A command made only of those formatter calls (`oxfmt`, `prettier`, `biome format`, `dprint fmt`), with nothing but a `cd` beside it, is no longer measured, and the review now runs each formatter as its own call. A formatter chained with another command run by path, a redirect into a file, and a script elsewhere that shares a formatter's name are still measured.
