---
review-cycle: patch
---

### The README says what the commit gate guards against

The gate is there for a well-meaning agent that commits too early, before a review or before you asked, in the commands agents actually write. The README now says so under "What it guards against": what is checked before it runs, what is only reported afterwards (a commit made inside `npm version`, `make release` or a project script), and what is out of scope (an obscure shell construct or an environment trick, and your own `!` shell). It points to an OS-level sandbox for containing an adversarial agent.

The review skill also keeps a reviewer's question about a guard inside what the guard claims to cover: it asks whether the guard catches the cases it documents, not whether a reviewer can find a way around it. A reviewer sent to hunt for a bypass always finds one, and each find costs a review iteration on a case no agent meets by accident. A gap an ordinary command falls into is still a finding.
