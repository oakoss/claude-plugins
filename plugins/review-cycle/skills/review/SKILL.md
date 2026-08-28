---
name: review
description: Run the full automated code review cycle on uncommitted changes. First brings the tree to the project's canonical state (its own format/lint/typecheck). Scales the fan-out to the diff tier (light diffs — docs-only or ~25 changed lines or fewer — get code-reviewer and a 2-iteration cap; the rest get the full conditional fan-out, max 4). Adds a Codex review leg when the Codex CLI is installed — at reduced reasoning effort on light diffs — and runs Claude-only when it isn't. Applies fixes inline per the embedded policies, self-verifies mechanical and empirically-verified message fixes instead of re-fanning-out, then runs the report-only reviewers (structural maintainability and spec conformance) and cleanup once against the final state. Updates the review sentinel on completion. Does NOT commit.
argument-hint: "[against <ref>] [max <n>] [effort <level>]"
allowed-tools: Bash, Read, Edit, Write, MultiEdit, Glob, Grep, Agent, SendMessage, AskUserQuestion, Skill
---

# Review cycle

Automated multi-agent review cycle on uncommitted changes. Invoke manually with `/review-cycle:review` or via the Stop hook when uncommitted-and-unreviewed changes exist.

## Embedded policies

The following three policies apply throughout this cycle. Standalone copies live in `${CLAUDE_PLUGIN_ROOT}/reference/policies.md` if you want them active outside this cycle (paste into `~/.claude/CLAUDE.md` for global scope or `./CLAUDE.md` for project scope).

### Evidence policy

**A claim about what a command does cites a run of that command.** This binds everyone in the cycle — reviewers writing findings, and you writing fixes, prose, comments, and commit messages.

A manifest, config file, lockfile, script entry, CI workflow, or flag in documentation says what someone *configured* or *intended*. It does not say what the tool does with it, and the two disagree often enough that the gap is where wrong findings come from. `doctest = false` in a Cargo manifest does not stop `cargo test --doc` from running the doctests — cargo compiles the crate and runs them anyway, and the flag only removes them from plain `cargo test`. A `skip` in a workflow does not prove the job was skipped on this run, and a `package.json` script does not prove what the script does when invoked. **A declaration is never evidence for behavior.**

Three rules follow:

- **Run it, then quote what it printed.** Name the command and the observed output, not the file you read it from. Quote what the tool actually emits: "the test command printed `1..512` and 512 `ok` lines, no `not ok`" is evidence; "the suite covers this" is not, and neither is a tidy summary line the tool never printed.
- **A run you did not observe is not a run.** Read the output the command actually produced this time. A stale file, a redirect the shell refused, a cached artifact, or a job that skipped all look like success from a distance — check that what you are reading came from the invocation you just made.
- **When you cannot run it, say so in the finding.** A claim the environment cannot exercise — another OS, another shell, a remote service, a build past your budget — is labeled inferred rather than measured, or verified against authoritative documentation. Never state it flatly.

Two outcomes, decided in this order — the first that applies wins, so no claim qualifies for both:

1. **Could the run have happened here, given more time, a longer build, or a bigger sample?** Then the finding **keeps its place, labeled inferred**, and still reaches Phase 4. Budget is the reason you did not measure, not a reason to drop the finding.
2. **Otherwise — no run was possible at all and no authoritative documentation settles it** — the claim is not a low-confidence finding: it is a **question**, and belongs in the summary as one rather than in the findings list.

Rule 1 has priority. A claim you skipped for budget stays a finding even when nothing documents it; only a claim that was never runnable *here* reaches rule 2.

Withdrawing is not a way to be quiet. A leg that could not build and therefore withdrew everything reports no findings, which the summary would otherwise read as clean — so a leg in that position says it could not build, in the summary, by name.

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
- **A Codex effort** — `effort medium`, `codex effort high` → the Codex leg runs at exactly that effort on either tier, raising included (see Phase 3). Valid values are the seven literals `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Anything else → name the invalid value, list the valid set, and stop before the cycle starts — a silent fallback would run a long review at the wrong depth.
- **Empty** → defaults: the uncommitted working tree, tier-default iteration cap, tier-decided Codex effort.

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

**Scope to the unreviewed delta when one is known.** Before settling the tier, run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" delta
```

