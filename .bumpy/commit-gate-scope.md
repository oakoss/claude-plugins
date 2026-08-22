---
"review-cycle": patch
---

Scope the commit gate to the project and stop matching text the command carries.

The gate blocked the commit verb in any repository a session touched, not only the project it guards. That collided with the reviewer techniques in this same release: agents building a scratch fixture with real history — a copy at the base revision to diff against — were blocked while building it, and worked around it instead. The gate now stands aside only when the command *proves* the commit lands elsewhere, and gates the project whenever it cannot tell.

Proving it means reading a leading `cd` chain and the commit's own `-C`, then resolving the result through its nearest existing ancestor, so a fixture that does not exist when the hook runs still resolves — while a not-yet-created subdirectory *of the project* still resolves to the project. `cd` hops compose the way bash composes them when the command is `&&`-joined throughout, or plainly sequenced with every directory already on disk.

Everything else gates. A hop inside a subshell, a backtick, or an `if` branch may never run; a second commit in the same command lands somewhere the router never read, since everything it reads stops at the first; a path holding a variable, a glob, a `cd` option, a `~+`, a `..` segment, or only partial quoting was never expanded; `--git-dir`, `GIT_DIR`, and `CDPATH` move git or `cd` off the computed path; a payload cwd that is missing or relative names nothing. Both the payload cwd's repository and the one `CLAUDE_PROJECT_DIR` names count as the project, and an unresolvable target is checked against every one of them, so a stale `CLAUDE_PROJECT_DIR` can no longer switch the gate off where you are working.

Detection runs on the command skeleton rather than the raw text. Quoted arguments, comments, and heredoc bodies are data, so an issue description quoting the phrase or a heredoc writing a setup script no longer counts as an invocation. Command substitutions stay code wherever bash expands them, double quotes and unquoted heredoc bodies included; a quoted command handed to `bash -c`, a cluster like `bash -lc`, `eval`, `ssh`, a heredoc into a shell, or a pipe into one still blocks, as does a path-qualified `/usr/bin/git`. `git commit-tree` and the other hyphenated plumbing verbs are no longer treated as the gated verb — they write an object and move no ref.

Failures are no longer read as answers. A `grep` that errored, an `awk` that died or produced nothing, and a lexer that lost track of quoting each mean the text was not read, and unread text blocks rather than passes.

Two limits are deliberate. Commands over 32 KB skip the skeleton and let the raw text decide, because the lexer is quadratic and a hook that takes seconds is its own defect. And the shapes that hand a string to a shell are a named list, so a runner it does not cover — `python3 -c`, a task runner — is missed, and the commit it hides passes; the gate has never claimed to be an adversarial boundary.

If your project relied on the gate firing in a second repository under the same session, set `CLAUDE_PROJECT_DIR` to that repository, or opt the project out with `{"disabled": true}` in `.claude/review-cycle.json`.
