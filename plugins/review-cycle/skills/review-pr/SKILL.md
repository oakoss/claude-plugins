---
name: review-pr
description: Review a GitHub pull request from your machine — report-only, single pass. Fetches the PR head into a disposable worktree (your checkout is never touched), runs the review cycle's reviewer fan-out in one pass (report-only reviewers included on the full tier) — Codex leg joining when the CLI is installed — with the intent brief sourced from the PR itself, and reports findings in the conversation with explicit coverage. Posts to the PR only when asked, as one COMMENT review with fingerprint-deduplicated comments. Never fixes code, never approves, never touches the review sentinel.
argument-hint: "<number | url | branch> [and post]"
allowed-tools: Bash, Read, Write, Glob, Grep, Agent, SendMessage, AskUserQuestion
---

# Review a pull request

Single-pass, report-only review of a GitHub PR, run locally. It shares the review cycle's reviewer agents and tiering but none of its loop: no fixes, no iterations, no sentinel update. The deliverable is a findings report with explicit coverage — and, only when asked, a posted PR review.

## Argument parsing

`$ARGUMENTS` is free-form natural language — no flags. Read intent from it:

- **Which PR** — a number (`42`), a full PR URL, or a head branch name; each is a valid selector for `gh pr view`. Empty → the PR associated with the current branch (`gh pr view` with no selector); if there is none, say so and stop.
- **Whether to post** — phrases like `and post`, `post the findings`, `comment on the PR` → post mode ON. Anything else → report in conversation only. Posting is the one outward-facing action here; it never happens by default.

## Phase 1: Resolve the PR and plan

First, `gh auth status` — if it fails, report that `gh` is missing or unauthenticated and stop; nothing below works without it. Then:

```bash
gh pr view <selector> --json number,title,body,state,isDraft,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url
gh pr view <selector> --json commits --jq '.commits[].messageHeadline'
gh pr diff <selector> --name-only
```

- `state: MERGED` → report that and stop; reviewing a merged PR produces findings nobody can act on in place.
- `state: CLOSED` → say so and ask before proceeding.
- `isDraft: true` → proceed (the user pointed at it deliberately) and carry "draft" into the report header.

**Classify the tier** from the changed files and `additions + deletions`, with the same rule as the review cycle: **light** when every changed path is prose or inert metadata (`*.md`, `*.txt`, `*.rst`, `docs/`, `LICENSE*`, `NOTICE`, `CHANGELOG*`) or the whole diff is ~25 changed lines or fewer; **full** otherwise. The tier decides the fan-out and whether Codex's effort is capped. Decide once, name it in the report.

**Probe the Codex leg** — optional, exactly as in the review cycle:

```bash
codex --version 2>&1; echo "version-exit=$?"
codex login status 2>&1; echo "login-exit=$?"
```

`codex --version` exit 0 → leg `eligible`; exit 127 / `command not found` → `skipped (not installed)`; any other nonzero → `skipped (codex present but unusable: <first line of stderr>)`. `codex login status` is advisory, never a gate — it reports `Not logged in` for env-var auth, so record it as auth `confirmed` (exit 0), `no stored session` (reports not logged in), or `unknown (probe unsupported)` (subcommand unrecognized) and move on. Never stop over an absent Codex; never leave its status out of the report. `eligible` is a launch precondition, not an outcome: once the leg delivers, the report records `participated` (or `failed`) in its place.

**Record three literal values now** — each Bash call runs in a fresh shell, so shell variables never survive between calls; these are recorded once and substituted by you into every later command (the snippets below write them as `<...>` placeholders, never live variables):

- `<ROOT>` — `git rev-parse --show-toplevel`
- `<REMOTE>` — the remote whose URL matches the PR's base repo (`git remote -v`; usually `origin`)
- `<OWNER>/<REPO>` — parsed from the PR's `url` field (`https://github.com/<owner>/<repo>/pull/<n>`). This is the base repo that Phase 6's `gh api` calls target — for a fork PR it is not the fork.

