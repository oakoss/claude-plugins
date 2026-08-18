---
name: review
description: Run the full automated code review cycle on uncommitted changes. First brings the tree to the project's canonical state (its own format/lint/typecheck). Scales the fan-out to the diff tier (light diffs — docs-only or ~25 changed lines or fewer — get code-reviewer and a 2-iteration cap; the rest get the full conditional fan-out, max 4). Adds a Codex review leg when the Codex CLI is installed — at reduced reasoning effort on light diffs — and runs Claude-only when it isn't. Applies fixes inline per the embedded policies, self-verifies mechanical fixes instead of re-fanning-out, then runs the report-only reviewers (structural maintainability and spec conformance) and cleanup once against the final state. Updates the review sentinel on completion. Does NOT commit.
argument-hint: "[against <ref>] [max <n>]"
allowed-tools: Bash, Read, Edit, Write, MultiEdit, Glob, Grep, Agent, SendMessage, AskUserQuestion, Skill
---

# Review cycle

Automated multi-agent review cycle on uncommitted changes. Invoke manually with `/review-cycle:review` or via the Stop hook when uncommitted-and-unreviewed changes exist.

## Embedded policies

The following two policies apply throughout this cycle. Standalone copies live in `${CLAUDE_PLUGIN_ROOT}/reference/policies.md` if you want them active outside this cycle (paste into `~/.claude/CLAUDE.md` for global scope or `./CLAUDE.md` for project scope).

### Comment policy

Comments are useful when they add value. Keep them clean and minimal.

A good comment:

- Is accurate (matches the code; remove if stale)
- Earns its place (explains WHY or non-obvious context, not WHAT)
- Is concise (one or two lines unless documenting a complex invariant)

Avoid:

- Restating what the code does
- Section markers like `// ===== HELPERS =====`
- Hedge words, apologies, "obviously", "basically", "just"
- "Note:" / "Important:" prefixes when surrounding text already conveys importance
- TODOs without ticket references
- Cross-references that belong in the PR description ("added for X", "used by Y")
- Comments narrating change history ("previously", "no longer", "as it did before the refactor") — state the current invariant; the story belongs in the commit message
- Multi-line comments on trivial code
- AI-flavored phrasings ("Here we...", "Let's...", "This...")

When in doubt: keep the comment, but make it tighter. A review pass must never make a comment longer — explaining the previous version of a comment is accretion, not review.

### Fix-vs-defer policy

Default to fixing inline. Defer to a follow-up only if:

- The fix is substantially more work than writing the follow-up itself
- The fix requires architectural changes spanning files outside this PR scope
- The fix requires a new dependency or schema migration not in this PR
- The fix would invalidate unrelated tests

If you can describe the fix in one sentence, just do the fix.

## Argument parsing

`$ARGUMENTS` is free-form natural language — there are no flags. Read intent from it:

- **A base ref to scope against** — phrases like `against main`, `since v1.2`, or a bare ref / branch / tag / SHA → review `git diff <ref>..HEAD` instead of the default `git diff HEAD`.
- **An iteration cap** — `max 6`, `6 iterations`, or a bare integer → use it as the max iteration count, overriding the tier default (4 for the full tier, 2 for light; see Phase 1).
- **Empty** → defaults: the uncommitted working tree, tier-default iteration cap.

If a token is ambiguous, treat a ref-like string as the base and a bare integer as the iteration cap. Parse before starting the cycle.

## Cycle phases

### Phase 1: Preflight

Resolve the project root and verify the working state:

```bash
git rev-parse --is-inside-work-tree
git rev-parse --show-toplevel
```

Run the second command bare, not captured into a variable — the printed path is the `<PROJECT_ROOT>` value later phases substitute into prompts and commands, and a shell assignment neither survives to those calls nor lands in the transcript where you can read it.

If not in a git repo, print a clear error and stop.

Check for changes:

```bash
git status --porcelain --untracked-files=all
```

If empty, report "nothing to review" and stop.

**Classify the diff into a tier.** List the changed paths in scope (the working tree by default, `<ref>..HEAD` when a base was given) and pick one:

