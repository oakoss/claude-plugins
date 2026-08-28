---
review-cycle: patch
---

Reviewer containment now requires a private mktemp -d — never a shared session scratchpad — and the never-evade rule reaches every spawned leg.

Two measured incidents drove this. In one cycle a reviewer's copy was mutated mid-run by a sibling agent sharing the session scratchpad, contaminating its first probe round before it noticed and redid everything in an isolated directory. In another, a reviewer ran a different agent's script by accident and received a results matrix it had not authored — a failure mode indistinguishable from fabrication in the final report. Every containment block, and both skills' spawn prompts, now name a private mktemp -d as the only sanctioned workspace, forbid writes anywhere outside it (during this release's own review cycle, an agent briefly wrote a marker file to the repository's parent directory — a location the old wording never prohibited), and reviewers state the directory their measurements ran in so results are traceable to their author.

The never-evade rule ('never reshape a command to slip past a guard: an opt-out is visible and reviewable, an evasion is neither') previously covered only the four fix-loop agents; it now also covers the maintainability auditor, the spec-conformance analyzer, the cleanup agent, and — via the spawn prompts — any leg the cycle spawns. A new bats suite anchors both requirements across every file that carries them.
