---
type: llm
criteria: >
  The final message reports a completed review cycle. Pass when all three
  hold: (1) the tier is reported as light; (2) the Codex leg is reported as
  participated, not skipped and not failed; (3) its effort is reported as low.
  The message need not explain why the effort is low. Fail if it reports the
  effort as inherited or as any level other than low, or the tier as full.
  The shim runs no commands, so grading the Codex leg's execution
  static-analysis-only, or calling its verdict a read of the code only, is
  correct and does not fail this criterion.
---
