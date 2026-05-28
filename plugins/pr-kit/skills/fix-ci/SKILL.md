---
name: fix-ci
description: Drive a pull request's CI checks to green — watch the check set, diagnose the root failure, apply the smallest fix, route it through review, then commit and push; repeat until green. Use when the user asks to "fix CI", "get the checks green", "loop on CI", or "the PR build is failing".
argument-hint: "[<pr number or url>]"
---

# Fix CI

Iterate on failing PR checks until they're green. Getting CI green inherently requires pushing, so this skill commits and pushes — but every fix goes through review first, and hooks are never bypassed.

## Source of truth

Use `gh pr checks` for the check set — it covers **all** PR-attached checks, not just GitHub Actions (`gh run list` misses external checks). Re-read it after every push; the set can change.

```bash
gh pr view <number> --json number,url,headRefName
gh pr checks <number> --json name,bucket,state,workflow,link
```

`$ARGUMENTS` may name the PR; otherwise use the current branch.

## The loop

Each round:

1. **Read the check set.** If checks are still pending, watch them: `gh pr checks <number> --watch --fail-fast`. If they've already failed, skip the wait and diagnose.
2. **Diagnose one failure.** Take a single failing check and find the root error — the first actionable failure, not a downstream symptom. For GitHub Actions, read the failed logs:
   ```bash
   gh run view <run-id> --log-failed
   ```
   For an external check, follow its `link` to find the failing command or service.
3. **Apply the smallest safe fix** for that one cause. Don't batch unrelated fixes into one round — one cause at a time keeps each push diagnosable.
4. **Review before it leaves your machine.** Route the fix through your review gate so it's never pushed unreviewed:
   - If `review-cycle` is installed: run `/review-cycle:review` (it reviews, applies fixes, and marks the sentinel) — or `/review-cycle:accept` for a trivial one-line fix like a lint correction.
   - If not: show the diff and get the user's OK before pushing.
5. **Stage, commit, and push.** `/review-cycle:review` reviews and marks the diff but does not stage it, so `git add` the reviewed files yourself, then commit and push — never `--no-verify`.
6. **Re-check** the full set and repeat.

## Guardrails

- **One failure cause per round.** Minimal, low-risk fixes before any broader change.
- **Flaky checks:** retry once. If it passes on retry, report it as a flake with evidence rather than "fixing" phantom failures.
- **Failures unrelated to this PR** that are already green on `main`: merge `main` in (then re-review and push) instead of bloating the PR with unrelated fixes.
- **Never bypass hooks** (`--no-verify`) to force a check green.
- **Know when to stop.** If the same check fails twice with no progress, or a failure needs human judgment (a flaky infra outage, a genuinely ambiguous test), stop and hand back with what you found. Don't loop indefinitely.

## Output

```
PR #<n> — CI: <green / still failing / stuck>

Rounds:
  1. <check> failed — root cause: <…> — fix: <…> (reviewed via <review-cycle / approved>, pushed)
  2. ...

Flakes: <none / <check> passed on retry>
Current checks: <summary>
Next: <PR URL once green, or what needs a human>
```

## Do NOT

- Do NOT push an unreviewed fix — route through `/review-cycle:review` or get explicit approval.
- Do NOT bypass hooks (`--no-verify`).
- Do NOT keep looping on a failure that isn't making progress — stop and report.
- Do NOT bundle unrelated fixes into one round.
