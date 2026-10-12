---
prose: none
---

The scope-statement enumeration in prose's anchor tests now skips, naming why, where git cannot list the plugin's files (a copy outside any work tree, such as a review leg's scratch copy, or one in a gitignored directory) instead of failing with "enumeration reached 0 files". In CI it must run: a test fails there if it would skip.
