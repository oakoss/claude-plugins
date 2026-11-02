---
pr-watch: patch
---

A draft's line says `✓ checks passed` only once every check has passed, the same test that decides whether Claude is told so. Otherwise it names what did not pass, whether the merge waits on it or not: a required GitHub App check (`✗ Vercel failed`), a job (`✗ CodeQL: Analyze failed`), or a run that ended without passing (`✗ CI stale`), and reads `○ waiting on checks` while any workflow still runs or the draft has more checks than one read returns. Claude is now told when a required GitHub App check fails, once per head commit and only for its newest run, and when a run fails with no job failed, as a startup failure does, in place of telling a merge's or push's checks passed; before, both went untold.
