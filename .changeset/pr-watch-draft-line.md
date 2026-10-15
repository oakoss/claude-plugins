---
pr-watch: patch
---

A draft pull request's line now shows its checks. It starts `#128 draft ·` and follows them like any other line: the bar while they run, the job that failed, `○ waiting on checks` while a required GitHub App check runs, or `✓ checks passed` once they pass, where it had read `○ waiting on draft` and hidden them. It still never says `ready to merge` while a draft, and now also says what would block the merge once it is marked ready, as in `#128 draft · ✓ checks passed · ⚠ conflicts`. A draft with no checks reads `#128 ○ draft`.
