---
pr-watch: minor
---

A stack layer reads ready to merge only once every layer below it has merged or is ready itself, since `gh stack merge` on a layer merges the open layers below it too and GitHub reports each layer ready by itself. Until then its line shows `○ waiting on layer 2/3`, it raises no ready toast or `merge #N` suggestion, and a `watch` with `wake` on the top layer wakes Claude when the whole stack is ready. A layer below that pr-watch does not watch counts as not ready unless GitHub's stacks API reports it merged. When a layer's line changes, the layers above it are read again at once, so a stack turns ready without waiting out their read delay.