Exit 0 prints a name-status list, `--`, and a `delta: N files, +A -D` summary — exactly what changed since the last marked tree, untracked files included, unaffected by commits. Decide the tier from THAT (light when the delta is prose-only or ~25 lines or fewer), hand reviewers the delta's files as the changed-file list, and say in the brief that the rest of the diff matches the last reviewed state. Exit 3 means no marked tree exists (first review, or a pre-0.16 mark): scope to the full diff as above. Any other nonzero: full diff, and name the error in the summary. The delta is why a 20-line follow-up to a converged review gets a small review instead of a full re-run.

The tier and scope are decided once, here, and named in the final summary — do not re-derive them per phase.

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

Never stop the cycle over an absent Codex, and never let its absence go unmentioned — a review at half coverage must be visible in the summary. When an explicit `effort` argument was parsed and the leg resolves to `skipped`, say so before the fan-out and record `effort <level> requested, unused (codex skipped)` in the draft: the argument affects only the Codex leg, so a skipped leg silently drops a request the user made deliberately.

### Phase 2: Canonicalize the working tree

Before reviewing, bring the tree to the project's canonical state so reviewers see clean code and the marked state matches what the commit-time hooks produce. Otherwise a pre-commit formatter re-runs at commit, restaging or stranding changes the gate reads as fresh unreviewed drift and forcing a needless second review.

**Use the project's own checks — don't invent commands.** Source them from context you most likely already have: `CLAUDE.md` / `AGENTS.md`, the pre-commit config (`lefthook.yml`, `.husky/`, `.pre-commit-config.yaml`), `package.json` scripts, a `justfile` / `Makefile` / `Taskfile.yml` / `mise.toml`, or the CI workflow. If none is discoverable, skip this phase and note "no project checks found" in the summary.

1. **Auto-fixers (mutating)** — formatters and `lint --fix`. Run them and keep the result, scoped to the changed fileset so unrelated files aren't swept into the diff. (If the project's convention is genuinely whole-tree, follow it.)
2. **Read-only checks** — typecheck and fast/affected tests. Fold any failures into the review findings; the fix-vs-defer policy applies. Do NOT run a slow full suite on every review — surface it as "run `<cmd>` before merging" instead.

Fail-open: a missing tool or a check that errors out is noted and skipped, never blocks the review.

### Phase 3: Fan-out (parallel)

First, at the top of every iteration, mark the cycle as in progress:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" cycle-start
```

This marker is also what licenses Phase 8's `mark`, so it is not optional — skip it and the cycle cannot record its own result. Re-running it each iteration is deliberate: the marker carries a timestamp, both reapers retire it after 60 minutes, and a cycle that reviews for longer than that would otherwise outlive its own license and fail Phase 8. Refreshing it on each pass keeps a cycle that is still working licensed while one that died still expires on schedule. This is not the same as re-running it *after* `mark` has already refused — that recreates evidence for a cycle that is over, and Phase 8 says not to. **If `cycle-start` exits nonzero, report it and stop before spawning reviewers**: it can only fail on a filesystem problem (exit 2: `.claude` uncreatable or unwritable), and running the full cycle anyway means burning it to reach a Phase 8 that cannot record anything, where the exit-3 message reads as a TTL reap rather than the disk error it is. While it is fresh, the Stop gate lets your turns end, so after spawning the reviewers you may simply end the turn and let their completion notifications re-wake you. Never busy-wait with sleep loops. The marker is cleared automatically by Phase 8's `mark`; if the cycle aborts before Phase 8 for any reason, run `"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" cycle-end` so the gate re-arms. Print an abbreviated status alongside it — tier, leg status, which reviewers had reported — because Phase 9 is the only thing that reports coverage, and an abort skips it entirely.

**Snapshot the target before spawning anything.** The reviewers run techniques that perturb code — on a copy, per their own rule — and an agent that contaminated the target is the worst available witness that it didn't. Capture the state here, once, rather than asking each leg to attest to itself:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" current-hash
git config --local --list
```

