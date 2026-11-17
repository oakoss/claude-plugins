---
pr-kit: patch
---

`/pr-kit:fix-ci` no longer treats a check that passes on retry as settled. The retry only tells a flake from a real failure: the skill now reads the failed attempt for what stopped it, naming `gh run view --attempt`, since without it `gh` reads the attempt that passed, and the report's `Flakes:` line carries that cause, or "cause unknown" and what it read. It never retries again, adds sleeps, raises timeouts or skips the check to turn a flake green. A retry that fails again is handled as a real failure.
