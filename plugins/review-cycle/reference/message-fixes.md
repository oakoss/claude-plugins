# Verified message fixes

How `/review-cycle:review` decides, in Phase 6, whether a fix is a verified message fix, which counts as mechanical for the loop decision.

Its entire diff is (a) human-facing message text (error strings, log lines, help text, comments, docs), (b) a unit-tested **pure** helper (output depends only on its arguments: no I/O, process spawning, or environment or global reads) of ≤ ~15 added-plus-changed lines consumed only by such strings, and/or (c) those unit tests; every changed output path a user can trigger has a test or a reproduction.

Eligible **only after empirical verification**: reproduce the state a remedy is for, run it exactly as printed, and confirm it clears; check a fact as Phase 6's step 2 does. A claim the local environment cannot exercise is verified against authoritative documentation or explicitly flagged, and routes through the valve: the Codex leg Phase 6's confirmation pass adds. Write each verification line into the Phase 9 summary draft when you make it.

Never eligible: machine-readable output (`--json`, exit codes, formats another tool parses), a check's verdict or control flow, or an unverified, unflagged remedy.