- **light** — every changed path is prose or inert metadata (`*.md`, `*.txt`, `*.rst`, `docs/`, `LICENSE*`, `NOTICE`, `CHANGELOG*`), OR the entire diff is ~25 changed lines or fewer regardless of file type — a two-line `.gitignore` fix does not need the full apparatus. Reduced: fan-out is `code-reviewer` plus Codex when available, default iteration cap 2 (an explicit user `max` still wins), and the Codex leg may run at reduced reasoning effort (Phase 3 checks the configured value first).
- **full** — anything else. Full conditional fan-out, default cap 4, Codex at the user's configured effort.

The tier decides fan-out, iteration cap, and whether Codex's effort is capped. Cleanup mode (Phase 7) is a separate, purely size-based decision — a docs-only diff can be huge, and huge prose is exactly where the cleanup agent pays for itself.

The tier is decided once, here, and named in the final summary — do not re-derive it per phase.

**Probe the Codex leg.** Codex is one of two review legs, not a prerequisite. Where it is available the cycle uses it; where it isn't (CI, a teammate without it) the cycle runs Claude-only rather than stopping.

```bash
codex --version 2>&1; echo "version-exit=$?"
codex login status 2>&1; echo "login-exit=$?"
```

**`codex --version` alone decides participation**, and its exit code decides the reason. Read the code, not just success-or-failure:

- **0** → leg status `eligible`; the leg runs. (`participated` is a Phase 3 *outcome*, not this — see below.)
- **127, or `command not found`** → `skipped (not installed)`. Expected where Codex isn't deployed; not an error.
- **any other nonzero** → `skipped (codex present but unusable: <first line of stderr>)`. A broken install, a non-executable file, a `$PATH` this shell can't see. Reporting these as "not installed" sends the user to `npm install -g` for something already installed — quote what actually happened instead.

**`codex login status` is advisory, never a gate**, and it has three outcomes, not two. It reports only on a *stored* session, so it exits nonzero with `Not logged in` whenever Codex is authenticated by environment variable (`OPENAI_API_KEY` and friends) with no login on disk — the standard CI setup, and exactly the environment an optional Codex leg exists to serve. Record which of these applies:

- exit 0 → auth `confirmed`
- reports not logged in → auth `no stored session`
- the subcommand is unrecognized (an older CLI) → auth `unknown (probe unsupported)`

The third is not the second. Telling someone to run `codex login` when the probe simply doesn't exist on their CLI sends them to fix something that isn't broken.

**Write all of this into the Phase 9 summary draft now, not at Phase 9.** Open the draft here with the tier, the leg status, and the auth state — and add the Codex effort once Phase 3 decides it — updating the draft as the cycle proceeds. The loop ends turns and re-wakes across up to four iterations, and none of these facts is re-derivable later without re-running the probe.

Never stop the cycle over an absent Codex, and never let its absence go unmentioned — a review at half coverage must be visible in the summary.

### Phase 2: Canonicalize the working tree

Before reviewing, bring the tree to the project's canonical state so reviewers see clean code and the marked state matches what the commit-time hooks produce. Otherwise a pre-commit formatter re-runs at commit, restaging or stranding changes the gate reads as fresh unreviewed drift and forcing a needless second review.

**Use the project's own checks — don't invent commands.** Source them from context you most likely already have: `CLAUDE.md` / `AGENTS.md`, the pre-commit config (`lefthook.yml`, `.husky/`, `.pre-commit-config.yaml`), `package.json` scripts, a `justfile` / `Makefile` / `Taskfile.yml` / `mise.toml`, or the CI workflow. If none is discoverable, skip this phase and note "no project checks found" in the summary.

1. **Auto-fixers (mutating)** — formatters and `lint --fix`. Run them and keep the result, scoped to the changed fileset so unrelated files aren't swept into the diff. (If the project's convention is genuinely whole-tree, follow it.)
2. **Read-only checks** — typecheck and fast/affected tests. Fold any failures into the review findings; the fix-vs-defer policy applies. Do NOT run a slow full suite on every review — surface it as "run `<cmd>` before merging" instead.

Fail-open: a missing tool or a check that errors out is noted and skipped, never blocks the review.

### Phase 3: Fan-out (parallel)

