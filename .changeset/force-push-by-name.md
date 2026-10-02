---
review-cycle: minor
---

A force push now has to be asked for by name. "push it" no longer covers one: "force push it", or "yes" to the agent's "Force-push `fix/x` to `origin` with a lease?", allows `--force-with-lease` and `--force-if-includes`. A bare `--force`, `-f`, `+refspec` or `--mirror`, which overwrites whatever the remote holds, is refused with a pointer to `--force-with-lease --force-if-includes`, and runs only when the request itself names it ("force push it without a lease", "bare force push", "push it with `--force`"); a bare force mentioned elsewhere in the message, or in the agent's question, grants nothing.

The gate now reads `git push`'s options exactly, as it does `git commit`'s: an option it does not know, an abbreviation such as `--forc` included, is refused with a request to spell it out.
