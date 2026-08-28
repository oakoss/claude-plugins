---
review-cycle: patch
---

The Codex leg's falsifiable question is now reading-shaped; measurement-shaped questions route to the subagents.

codex review runs its sandbox read-only by default: read-only commands succeed, but builds, test suites, and temp-directory writes are denied. Measured on codex-cli 0.149.1 during this release's own review cycle — an unoverridden codex review session opened with `sandbox: read-only` in its header, and its attempt to run the project's test suite failed with `mktemp: mkstemp failed ... Operation not permitted`; the same denials recurred across three review iterations on another repository, where the leg burned effort attempting runs the sandbox refused and reported inferred findings every time. The brief now gives Codex a question settleable by reading source, diff, or authoritative documentation (read-only commands included), and reserves questions that require running or perturbing code for the subagent legs, which own writable scratch directories. Codex's findings were already useful as reading; this stops paying for the failing runs.
