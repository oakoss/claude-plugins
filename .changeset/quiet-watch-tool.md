---
pr-watch: patch
---

The `watch` tool is quieter:

- It answers in one line naming the pull request, without its progress line, which stays on the band above the prompt. When a rate limit or an outage keeps it from reading, the line says so; news its first read found still follows.
- Its description tells Claude that pull requests it opened or merged are watched already, so it calls the tool for one of them only to pass `wake`.
- It takes `pr` as well as `pull`, so a first call naming the pull request `pr` no longer fails.
