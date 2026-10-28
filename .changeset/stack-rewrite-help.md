---
review-cycle: patch
---

Asking `gh stack rebase` or `gh stack sync` for help (`--help`, `-h`) no longer counts as rewriting the stack, so Monitor runs it and the commit gate does not watch it as a rebase. Only a bare help request counts as one: with any other argument, or fed by `xargs`, it still counts as a rewrite, since an argument such as `-h=false` turns help off. `gh stack rebase` is now found wherever `gh` appears in a command, such as after `sudo -u gh`, not only at the first `gh` word.

A `git -c alias.x=…` that commits is refused even when a later call in the same command redefines `x` inline: each call is read with its own definition.

When the commit gate fails while checking `gh stack rebase` or `gh stack sync`, it refuses the command rather than letting it run with a note.
