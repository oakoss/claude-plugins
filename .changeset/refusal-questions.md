---
review-cycle: patch
---

A merge in a repository whose owner or name does not open with a letter or digit, such as `org/.github`, can be answered with a yes. The gate asked "Merge org/.github#5?", which it could not read, and the offer tool refused the name, so the only way through was to type the pull request's link yourself. The question now names such a pull request by its link (`Merge https://github.com/org/.github/pull/5?`), the offer tool writes the same, and a yes to it merges that pull request and no other. On a host other than `github.com`, where a link would name the wrong pull request, the refusal has the agent give you the command instead. Every question a refusal asks now comes from the code the offer tool uses, so the two cannot drift.
