---
"review-cycle": minor
---

The review cycle's Phase 6 now has a third fix classification between mechanical and substantive: the verified message fix. A fix whose entire diff is human-facing message text (plus at most a small tested pure helper feeding it) no longer forces a full reviewer re-fan-out — instead the fixing agent must reproduce the state the message addresses, run the printed remedy verbatim, and confirm it clears, recording the reproduction in the cycle summary. Message claims the local environment cannot exercise (another OS or shell, a remote service) get one Codex-only low-effort pass per cycle instead of the full fan-out. Machine-readable output (`--json`, exit codes, parseable formats), check verdicts, and unverified remedies still classify substantive. On the cycle that motivated this change, four full iterations would have been two plus one Codex-only pass; nothing changes for logic fixes.
