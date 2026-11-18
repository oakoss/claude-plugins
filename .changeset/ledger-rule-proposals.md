---
review-cycle: minor
---

A finding that keeps recurring is proposed as a project rule. When `/review-cycle:review` records a finding in the ledger that instances a general rule, it tags it with a `class` naming that rule, reusing the wording of a class the ledger already holds. When a class has been settled on two different days, the review ends by proposing to fix it at the source: in code first, then a check, then a line in your `AGENTS.md` or `CLAUDE.md`. It writes nothing until you say yes, and does not propose the same class again while it stays recurring, whatever you answer; a class whose entries are resolved can come back.

An older review-cycle version reading the same ledger drops the entries that carry a class, as it does any entry a newer version wrote.
