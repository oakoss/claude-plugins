---
name: review
description: Run the full automated code review cycle on uncommitted changes, before a commit. Canonicalizes the tree, fans out reviewer subagents (plus a Codex leg when the CLI is installed) scaled to the diff, applies fixes inline and loops until a pass applies none, since a commit is admitted only for content a reviewer saw; at the round limit it holds that round's findings unfixed, and asks whether to apply them or commit with them deferred. Then commits a clean result unless the user held off.
argument-hint: "[against <ref>] [max <n>] [effort <level>]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, SendMessage, AskUserQuestion, Skill
---

# Review cycle

Automated multi-agent review cycle on uncommitted changes. Invoke it with `/review-cycle:review`, or via the Skill tool before a commit: review-cycle's commit gate admits a commit only when a reviewer saw exactly what it records, and a push or pull request only when the user asked for one or their stop-before setting allows it. The gate keeps what each reviewer saw in the session's memory, so a review from an earlier session does not count.

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
- **An iteration ceiling** — `max 6`, `6 iterations`, or a bare integer → use it as the most iterations the loop may run before holding its last findings for the user (Phase 5), overriding the tier default (3 for the full tier, 2 for light; see Phase 1).
- **A Codex effort** — `effort medium`, `codex effort high` → the Codex leg runs at exactly that effort on either tier, raising included (see Phase 3). Valid values are the seven literals `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Anything else → name the invalid value, list the valid set, and stop before the cycle starts — a silent fallback would run a long review at the wrong depth.
- **Empty** → defaults: the uncommitted working tree, tier-default iteration ceiling, tier-decided Codex effort.

If a token is ambiguous, treat a ref-like string as the base and a bare integer as the iteration ceiling. Parse before starting the cycle.

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

- **light** — every changed path is prose or inert metadata (`*.md`, `*.txt`, `*.rst`, `docs/`, `LICENSE*`, `NOTICE`, `CHANGELOG*`), OR the entire diff is ~25 changed lines or fewer regardless of file type — a two-line `.gitignore` fix does not need the full apparatus. Markdown a tool loads as instructions tiers as code, wherever it lives: agent bodies, `SKILL.md`, commands, hook-owned markdown, `reference/` files a skill loads, and instruction files like `AGENTS.md` and `CLAUDE.md` — an agent body is a system prompt, not prose. Under a plugin directory that leaves only `README.md`, `LICENSE*`, `CHANGELOG*`, `NOTICE`, and `tests/` as prose. Reduced: fan-out is `code-reviewer` plus Codex when available (and spec conformance in iteration 1), default iteration ceiling 2 (an explicit user `max` still wins), and the Codex leg may run at reduced reasoning effort (Phase 3 checks the configured value first).
- **full** — anything else. Full conditional fan-out, default ceiling 3, Codex at the user's configured effort.

The tier decides fan-out, iteration ceiling, and whether Codex's effort is capped. Cleanup mode (Phase 7) is a separate, purely size-based decision — a docs-only diff can be huge, and huge prose is exactly where the cleanup agent pays for itself.

**Scope to the unreviewed delta when one is known.** Before settling the tier, call the `mcp__review-cycle__status` tool. It reports `worktreeTree` (the working tree as a git tree id), `lastReviewedTree` (the tree the most recent counting reviewer was given in this session, or null), and `uncovered` (the changed paths no reviewer has seen in their current form, each `edited-after-review` or `never-reviewed`). When `lastReviewedTree` is set, scope to what changed since then:

```bash
git diff --name-status <lastReviewedTree> <worktreeTree>
git diff --shortstat <lastReviewedTree> <worktreeTree>
```

Decide the tier from THAT (light when the delta is prose-only or ~25 lines or fewer), hand reviewers the delta's files as the changed-file list, and say in the brief that the rest of the diff matches what an earlier reviewer saw. When `lastReviewedTree` is null (no review yet this session), scope to the full diff. When the tool does not exist, the commit gate is not loaded — it is switched off in `/config`, or mods did not load in this session — so nothing will gate the commit: scope to the full diff and say so prominently in the summary. The delta is why a 20-line follow-up to a converged review gets a small review instead of a full re-run.

The tier and scope are decided once, here, and named in the final summary — do not re-derive them per phase. Record the scope with the delta's file count and `+A -D` from `--shortstat`.

**Probe the Codex leg.** Codex is one of two review legs, not a prerequisite: where it is not installed (CI, a teammate) the cycle runs Claude-only.

```bash
codex --version 2>&1; echo "version-exit=$?"
codex login status 2>&1; echo "login-exit=$?"
```

**`codex --version` alone decides participation**, by its exit code:

- **0** → leg status `eligible`; the leg runs. (`participated` is a Phase 3 *outcome*.)
- **127, or `command not found`** → `skipped (not installed)`, not an error.
- **any other nonzero** → `skipped (codex present but unusable: <first line of stderr>)`. Quote what happened; "not installed" would send the user to reinstall something present.

**`codex login status` is advisory, never a gate.** It reads the stored session file without exercising the credential, and says `Not logged in` whenever Codex authenticates by environment variable (`OPENAI_API_KEY`), as in CI. Record which applies:

- exit 0 → auth `stored session (not exercised)`
- reports not logged in → auth `no stored session`
- the subcommand is unrecognized (an older CLI) → auth `unknown (probe unsupported)`, which is never a reason to suggest `codex login`

Exit 0 is not confirmation: it reports the same for a revoked session and for an `auth.json` containing only `{}`. Never report it as working auth.

**Write all of this into the Phase 9 summary draft now, not at Phase 9**: the tier, the leg status, the auth state, and the Codex effort once Phase 3 decides it. The loop ends turns across iterations, and none of these is re-derivable without re-running the probe.

Never stop the cycle over an absent Codex, and never leave its absence unmentioned. When an explicit `effort` argument was parsed and the leg resolves to `skipped`, say so before the fan-out and record `effort <level> requested, unused (codex skipped)` in the draft.

### Phase 2: Canonicalize the working tree

Before reviewing, bring the tree to the project's canonical state so reviewers see clean code and the reviewed content matches what the commit-time hooks produce. Otherwise a pre-commit formatter rewrites a file at commit, and the commit records content no reviewer saw.

**Use the project's own checks — don't invent commands.** Source them from context you most likely already have: `CLAUDE.md` / `AGENTS.md`, the pre-commit config (`lefthook.yml`, `.husky/`, `.pre-commit-config.yaml`), `package.json` scripts, a `justfile` / `Makefile` / `Taskfile.yml` / `mise.toml`, or the CI workflow. If none is discoverable, skip this phase and note "no project checks found" in the summary.

1. **Auto-fixers (mutating)** — formatters and `lint --fix`. Run them and keep the result, scoped to the changed fileset so unrelated files aren't swept into the diff. (If the project's convention is genuinely whole-tree, follow it.) **Cover every file type the pre-commit hook rewrites, not only those a check script covers.** Read the hook config's globs: a `format:check` script that checks only TypeScript says nothing about the JSON the hook formats at commit, and a commit it rewrites records content no reviewer saw. Point a formatter at the changed files it handles, never at a directory: it may reformat other file types there in a style the project does not use.
2. **Read-only checks** — typecheck and fast/affected tests. Fold any failures into the review findings; the fix-vs-defer policy applies. Read each check's exit code, or run it unpiped: a nonzero exit is never a pass, and output cut short by `tail` or `head` is not a pass. Do NOT run a slow full suite on every review — surface it as "run `<cmd>` before merging" instead.

Record in the summary draft the commands this phase ran, and any tool that was unavailable.

Fail-open: a check that could not run at all — the tool missing, the command or script not found — is noted and skipped, never blocks the review. Its output says which case applies, since a missing tool can exit 1 exactly like a failed lint; a check that ran and failed is a finding.

### Phase 3: Fan-out (parallel)

There is no marker to set: the commit gate watches the reviewers spawn and complete. After spawning them you may end the turn and let their completion notifications re-wake you. Never busy-wait with sleep loops. **Do not edit the tree while reviewers run** — a reviewer covers a path only where the content was the same when it was spawned and when it finished, so an edit mid-review voids that review for the edited path. If the cycle aborts for any reason, print an abbreviated status — tier, leg status, which reviewers had reported — because Phase 9 is the only thing that reports coverage, and an abort skips it entirely; call `mcp__review-cycle__sweep` before it.

**Before the first fan-out, call `mcp__review-cycle__scratch` once** and use the path it returns as `<SCRATCH>` in every reviewer prompt this cycle. A leg that stalls or is dropped cleans up nothing, so the cycle sweeps that directory itself in Phase 9. If the tool is missing or fails, send the prompts with a bare `mktemp -d` and say so in the summary.

**Snapshot the target before spawning anything**, rather than asking each leg to attest that its perturbations stayed on a copy. Call the `mcp__review-cycle__status` tool and run:

```bash
git config --local --list
```

Record the status tool's `snapshot` value, its `worktreeTree` (this iteration's `<spawnTree>`, which Phase 6 diffs against; keep every iteration's), the time (`date +%s`, the start of the iteration's wall-clock), and the config listing verbatim into the Phase 9 summary draft as you take them. Write any scratch file outside the repository; one inside it is a change no reviewer saw.

Re-take both in Phase 4 and compare. `snapshot` digests HEAD and every reviewable change, so it moves with content, staging and commits, an empty commit included; the config listing catches a repository-local identity, which would mis-author later commits. Neither sees the excluded paths (`.beads/**`, `.trekker/**`, editor directories, the project's `ignore` patterns), gitignored files, or `.git/` beyond HEAD, which is why reviewers work outside the repository.

If either differs, name the leg in the summary. The status tool's `reviewerChanges` names each Claude reviewer command the gate saw change the repository; it lasts the session, so note its count at the snapshot and read only the ones added since. The gate never compares around the Codex leg, a background command of the main session, nor after a reviewer's background command returns, so a difference with no new entry most likely came from Codex, or from a write the gate does not check. The commit gate already refuses content a leg changed. This check covers the Phase 3 fan-out only, not Phase 7, where cleanup edits the target by design; the summary says so.

**Compose an intent brief first**: 2–4 sentences on what the change does and why, plus the changed-file list, from the conversation or, against a base, the commit messages in `<ref>..HEAD`. Every reviewer gets it. State intent, not hoped-for verdicts.

**Carry the evidence policy into the brief**, in one sentence: a claim about what a command does cites a run of that command, a manifest is not evidence for behavior, and a claim the leg could not exercise is labeled inferred. The subagents carry this in their bodies; for Codex the brief is the only channel that reaches it. Carry the never-evade rule into the brief the same way: never reshape a command to slip past a guard.

**Every brief carries what earlier cycles settled.** Before composing the first brief, call the `mcp__review-cycle__ledger` tool with the changed-file list as `paths` and, as `query`, a few words naming what the change touches: the functions, rules or behaviors it alters, such as `conditional offer approval merge` for a consent change. It returns, those holding the most query words first and within a size cap, the findings earlier review cycles in this repository deferred, rebutted, left alone on purpose, or raised as questions, each with an id, `changed` when its file differs from what the last cycle to carry it reviewed, and `stale` when it was settled more than 90 days ago. `matched` counts every match; when `next` is present, read on with it as `offset` only while the entries still bear on the change, and drop `query` when it matched nothing. Append the entries that bear on this change as a `settled in earlier cycles` block to every leg's brief, the test, type and spec legs as much as code-reviewer and Codex, each entry by its substance (path, the finding, and the reason it was settled), never by id alone, since a leg cannot look an id up. The block is otherwise on the same terms as the one below, with these exceptions, each listed as reopened so the legs judge it afresh: a `changed` entry whose `git diff <blob> <current>` touches the code it cites, or cannot be run; an entry whose `changed` is null, since nothing checked it; and a `stale` one. Record the entries' ids, and which were reopened, in the summary draft, with any `note` the tool reported; Phase 9 needs them. Stored entries it counts as `unreadable` are dropped by the next record, which reports them. When the tool does not exist, or answers with an error rather than JSON, write `Ledger: unavailable (<its answer, or tool missing>)` into the draft and continue.

**From iteration 2 on, the brief carries what earlier iterations settled**, since a leg has no memory of the passes before it and re-raises what the cycle decided. Append a short `already settled this cycle` block, findings only, listing four things: what was fixed; what was deferred and why; what was rebutted and on what basis, whether a measurement, the documentation, or a deliberate design decision; and what was examined and left alone on purpose. That last category is not optional: a judgment that something is fine reads as an unmade decision to the next leg. Say plainly that these are settled and are not to be re-reported, and that a leg which believes one is wrong must say so with new evidence rather than restating the original finding. Every leg gets it, Codex included, on the same single-line no-double-quotes terms as the rest of its brief.

**Ask for the execution receipt in the brief too.** Every leg opens its report with two lines: `execution:` naming the heaviest verification that *succeeded* (build, test suite, typecheck, or the repro its findings rest on) with that command's first output line, or `none`; then `attempted-but-failed:` listing every verification that did not succeed, plus this project's build or test suite when the leg never attempted it, or `none`. Both lines are required, and an orientation command like `git status` grades the same as `none`. Phase 4 grades the leg from those two lines; Codex learns them only from the brief.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)**, only when Phase 1 recorded the leg as `eligible`: Read `${CLAUDE_PLUGIN_ROOT}/skills/review/codex.md` and follow it.

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool with `run_in_background: true` in the same single message as the codex invocation. Dispatch by the tier decided in Phase 1 — on the **light** tier, spawn `review-cycle:code-reviewer`, plus spec conformance in iteration 1 (below), and nothing else. On the **full** tier, conditional dispatch:

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if the diff changes source code at all, whether or not it touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, or similar test paths. A source change that ships **no** corresponding test is precisely the case to flag, so do not gate this on test files being touched.
   - `review-cycle:silent-failure-hunter` — if diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if diff adds or modifies type declarations (interfaces, structs, classes, type aliases), OR introduces type-boundary smells anywhere (`any`, an un-narrowed `unknown`, `as` casts, non-null `!`, or newly optional fields/params)

   - `review-cycle:spec-conformance-analyzer` — **iteration 1 only, on either tier**, when a spec source is discoverable: the diff's commits reference an issue/task ID, a spec or PRD file matches the branch/feature, or the user passed a spec path. Its question is whether this is the thing that was asked for, which gates whether it is built well. Name a source in its prompt only when the user named one or the reviewed commits reference it: the agent treats a source it is handed as current, so let it find and label any other source itself. With no spec source, skip it and note "no spec source found" in the summary.

   `review-cycle:maintainability-auditor` is **not** in this loop: it runs once after the loop (Phase 7), on the code you will commit.

   **Give each leg a falsifiable question, the Codex leg included**, composed before step 1 assembles the Codex invocation and appended to that leg's `<brief>` on the same single-line, no-double-quotes terms. A reviewer told to "review this" returns prose; one told to settle a specific claim runs something. A question is a claim this change depends on that a command could refute: "Are the tests thorough?" is a topic; "Which of these new assertions still pass when the code under them is broken?" is a question. Derive it from the diff, not from the agent's job description. The shapes that pay:

   - `code-reviewer` — do the old path and the new path agree on the same inputs, or does some behavioral claim the change rests on survive being run? From iteration 2, when Phase 6 named importers outside the diff, ask instead which of those callers behave differently, measured old against new on their existing inputs.
   - `pr-test-analyzer` — which changed output paths survive being broken? From iteration 2, ask only about the guards this cycle's fixes added.
   - `silent-failure-hunter` — which of these error paths still reports success when the dependency genuinely fails?
   - `type-design-analyzer` — can an invalid value of this type be constructed through a public route?

   **Shape the Codex leg's question for reading, not measurement.** Under the step 1 profile, reading and checks that write nothing succeed — typecheck, lint, `git diff` — while a build or test runner that writes inside the repository is denied. Give Codex a question settleable by reading source, diff, or authoritative documentation, and route every question that needs running or perturbing code to the subagents, which own writable scratch directories.

   If you cannot name what would answer a question, omit it for that leg (drop the `Settle this first...` sentence) rather than manufacture one that only sounds specific.

   **Keep a question about a guard inside the guard's stated scope.** Ask whether it catches the cases its documentation says it covers, not whether a leg can evade it: a leg sent to find a bypass always finds one. Leave out evasions only a deliberate agent would write. A gap an ordinary command falls into, such as a release script that commits, is still a finding, whether or not the documentation lists it.

   Each spawn pattern:

   ```js
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "Code review of uncommitted changes",
     run_in_background: true,
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Intent: <brief>. Changed files: <list>. Do not edit, stage, or commit anything in <PROJECT_ROOT> — perturb only a copy in a private directory you make with mktemp -d <SCRATCH>/leg.XXXXXX, never a shared scratchpad, and never reshape a command to slip past a guard. Name that directory in your report, delete it when you finish, and write nowhere outside it. Copy files into it, never symlink anything from the target, and run no package-manager install there; a script starts with set -u and runs cd <dir> && before any git command, and an rm guards every variable in its path, as in ${DIR:?}/…, never $DIR/…. End every process you started before you report: one left blocked on a pipe you opened outlives both you and the directory. Settle this first, by measurement rather than reading, and report what you ran: <falsifiable question>. Then output findings as file:line — severity — issue — suggested fix. List separately, under Questions, any claim about tool behavior you could neither exercise here nor settle against authoritative documentation."
   })
   ```

   All applicable agents fire in parallel. Auto-notification on completion — do not poll.

   **Do not pass `name:` to these spawns** (see "Things to NOT do"). Address any nudge to the `agent_id` in the spawn result instead — that keeps `SendMessage` available without changing completion semantics.

The post-loop pass (Phase 7) runs the maintainability auditor and cleanup; neither is part of this fan-out.

**Collecting results, with a stall watchdog.** Completion notifications arrive on their own: do not poll, and end the turn rather than sleep. A background reviewer sometimes goes idle without reporting. Act on whatever wakes you (a completion, an idle notification, a user message):

- On a wake where a reviewer has gone idle without delivering, or stayed silent while the others all completed, send it ONE nudge via `SendMessage`, addressed to the `agent_id` from its spawn result: deliver findings now, even if incomplete, opening with the two receipt lines.
- If a nudged reviewer still hasn't reported by the next wake **that carries information about it**, proceed to Phase 4 without it and list it under "reviewers dropped (stalled)". Evidence means an idle or completion notification naming it, or, only when other Claude-side reviewers exist, all of them having since reported. A wake from unrelated agents is not evidence.
- **When it is the only Claude-side reviewer** (the light tier after iteration 1, or with no spec source), only its own idle notification or the user's next message counts as evidence: dropping it drops the whole Claude side.
- Never nudge the same reviewer twice, and never hold the cycle for a straggler already nudged.
- A leg that keeps working is never idle, so the gate keeps the clock: when a leg passes its 30-minute budget, a prompt from `review-cycle` names its agent id. Stop that leg with the TaskStop tool, proceed without it, and list it under "Reviewers capped".
- If the last reviewer stalls without even an idle notification, the user's next message is the wake. Do not burn turns polling for it.

**A Codex leg that dies after launch is a failure, not a skip.** Read *whether* it failed from the completion notification's exit code, and *why* from its output file: exit 1 alone names no cause. Open the output file before composing the failure message and quote what it actually says. `participated` is the outcome recorded here, replacing Phase 1's `eligible`. Continue on the subagent findings either way, and report the failure in Phase 9 apart from a skip, with Phase 1's auth state: `failed (<error> — no stored session, try codex login)`, but never a login hint for auth `unknown`.

Proceed to Phase 4 when every reviewer has reported or been dropped under this policy.

### Phase 4: Aggregate findings

Re-take the Phase 3 snapshot (the status tool's `snapshot`, and `git config --local --list`) and compare before reading a single finding.

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

`execution: none`, a line one naming no verification, and one naming a verification that failed are the same row: a receipt quoting a compile error is `static-analysis-only`, never `executed`. A category the leg says it could not exercise at all also makes it `partial`; a claim it labelled `inferred` does not.

**The receipt narrows what a leg can quietly omit; it does not verify.** Nothing checks the quoted output, so treat an unqualified `executed` from a leg making external-tool claims as unconfirmed. An `executed` receipt naming none of the project checks Phase 2 recorded is worth a second look.

**Demotion keys on the claim's evidence, not the leg's grade.** Demote one narrow class wherever it appears: **a claim about how an external tool, framework, or service behaves whose only support is a manifest, config file, lockfile, or CI file**, like the `doctest = false` claim in the evidence policy. Claims about what the changed code itself does are read from the source and stand, whatever the leg could run. A `partial` leg's claims about the very category it named unreachable are demoted too.

**An `unknown` leg is not demoted for the missing receipt alone**, but if anything else in its report says it could not run the project's checks, demote it exactly as `static-analysis-only`. A finding a leg labeled `inferred` keeps that label and stays a finding: that is budget, not incapacity.

**Collect questions too, and keep them out of the findings list.** A claim a reviewer could neither run nor settle against authoritative documentation goes under Questions: it never enters Phase 5, and carries through verbatim to the Phase 9 field. Keep a reviewer's `inferred` label on its finding through aggregation.

Record per leg whether its falsifiable question was answered by measurement or fell back to reading, for the summary's `Falsifiable questions:` line. Attribute each finding to its source. Group by file when presenting. Do not aggressively dedupe — if two reviewers flag the same line, merge them into one bullet with both sources listed.

**Spec conformance decides whether the loop runs at all.** Grade it like the other legs. A finding that quotes an explicit spec line the code contradicts or leaves out is a defect, and goes through Phase 5 with the rest. Scope creep against a current spec source needs the user's decision: stop here, apply no review fix (Phase 2's formatting stays), run Phase 9 with the spec section filled, and end without committing. Fixing quality findings first would polish code the user may remove. Use the source label the agent reports: findings against an unverified source are caveated, never a stop. On a stop, record only the scope finding in the ledger, as a `question`, and list iteration 1's other findings in the summary as pending, not deferred.

The maintainability auditor runs post-loop and is aggregated in Phase 7.

### Phase 5: Apply fixes per policy

For each finding, apply the fix-vs-defer policy:

- Default to fixing inline
- Defer only if a criterion above is met
- Critical and high severity findings should almost always be fixed inline; deferring a critical finding requires a strong, defensible justification
- From iteration 2, also apply Phase 6's bar (in `loop.md`): a finding below it is deferred, not fixed
- On the iteration that reaches the ceiling, apply no fix: no reviewer would see it, so the gate would refuse the commit. Hold each finding you would have fixed, with its severity and leg, for Phase 10

When fixing, follow the comment policy — do not add comments that restate the code or describe the fix itself.

Track fixed items and deferred items separately for the final summary. Do not auto-create beads or trekker tickets for deferred findings — just list them in the summary; the user decides.

The loop's reviewers feed this phase, spec conformance's defects included. The maintainability auditor runs after the loop, and Phase 7 decides which of its findings are fixed there and which are surfaced.

### Phase 6: Verify fixes (self-check), then loop check

Read `${CLAUDE_PLUGIN_ROOT}/skills/review/loop.md` and follow it: it verifies this iteration's fixes and decides whether the loop goes round again.

### Phase 7: Post-loop pass (maintainability + cleanup)

Read `${CLAUDE_PLUGIN_ROOT}/skills/review/post-loop.md` and follow it: the maintainability audit, cleanup, and the release-note check.

### Phase 8: Confirm coverage

Call the `mcp__review-cycle__status` tool. When `uncovered` is empty, every changed path is content a reviewer saw: continue to Phase 9.

When it is not — Phase 7 fixes or cleanup edits, or a report-only leg that ran while cleanup was editing — run one confirmation pass: `review-cycle:code-reviewer` alone, background, with the Phase 3 brief and receipt ask, scoped to `git diff <lastReviewedTree> <worktreeTree>` from the status tool, asked whether those changes are correct and ready to commit. Findings go through Phases 4–6. A fix it prompts gets one more confirmation pass; if paths are still uncovered after that, stop and list them in the summary rather than looping on.

Skip the confirmation pass when Phase 4 found the target contaminated: report what happened and leave the decision to the user.

### Phase 9: Final summary

Read `${CLAUDE_PLUGIN_ROOT}/skills/review/summary.md` and follow it: the ledger record, the sweep, the summary template, and the known-issues block.

### Phase 10: Finish

When the final state is clean, nothing is still held at the ceiling, and every path is covered, commit the reviewed work now, as its own Bash call, unless `mcp__review-cycle__status` reports `mayCommit` false: the user's stop-before setting stops before a commit, so end the summary by asking in plain prose whether to commit, naming the branch ("Commit the changes to `fix/x`?"). Otherwise commit — `git add …` then `git commit …`, joined by `&&` (the gate refuses a `git add` followed by `;` or a newline). Skip the commit and stop after the summary when the user's message held off a commit ("don't commit", "not yet"), or when findings other than held ones remain that need their decision. When findings are held at the ceiling, skip the commit and end the summary by listing them and asking in plain prose, not a dialog, whether to apply them or commit with them deferred; the user may answer with something else entirely. Applied, they get the re-review Phase 6 gives their class, outside Phase 5's ceiling rule, and that pass's own findings follow Phase 8's rule: one more pass, then stop and list. A clean re-review with every path covered commits as above. Deferred, they leave nothing held: commit as above. The gate admits a commit only if every path it records is covered; a refusal names the paths, and nothing is gained by rephrasing the command.

Push only when the user's latest message asked for one ("push it", "ship it"), or when `mcp__review-cycle__status` reports `mayPush`: their stop-before setting lets a push run without asking. After "ship it", also open the pull request; without a request, open one only when the status reports `mayOpenPr`.

## Things to NOT do

- Do NOT push or open a pull request that the user did not ask for and their stop-before setting does not allow. The gate refuses it; ask them in your reply, naming what it pushes and where, and end your turn.
- Do NOT let the Codex leg's status go unreported. Absent is fine and gets named; broken mid-run gets named louder.
- Do NOT pass `name:` when spawning any review subagent, in either the Phase 3 loop fan-out or the Phase 7 post-loop pass. A named background agent parks as `idle` awaiting messages instead of completing and returning its report, so its findings never arrive — and Phase 7 has no watchdog to notice.
- Do NOT auto-create beads or trekker tickets for deferred findings.
- Do NOT edit the tree while reviewers are running. The edited paths lose that review's coverage.
- Do NOT try to turn the gate off. Only the user can, in `/config`.
- Do NOT add comments to code while fixing. The comment policy applies to fix code, not just original code.
