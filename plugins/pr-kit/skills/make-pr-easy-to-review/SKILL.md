---
name: make-pr-easy-to-review
description: Make a pull request easy to review without changing its behavior — a TL;DR that matches the diff, core files separated from generated ones, risks called out, and (only with approval) cleaner commit history. Use when the user asks to "make this easy to review", "tidy this PR", "clean up the commits", or "annotate the diff".
argument-hint: "[<pr number or url>]"
---

# Make PR easy to review

Help a reviewer understand the intent, the important files, and the risk — fast. The default is **reviewability without behavior changes**: improve how the change is presented.

## Resolve and inspect

`$ARGUMENTS` may name the PR; otherwise use the current branch.

```bash
gh pr view <number> --json title,body,headRefName,baseRefName,state,commits,files
```

Look for what makes this hard to review: a stale or missing description, noisy/WIP commits, unrelated changes mixed in, mechanical churn (formatting, generated files) tangled with real logic, a large diff with no obvious entry point, or missing tests for new behavior.

## Tier 1 — safe by default (no history rewrite)

These don't touch code or history. Do them directly:

- **A TL;DR that matches the actual diff** — what changed and why, in a few lines. Never describe behavior the diff doesn't contain.
- **Separate the signal** — call out the core files a reviewer should read first, and list generated/mechanical files they can skim.
- **Call out risk** — behavior changes, migration/rollout order, and test coverage (or its absence).
- **Link intent** — the originating issue/PRD, dashboards, or design docs.

Apply these by updating the PR description (a visible write to the PR, not to code):

```bash
gh pr edit <number> --body "<improved description>"
```

Show the proposed body before writing it.

## Tier 2 — history rewrite (requires explicit approval)

Reordering/squashing commits and force-pushing is **destructive and visible**. Never do it on your own initiative. Propose a plan and get an explicit yes first.

Before rewriting, capture the original tree so you can prove behavior is unchanged. First find where the head branch lives — for a fork PR it is **not** on `origin`:

```bash
gh pr view <number> --json headRefName,baseRefName,isCrossRepository,headRepositoryOwner,commits
```

Fetch the head ref from the right place, then capture its tree:

```bash
# same-repo PR — the head ref is on origin
git fetch origin <headRefName> <baseRefName>
ORIGINAL_TREE=$(git rev-parse origin/<headRefName>^{tree})

# cross-repo (fork) PR — fetch from the fork instead
git fetch https://github.com/<headRepositoryOwner>/<repo>.git <headRefName>
ORIGINAL_TREE=$(git rev-parse FETCH_HEAD^{tree})
```

A good commit grouping follows dependency order: schema/storage or generated API defs → core logic → wiring/integration → UI/surface → tests.

After rewriting, **verify the tree is byte-identical** — the whole point is that history changed but code did not:

```bash
echo "original: $ORIGINAL_TREE"
echo "current:  $(git rev-parse HEAD^{tree})"
git diff origin/<headRefName> --stat
```

If the trees differ at all, **do not push** — the rewrite changed code, which is not what this skill does. Investigate or abort.

Check where the head branch lives before pushing. For a PR from a fork, `<headRefName>` is on the fork, not `origin` — pushing to `origin` would target the base repo and either fail or create a stray same-named branch there while leaving the PR untouched:

```bash
gh pr view <number> --json isCrossRepository,headRepositoryOwner,headRefName,maintainerCanModify
```

Only force-push after the trees match and the user has approved. Push the exact `HEAD` you verified (not a local branch name, which may be stale or absent) to the PR's **head** remote — `origin` for a same-repo PR, the fork's remote for a cross-repo one (add it if needed, and only if you own the fork or `maintainerCanModify` is true). If you can't push to the head repo, stop and tell the user — don't rewrite history you can't publish.

```bash
git push --force-with-lease <head-remote> HEAD:<headRefName>
```

Use `--force-with-lease`, never `--force` — it refuses to clobber commits you haven't seen.

## When the PR is just too big

If a diff can't be made reviewable with notes and grouping — too many concerns in one PR — say so and **recommend splitting** it. Polishing the description around a 2,000-line multi-concern PR doesn't make it reviewable; it hides the problem.

## Output

```
PR #<n> — reviewability pass

Description: <updated / proposed — show it>
Reviewer guidance: <entry-point files, generated files, risks>
History: <left as-is / rewrite proposed (plan) / rewritten + tree verified + force-pushed>
Recommendation: <ready to review / split suggested because …>
```

## Do NOT

- Do NOT hide a behavior change inside "cleanup" — if the tree changes, it is not this skill's job.
- Do NOT rewrite history or force-push without explicit approval and a verified-identical tree.
- Do NOT use `git push --force` (use `--force-with-lease`).
- Do NOT bypass hooks (`--no-verify`).
