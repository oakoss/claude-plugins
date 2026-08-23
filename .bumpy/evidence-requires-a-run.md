---
"review-cycle": minor
---

Require a run, not a manifest, behind any claim about what a command does.

A new evidence policy joins the comment and fix-vs-defer policies, and binds everyone in the cycle rather than only the author applying fixes. A manifest, config file, lockfile, script entry, CI workflow, or flag in documentation says what someone configured or intended; it does not say what the tool does with it. A real finding in the field report was reasoned from a manifest and was wrong: `doctest = false` does not stop `cargo test --doc` from running the doctests. Cargo compiles the crate and runs them anyway; the flag only removes them from plain `cargo test`.

Three rules follow: name the command and quote what it printed rather than the file you read it from; treat a run you did not observe as no run at all, since a stale file, a redirect the shell refused, a cached artifact, and a skipped job all look like success from a distance; and when the environment cannot exercise a claim, label it inferred or verify it against authoritative documentation instead of stating it flatly. A finding that rests entirely on behavior nobody could exercise is withdrawn and raised as a question.

The policy reaches every leg. The seven bundled agents carry it in their bodies, so it applies when they are invoked directly as well as inside the cycle. Codex has no body, so both `/review-cycle:review` and `/review-cycle:review-pr` now carry the rule into the intent brief that reaches it — and `review-pr` says why it matters more there, since the PR head sits in a disposable worktree whose dependencies may not be installed and there is no fix loop downstream to catch a manifest-only claim.

Two agents get the rule in the form their job takes. The maintainability auditor is told that green tests are the weakest form of this evidence, because a suite that does not constrain the code being simplified stays green while the simplification breaks it — so a behavior-preserving claim must say what would have caught it, and when nothing would have, the missing test is the finding. The cleanup agent is told that tightening prose must never make it false, and that a factual correction is reported separately from a wording change, because the author needs to know a claim was wrong rather than merely shorter.

`/review-cycle:init` now installs all three policies and appends only the ones a `CLAUDE.md` is missing, so re-running it after this upgrade adds the new policy without duplicating the two already there.