First, on the loop's first iteration only, mark the cycle as in progress:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" cycle-start
```

While this marker is fresh, the Stop gate lets your turns end — so after spawning the reviewers you may simply end the turn and let their completion notifications re-wake you. Never busy-wait with sleep loops. The marker is cleared automatically by Phase 8's `mark`; if the cycle aborts before Phase 8 for any reason, run `"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" cycle-end` so the gate re-arms. Print an abbreviated status alongside it — tier, leg status, which reviewers had reported — because Phase 9 is the only thing that reports coverage, and an abort skips it entirely.

**Compose an intent brief first** — 2–4 sentences on what the change is trying to accomplish and why, plus the changed-file list. Source it from the conversation that produced the changes, or from the commit messages in `<ref>..HEAD` when reviewing against a base. Every reviewer gets it: a reviewer that knows the intent flags real deviations instead of guessing at purpose, and its findings need less relitigating. Do not editorialize about expected findings — state intent, not hoped-for verdicts.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — only when Phase 1 recorded the leg as `eligible`; skip this step entirely otherwise and fan out to the subagents alone. Direct CLI invocation, not the `/codex:review` slash command. Scope must match the subagents': `--uncommitted` for the default working-tree review, `--base <ref>` when the user gave a base. The scope flags reject a prompt argument (`error: the argument '--uncommitted' cannot be used with '[PROMPT]'`), so the intent brief rides a config override instead: `-c "developer_instructions=\"<brief>\""`.

   **Reshape the brief for the flag.** The `-c` value is parsed as TOML and the argument passes through one layer of shell quoting, so flatten the Phase 3 brief into a single line of plain prose with no double quotes, backslashes, backticks, or dollar signs — apostrophes are fine. Name files and identifiers bare rather than quoting them; the changed-file list stays, comma-separated.

   **Match the review's depth to the tier.** On the **full** tier pass no override at all and let the user's `~/.codex/config.toml` decide. The adjustment is one-directional by design — lower the effort on a trivial diff, never raise it on a large one. A user who set `medium` globally chose that.

   On the **light** tier, lower the effort *only when it would actually be lower*. Check what is configured first:

   ```bash
   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   ```

   Read the **root table only** — stop at the first `[section]` header. A plain grep also matches `model_reasoning_effort` keys inside `[profiles.*]`, so a root value of `minimal` alongside an unused profile value of `medium` would look like `medium` and get "lowered" to `low`, raising the effort the user is actually running at.

   The effort scale, ascending, is `none` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max` (the API rejects anything else, naming exactly this set). Append `-c model_reasoning_effort="low"` when the configured effort is above `low`, or when nothing is configured — the review model's own default sits at `low` or higher, so the override can only lower or no-op. When the configured value is already `low`, `minimal`, or `none`, **pass no override**: raising a user who deliberately chose `minimal` up to `low` would both break the one-directional rule and make a trivial diff cost more than a full-tier one.

   Record the effort actually passed — `low` or `inherited` — into the summary draft at the moment of the spawn. It is not recoverable from the tier later: two light-tier runs report differently depending on what was configured.

   Assemble the invocation from these parts:

   ```bash
   # full tier, working-tree scope (re-derive the root in this call — shell values
   # don't survive between Bash calls):
   cd "$(git rev-parse --show-toplevel)" && codex review --uncommitted -c "developer_instructions=\"<brief>\""
   # base scope: swap --uncommitted for --base <ref>
   # light tier: append -c model_reasoning_effort="low"
   ```

   ```js
   Bash({
     command: "<the invocation assembled above>",
     description: "Codex review",
     run_in_background: true
   })
   ```

   - Uses the `codex` CLI directly; no dependency on the codex Claude plugin
   - `developer_instructions` is additive, not a replacement: Codex still discovers the repo's `AGENTS.md`, and the brief arrives on top of it (marker-verified on v0.147.0 — one review summary carried markers planted in both)
   - The key is undocumented — absent from `codex review --help` but recognized by the config loader. Unrecognized `-c` keys are ignored without error, so a Codex version that drops the key degrades to an unbriefed review instead of breaking the leg. For the same reason, never add `--strict-config` to this invocation: it would turn that benign degradation into a hard failure
   - With `multi_agent = true` in `~/.codex/config.toml`, Codex spawns parallel review agents internally during a single review call — the effort setting applies to those internal agents too, so the light-tier reduction compounds across them
   - `-c` is the only per-invocation lever available: `codex review` has no `--model` or `--profile` flag (both exist on the top-level command, not this subcommand)
   - Tier on effort, never on model name. Model names churn — Codex records its own migrations under `[notice.model_migrations]` — and a name pinned here would rot into an error or a silent downgrade, on top of overriding a model the user picked deliberately.
   - For the effort override, emit the literal string `low` and nothing else. Codex does not validate `-c` values locally (a bogus effort passes straight into the session and fails at the API mid-review), so never interpolate an effort read from config, user input, or a model list.
   - Returns immediately with a bash shell ID; output streams to the task output file
   - Save the shell ID; you'll read its output later when notified of completion

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool with `run_in_background: true` in the same single message as the codex invocation. Dispatch by the tier decided in Phase 1 — on the **light** tier, spawn `review-cycle:code-reviewer` and nothing else. On the **full** tier, conditional dispatch:

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if the diff changes source code at all, whether or not it touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, or similar test paths. A source change that ships **no** corresponding test is precisely the case to flag, so do not gate this on test files being touched.
   - `review-cycle:silent-failure-hunter` — if diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if diff adds or modifies type declarations (interfaces, structs, classes, type aliases), OR introduces type-boundary smells anywhere (`any`, an un-narrowed `unknown`, `as` casts, non-null `!`, or newly optional fields/params)

   The **report-only** reviewers — `review-cycle:spec-conformance-analyzer` and `review-cycle:maintainability-auditor` — are deliberately **not** in this loop fan-out. They run once after the loop converges (Phase 7), against the final post-fix state. That keeps the expensive opus maintainability pass and the spec-discovery step from re-running on every iteration, and means their findings reflect exactly the code you'll commit rather than an intermediate state.

   Each spawn pattern:

   ```js
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "Code review of uncommitted changes",
     run_in_background: true,
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Intent: <brief>. Changed files: <list>. Output findings as file:line — severity — issue — suggested fix."
   })
   ```

   All applicable agents fire in parallel. Auto-notification on completion — do not poll.

   **Do not pass `name:` to these spawns** (see "Things to NOT do"). Address any nudge to the `agent_id` in the spawn result instead — that keeps `SendMessage` available without changing completion semantics.