Open the report draft now — PR, tier, leg status, auth state — and update it as phases complete. Turns end and re-wake while reviewers run; these facts are not re-derivable later without re-probing.

## Phase 2: Fetch the PR into a disposable worktree

Never `gh pr checkout` — it switches the user's working tree. The PR gets its own detached worktree; the user's checkout, branch, and index stay untouched.

Fetch first, and check for drift BEFORE any worktree exists:

```bash
git -C <ROOT> fetch <REMOTE> "+refs/heads/<baseRefName>:refs/remotes/<REMOTE>/<baseRefName>"
git -C <ROOT> fetch <REMOTE> "pull/<number>/head"     # FETCH_HEAD = the PR head, fork PRs included
git -C <ROOT> rev-parse FETCH_HEAD
```

The base fetch uses an explicit forced refspec because in single-branch or narrow-refspec clones a plain `git fetch <REMOTE> <branch>` succeeds without creating the remote-tracking ref, and the failure would surface two phases later as an unresolvable `<REMOTE>/<baseRefName>`. Fetch the base and the PR head in **two separate fetches** — a combined fetch leaves FETCH_HEAD ambiguous. If the printed FETCH_HEAD differs from Phase 1's `headRefOid`, the PR moved between commands: re-run `gh pr view`, fetch again, and compare again — the retry is free while no worktree exists yet.

Then create the worktree (`TMP` is used within the same call that sets it):

```bash
TMP=$(mktemp -d "${TMPDIR:-/tmp}/review-pr-<number>.XXXXXX")
git -C <ROOT> worktree add --detach "$TMP/wt" FETCH_HEAD
echo "TMP=$TMP"
```

**Record `<TMP>` (printed above) and `<WT>` = `<TMP>/wt` as literals alongside the Phase 1 values, and substitute them yourself into every later command.** A live `$WT` in a later call expands to nothing — and `cd ""` succeeds silently, leaving Codex to review whatever directory it happened to inherit. None of the `<...>` placeholders below is a shell variable.

