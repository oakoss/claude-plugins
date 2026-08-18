---
"review-cycle": minor
---

New `/review-cycle:review-pr` skill: single-pass, report-only review of a GitHub pull request, run locally. It fetches the PR head into a disposable detached worktree — the working checkout is never touched — runs the same reviewer fan-out as the review cycle (Codex leg included, briefed, with `--base` against the PR's base branch), and reports findings with explicit per-reviewer coverage so "no findings" is never mistaken for "nobody looked". On request it posts the findings back to the PR as a single COMMENT review whose comments — inline and body-level alike — carry fingerprints that deduplicate across re-runs. It never fixes code, never approves, and never touches the review sentinel.