The post-loop pass (Phase 7) runs the report-only reviewers and cleanup; none of those are part of this fan-out.

**Collecting results, with a stall watchdog.** Completion notifications arrive automatically — do not poll, and (with the in-progress marker set) end the turn rather than sleep while reviewers run. Background reviewers sometimes stall: they go idle without ever delivering a report. The watchdog is wake-driven — you cannot wait on a timer, so act on whatever wakes you (a completion, an idle notification, a user message):

- On any wake where a reviewer has gone idle without delivering, or has stayed silent while the other reviewers all completed, send it ONE nudge via `SendMessage`: deliver findings now, even if incomplete. Address the nudge to the `agent_id` from that reviewer's spawn result.
- If a nudged reviewer still hasn't reported by the next wake **that carries information about it**, proceed to Phase 4 without it and list it under "reviewers dropped (stalled)" in the final summary. Evidence means an idle or completion notification naming that reviewer, or — only when other Claude-side reviewers exist — all of them having since reported. A wake triggered by unrelated agents is not evidence; dropping on it discards a reviewer that may be mid-reply.
- **When it is the only Claude-side reviewer** (the light tier spawns `code-reviewer` alone), the set-relative test is vacuously true and must not be used: only that reviewer's own idle notification, or the user's next message, counts as evidence. Dropping it takes the entire Claude side of the review with it, so it gets the strictest reading.
- Never nudge the same reviewer twice, and never hold the whole cycle for a single straggler that has already been nudged.
- Residual: if the last outstanding reviewer stalls without even an idle notification, no wake arrives until the user's next message — that message is the wake; apply the rules then. Do not burn turns polling to avoid this case.

**A Codex leg that dies after launch is a failure, not a skip.** It passed the Phase 1 probe, so anything short of a usable report means something broke mid-run — a revoked session, a rate limit, a crash, or credentials that were never valid.

Read the status from the completion notification, which carries the shell's exit code — not from the output file, where a crashed run and a clean run look alike.

`participated` is the outcome recorded here, replacing Phase 1's `eligible`; it is never the precondition for launching the run that produces it.

Continue on the subagent findings either way, and report the leg in Phase 9 distinctly from the `skipped` cases — a skip is a known-shape environment, a failure is a regression worth looking at. Carry Phase 1's auth state into the message: `failed (<error> — no stored session, try codex login)` turns a puzzling failure into a one-command fix, while an auth state of `unknown` must never be dressed up as a login problem.

Proceed to Phase 4 when every reviewer has reported or been dropped under this policy.

### Phase 4: Aggregate findings

