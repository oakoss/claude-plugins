---
name: review
description: Run the full automated code review cycle on uncommitted changes. First brings the tree to the project's canonical state (its own format/lint/typecheck). Scales the fan-out to the diff tier (light diffs — docs-only or ~25 changed lines or fewer — get Codex + code-reviewer and a 2-iteration cap; the rest get the full conditional fan-out, max 4). Applies fixes inline per the embedded policies, self-verifies mechanical fixes instead of re-fanning-out, then runs the report-only reviewers (structural maintainability and spec conformance) and cleanup once against the final state. Updates the review sentinel on completion. Does NOT commit.
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
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

If not in a git repo, print a clear error and stop.

Check for changes:

```bash
git status --porcelain --untracked-files=all
```

If empty, report "nothing to review" and stop.

**Classify the diff into a tier.** List the changed paths in scope (the working tree by default, `<ref>..HEAD` when a base was given) and pick one:

- **light** — every changed path is prose or inert metadata (`*.md`, `*.txt`, `*.rst`, `docs/`, `LICENSE*`, `NOTICE`, `CHANGELOG*`), OR the entire diff is ~25 changed lines or fewer regardless of file type — a two-line `.gitignore` fix does not need the full apparatus. Reduced: fan-out is Codex + `code-reviewer` only, default iteration cap 2 (an explicit user `max` still wins).
- **full** — anything else. Full conditional fan-out, default cap 4.

The tier decides fan-out and iteration cap only. Cleanup mode (Phase 7) is a separate, purely size-based decision — a docs-only diff can be huge, and huge prose is exactly where the cleanup agent pays for itself.

The tier is decided once, here, and named in the final summary — do not re-derive it per phase.

Verify Codex CLI is available:

```bash
codex --version
```

If the command fails or codex is unauthenticated, surface the error and stop — do not silently skip it.

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

While this marker is fresh, the Stop gate lets your turns end — so after spawning the reviewers you may simply end the turn and let their completion notifications re-wake you. Never busy-wait with sleep loops. The marker is cleared automatically by Phase 8's `mark`; if the cycle aborts before Phase 8 for any reason, run `"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" cycle-end` so the gate re-arms.

**Compose an intent brief first** — 2–4 sentences on what the change is trying to accomplish and why, plus the changed-file list. Source it from the conversation that produced the changes, or from the commit messages in `<ref>..HEAD` when reviewing against a base. Every reviewer gets it: a reviewer that knows the intent flags real deviations instead of guessing at purpose, and its findings need less relitigating. Do not editorialize about expected findings — state intent, not hoped-for verdicts.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — direct CLI invocation, not the `/codex:review` slash command. Scope must match the subagents': `--uncommitted` for the default working-tree review, `--base <ref>` when the user gave a base. The scope flags reject a prompt argument (`error: the argument '--uncommitted' cannot be used with '[PROMPT]'`), so the intent brief goes to the subagents only — do not pass it to Codex:

   ```
   Bash({
     command: "cd \"$PROJECT_ROOT\" && codex review --uncommitted",   // or: codex review --base <ref>
     description: "Codex review",
     run_in_background: true
   })
   ```

   - Uses the `codex` CLI directly; no dependency on the codex Claude plugin
   - The user has `multi_agent = true` enabled in `~/.codex/config.toml`, so Codex spawns parallel review agents internally during a single review call
   - Returns immediately with a bash shell ID; output streams to the task output file
   - Save the shell ID; you'll read its output later when notified of completion

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool with `run_in_background: true` in the same single message as the codex invocation. Dispatch by the tier decided in Phase 1 — on the **light** tier, spawn `review-cycle:code-reviewer` and nothing else. On the **full** tier, conditional dispatch:

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if the diff changes source code at all, whether or not it touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, or similar test paths. A source change that ships **no** corresponding test is precisely the case to flag, so do not gate this on test files being touched.
   - `review-cycle:silent-failure-hunter` — if diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if diff adds or modifies type declarations (interfaces, structs, classes, type aliases), OR introduces type-boundary smells anywhere (`any`, an un-narrowed `unknown`, `as` casts, non-null `!`, or newly optional fields/params)

   The **report-only** reviewers — `review-cycle:spec-conformance-analyzer` and `review-cycle:maintainability-auditor` — are deliberately **not** in this loop fan-out. They run once after the loop converges (Phase 7), against the final post-fix state. That keeps the expensive opus maintainability pass and the spec-discovery step from re-running on every iteration, and means their findings reflect exactly the code you'll commit rather than an intermediate state.

   Each spawn pattern:

   ```
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "Code review of uncommitted changes",
     run_in_background: true,
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Intent: <brief>. Changed files: <list>. Output findings as file:line — severity — issue — suggested fix."
   })
   ```

   All applicable agents fire in parallel. Auto-notification on completion — do not poll.

The post-loop pass (Phase 7) runs the report-only reviewers and cleanup; none of those are part of this fan-out.

**Collecting results, with a stall watchdog.** Completion notifications arrive automatically — do not poll, and (with the in-progress marker set) end the turn rather than sleep while reviewers run. Background reviewers sometimes stall: they go idle without ever delivering a report. The watchdog is wake-driven — you cannot wait on a timer, so act on whatever wakes you (a completion, an idle notification, a user message):

- On any wake where a reviewer has gone idle without delivering, or has stayed silent while the other reviewers all completed, send it ONE nudge via `SendMessage`: deliver findings now, even if incomplete.
- If a nudged reviewer still hasn't reported by the next wake, proceed to Phase 4 without it and list it under "reviewers dropped (stalled)" in the final summary.
- Never nudge the same reviewer twice, and never hold the whole cycle for a single straggler that has already been nudged.
- Residual: if the last outstanding reviewer stalls without even an idle notification, no wake arrives until the user's next message — that message is the wake; apply the rules then. Do not burn turns polling to avoid this case.

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
2. **Classify the iteration's fix churn:**
   - **Mechanical** — strictly non-semantic fixes confined to the flagged lines: typo/wording corrections, renames, removing dead code or a redundant comment, doc corrections. The self-check is sufficient verification.
   - **Substantive** — any fix that changes runtime behavior, however small: a new function, branch, or guard clause, a tightened condition, restructured control flow, edits beyond the flagged lines, or a fix where you chose among design alternatives. The self-check confirms the finding was addressed, not that the new behavior is right — behavior changes get re-reviewed.

Then decide:

- NO inline fixes applied (everything clean or correctly deferred) → exit loop.
- Only mechanical fixes, all self-checked → exit loop. Do NOT re-fan-out just to confirm fixes landed — that confirmation is exactly what the self-check provided.
- At least one substantive fix AND iteration count < max-iter → GOTO Phase 3, scoped: re-run Codex plus only the subagents whose domain the substantive fixes touched.
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

  ```
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

```
Review cycle complete.

Tier: light | full
Iterations: N / max
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
- Do NOT silently skip Codex if it fails. Surface the error.
- Do NOT auto-create beads or trekker tickets for deferred findings.
- Do NOT touch the opt-out marker (`.claude/.no-review-gate`) programmatically. The user controls it.
- Do NOT modify the sentinel except at Phase 8, after a complete successful cycle.
- Do NOT add comments to code while fixing. The comment policy applies to fix code, not just original code.
