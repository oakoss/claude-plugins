---
review-cycle: patch
---

The gate now reads a command's `$'…'` word the way zsh, the Bash tool's shell, runs it. Before, `git $'\commit' -m x`, `git co$'\C-'mmit -m x` and `git co$'\C'mmit -m x` all ran `git commit` while the gate saw no git command and let them through. zsh does not treat `\c` as an escape, and in zsh `\C` and `\M` (each with an optional `-`) set control and meta on the next character, adding nothing when no character follows. A bare `\x`, `\u` or `\U` reads as NUL, which the gate refuses, as it already did for `$'\0'`; such a word used to fail to parse. Measured against zsh 5.9.2 over 1321 escape shapes, every reading agrees except where a word contains NUL: zsh cuts the argument there, and the gate refuses the command.