Record both outputs verbatim into the Phase 9 summary draft as you take them — the loop ends turns between here and Phase 4, and a baseline you have to remember is one you will compare against badly. Write any snapshot file outside the repository; a scratch file inside it reads as unreviewed drift and changes the hash you are trying to hold still.

Re-run both in Phase 4 before aggregating and compare. `current-hash` covers content, staging, and commits; a `git status` comparison does not, since an empty commit leaves porcelain identical and only the anchor line moves. The config listing covers a repository-local identity, which the hash never reads and which mis-authors every later commit. What escapes both: anything in the sentinel's exclude list (`.beads/**`, `.trekker/**`, editor directories, the user's `ignore` patterns) and anything under `.git/` other than HEAD — a worktree registration, a written hook, the stash. That residual is why reviewers work outside the repository rather than in a subdirectory of it.

If either differs, name the leg if you can identify it, report it in the summary, and do not mark the sentinel — a contaminated tree stamped as reviewed is worse than no review at all.

This covers the Phase 3 fan-out, including the Codex CLI, which carries no containment rule of its own. It does **not** cover Phase 7: that runs after the Phase 4 comparison, and one of its agents edits the target by design, so a snapshot there could not tell sanctioned cleanup from contamination. Phase 7 is uncovered, and the summary says so rather than implying otherwise.

**Compose an intent brief first** — 2–4 sentences on what the change is trying to accomplish and why, plus the changed-file list. Source it from the conversation that produced the changes, or from the commit messages in `<ref>..HEAD` when reviewing against a base. Every reviewer gets it: a reviewer that knows the intent flags real deviations instead of guessing at purpose, and its findings need less relitigating. Do not editorialize about expected findings — state intent, not hoped-for verdicts.

**Carry the evidence policy into the brief**, in one sentence: a claim about what a command does cites a run of that command, a manifest is not evidence for behavior, and a claim the leg could not exercise is labeled inferred rather than stated flatly. The bundled subagents carry this in their own bodies; Codex does not, and the brief is the only channel that reaches it. Carry the never-evade rule into the brief the same way: never reshape a command to slip past a guard — an opt-out is visible and reviewable, an evasion is neither.

