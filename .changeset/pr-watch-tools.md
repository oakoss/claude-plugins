---
pr-watch: minor
---

Claude can now watch a pull request it did not open, such as a teammate's or one you point it at, with pr-watch's `watch` tool, instead of polling `gh pr checks` or sleeping. The tool answers with what the pull request shows now, and pr-watch then tells Claude when that changes, as for one it opened. `unwatch` stops watching a pull request or a pushed branch, and `watches` lists what pr-watch is watching and what each line shows.
