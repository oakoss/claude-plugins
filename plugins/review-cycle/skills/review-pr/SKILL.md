---
name: review-pr
description: Review a GitHub pull request from your machine — report-only, single pass. Fetches the PR head into a disposable worktree (your checkout is never touched), runs the review cycle's reviewer fan-out in one pass (report-only reviewers included on the full tier) — Codex leg joining when the CLI is installed — with the intent brief sourced from the PR itself, and reports findings in the conversation with explicit coverage. Posts to the PR only when asked, as one COMMENT review with fingerprint-deduplicated comments. Never fixes code, never approves, never touches the review sentinel.
argument-hint: "<number | url | branch> [effort <level>] [and post]"
allowed-tools: Bash, Read, Write, Glob, Grep, Agent, SendMessage, AskUserQuestion
---

# Review a pull request

Single-pass, report-only review of a GitHub PR, run locally. It shares the review cycle's reviewer agents and tiering but none of its loop: no fixes, no iterations, no sentinel update. The deliverable is a findings report with explicit coverage — and, only when asked, a posted PR review.

## Embedded policy

The review cycle's **evidence policy** binds you here too, and binds you more tightly than it does there: what you write can be posted as a public comment on someone else's PR, with no fix loop and no author turn between your sentence and their inbox.

A claim about what a command does cites a run of that command. A manifest, config file, lockfile, script entry, CI workflow, or a project's own README says what someone configured or intended — never what the tool does with it. `doctest = false` in a Cargo manifest does not stop `cargo test --doc` from running the doctests — cargo compiles the crate and runs them anyway; the flag only removes them from plain `cargo test`. Quote what the command printed, not the file you read it from, and check that what you read came from the invocation you just made: a stale file, a redirect the shell refused, and a job that skipped all look like success from a distance.

The tool vendor's own documentation is the one exception, and the same one the working-tree cycle makes: where a command cannot run here but authoritative documentation specifies its behavior, that settles it — cite the documentation as the evidence. A project describing how it *uses* a tool is not the tool's documentation.

This applies to your own prose as much as to the reviewers' findings — the severity you assign, the summary you write, and every line you post. A claim you could exercise neither by running nor against authoritative documentation is asked as a question; it is never stated flatly on someone else's PR.

The cycle's comment and fix-vs-defer policies do not apply: this skill changes no code.

## Argument parsing

`$ARGUMENTS` is free-form natural language — no flags. Read intent from it:

