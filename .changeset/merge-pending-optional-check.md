---
pr-kit: patch
---

The merge skill no longer waits on a check the repository does not require. GitHub reports a pull request as `UNSTABLE` both when such a check failed and while one is still running, and the skill used to treat both as a failure to ask about, so "merge 56" sat waiting for a CodeQL scan while pr-watch already showed the pull request ready. It now reads the checks and the required ones: a failed or cancelled check is still named and asked about, and when the others are only still running and every required check passed, it merges and names them in the report. With no required checks, or one still running, it asks. A repository that wants a check to hold merges makes it a required check.