Record `<WT>` in the report draft immediately, then mark a review as in progress so the Stop gate lets turns end while reviewers run in the background:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root <ROOT> pr-cycle-start
```

`pr-cycle-start`, not `cycle-start`: this skill reviews a PR head and never inspects the working tree, so its marker holds the Stop gate open without licensing `mark` over the user's local changes. `--root` is required on every sentinel call here: the binary otherwise resolves the project from the current directory, and after Phase 3's `cd <WT>` that would be the disposable worktree. **If the skill aborts at any point after this — any reason, any phase — run the Phase 7 cleanup before stopping**, so the worktree is removed and the gate re-arms; if cleanup itself is impossible, tell the user the `<TMP>` path and that `pr-cycle-end` still needs to run.

## Phase 3: Brief and fan-out (parallel)

**Compose the intent brief** — 2–4 sentences on what the PR is trying to accomplish and why, from its title, body, and commit subjects, plus the changed-file list. State intent, not hoped-for verdicts. Every reviewer gets it.

**The review scope is the merge-base diff**: `git diff <REMOTE>/<baseRefName>...HEAD` (three dots), matching what GitHub shows as the PR diff. A two-dot diff against the base *tip* would also show the inverse of everything merged since the PR branched, and reviewers would flag files the PR never touched.

For the Codex flag, **reshape the brief**: the `-c` value is parsed as TOML and passes through one layer of shell quoting, so flatten it to a single line of plain prose with no double quotes, backslashes, backticks, or dollar signs — apostrophes are fine. Name files and identifiers bare.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — only when Phase 1 recorded `eligible`:

   ```bash
   # full tier:
   cd <WT> && codex review --base "<REMOTE>/<baseRefName>" -c "developer_instructions=\"<brief>\""
   # light tier: append -c model_reasoning_effort="low" — but only when that is actually
   # lower than the configured value; check the root table of ~/.codex/config.toml first:
   #   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   # The ladder is none < minimal < low < medium < high < xhigh < max. Append the override
   # when the configured effort is above low OR nothing is configured; pass NO override at
   # all (not the value none) when it is already low, minimal, or none — the adjustment
   # lowers, never raises. Emit the literal string low, never an interpolated value.
   # Record low or inherited in the report draft at spawn time.
   ```

   Spawn via `Bash` with `run_in_background: true`; save the shell ID. The remote-tracking ref works as the base from a detached worktree, and `developer_instructions` is additive — Codex still discovers the repo's `AGENTS.md` (both verified on v0.147.0). Unrecognized `-c` keys are ignored without error, so a Codex that drops the key runs unbriefed instead of breaking; never add `--strict-config` to this invocation.

2. **Review subagents (parallel, background, no `name:`)** — all pointed at the worktree, all told they are report-only. Light tier spawns `review-cycle:code-reviewer` alone. Full tier dispatches conditionally:

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if the diff changes source code at all; a source change shipping no test is precisely the case to flag
   - `review-cycle:silent-failure-hunter` — if the diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if the diff adds or modifies type declarations, or introduces type-boundary smells (`any`, un-narrowed `unknown`, `as` casts, non-null `!`, newly optional fields/params)
   - `review-cycle:spec-conformance-analyzer` — if a spec source is discoverable: the PR body links an issue, commits reference a task ID, or a spec/PRD file matches the branch. Otherwise skip and note "no spec source found".
   - `review-cycle:maintainability-auditor` — if the diff includes non-trivial source changes; skip for docs, config, version bumps, or a handful of trivial lines.

   On the full tier the report-only pair runs in this same single fan-out — with no fix loop there is no intermediate state to shield them from. On the light tier they don't run at all, and the report says so.

   ```js
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "PR review",
     run_in_background: true,
     prompt: "Review git diff <REMOTE>/<baseRefName>...HEAD (three dots — the merge-base diff, matching the PR as GitHub shows it) in <WT>, a detached worktree at PR #<n>'s head — run git commands there, not in the main checkout. Intent: <brief>. Changed files: <list>. REPORT-ONLY: do not edit any file. Output findings as file:line — severity — issue — suggested fix."
   })
   ```

**Collecting results — wake-driven, single pass.** Completion notifications arrive automatically; do not poll, and end the turn while reviewers run. On any wake where a reviewer has gone idle without delivering — or stayed silent while every other reviewer completed — send it ONE `SendMessage` nudge (to the `agent_id` from its spawn result): deliver findings now, even if incomplete. If it still hasn't reported by the next wake that carries information about it (its own idle or completion notification, or — only when other Claude-side reviewers exist — all of them having since reported), proceed without it and list it under dropped reviewers. When it is the only Claude-side reviewer (light tier), only its own notification or the user's next message counts as evidence. Never nudge twice; never hold the pass for a nudged straggler.

A Codex leg that dies after launch is a **failure**, not a skip — read the exit code from the completion notification, not the output file, and report it distinctly.

## Phase 4: Aggregate

Collect findings from every reviewer. Attribute each to its source, group by file, and do not aggressively dedupe — two reviewers flagging the same line merge into one bullet with both sources listed. Apply the review cycle's severity framing (critical/high/medium/low) when a source doesn't provide its own.

**The coverage floor is the point of this phase.** Every dispatched reviewer appears in the report with an outcome: `reported`, `skipped (<reason>)`, `failed (<error>)`, or `dropped (stalled, nudged once)`. "No findings" and "nobody looked" must never read the same: if any dispatched leg is `failed` or `dropped`, the verdict says `partial coverage` and never `clean`, regardless of how few findings arrived.

## Phase 5: Report

Always deliver the report in conversation, whether or not posting was requested:

```text
PR #<n> review — <title>  [draft]
<url>
Tier: light | full
Coverage:
  codex — participated (effort: low | inherited) | skipped (<reason>) | failed (<error>)
    auth: confirmed | no stored session | unknown (probe unsupported)
  code-reviewer — reported | dropped (stalled, nudged once)
  <each other dispatched reviewer — reported | skipped (<reason>) | failed | dropped>

Findings: <count>
  - file:line — severity — issue — suggested fix (source)
  - ...

