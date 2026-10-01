---
review-cycle: minor
---

`/review-cycle:review` now checks the change against its spec in the first round, not after the fix loop. Spec conformance runs alongside the other reviewers in iteration 1, on either tier, whenever a spec source is discoverable. A finding that quotes a spec line the code contradicts or leaves out is fixed like any defect. Scope creep against a current spec source stops the cycle before any review fix and asks you, so rounds are no longer spent polishing code you may remove; a spec source the reviewer cannot verify never stops it. A round that fixed a spec defect runs spec conformance again, scoped to that requirement. In a cycle on 2026-10-01, the spec finding arrived only after the loop had closed and cost two extra confirmation passes.

The cycle also names any file its fixes touched in every round. After each round it records the files that round's fixes changed, measured from the tree the round's reviewers were given, and from the second round that applied fixes it flags a file present in every such round, with the latest hunks, as a sign the fixes are not converging there: cut or defer the piece that keeps drawing findings rather than run another round. The summary reports it on a new `Churn:` line, even when the loop later converges. On 2026-10-01 one file was edited in every round of three consecutive cycles, each fix drawing the next finding.

The maintainability reviewer still runs once, after the loop.
