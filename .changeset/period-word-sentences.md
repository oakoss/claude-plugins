---
review-cycle: patch
---

A path that opens with a period no longer ends the sentence, so a deferral after it counts: "push .github later" and "push .gitignore when CI passes" no longer grant a push. A name opening with a period or `./` now reads as the bare name does: "push the .gitignore changes" holds as "push the gitignore changes" already did, and "run ./release.sh" holds the release as "run release.sh" did. Ask in other words, such as "push it", when the gate holds one of these.
