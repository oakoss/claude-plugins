---
review-cycle: patch
---

The review cycle and `/review-cycle:review-pr` grade the Codex leg from the commands it ran, not from its verdict. `codex review` prints its own verdict format, which carries the execution receipt only some of the time, so Codex was usually graded `unknown`. A new `mcp__review-cycle__codex_log` tool reads Codex's output file, with or without color, and lists each command with its status, exit code, and first and last output lines, flagging a status that parallel commands leave unclear. The skills build Codex's receipt from that list, counting the project's test suite as unattempted when no command ran it, and no longer ask Codex for receipt lines. A file that is not a Codex log is refused rather than read as a Codex that ran nothing, and the skills then read the receipt off the verdict as before.

The review summary now comes after the commit in the cycle's final message, since one run printed it first and ended with prose.
