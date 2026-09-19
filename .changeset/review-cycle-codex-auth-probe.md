---
review-cycle: patch
---

### Fixed

The Codex preflight recorded auth as `confirmed` whenever `codex login status` exited 0, and the summary reported that word to the user. The probe does not exercise the credential — its verdict is a pure function of whether `auth.json` exists and parses — so `confirmed` was a claim the cycle had no evidence for.

Measured on codex-cli 0.155.1, three times independently during review: the probe printed `Logged in using ChatGPT` and exited 0 while the refresh token had been revoked server-side. The cycle recorded `confirmed`, spawned the Codex leg, and the leg died against `401 Unauthorized`. The probe prints the identical line and exit code after re-authenticating, and prints it again for an `auth.json` containing only `{}` — nothing in its output distinguishes a working credential from a revoked one, or from no credential at all.

The exit-0 outcome is now `stored session (not exercised)` in `/review-cycle:review`, `/review-cycle:review-pr`, and the plugin README. `/review-cycle:init` stopped printing `✓ authed` for it, which was the same promise in stronger words, and its glyph legend now covers observed-but-not-verified.

One sentence was removed for being false rather than imprecise. Both review skills justified reading a failed leg's status from the completion notification "not from the output file, where a crashed run and a clean run look alike". Measured: the output file records `[exited with code N]` on both, so it is strictly more informative than the notification, which flattens a rejected credential, a rate limit, a sandbox denial and a signal death into the same integer. Both skills now say the exit code reports whether the leg failed and the output file reports why, and both open that file before composing the failure message.

`tests/codex-auth-anchors.bats` anchors the vocabulary across the four files. Its anchors were chosen by mutation rather than by eye, and it states what it checks rather than claiming coverage: a rewrite that keeps every anchored phrase while changing what the surrounding rule means still passes, and no grep can close that.

Phase 1 still makes no API call. Exercising the credential on every review would spend a real request to catch a rare failure.

Deliberately not included: classifying *which* credential a 401 rejected, and the retry and remedy rules that would follow from it. A first attempt shipped that machinery and review found it repeatedly unsound — a branch written for a state the harness makes unreachable, and a recognizer that would fire on a non-fatal `401 Unauthorized` from a subsystem unrelated to auth, at the cost of the leg's retry. It needs its own design pass rather than a widening patch on this one.
