---
review-cycle: patch
---

`/review-cycle:review` no longer ends its reply with the 35-line summary block, which pushed whatever it explained or asked above it off the screen. The block goes to a new `summary` tool instead: the transcript shows it folded to its first lines, ctrl+o to expand, and the call reads `review-cycle - summary (MCP)(lines: N)` rather than the block with its newlines escaped. The reply then ends with what you need to read or answer, such as findings held at the round limit. The tool is there with the gate off too; where mods do not load at all, the block is printed in the reply as before.
