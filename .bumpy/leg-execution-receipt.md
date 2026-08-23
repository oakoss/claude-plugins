---
"review-cycle": minor
---

Grade each review leg by what it could actually verify, so a leg whose build was broken no longer carries the same weight as one whose build worked.

Every reviewer now opens its report with a two-line receipt: `execution:` naming the heaviest verification that **succeeded** with its first output line, or `none`; and `attempted-but-failed:` naming every verification that would not run — including the project's own suite when the leg never attempted it, since an unattempted check is not a passed one. Orientation commands like `git status` are excluded from line one, because they succeed on a machine where nothing else does.

Both skills grade each reporting leg from two facts read off the receipt — whether line one names a verification that succeeded, and whether line two says `none` — giving `executed`, `partial`, or `static-analysis-only`, with `unknown` when either line is missing. A receipt quoting a compile error is `static-analysis-only`, never `executed`.

Demotion keys on the claim's evidence rather than the leg's grade, for one narrow class: how an external tool, framework, or service behaves when the sole support is a manifest, config file, lockfile, or CI file. Gating that on the label would miss the incident outright, since a leg that got any one unrelated check to pass grades `executed` or `partial` — and real legs almost always get something to pass. The label says what the demotion means: `static-analysis-only` could not have checked, `executed` could have and did not. Claims about what the changed code itself does — control flow, error propagation, what a caller observes — are read from the source and stand. A finding already labelled `inferred` keeps its place, since that reflects a budget spent elsewhere rather than a capability that was missing. A leg that merely omitted the receipt is labelled `unknown` and is not demoted for that alone: a formatting miss should not cost you a finding, and a silently dropped finding is worse than an ungraded one you can still read. Omission does not beat candour, though — a report that otherwise shows the leg could not run the checks is demoted exactly as `static-analysis-only` would be.

The summary reports this the way it reports stalled reviewers: one line naming only the legs that were not `executed`, with the observed cause. A healthy cycle prints `Leg execution: all executed` and nothing more.

This addresses a failure seen over eight cycles on another repository: the Codex leg's builds failed for an entire session, it kept reasoning confidently from manifests, and two of its findings were wrong — including one asserting that `doctest = false` stops `cargo test --doc` from compiling the crate, which it does not. The summary read identically to a session where everything ran.

The receipt narrows what a leg can quietly omit; it does not verify, and the skills say so. `partial` still rests on a leg volunteering what it could not reach.

A new bats suite holds the contract across the files that carry it, catching a requirement dropped from an agent body, a new reviewer agent that never joined it, a renamed label, and an inverted grade mapping. CI's changed-files filter now routes plugin edits to the bats job, so that guard runs on the pull requests it exists for rather than only after merge.
