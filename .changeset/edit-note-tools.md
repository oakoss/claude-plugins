---
review-cycle: patch
---

The note that a Bash command changed files no longer fires for a package install. `pnpm install`, `npm install` and the like went into the note because the word `install` was read as the `install` copier wherever it appeared, so every install named the lockfile it rewrote. `install` now counts only as the command itself, so an install is not measured, as a package script already was not. `bun install` is still measured, since `bun` also runs scripts.
