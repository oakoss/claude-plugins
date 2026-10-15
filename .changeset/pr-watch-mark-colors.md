---
pr-watch: patch
---

A status in the band colors only its mark, not the words beside it. Each other workflow reads ` · CodeQL ` in the normal text color with its mark carrying the state: `●` blue while it runs, `✓` green once it passes, `✗` red when it fails. A line's own status does the same: `✓ ready to merge` and `✓ checks passed` color only the `✓` green, a blocked line only its `⚠` yellow, a failed job only its `✗` red, and the running workflow only its `●` blue. The running `●` and the failed `✗` had drawn uncolored, since their names are links. An error such as `gh failed` still reads red. A mark is drawn whole when a line is too wide for the band; the plain text beside it is cut first.
