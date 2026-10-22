---
review-cycle: patch
---

One yes now covers `gh stack submit`. The consent grammar reads a stack's pull requests ("open its PRs", "open the PRs", "open their pull requests", "open a PR for each layer"), and an offer that lists backticked branches ("Force-push the stack `feat/a`, `feat/b` with a lease and open its PRs?") keeps both of its steps. When `gh stack submit` lacks consent for its pull requests and its leased push would not run on the stop-before setting alone, the commit gate's refusal names the forced push with a lease and the pull requests together, so the agent asks for both in one question instead of one at a time, and one yes runs it. A yes to an offer to merge several named branches into a base ("Merge `fix/a` and `fix/b` into `main`?") now grants nothing, as one naming a single branch already did, since that is a local merge.
