**Record the cycle in the ledger first**, with the `mcp__review-cycle__ledger_record` tool, so the next cycle's reviewers do not re-raise what this one settled. Pass as `entries` every finding this cycle deferred, rebutted, or examined and left alone on purpose, and every question, each with its path, line when it has one, kind (`deferred`, `rebutted`, `left-alone`, `question`), the finding, the reason (the deferral criterion, the measurement or documentation that rebutted it, or why it was left alone), and the leg that raised it. Pass as `resolve` the ids of carried entries this cycle fixed, or found no longer apply. Pass as `keep` the ids of every other carried entry that was not reopened: the tool stamps each with its file as this cycle reviewed it, keeps its date, and drops one whose file is gone. A reopened entry the legs settled again goes in `entries` as this cycle now sees it, which dates it today, with its old id in `resolve` when the wording changed. A fixed finding is never recorded: the code changed, so raising it again means it came back. When there is nothing to record, keep or resolve, skip the call. The tool refuses a malformed batch whole and names the first fault; correct it and call again. When the tool does not exist or cannot record, the summary says `not recorded (<its answer, or tool missing>)`. Skip this step when the cycle was aborted.

Call `mcp__review-cycle__sweep` first, so the summary can report what it ended and removed. Then print a structured summary:

```text
Review cycle complete.

Tier: light | full
Scope: delta (N files, +A -D vs the last reviewed tree) | full (<no review yet this session | status tool unavailable>)
Iterations: N (converged | ceiling of <max> reached, N findings held | stopped at iteration 1 for a spec decision)
Coverage: all changed paths reviewed | uncovered: <path (edited-after-review | never-reviewed)>, ...
Falsifiable questions: N asked / N answered by measurement / N fell back to reading
Factual corrections (cleanup): N — <the claim that was wrong, and what the run showed> | none
Release-note corrections: N — <file, the claim that no longer matched the diff> | none | not checked (<reason>) | no release-note file in this diff
Unexercised claims raised as questions: N — <each one> | none
Ledger: carried N from earlier cycles (O reopened); recorded A new, U updated, K kept, R resolved[, G gone][, E evicted][, D dropped unreadable][; <note>] | unavailable (<reason>) | not recorded (<reason>)
Target integrity: unchanged (Phase 3 fan-out; Phase 7 not covered) | CONTAMINATED (<leg>, <what differed>) | not checked (<reason>)
Message fixes verified: N (one verification line per fix) | none
  valve: 1 Codex-only pass (effort: low | inherited | <level> (explicit)) | not needed
Codex leg: participated (effort: low | inherited | <level> (explicit)) | skipped (<reason>[; effort <level> requested, unused]) | failed (<error>)
  auth: stored session (not exercised) | no stored session | unknown (probe unsupported)
Leg execution: all executed | no leg reported | <leg> = partial (<what>) / static-analysis-only (<observed cause>) / unknown — naming only legs that were not `executed`
Canonicalization: ran (<commands>) | partial (<tool> unavailable) | no project checks found
Reviewers dropped (stalled): none | <names, each nudged once before dropping>
Reviewers capped (over budget): none | <each `cappedReviews` entry from the status tool, and whether TaskStop stopped it>
Churn: none | <file[:hunks] in every fixing iteration's set (N of N fixing iterations)>
Convergence: iteration 1 only | <iteration N: X of Y from this cycle's fixes[ (confirmation pass)]>, ... [— the loop is generating its own work]
Cost: <iteration N: W min wall-clock, L legs, T subagent tokens, C Codex tokens[, not reported: <legs>]>, ... | not recorded (<reason>)
Scratch swept: <N processes ended, directory removed> | <errors> | not swept (<reason>)
Findings fixed inline: X
  - file:line — issue (source)
  - ...

Findings deferred: Y
  - file:line — issue (source)
    reason: <criterion from fix-vs-defer policy | held at the ceiling>
  - ...

Spec conformance (iteration 1): <spec source / no spec source found>
  - contradicts or leaves out an explicit spec line (defect — fixed or deferred above): ...
  - scope creep against a current source (stopped the cycle for your decision): ...
  - findings against an unverified source (caveated, not acted on): ...
  - pending after a spec stop (iteration 1's other findings, not judged): ...

Structural suggestions (report-only — prompt to address the ones you want):
  - file:line — suggestion (confidence: high/medium/speculative)
  - ... (or "maintainability-auditor not run — diff too small" / "none")

Final state: clean / N findings remain
```

**When anything was deferred or raised as a question, follow the summary, before any question Phase 10 asks, with a paste-ready markdown block** for the pull request description, since the summary is gone with the session: `## Known issues` with one bullet per deferred finding (`` `file:line` — the finding (deferred: the reason) ``), then `### Open questions` with one bullet per question. It repeats the summary, nothing new, and leaves out findings still held at the ceiling, which Phase 10 asks about, and a heading with nothing under it. Never file it in a tracker; when you open the pull request yourself, put it in the body, with any held findings the user chose in Phase 10 to defer added first.