- **Which PR** — a number (`42`), a full PR URL, or a head branch name; each is a valid selector for `gh pr view`. Empty → the PR associated with the current branch (`gh pr view` with no selector); if there is none, say so and stop.
- **Whether to post** — phrases like `and post`, `post the findings`, `comment on the PR` → post mode ON. Anything else → report in conversation only. Posting is the one outward-facing action here; it never happens by default.
- **A Codex effort** — `effort medium`, `codex effort high` → the Codex leg runs at exactly that effort on either tier, raising included. Valid values are the seven literals `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; anything else → name the invalid value, list the valid set, and stop.

`effort` and the seven level literals are never PR selectors, even though each is a plausible branch name: when they are the only tokens, the selector is empty (the current branch's PR). When an effort argument was parsed and the Codex leg resolves to `skipped`, say so before the fan-out and record `effort <level> requested, unused (codex skipped)` in the report — the argument affects only that leg, so a skip silently drops it.

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

**Classify the tier** from the changed files and `additions + deletions`, with the same rule as the review cycle: **light** when every changed path is prose or inert metadata (`*.md`, `*.txt`, `*.rst`, `docs/`, `LICENSE*`, `NOTICE`, `CHANGELOG*`) or the whole diff is ~25 changed lines or fewer; **full** otherwise. Markdown a tool loads as instructions tiers as code, wherever it lives: agent bodies, `SKILL.md`, commands, hook-owned markdown, `reference/` files a skill loads, and instruction files like `AGENTS.md` and `CLAUDE.md`. Under a plugin directory that leaves only `README.md`, `LICENSE*`, `CHANGELOG*`, `NOTICE`, and `tests/` as prose. The tier decides the fan-out and whether Codex's effort is capped. Decide once, name it in the report.

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

Carry the evidence rule into the brief, in one sentence: a claim about what a command does cites a run of that command, a manifest is not evidence for behavior, and a claim the leg could not exercise is labeled inferred rather than stated flatly. Carry the never-evade rule into the brief the same way: never reshape a command to slip past a guard — an opt-out is visible and reviewable, an evasion is neither. It matters more here than in the working-tree cycle — the PR head sits in a disposable worktree whose dependencies may not be installed, so a reviewer that cannot build has every reason to reason from manifests and no fix loop downstream to catch it.

Ask for the execution receipt in the same breath: every leg opens its report with two lines — `execution:` naming the heaviest verification that *succeeded* against this checkout with its first output line, or `none`; then `attempted-but-failed:` listing every verification that did not succeed, plus this project's build or test suite when the leg never attempted it, or `none`. Both lines are required, and an orientation command like `git status` on line one grades the same as `none`. The subagents carry this in their bodies; Codex does not, so the brief is the only channel that reaches it.

**The review scope is the merge-base diff**: `git diff <REMOTE>/<baseRefName>...HEAD` (three dots), matching what GitHub shows as the PR diff. A two-dot diff against the base *tip* would also show the inverse of everything merged since the PR branched, and reviewers would flag files the PR never touched.

For the Codex flag, **reshape the brief**: the `-c` value is parsed as TOML and passes through one layer of shell quoting, so flatten it to a single line of plain prose with no double quotes, backslashes, backticks, or dollar signs — apostrophes are fine. Name files and identifiers bare.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — only when Phase 1 recorded `eligible`:

   ```bash
   # full tier:
   cd <WT> && codex review --base "<REMOTE>/<baseRefName>" -c "developer_instructions=\"<brief>\""
   # explicit effort argument: append -c model_reasoning_effort="<validated literal>" on
   # either tier, raising included, and skip the tier logic below.
   # light tier: append -c model_reasoning_effort="low" — but only when that is actually
   # lower than the configured value; check the root table of ~/.codex/config.toml first:
   #   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   # The ladder is none < minimal < low < medium < high < xhigh < max. Append the override
   # when the configured effort is above low OR nothing is configured; pass NO override at
   # all (not the value none) when it is already low, minimal, or none — the tier
   # adjustment lowers, never raises; only the explicit effort argument outranks it.
   # Emit only exact-match literals from that ladder, never an unvalidated value.
   # Record low, inherited, or <level> (explicit) in the report draft at spawn time.
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
     prompt: "Review git diff <REMOTE>/<baseRefName>...HEAD (three dots — the merge-base diff, matching the PR as GitHub shows it) in <WT>, a detached worktree at PR #<n>'s head — run git commands there, not in the main checkout. Intent: <brief>. Changed files: <list>. REPORT-ONLY: do not edit any file in <WT> or in the main checkout — verification that has to run or perturb code goes in a private mktemp -d directory outside both, never a shared scratchpad, under the containment rule in your own prompt — and never reshape a command to slip past a guard. Name that directory in your report, and write nowhere outside it. Output findings as file:line — severity — issue — suggested fix."
   })
   ```

**Collecting results — wake-driven, single pass.** Completion notifications arrive automatically; do not poll, and end the turn while reviewers run. On any wake where a reviewer has gone idle without delivering — or stayed silent while every other reviewer completed — send it ONE `SendMessage` nudge (to the `agent_id` from its spawn result): deliver findings now, even if incomplete, opening with the two receipt lines. If it still hasn't reported by the next wake that carries information about it (its own idle or completion notification, or — only when other Claude-side reviewers exist — all of them having since reported), proceed without it and list it under dropped reviewers. When it is the only Claude-side reviewer (light tier), only its own notification or the user's next message counts as evidence. Never nudge twice; never hold the pass for a nudged straggler.

A Codex leg that dies after launch is a **failure**, not a skip — read the exit code from the completion notification, not the output file, and report it distinctly.

## Phase 4: Aggregate

Collect findings from every reviewer. Attribute each to its source, group by file, and do not aggressively dedupe — two reviewers flagging the same line merge into one bullet with both sources listed. Apply the review cycle's severity framing (critical/high/medium/low) when a source doesn't provide its own.

**The coverage floor is the point of this phase.** Every dispatched reviewer appears in the report with an outcome: `reported`, `skipped (<reason>)`, `failed (<error>)`, or `dropped (stalled, nudged once)`. "No findings" and "nobody looked" must never read the same: if any dispatched leg is `failed` or `dropped`, the verdict says `partial coverage` and never `clean`, regardless of how few findings arrived.

**Evidence grade survives aggregation.** A finding a reviewer labeled inferred keeps that label here and in the posted body — you are the last edit before it becomes a public comment on someone's PR, and this cycle has no fix loop and no author turn to catch a claim that arrives stripped of its caveat. A finding whose only support is a manifest, a config file, or a script entry is posted as a question, not as a finding: reading a declaration is not evidence for what the tool does with it. This is deliberately broader than the working-tree cycle, and the difference is the class of claim rather than the leg: there, demotion covers claims about external tool behavior; here it covers any finding whose only support is a declaration, because the finding leaves as a public comment with no fix loop and no author turn behind it. Neither is gated on the leg's grade. A leg that could not build says so in the report by name, rather than contributing a short findings list that reads as a clean file.

**Grade each leg that reported, from its two receipt lines.**

A *verification* is a command that exercises this project — its build, test suite, typecheck, linter, schema or manifest validator, or a repro the leg's findings rest on. Reading commands (`git status`, `git diff`, `ls`, `cat`, `find`, `grep`, `rg`) are not verifications: they succeed on a machine where nothing else does.

If either receipt line is absent, or present with nothing after it, the leg is `unknown`. Otherwise read two facts off the receipt:

| line one names a verification that succeeded | `attempted-but-failed:` | label |
| --- | --- | --- |
| yes | `none` | `executed` |
| yes | anything else | `partial (<what was unreachable>)` |
| no | — | `static-analysis-only` |

`execution: none`, a line one naming no verification, and one naming a verification that failed are the same row — a receipt quoting a compile error is `static-analysis-only`, never `executed`. A category the leg says it could not exercise at all also makes it `partial`; a claim it labelled `inferred` does not, since that reflects a budget spent elsewhere and naming what you inferred must never cost the grade a silent leg keeps.

A leg that was skipped, failed, or dropped carries no execution label — its coverage outcome already says why, and calling it `unknown` would blur "we cannot tell what it did" into "it never ran".

The receipt narrows what a leg can quietly omit; it does not verify. Nothing checks the quoted output against a real run, and `partial` rests on the leg volunteering what it could not reach — which matters more here than in the working-tree cycle, since a finding leaves this skill as a public comment with no fix loop behind it. Demote one narrow class to questions, keyed on the claim's evidence rather than the leg's grade: a claim about how an external tool, framework, or service behaves whose only support is a manifest, config file, lockfile, or CI file. A leg that got one unrelated check to pass is not thereby a witness to this one. A `partial` leg's claims about the category it named unreachable are demoted too. An `unknown` leg is not demoted for the missing receipt alone — a formatting miss is not evidence of incapacity — but omission must not beat candour: if anything else in the report says the leg could not run the checks, demote it exactly as `static-analysis-only`. Claims about what the changed code itself does are read from the source and stand, whatever the leg could run.

## Phase 5: Report

Always deliver the report in conversation, whether or not posting was requested:

```text
PR #<n> review — <title>  [draft]
<url>
Tier: light | full
Coverage:
  codex — participated (effort: low | inherited | <level> (explicit)) | skipped (<reason>[; effort <level> requested, unused]) | failed (<error>)
    auth: confirmed | no stored session | unknown (probe unsupported)
  code-reviewer — reported | dropped (stalled, nudged once)
  <each other dispatched reviewer — reported | skipped (<reason>) | failed | dropped>
Leg execution: all executed | no leg reported | <leg> = partial (<what>) / static-analysis-only (<observed cause>) / unknown — naming only legs that were not `executed`

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