**Ask for the execution receipt in the brief too.** Every leg opens its report with two lines: `execution:` naming the heaviest verification that *succeeded* — build, test suite, typecheck, or the repro its findings rest on — with that command's first output line, or `none`; then `attempted-but-failed:` listing every verification that did not succeed, plus this project's build or test suite when the leg never attempted it, or `none`. Both lines are required, and an orientation command like `git status` on line one grades the same as `none`. Phase 4 grades the leg from those two lines. The subagents carry this in their bodies; Codex does not, so the brief is again the only channel that reaches it.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — only when Phase 1 recorded the leg as `eligible`; skip this step entirely otherwise and fan out to the subagents alone. Direct CLI invocation, not the `/codex:review` slash command. Scope must match the subagents': `--uncommitted` for the default working-tree review, `--base <ref>` when the user gave a base. The scope flags reject a prompt argument (`error: the argument '--uncommitted' cannot be used with '[PROMPT]'`), so the intent brief rides a config override instead: `-c "developer_instructions=\"<brief>\""`.

   **Reshape the brief for the flag.** The brief carries this leg's falsifiable question too (see step 2), under the same constraints. The `-c` value is parsed as TOML and the argument passes through one layer of shell quoting, so flatten the Phase 3 brief into a single line of plain prose with no double quotes, backslashes, backticks, or dollar signs — apostrophes are fine. Name files and identifiers bare rather than quoting them; the changed-file list stays, comma-separated.

   **An explicit effort argument wins over the tier.** When Argument parsing validated one, append `-c model_reasoning_effort="<that literal>"` on either tier, raising included — an explicit per-invocation argument is the user's choice exactly as the global config is. Everything in the rest of this depth section applies only when no effort argument was given.

   **Match the review's depth to the tier.** On the **full** tier pass no override at all and let the user's `~/.codex/config.toml` decide. The tier adjustment is one-directional by design — lower the effort on a trivial diff, never raise it on a large one. A user who set `medium` globally chose that; only an explicit effort argument outranks it.

   On the **light** tier, lower the effort *only when it would actually be lower*. Check what is configured first:

   ```bash
   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   ```

   Read the **root table only** — stop at the first `[section]` header. A plain grep also matches `model_reasoning_effort` keys inside `[profiles.*]`, so a root value of `minimal` alongside an unused profile value of `medium` would look like `medium` and get "lowered" to `low`, raising the effort the user is actually running at.

   The effort scale, ascending, is `none` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max` (the API rejects anything else, naming exactly this set). The CLI offers no local way to enumerate it — no help text, completion, or shipped schema names the values (checked on codex-cli 0.149.1) — so this documented set is what an invalid `effort` argument is validated against and shown alongside. Append `-c model_reasoning_effort="low"` when the configured effort is above `low`, or when nothing is configured — the review model's own default sits at `low` or higher, so the override can only lower or no-op. When the configured value is already `low`, `minimal`, or `none`, **pass no override**: raising a user who deliberately chose `minimal` up to `low` would both break the one-directional rule and make a trivial diff cost more than a full-tier one.

   Record the effort actually passed — `low`, `inherited`, or `<level> (explicit)` — into the summary draft at the moment of the spawn. It is not recoverable from the tier later: two light-tier runs report differently depending on what was configured.

   Assemble the invocation from these parts:

   ```bash
   # full tier, working-tree scope (re-derive the root in this call — shell values
   # don't survive between Bash calls):
   cd "$(git rev-parse --show-toplevel)" && codex review --uncommitted -c "developer_instructions=\"<brief>\""
   # base scope: swap --uncommitted for --base <ref>
   # light tier: append -c model_reasoning_effort="low"
   # explicit effort argument: append -c model_reasoning_effort="<validated literal>" on either tier
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
   - For the effort override, emit only a literal from the seven-value set, chosen by exact match: the tier path emits `low` and nothing else, and the argument path emits the validated argument. Codex does not validate `-c` values locally (a bogus effort passes straight into the session and fails at the API mid-review), so never pass a string that did not exact-match the set — not from config, free-form input, or a model list.
   - Returns immediately with a bash shell ID; output streams to the task output file
   - Save the shell ID; you'll read its output later when notified of completion

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool with `run_in_background: true` in the same single message as the codex invocation. Dispatch by the tier decided in Phase 1 — on the **light** tier, spawn `review-cycle:code-reviewer` and nothing else. On the **full** tier, conditional dispatch:

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if the diff changes source code at all, whether or not it touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, or similar test paths. A source change that ships **no** corresponding test is precisely the case to flag, so do not gate this on test files being touched.
   - `review-cycle:silent-failure-hunter` — if diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if diff adds or modifies type declarations (interfaces, structs, classes, type aliases), OR introduces type-boundary smells anywhere (`any`, an un-narrowed `unknown`, `as` casts, non-null `!`, or newly optional fields/params)

   The **report-only** reviewers — `review-cycle:spec-conformance-analyzer` and `review-cycle:maintainability-auditor` — are deliberately **not** in this loop fan-out. They run once after the loop converges (Phase 7), against the final post-fix state. That keeps the expensive opus maintainability pass and the spec-discovery step from re-running on every iteration, and means their findings reflect exactly the code you'll commit rather than an intermediate state.

   **Give each leg a falsifiable question — the Codex leg included.** Compose all of them before step 1 assembles the Codex invocation, and append that leg's question to its `<brief>`; `developer_instructions` is additive, so it carries the question the same way it carries the intent. The question rides the same single-line, no-double-quotes constraint as the brief itself — a question containing `"` breaks the `-c` argument's quoting.

   A reviewer told to "review this" returns prose; a reviewer told to settle one specific claim about this diff runs something. Compose one question per leg before spawning — a claim this change depends on that a command could refute, not a topic. "Are the tests thorough?" is a topic. "Which of these new assertions still pass when the code under them is broken?" is a question, and answering it requires a mutation run.

   Derive it from the diff, not from the agent's job description. The shapes that pay:

   - `code-reviewer` — do the old path and the new path agree on the same inputs, or does some behavioral claim the change rests on survive being run?
   - `pr-test-analyzer` — which changed output paths survive being broken?
   - `silent-failure-hunter` — which of these error paths still reports success when the dependency genuinely fails?
   - `type-design-analyzer` — can an invalid value of this type be constructed through a public route?

   **Shape the Codex leg's question for reading, not measurement.** `codex review` runs its sandbox read-only by default: read-only commands succeed, but builds, test suites, and temp-directory writes are denied (measured on codex-cli 0.149.1). A measurement-shaped question sends that leg into runs the sandbox refuses — it burns its effort failing and reports the finding as inferred anyway. Give Codex a question settleable by reading source, diff, or authoritative documentation (read-only commands included), and route every question that requires running or perturbing code to the subagents, which own writable scratch directories.

   A question with no command behind it is still a topic. If you cannot name what would answer it, omit the question for that leg — send the prompt below with the `Settle this first...` sentence dropped — rather than manufacture one that only sounds specific.

   Each spawn pattern:

   ```js
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "Code review of uncommitted changes",
     run_in_background: true,
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Intent: <brief>. Changed files: <list>. Do not edit, stage, or commit anything in <PROJECT_ROOT> — perturb only a copy in a private mktemp -d directory, never a shared scratchpad, and never reshape a command to slip past a guard. Name that directory in your report, and write nowhere outside it. Settle this first, by measurement rather than reading, and report what you ran: <falsifiable question>. Then output findings as file:line — severity — issue — suggested fix. List separately, under Questions, any claim about tool behavior you could neither exercise here nor settle against authoritative documentation."
   })
   ```

   All applicable agents fire in parallel. Auto-notification on completion — do not poll.

   **Do not pass `name:` to these spawns** (see "Things to NOT do"). Address any nudge to the `agent_id` in the spawn result instead — that keeps `SendMessage` available without changing completion semantics.