Spec conformance (report-only): <spec source | no spec source found | not run — light tier>
Structural suggestions (report-only): <items | not run — diff too small | not run — light tier>

Verdict: clean (full coverage) | <N> findings | partial coverage — not reviewable as clean
```

The worktree's fate isn't known yet — cleanup is Phase 7 — so the report gains its `Worktree:` line there, after cleanup actually runs.

## Phase 6: Post to the PR (only when asked)

Post only when the argument parse found post intent, or the user asks after seeing the report. Never post unprompted.

1. **Fetch existing markers** so re-runs don't duplicate — from BOTH endpoints, because inline comments and review bodies live in different places:

   ```bash
   gh api "repos/<OWNER>/<REPO>/pulls/<n>/comments" --paginate --jq '.[].body' | grep -o 'review-cycle:f:[0-9a-f]*'
   gh api "repos/<OWNER>/<REPO>/pulls/<n>/reviews"  --paginate --jq '.[].body' | grep -o 'review-cycle:f:[0-9a-f]*'
   ```

2. **Fingerprint each finding**: `sha256sum` (or `shasum -a 256` on macOS) over `<file>|<severity>|<claim with whitespace collapsed>`. Append `<!-- review-cycle:f:<hash> -->` to the finding's text — invisible when rendered. Skip any finding whose fingerprint already exists on the PR, wherever it appeared.

3. **Post one review, event `COMMENT`** — never `APPROVE` or `REQUEST_CHANGES`; the user owns verdicts. If nothing survived deduplication — every finding already on the PR, or none to begin with — post nothing and say so in conversation; the reviews API rejects an empty review. Inline comments only for findings on lines present in the PR diff (`path` + `line` + `side: RIGHT`); everything else — coverage, findings on unchanged lines, report-only sections — goes in the review body, each finding carrying its fingerprint. Build the JSON payload at `<TMP>/payload.json` — never in the user's repo, where an untracked file reads as unreviewed drift — and send it:

   ```bash
   gh api "repos/<OWNER>/<REPO>/pulls/<n>/reviews" --method POST --input <TMP>/payload.json
   ```

## Phase 7: Clean up (always)

Runs on every exit path — posted, report-only, or aborted anywhere after Phase 2:

```bash
git -C <ROOT> worktree remove --force <WT>
rm -rf <TMP>
git -C <ROOT> worktree prune
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root <ROOT> pr-cycle-end
```

`rm -rf <TMP>` also clears the mktemp parent and any payload file — `worktree remove` alone leaves both behind. `prune` runs last and ungated: it is the step that repairs a half-removed worktree, so it must not depend on `remove` succeeding. `pr-cycle-end`, never `mark`: this skill reviewed a PR head, not the user's working tree, so the sentinel and commit gate must be exactly as it found them.

Then finish the report with its last line: `Worktree: removed` — or, if removal failed, `Worktree: left behind at <TMP> — remove with: git -C <ROOT> worktree remove --force <WT>; rm -rf <TMP>; git -C <ROOT> worktree prune`.

## Things to NOT do

- Do NOT edit, fix, or reformat anything — in the worktree or the main checkout. Report-only means the tree hashes are identical before and after.
- Do NOT run `review-sentinel mark`, `accept-state`, or `seed`. Only `pr-cycle-start` and `pr-cycle-end`, always with `--root <ROOT>`, as written above. The unprefixed `cycle-start` is the review cycle's own marker and would license a `mark` over changes this skill never read.
- Do NOT run `gh pr checkout`, `git checkout`, or `git switch` in the user's working tree.
- Do NOT reuse `$ROOT`/`$WT`-style shell variables across Bash calls — substitute the recorded literal values; each call is a fresh shell.
- Do NOT post without an explicit ask, and never with event `APPROVE` or `REQUEST_CHANGES`.
- Do NOT pass `name:` when spawning review subagents — a named background agent parks as `idle` instead of returning its report.
- Do NOT print a clean verdict under partial coverage.
- Do NOT auto-create beads or trekker tickets for findings.
