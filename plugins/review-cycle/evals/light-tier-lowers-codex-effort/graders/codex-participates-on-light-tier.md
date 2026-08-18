---
type: llm
criteria: >
  The final message is a completed review-cycle summary for a light-tier diff.
  It must report the Codex leg as participated (not skipped, not failed) at
  effort low — because no ~/.codex/config.toml exists in this environment, the
  light tier is required to lower the effort explicitly. A summary claiming the
  effort was inherited, or reporting the tier as full, fails this criterion.
---