The post-loop pass (Phase 7) runs the report-only reviewers and cleanup; none of those are part of this fan-out.

**Collecting results, with a stall watchdog.** Completion notifications arrive automatically — do not poll, and (with the in-progress marker set) end the turn rather than sleep while reviewers run. Background reviewers sometimes stall: they go idle without ever delivering a report. The watchdog is wake-driven — you cannot wait on a timer, so act on whatever wakes you (a completion, an idle notification, a user message):

- On any wake where a reviewer has gone idle without delivering, or has stayed silent while the other reviewers all completed, send it ONE nudge via `SendMessage`: deliver findings now, even if incomplete, opening with the two receipt lines. Address the nudge to the `agent_id` from that reviewer's spawn result.
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

Re-run the Phase 3 snapshot and compare before reading a single finding:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" current-hash
git config --local --list
```

Collect findings from every reviewer:

- Codex output is structured: `verdict`, `summary`, `findings[]` each with `severity` (critical/high/medium/low), `file`, `line_start`, `line_end`, `confidence`, `recommendation`
- pr-review-toolkit output is markdown organized as Critical / Important / Suggestions / Strengths

**Label each leg by what it could actually run.** Read the two receipt lines before weighting a single finding.

A *verification* is a command that exercises this project — its build, test suite, typecheck, linter, schema or manifest validator, or a repro the leg's findings rest on. Reading commands (`git status`, `git diff`, `ls`, `cat`, `find`, `grep`, `rg`) are not verifications: they succeed on a machine where nothing else does.

If either receipt line is absent, or present with nothing after it, the leg is `unknown`. Otherwise read two facts off the receipt:

| line one names a verification that succeeded | `attempted-but-failed:` | label |
| --- | --- | --- |
| yes | `none` | `executed` |
| yes | anything else | `partial (<what was unreachable>)` |
| no | — | `static-analysis-only` |

`execution: none`, a line one naming no verification, and one naming a verification that failed are the same row — a receipt quoting a compile error is `static-analysis-only`, never `executed`. A category the leg says it could not exercise at all also makes it `partial`; a claim it labelled `inferred` does not, since that reflects a budget spent elsewhere and naming what you inferred must never cost the grade a silent leg keeps.

**The receipt narrows what a leg can quietly omit; it does not verify.** Nothing checks the quoted output against a real run, and `partial` rests entirely on the leg volunteering what it could not reach — so treat an unqualified `executed` from a leg making external-tool claims as unconfirmed rather than settled. What the receipt does buy is a shape where silence is visible: a leg that names only an orientation command, or leaves `attempted-but-failed:` off, has told you something.

Corroborate rather than trust. Phase 2 already recorded which of the project's own checks exist and whether they ran, so an `executed` claim whose receipt names no command from that set is worth a second look — you know what this project can run, and the leg is claiming less than that.

**Demotion keys on the claim's evidence, not the leg's grade.** Demote one narrow class wherever it appears: **a claim about how an external tool, framework, or service behaves whose only support is a manifest, config file, lockfile, or CI file.** That is the failure this exists for — a leg read `doctest = false` in a Cargo manifest and asserted it stops `cargo test --doc` from compiling the crate, which it does not. Gating that on the leg's label would miss it: a leg that got any one unrelated check to pass grades `executed` or `partial`, and real legs almost always get something to pass. Claims about what the changed code itself does — control flow, error propagation, what a caller observes — are read from the source and stand, whatever the leg could run.

The label is what the demotion means, not whether it fires. `static-analysis-only` says the leg could not have verified the claim; `executed` says it could have and did not, which deserves less benefit of the doubt rather than more. A `partial` leg's claims about the very category it named unreachable are demoted too — that category is the one thing `partial` uniquely knows, and it is otherwise never read.

**An `unknown` leg is not demoted for the missing receipt alone.** A formatting miss is not evidence of incapacity, and the errors are asymmetric: an ungraded finding you can still read costs nothing, while a real finding demoted for a slip disappears unseen. But omission must not beat candour — if anything else in the report says the leg could not run the project's checks, demote it exactly as `static-analysis-only`, because an honest `execution: none` would have been.

A finding the leg labeled `inferred` keeps that label and stays a finding. The leg had the capability and spent it elsewhere; that is budget, not incapacity, and the agent bodies promise it survives. Demotion applies only to claims a leg could not have exercised at all.

**Collect questions too, and keep them out of the findings list.** A reviewer that could neither run a check nor settle it against authoritative documentation reports the claim under Questions rather than asserting it. Those do not enter Phase 5 — nothing is fixed on the strength of a claim nobody exercised — and they carry through verbatim to the Phase 9 field, where the user decides whether to chase them. An `inferred` label a reviewer attached survives aggregation with the finding; do not quietly promote it by dropping the word.

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
2. **Verify facts introduced by fixes.** A fix that adds or rewords a factual claim — in prose, a comment, a doc, or a commit-message draft — gets the claim itself checked before proceeding, under the evidence policy above: run the command it describes and read what that run printed, read the code it characterizes, confirm the name or version it cites against the file that defines it. A manifest is not evidence for what a command does. Step 1 confirms the finding was addressed; this step confirms the fix didn't trade the finding for a false statement, which otherwise survives until the next fan-out catches it — or ships.
3. **Classify the iteration's fix churn:**
   - **Mechanical** — strictly non-semantic fixes confined to the flagged lines: typo/wording corrections, renames, removing dead code or a redundant comment, doc corrections. Message text that prescribes a remedy or states a factual claim is never mechanical — it classifies as a verified message fix below, so its verification cannot be skipped. The self-check is sufficient verification.
   - **Verified message fix** — a fix whose entire diff is (a) human-facing message text (error/diagnostic strings, log lines, help text, comments, docs), (b) a new or changed **pure** helper — output depends only on its arguments: no I/O, no process spawning, no environment or global reads — of ≤ ~15 added-plus-changed lines whose only consumers are such strings and which is covered by a unit test, and/or (c) the unit tests covering that helper. Every changed output path a user can trigger needs a test or a reproduction. Eligible **only after empirical verification** — step 2 above made load-bearing, split by text kind: text that prescribes a remedy — reproduce the state the message addresses, execute the remedy exactly as printed (copy-paste it), and confirm the condition clears; text that only states a fact — check the claim per step 2 (run the command it describes, read the code it characterizes). A claim the local environment cannot exercise (another OS, another shell, a remote service) must be verified against authoritative documentation or explicitly flagged — never assumed — and routes through the valve in the decision list below. Write the verification line — the reproduction, or the factual-claim check — into the Phase 9 summary draft at verification time, as with the Codex facts in Phase 1: the loop ends turns, and evidence from an early iteration is not re-derivable later. Treated as mechanical for the loop decision. Not eligible, always substantive: anything touching machine-readable output (`--json`, exit codes, parseable formats another tool consumes), the verdict or control flow of a check, or a remedy whose claims were neither verified (locally or against authoritative documentation) nor explicitly flagged for the valve.
   - **Substantive** — any other fix that changes runtime behavior, however small: a new function, branch, or guard clause, a tightened condition, restructured control flow, edits beyond the flagged lines, or a fix where you chose among design alternatives. The self-check confirms the finding was addressed, not that the new behavior is right — behavior changes get re-reviewed.

Then decide:

- NO inline fixes applied (everything clean or correctly deferred) → exit loop.
- Only mechanical and verified message fixes, none carrying a claim local verification could not reach → exit loop. Do NOT re-fan-out just to confirm fixes landed — that confirmation is exactly what the self-check (and the message fix's reproduction) provided.
- Only mechanical and verified message fixes, at least one carrying a claim local verification could not reach (cross-platform shell behavior, remote-service semantics) → **one** lightweight re-review across the whole cycle: the Codex leg alone at `low` — or at the explicit effort argument when one was given; otherwise apply Phase 3's root-table check, passing no override when the configured effort is already `low`, `minimal`, or `none`; unlike Phase 3, this reduction is not tier-gated — with no subagent fan-out, and the pass does not count against max-iter. Its findings feed Phase 5 normally — carrying the Phase 3 brief including the receipt ask, and graded by Phase 4's labels before any fix is applied, since a `static-analysis-only` valve pass contributes questions rather than fixes. Return here afterward. A second such pass is never spawned, and a valve pass that dies counts as spawned without consuming the Codex leg's one retry. When the valve has already run this cycle, the Codex leg is not eligible, or it has already failed its retry, skip the valve, exit the loop, and name the unverifiable claim in the summary.
- At least one substantive fix AND iteration count < max-iter → GOTO Phase 3, scoped: re-run Codex (when its leg is eligible) plus only the subagents whose domain the substantive fixes touched. A Codex leg that failed gets exactly one retry across the whole cycle; after a second failure stop launching it, since repeated attempts against a rate limit or a revoked session buy nothing. Report the union across iterations, and let any failure stick: `failed (iteration 1: <error>; recovered iteration 3)` rather than a bare `participated` — the iteration Codex missed is usually the one that had the findings.
- Iteration count == max-iter → exit loop with summary of remaining findings.

### Phase 7: Post-loop pass (report-only reviewers + cleanup)

The loop has converged. Run the report-only reviewers **once** here — against the final post-fix state — together with cleanup. Spawn all applicable agents in a single turn; they don't conflict (the reviewers only read; cleanup only edits comments/prose, which doesn't change a structural or spec verdict):

1. **`review-cycle:maintainability-auditor`** — if the diff includes non-trivial source-code changes (new or substantially reworked functions, modules, types, or logic). Skip it when the diff is only docs, config, version bumps, or a handful of trivial lines — its ambitious suggestions are noise on small changes.

2. **`review-cycle:spec-conformance-analyzer`** — if a spec source is discoverable: the diff's commits reference an issue/task ID, a spec or PRD file matches the branch/feature, or the user passed a spec path. If none exist, skip it and note "no spec source found" in the summary. The agent's current/unverified source rules still apply; an unverified source is caveated, not acted on.

3. **Cleanup** — comment policy + de-slopify, tier-dependent (below).

Running them here, once, is the whole point: the opus maintainability pass and the spec-discovery step execute a single time against the code you'll actually commit, instead of re-running on every loop iteration.

**Both report-only spawns carry the containment sentence** — the maintainability auditor and the spec-conformance analyzer, not cleanup, which is spawned precisely to edit the target. Carry the same containment clauses Phase 3's prompt carries: *do not edit, stage, or commit anything in `<PROJECT_ROOT>` — work only on a copy in a private `mktemp -d` directory, never a shared scratchpad, and delete it when you finish. Never reshape a command to slip past a guard; name that directory in your report, and write nowhere outside it.* Phase 3's snapshot does not cover this phase and Phase 8 marks the sentinel immediately after, so a file a report-only agent leaves changed is marked reviewed without anyone having seen it. The maintainability auditor needs it most: demonstrating that a restructuring preserves behavior means applying the restructuring somewhere.

**Grade these two legs as well.** Phase 4's labelling covers only the loop's auto-fix reviewers, so apply it here from each report's two receipt lines and carry the label into Phase 9 — including the demotion rule, which applies to a structural or conformance claim about an external tool exactly as it does in the loop.

**Both reviewers are report-only.** Nothing they find is auto-applied and they do not re-open the loop:

- **maintainability-auditor** — speculative structural restructurings (delete a layer, split a file, reframe a state model): high-blast-radius, low-precision, never auto-apply. Surface them in the summary's "Structural suggestions" section; act on the ones you want by prompting afterward.
- **spec-conformance-analyzer** — missing/partial requirements, scope creep, and implemented-but-wrong: all surfaced for you to decide, quoting the spec line. "Did we build the right thing" is your call, so report rather than fix.

**Cleanup.** A separate agent spawn only earns its place on a diff big enough that loading the de-slopify methodology into your own context would be the greater cost:

- **diffs under ~150 changed lines, whatever the tier** — clean inline, yourself. Apply the embedded comment policy to comments you touched, and invoke `/review-cycle:de-slopify` via the Skill tool for the prose methodology, applying it to modified `.md` files and commit-message drafts. Tightening prose must never make it false: under the evidence policy, treat any claim about a command in the prose you touch as checkable, correct it against a run, and report the correction separately from the wording changes — the author needs to know a claim was wrong, not just that a sentence got shorter. Same exclusions as the agent: never touch algorithm logic, type definitions, or test assertions.
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

**Do not run it if Phase 4 found the target contaminated, or if the Phase 3 baseline was lost.** Marking is what tells every downstream gate this state was reviewed; doing it over a tree a reviewer altered, or one whose integrity you cannot speak to, is the failure this check exists to prevent. Report what happened, run `cycle-end` instead, and leave the decision to the user with `/review-cycle:accept`.

This is what allows the Stop hook and commit-gate to let the user commit. `mark` also clears the in-progress marker from Phase 3 and the Stop gate's blocked-state record.

If the CLI exits nonzero, surface the error in the final summary — do not silently succeed — and run `cycle-end` so the Stop gate re-arms. The one exception is an exit 2 reporting that the marker survived: `cycle-end` removes the same file and fails the same way, so report it and leave it to the TTL. Exit 3 means the Phase 3 marker is gone: either Phase 3 never ran, or the cycle outran the 60-minute TTL and a reaper — the Stop gate, or the next session's SessionStart — removed it. Do not re-run `cycle-start` to get past this — that fakes the evidence the guard exists to check. Report to the user what the reviewers found and that the sentinel could not be marked; accepting the state anyway is theirs to decide with `/review-cycle:accept`.

### Phase 9: Final summary

Print a structured summary:

```text
Review cycle complete.

Tier: light | full
Scope: delta (N files, +A -D vs the marked tree) | full (<no marked tree | delta error: reason>)
Iterations: N / max
Falsifiable questions: N asked / N answered by measurement / N fell back to reading
Factual corrections (cleanup): N — <the claim that was wrong, and what the run showed> | none
Unexercised claims raised as questions: N — <each one> | none
Target integrity: unchanged (Phase 3 fan-out; Phase 7 not covered) | CONTAMINATED (<leg>, <what differed>) | not checked (<reason>)
Message fixes verified: N (one verification line per fix) | none
  valve: 1 Codex-only pass (effort: low | inherited | <level> (explicit)) | not needed
Codex leg: participated (effort: low | inherited | <level> (explicit)) | skipped (<reason>[; effort <level> requested, unused]) | failed (<error>)
  auth: confirmed | no stored session | unknown (probe unsupported)
Leg execution: all executed | no leg reported | <leg> = partial (<what>) / static-analysis-only (<observed cause>) / unknown — naming only legs that were not `executed`
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
