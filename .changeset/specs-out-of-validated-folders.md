---
review-cycle: patch
pr-watch: none
pr-kit: none
session: none
---

The misses skill runs the consent corpus spec at its new path, `plugins/review-cycle/spec/consent.corpus.spec.ts`. Each plugin's vitest specs moved from `hooks/` and `tests/` into `spec/` and `spec/node/`, because Claude Code 2.1.323's `claude plugin validate` type-checks every file in a plugin's `hooks/` and `tests/` folders and cannot resolve `vitest` there, which failed each plugin with a hooks module. Nothing else a user runs changes.
