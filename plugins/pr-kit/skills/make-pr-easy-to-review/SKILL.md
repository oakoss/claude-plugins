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
gh pr view <number> --json headRefName,baseRefName,isCrossRepository,headRepository,maintainerCanModify,commits
```

Fetch the head ref from the right place, then record its tree **in a git ref**. A shell variable does not survive between tool calls, and the rewrite spans many — a variable set here reads as empty by the time you verify, which leaves the check below with nothing to compare and silently permits the push it exists to stop.

Chain every step with `&&`. A failed fetch that does not stop the capture stores the tree of a tracking ref nobody refreshed, and the guard then compares the rewrite against a stale baseline.

```bash
# same-repo PR — the head ref is on origin
git fetch origin <headRefName> <baseRefName> &&
git update-ref refs/pr-kit/original-head "$(git rev-parse --verify origin/<headRefName>)" &&
git update-ref refs/pr-kit/original-tree "$(git rev-parse --verify refs/pr-kit/original-head^{tree})"

# cross-repo (fork) PR — fetch from the fork instead. `nameWithOwner` carries
# both halves; `headRepositoryOwner` is an object, and the fork may be renamed.
git fetch "https://github.com/<headRepository.nameWithOwner>.git" <headRefName> &&
git update-ref refs/pr-kit/original-head "$(git rev-parse --verify FETCH_HEAD)" &&
git update-ref refs/pr-kit/original-tree "$(git rev-parse --verify refs/pr-kit/original-head^{tree})"
```

Then put yourself on the commit you just captured. `git fetch` writes `FETCH_HEAD` and moves nothing else, so after the fork block you are still on whatever branch you started on — and for a PR resolved by number that is not the PR's head at all:

```bash
git checkout --detach refs/pr-kit/original-head
```

This is also what makes "push the exact `HEAD` you verified" true rather than assumed, and it covers the same-repo path when the local branch is stale or absent.

Write those refs **once per run**, from `origin/<headRefName>` or `FETCH_HEAD` immediately after a successful fetch — never from `HEAD` or a local branch, which records the rewrite you are trying to check rather than the baseline. If a run aborts, clear them and start from a fresh fetch:

```bash
git update-ref -d refs/pr-kit/original-tree; git update-ref -d refs/pr-kit/original-head
```

A good commit grouping follows dependency order: schema/storage or generated API defs → core logic → wiring/integration → UI/surface → tests.

After rewriting, **verify the tree is byte-identical** — the whole point is that history changed but code did not:

```bash
o=$(git rev-parse --verify refs/pr-kit/original-tree^{tree}) &&
h=$(git rev-parse --verify HEAD^{tree}) &&
[ -n "$o" ] && [ "$o" = "$h" ] && echo "TREES MATCH $o"
```

**Do not push unless you see the literal line `TREES MATCH <sha>`.** A silent exit 0 is a failure, not a pass. Comparing two command substitutions directly — `test "$(git …)" = "$(git …)"` — passes when *both* are empty, and command substitution throws away git's exit code, so a git that is absent, shimmed, broken, or run outside a repository produces `"" = ""`, exit 0, and no output at all. That is byte-identical to a genuine pass, and this harness resets the working directory between calls. The `--verify` flags and the `&&` chain are what turn git's failure into the guard's; `[ -n "$o" ]` is the backstop; the printed token is what you actually check.

If it does not print, **do not push** — either the rewrite changed code, or the check could not run. Both mean stop. To see what moved, `git diff refs/pr-kit/original-tree HEAD --stat`; compare against the ref rather than `origin/<headRefName>`, which does not exist for a fork PR and may name an unrelated branch in the base repo.

Delete both refs once the push lands: `git update-ref -d refs/pr-kit/original-tree; git update-ref -d refs/pr-kit/original-head`.

Only force-push after the tree check passes and the user has approved. Push the exact `HEAD` you verified — not a local branch name, which may be stale or absent — to the PR's **head** remote. For a PR from a fork that is the fork, not `origin`: pushing to `origin` targets the base repo and either fails or creates a stray same-named branch there while leaving the PR untouched. Add the fork remote only if you own it or `maintainerCanModify` is true. If you can't push to the head repo, stop and tell the user — don't rewrite history you can't publish.

State the lease explicitly, against the head you recorded before rewriting. The bare `--force-with-lease` reads a remote-tracking ref, which a freshly added fork remote does not have — it is then rejected as `stale info` even though nothing is wrong. The explicit form carries the expected value itself, so it works for a fork and still refuses when the remote moved.

```bash
# same-repo PR
git push --force-with-lease="<headRefName>:$(git rev-parse --verify refs/pr-kit/original-head)" \
  origin HEAD:refs/heads/<headRefName>

# cross-repo PR — name the remote per PR, and confirm where it points before
# pushing. `git remote add` fails with exit 3 when the name is already taken,
# and the push then goes to whatever repository the leftover name refers to.
git remote remove pr-kit-head-<number> 2>/dev/null || true
git remote add pr-kit-head-<number> "https://github.com/<headRepository.nameWithOwner>.git" &&
git remote get-url pr-kit-head-<number>
git push --force-with-lease="<headRefName>:$(git rev-parse --verify refs/pr-kit/original-head)" \
  pr-kit-head-<number> HEAD:refs/heads/<headRefName>
```

Read the `get-url` output before the push: it must be the fork from `headRepository.nameWithOwner`. A remote name left over from an earlier run on a different PR redirects the force-push into that repository, with a valid lease and an exit 0, while the PR you are working on goes untouched.

Use `--force-with-lease`, never `--force`. **If it is rejected as `stale info`, someone pushed to the PR while you were rewriting — stop.** Do not fetch and retry: that refreshes the lease to include their commit and then overwrites it, which is `--force` by another route. Tell the user what landed, and let them decide whether to rebase onto it or abandon the rewrite. Your tree check is also stale at that point, because it compares against the snapshot you took before their push.

## When the PR is just too big

If a diff can't be made reviewable with notes and grouping — too many concerns in one PR — say so and **recommend splitting** it. Polishing the description around a 2,000-line multi-concern PR doesn't make it reviewable; it hides the problem.

## Output

```text
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
