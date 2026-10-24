---
pr-kit: patch
---

After a merge, `merge` asks pr-watch to watch the repository's open release pull request (headed `*/version-packages` or `changeset-release/*`), when pr-watch is installed, so the version pull request's rebuild and checks show above the prompt without polling. It never offers or runs that merge: merging it is the release, and stays your ask.
