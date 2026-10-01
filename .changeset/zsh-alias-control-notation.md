---
review-cycle: patch
---

The gate now reads zsh's control and meta notation in alias values. zsh lists a control byte in an alias as `\C-M`, DEL as `\C-?` and a high byte with a `\M-` prefix (measured on zsh 5.9.2, every byte from 1 to 255). The gate used to read the literal text `C-M`. When the escaped byte was a quote or a backslash, as in `$'a\C-\'` or `$'x\M-'y'`, it also misread where the value ended, so the aliases listed after it ran into that value and went unchecked. The gate now reads each value as zsh means it and keeps every alias that follows.

Command parsing is unchanged: bash never writes this notation, and the gate still reads an unknown `$'…'` escape the way zsh runs it, dropping the backslash, so `git $'c\ommit'` stays gated.
