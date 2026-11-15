---
review-cycle: patch
---

A push during a review no longer reads as a contaminated target. The review compares the repository's local git config before and after its reviewers run, to catch an identity a leg might leave behind, and `git push -u` adds `branch.<name>.remote` and `branch.<name>.merge` entries, which made the summary name a leg for what was only a push. The comparison now ignores those two entries when they are new and the `remote` names a remote the repository already has. A URL or path there, a changed or removed `branch.*` value, or another `branch.*` key such as `pushRemote`, still counts, since each can send a later push elsewhere, and so do `user.*`, `core.hooksPath` and the rest.