Collect findings from every reviewer:

- Codex output is structured: `verdict`, `summary`, `findings[]` each with `severity` (critical/high/medium/low), `file`, `line_start`, `line_end`, `confidence`, `recommendation`
- pr-review-toolkit output is markdown organized as Critical / Important / Suggestions / Strengths

Attribute each finding to its source. Group by file when presenting. Do not aggressively dedupe — if two reviewers flag the same line, merge them into one bullet with both sources listed.

This phase covers only the loop's auto-fix reviewers. The report-only reviewers (spec conformance, maintainability) run post-loop and are aggregated in Phase 7.

### Phase 5: Apply fixes per policy

For each finding, apply the fix-vs-defer policy:

- Default to fixing inline
- Defer only if a criterion above is met
- Critical and high severity findings should almost always be fixed inline; deferring a critical finding requires a strong, defensible justification

When fixing, follow the comment policy — do not add comments that restate the code or describe the fix itself.

Track fixed items and deferred items separately for the final summary. Do not auto-create beads or trekker tickets for deferred findings — just list them in the summary; the user decides.

Only the loop's auto-fix reviewers feed this phase. The report-only reviewers (spec conformance, maintainability) run after the loop (Phase 7); nothing they find is auto-applied.

### Phase 6: Verify fixes (self-check), then loop check

A full reviewer re-fan-out is only worth its wall-clock when this iteration's fixes could themselves have introduced problems. Verify cheaply first:

1. **Self-check every fix against the findings list.** Re-read each fixed site and confirm the finding is actually addressed — not merely edited near. Anything unaddressed gets fixed now, within this iteration.
2. **Verify facts introduced by fixes.** A fix that adds or rewords a factual claim — in prose, a comment, a doc, or a commit-message draft — gets the claim itself checked before proceeding: run the command it describes, read the code it characterizes, confirm the name or version it cites. Step 1 confirms the finding was addressed; this step confirms the fix didn't trade the finding for a false statement, which otherwise survives until the next fan-out catches it — or ships.
3. **Classify the iteration's fix churn:**
   - **Mechanical** — strictly non-semantic fixes confined to the flagged lines: typo/wording corrections, renames, removing dead code or a redundant comment, doc corrections. The self-check is sufficient verification.
   - **Substantive** — any fix that changes runtime behavior, however small: a new function, branch, or guard clause, a tightened condition, restructured control flow, edits beyond the flagged lines, or a fix where you chose among design alternatives. The self-check confirms the finding was addressed, not that the new behavior is right — behavior changes get re-reviewed.

Then decide:

- NO inline fixes applied (everything clean or correctly deferred) → exit loop.
- Only mechanical fixes, all self-checked → exit loop. Do NOT re-fan-out just to confirm fixes landed — that confirmation is exactly what the self-check provided.
- At least one substantive fix AND iteration count < max-iter → GOTO Phase 3, scoped: re-run Codex (when its leg is eligible) plus only the subagents whose domain the substantive fixes touched. A Codex leg that failed gets exactly one retry across the whole cycle; after a second failure stop launching it, since repeated attempts against a rate limit or a revoked session buy nothing. Report the union across iterations, and let any failure stick: `failed (iteration 1: <error>; recovered iteration 3)` rather than a bare `participated` — the iteration Codex missed is usually the one that had the findings.
- Iteration count == max-iter → exit loop with summary of remaining findings.

### Phase 7: Post-loop pass (report-only reviewers + cleanup)

The loop has converged. Run the report-only reviewers **once** here — against the final post-fix state — together with cleanup. Spawn all applicable agents in a single turn; they don't conflict (the reviewers only read; cleanup only edits comments/prose, which doesn't change a structural or spec verdict):

1. **`review-cycle:maintainability-auditor`** — if the diff includes non-trivial source-code changes (new or substantially reworked functions, modules, types, or logic). Skip it when the diff is only docs, config, version bumps, or a handful of trivial lines — its ambitious suggestions are noise on small changes.

2. **`review-cycle:spec-conformance-analyzer`** — if a spec source is discoverable: the diff's commits reference an issue/task ID, a spec or PRD file matches the branch/feature, or the user passed a spec path. If none exist, skip it and note "no spec source found" in the summary. The agent's current/unverified source rules still apply; an unverified source is caveated, not acted on.

3. **Cleanup** — comment policy + de-slopify, tier-dependent (below).

Running them here, once, is the whole point: the opus maintainability pass and the spec-discovery step execute a single time against the code you'll actually commit, instead of re-running on every loop iteration.

**Both reviewers are report-only.** Nothing they find is auto-applied and they do not re-open the loop:

- **maintainability-auditor** — speculative structural restructurings (delete a layer, split a file, reframe a state model): high-blast-radius, low-precision, never auto-apply. Surface them in the summary's "Structural suggestions" section; act on the ones you want by prompting afterward.
- **spec-conformance-analyzer** — missing/partial requirements, scope creep, and implemented-but-wrong: all surfaced for you to decide, quoting the spec line. "Did we build the right thing" is your call, so report rather than fix.

**Cleanup.** A separate agent spawn only earns its place on a diff big enough that loading the de-slopify methodology into your own context would be the greater cost:

- **diffs under ~150 changed lines, whatever the tier** — clean inline, yourself. Apply the embedded comment policy to comments you touched, and invoke `/review-cycle:de-slopify` via the Skill tool for the prose methodology, applying it to modified `.md` files and commit-message drafts. Same exclusions as the agent: never touch algorithm logic, type definitions, or test assertions.
- **~150 changed lines or more** — spawn the cleanup subagent (it has de-slopify preloaded via its `skills` frontmatter). Size, not tier, decides: a large docs-only diff is light-tier for fan-out but is exactly the prose volume the agent spawn is for:

  ```js
  Agent({
    subagent_type: "review-cycle:cleanup",
    description: "Final cleanup pass — comments + de-slopify",
    prompt: "Run cleanup on the current diff (post-fix state). Apply comment policy to modified code comments and de-slopify to prose surfaces. Do not touch algorithm logic, type definitions, or test assertions."
  })
  ```

  It edits files directly and returns a summary. Scope: comments in modified code, modified `.md` files, commit-message drafts. Excluded: algorithm logic, type definitions, test assertions.

### Phase 8: Update sentinel

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" mark
```

This is what allows the Stop hook and commit-gate to let the user commit. `mark` also clears the in-progress marker from Phase 3 and the Stop gate's blocked-state record. If the CLI exits nonzero (not in a git repo, sha256 tool missing), surface the error in the final summary — do not silently succeed, and run `cycle-end` so the Stop gate re-arms.

### Phase 9: Final summary

Print a structured summary:

```text
Review cycle complete.

Tier: light | full
Iterations: N / max
Codex leg: participated (effort: low | inherited) | skipped (<reason>) | failed (<error>)
  auth: confirmed | no stored session | unknown (probe unsupported)
Canonicalization: ran (<commands>) | partial (<tool> unavailable) | no project checks found
Reviewers dropped (stalled): none | <names, each nudged once before dropping>
Findings fixed inline: X
  - file:line — issue (source)
  - ...

Findings deferred: Y
  - file:line — issue (source)
    reason: <criterion from fix-vs-defer policy>
  - ...

Spec conformance (report-only): <spec source / no spec source found>
  - implemented but wrong: ...
  - missing/partial requirements: ...
  - scope creep (confirm intended): ...

Structural suggestions (report-only — prompt to address the ones you want):
  - file:line — suggestion (confidence: high/medium/speculative)
  - ... (or "maintainability-auditor not run — diff too small" / "none")

Final state: clean / N findings remain
```

### Phase 10: Stop

Do NOT run `git commit`. The user is the final reviewer before commit. The commit-gate hook will block a commit attempt anyway, but you should not attempt one regardless.

The Stop hook will see the sentinel now matches the current state and allow the turn to end naturally.

## Things to NOT do

- Do NOT run `git commit`. The user owns the commit decision.
- Do NOT let the Codex leg's status go unreported. Absent is fine and gets named; broken mid-run gets named louder.
- Do NOT pass `name:` when spawning any review subagent, in either the Phase 3 loop fan-out or the Phase 7 post-loop pass. A named background agent parks as `idle` awaiting messages instead of completing and returning its report, so its findings never arrive — and Phase 7 has no watchdog to notice.
- Do NOT auto-create beads or trekker tickets for deferred findings.
- Do NOT touch the opt-out marker (`.claude/.no-review-gate`) programmatically. The user controls it.
- Do NOT modify the sentinel except at Phase 8, after a complete successful cycle.
- Do NOT add comments to code while fixing. The comment policy applies to fix code, not just original code.
