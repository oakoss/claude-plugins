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

The tier and scope are decided once, here, and named in the final summary — do not re-derive them per phase.

**Under a job, the cycle never stops to ask.** When the status tool's `stopBefore.mandate` names an epic, the user started a job and reads its report, not this turn. Scope creep (Phase 4) becomes a `question` in the ledger and the summary, and the loop runs on to a commit. Findings held at the ceiling are deferred at Phase 6's exit with the reason `held at the ceiling`, so Phase 9 records them, and the clean result commits. Shelve the bead instead of committing, its held findings still deferred, when those findings fall in an area an earlier iteration also fixed or came mostly from this cycle's fixes, when Phase 8 leaves paths uncovered or finds the target contaminated, or when `mayCommit` is false: leave the tree for the job to set aside, and end the summary with `Final state: shelved (<why>)`.

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

**Every brief carries what earlier cycles settled.** Before composing the first brief, call the `mcp__review-cycle__ledger` tool with the changed-file list as `paths` and, as `query`, a few words naming what the change touches: the functions, rules or behaviors it alters, such as `conditional offer approval merge` for a consent change. It returns, those holding the most query words first and within a size cap, the findings earlier review cycles in this repository deferred, rebutted, left alone on purpose, or raised as questions, each with an id, `changed` when its file differs from what the last cycle to carry it reviewed, and `stale` when it was settled more than 90 days ago. Stale entries always come first and count as `reopened`; `matched` counts the query's other matches. First read on, passing each `next` as `offset`, until you have every reopened entry. Then, if `matched` is 0, read again, once, without `query` starting at offset `reopened`, whether or not a `next` was given. Either way, keep reading on only while the entries still bear on the change. Append the entries that bear on this change as a `settled in earlier cycles` block to every leg's brief, the test, type and spec legs as much as code-reviewer and Codex, each entry by its substance (path, the finding, and the reason it was settled), never by id alone, since a leg cannot look an id up. The block is otherwise on the same terms as the one below, with these exceptions, each listed as reopened so the legs judge it afresh: a `changed` entry whose `git diff <blob> <current>` touches the code it cites, or cannot be run; an entry whose `changed` is null, since nothing checked it; and a `stale` one. Record the entries' ids, and which were reopened, in the summary draft, with any `note` the tool reported; Phase 9 needs them. Stored entries it counts as `unreadable` are dropped by the next record, which reports them. When the tool does not exist, or answers with an error rather than JSON, write `Ledger: unavailable (<its answer, or tool missing>)` into the draft and continue.

**From iteration 2 on, the brief carries what earlier iterations settled**, since a leg has no memory of the passes before it and re-raises what the cycle decided. Append a short `already settled this cycle` block, findings only, listing four things: what was fixed; what was deferred and why; what was rebutted and on what basis, whether a measurement, the documentation, or a deliberate design decision; and what was examined and left alone on purpose. That last category is not optional: a judgment that something is fine reads as an unmade decision to the next leg. Say plainly that these are settled and are not to be re-reported, and that a leg which believes one is wrong must say so with new evidence rather than restating the original finding. Every leg gets it, Codex included, on the same single-line no-double-quotes terms as the rest of its brief.

**Ask for the execution receipt in the brief too.** Every leg opens its report with two lines: `execution:` naming the heaviest verification that *succeeded* (build, test suite, typecheck, or the repro its findings rest on) with that command's first output line, or `none`; then `attempted-but-failed:` listing every verification that did not succeed, plus this project's build or test suite when the leg never attempted it, or `none`. Both lines are required, and an orientation command like `git status` grades the same as `none`. Phase 4 grades the leg from those two lines. Leave the ask out of the Codex brief: `codex review` prints its own verdict, so Phase 4 reads its receipt from its command log. Instead tell Codex to join verification commands with &&, never ; or a newline, so a failure shows in the exit code.

**Every brief, Codex's included, also asks for three things.** When findings share a cause, report the cause and the change that removes it, not only each instance. Tag a finding `pre-existing` when it reproduces on the base (`HEAD`, or `<ref>`) without this change. Report within 10 minutes: settle the question first, then the most severe findings, and past that report what you have, naming what you did not reach.

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)**, only when Phase 1 recorded the leg as `eligible`. Run the CLI directly, not the `/codex:review` slash command, with the subagents' scope: `--uncommitted`, or `--base <ref>` when the user gave a base. The scope flags reject a prompt argument, so the brief rides a config override: `-c "developer_instructions=\"<brief>\""`.

   **Reshape the brief for the flag**, falsifiable question included (step 2): the value is parsed as TOML through one layer of shell quoting, so flatten it into one line of plain prose with no double quotes, backslashes, backticks, or dollar signs (apostrophes are fine). Name files and identifiers bare; keep the changed-file list, comma-separated.

   **Keep the repository read-only for Codex.** In a trusted project its sandbox is `workspace-write`, which can write the repository. Two more overrides run it under a permission profile that reads everything and writes only `<SCRATCH>`. Write the absolute scratch path itself into the filesystem table and the brief on every Codex launch this cycle; when `mcp__review-cycle__scratch` failed, run `mktemp -d` once and use the path it prints. Then pass the filesystem table as one `-c` value, since a dotted key splits on the dot in the scratch path. The brief says so in this sentence: *The repository is read-only for this review, by design: write only inside <SCRATCH>, making your own directory there with mktemp -d <SCRATCH>/codex.XXXXXX and pointing TMPDIR at it. A command that writes inside the repository, such as a test runner writing a cache, fails with Operation not permitted; that is expected, not a defect in the change and not a reason to request wider permissions. Continue with checks that only read.*

   **An explicit effort argument wins over the tier.** When Argument parsing validated one, append `-c model_reasoning_effort="<that literal>"` on either tier, raising included. The rest of this paragraph and the next apply only without one. On the **full** tier pass no override: the user's `~/.codex/config.toml` decides. On the **light** tier, lower the effort only when it would actually be lower. Read the configured value from the root table only, since a `[profiles.*]` key is not what runs:

   ```bash
   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   ```

   The effort scale, ascending, is `none` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`; the API rejects anything else. Append `-c model_reasoning_effort="low"` when the configured effort is above `low` or nothing is configured. When it is already `low`, `minimal`, or `none`, **pass no override**: the tier never raises effort. Emit only a literal from that set, since Codex does not validate `-c` values before the API call.

   Record the effort actually passed (`low`, `inherited`, or `<level> (explicit)`) in the summary draft at the spawn; the tier alone does not say it.

   Assemble the invocation from these parts:

   ```bash
   # full tier, working-tree scope (re-derive the root in this call — shell values
   # don't survive between Bash calls):
   cd "$(git rev-parse --show-toplevel)" && FORCE_COLOR=1 codex review --uncommitted -c 'default_permissions="review-cycle"' -c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "<SCRATCH>"="write"}' -c "developer_instructions=\"<brief>\""
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

   `developer_instructions` is additive: Codex still reads the repo's `AGENTS.md`. Never add `--strict-config`: an unrecognized key then fails the leg instead of degrading to an unbriefed review. Tier on effort, never on a model name. Save the shell ID; you read its output when notified.

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool, which runs it in the background, in the same single message as the codex invocation. Dispatch by the tier decided in Phase 1 — on the **light** tier, spawn `review-cycle:code-reviewer`, plus spec conformance in iteration 1 (below), and nothing else. On the **full** tier, conditional dispatch:

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
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Intent: <brief>. Changed files: <list>. Do not edit, stage, or commit anything in <PROJECT_ROOT> — perturb only a copy in a private directory you make with mktemp -d <SCRATCH>/leg.XXXXXX, never a shared scratchpad, and never reshape a command to slip past a guard. Name that directory in your report, delete it when you finish, and write nowhere outside it. Copy files into it, never symlink anything from the target, and run no package-manager install there nor one a command triggers: in a JavaScript project run the project's tools by path, since the package manager installs when node_modules is missing; a script starts with set -u and runs cd <dir> && before any git command, and an rm guards every variable in its path, as in ${DIR:?}/…, never $DIR/…. End every process you started before you report: one left blocked on a pipe you opened outlives both you and the directory. Settle this first, by measurement rather than reading, and report what you ran: <falsifiable question>. Then output findings as file:line — severity — issue — suggested fix. List separately, under Questions, any claim about tool behavior you could neither exercise here nor settle against authoritative documentation."
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

**Label each leg by what it could actually run.** Read the two receipt lines before weighting a single finding, and grade them by `${CLAUDE_PLUGIN_ROOT}/reference/grading.md`: read it before grading the first leg. It defines a verification, the four labels and their table, and how to write the Codex leg's receipt from its command log.

**The receipt narrows what a leg can quietly omit; it does not verify.** Nothing checks the quoted output, so treat an unqualified `executed` from a leg making external-tool claims as unconfirmed. An `executed` receipt naming none of the project checks Phase 2 recorded is worth a second look.

**Demotion keys on the claim's evidence, not the leg's grade.** Demote one narrow class wherever it appears: **a claim about how an external tool, framework, or service behaves whose only support is a manifest, config file, lockfile, or CI file**, like the `doctest = false` claim in the evidence policy. Claims about what the changed code itself does are read from the source and stand, whatever the leg could run. A `partial` leg's claims about the very category it named unreachable are demoted too.

**An `unknown` leg is not demoted for the missing receipt alone**, but if anything else in its report says it could not run the project's checks, demote it exactly as `static-analysis-only`. A finding a leg labeled `inferred` keeps that label and stays a finding: that is budget, not incapacity.

**Collect questions too, and keep them out of the findings list.** A claim a reviewer could neither run nor settle against authoritative documentation goes under Questions: it never enters Phase 5, and carries through verbatim to the Phase 9 field. Keep a reviewer's `inferred` label on its finding through aggregation.

Attribute each finding to its source. Group by file when presenting. Do not aggressively dedupe — if two reviewers flag the same line, merge them into one bullet with both sources listed.

**Spec conformance decides whether the loop runs at all.** Grade it like the other legs. A finding that quotes an explicit spec line the code contradicts or leaves out is a defect, and goes through Phase 5 with the rest. Scope creep against a current spec source needs the user's decision, except under a job (Phase 1): stop here, apply no review fix (Phase 2's formatting stays), run Phase 9 with the spec section filled, and end without committing. Fixing quality findings first would polish code the user may remove. Use the source label the agent reports: findings against an unverified source are caveated, never a stop. On a stop, record only the scope finding in the ledger, as a `question`, and list iteration 1's other findings in the summary as pending, not deferred.

The maintainability auditor runs post-loop and is aggregated in Phase 7.

### Phase 5: Apply fixes per policy

For each finding, apply the fix-vs-defer policy:

- Default to fixing inline
- Defer only if a criterion above is met
- Critical and high severity findings should almost always be fixed inline; deferring a critical finding requires a strong, defensible justification
- From iteration 2, also apply Phase 6's bar: a finding below it is deferred, not fixed
- A finding tagged `pre-existing`, once you confirm it on the base, is not this change's: defer it with that reason, whatever its severity, so Phase 9 records it in the ledger
- On the iteration that reaches the ceiling, apply no fix: no reviewer would see it, so the gate would refuse the commit. Hold each finding you would have fixed, with its severity and leg, for Phase 10

When fixing, follow the comment policy — do not add comments that restate the code or describe the fix itself.

Track fixed items and deferred items separately for the final summary. Do not auto-create beads or trekker tickets for deferred findings — just list them in the summary; the user decides.

The loop's reviewers feed this phase, spec conformance's defects included. The maintainability auditor runs after the loop, and Phase 7 decides which of its findings are fixed there and which are surfaced.

### Phase 6: Verify fixes (self-check), then loop check

Verify cheaply before deciding whether the fixes need another fan-out:

1. **Self-check every fix against the findings list.** Re-read each fixed site and confirm the finding is addressed, not merely edited near; fix what is not, now. A fix that adds a check, guard, assertion, or validation gets exercised twice: once against the case it was written for, and once against input that must still pass. A guard that rejects valid input is worse than none.
2. **Verify facts introduced by fixes.** A fix that adds or rewords a factual claim, in prose, a comment, a doc, or a commit-message draft, gets the claim checked under the evidence policy: run the command it describes, read the code it characterizes, confirm the name or version against the file that defines it.
3. **Classify the iteration's fix churn:**
   - **Mechanical** — non-semantic fixes confined to the flagged lines: wording, renames, removing dead code or a redundant comment. Message text that prescribes a remedy or states a factual claim is never mechanical; it is a verified message fix.
   - **Verified message fix** — a fix whose entire diff is (a) human-facing message text (error strings, log lines, help text, comments, docs), (b) a new or changed **pure** helper (output depends only on its arguments: no I/O, process spawning, or environment or global reads) of ≤ ~15 added-plus-changed lines whose only consumers are such strings and which a unit test covers, and/or (c) those unit tests. Every changed output path a user can trigger needs a test or a reproduction. Eligible **only after empirical verification**: for a remedy, reproduce the state, run the remedy exactly as printed, and confirm it clears; for a fact, check it per step 2. A claim the local environment cannot exercise is verified against authoritative documentation or explicitly flagged, and routes through the valve below. Write each verification line into the Phase 9 summary draft when you make it. Treated as mechanical for the loop decision. Never eligible: machine-readable output (`--json`, exit codes, formats another tool parses), a check's verdict or control flow, or an unverified, unflagged remedy.
   - **Substantive** — any other fix: one that changes runtime behavior, however small (a new function, branch, or guard clause, a tightened condition, restructured control flow), edits beyond the flagged lines, or a fix where you chose among designs; behavior changes get re-reviewed. A fix that changes what code imported by files outside the diff does is substantive whatever its size, even one that would otherwise be mechanical or a verified message fix. Find those importers with one search for the end of the module path, whatever prefix importers write before it (`./shell`, `../hooks/shell`, an alias), such as `/shell["']` for `shell.ts`: a multi-line import puts only its last line next to the path. Name them in the summary draft.

**From iteration 2, only a finding that matters reopens the loop.** Fix a finding that shows one of this cycle's own fixes is wrong, at any severity: it breaks something, misses the case it was written for, or states something false. Also fix a finding at important or above, on whichever scale its leg uses: a Codex `critical` or `high`, a Critical or Important section, a CRITICAL or HIGH, or a test-gap rating of 7 or more. A numeric rating decides over the section it is listed under, and a finding with no rating counts as important. Every other finding is not fixed this cycle: a Codex `medium` or `low`, a Suggestion, or a test-gap rating under 7. Record it under the deferred findings with that reason, and leave it out of the count of applied fixes: a leg asked which guard survives always finds one more, and pinning each would keep the loop from converging.

**Track where the fixes land.** Before deciding, record `git diff --name-only <spawnTree> <worktreeTree>` in the summary draft, from this iteration's spawn tree to the status tool's tree now. From the second iteration that applied fixes, a file in every fixing iteration's set means the fixes are not converging there: name it with its latest hunks (`git diff -U0 <spawnTree> <worktreeTree> -- <file> | grep '^@@'`) and say that repeated patching at one site argues for the structural fix, or cutting or deferring the piece that keeps drawing findings. A flagged file stays on the summary's `Churn:` line even when the loop later converges. Churn covers loop iterations only, not Phase 8's pass.

**Count the findings this cycle's fixes caused.** From iteration 2, attribute each finding to this cycle's fixes when it cites a line inside `git diff <iteration 1's spawnTree> <spawnTree>` or says one of those fixes is wrong, otherwise to the original work. Record `iteration N: X of Y from this cycle's fixes`, and the pass type for a confirmation pass. When most of a full iteration's findings came from this cycle's fixes, the loop is generating its own work: say so in the summary, where the user decides between more patches, the structural fix, and a cut. The count changes nothing in the loop: a fix a finding shows is wrong is still fixed, as the bar above requires.

**Record each iteration's cost as its legs report.** Take the time again (`date +%s`); the difference from Phase 3's is the iteration's wall-clock. A subagent can notify more than once with its running usage (`subagent_tokens`, `duration_ms`), so keep only its latest. Capped and Codex legs report none. Codex runs the review in a child session of the `session id` its output prints; once it finishes, read that child's total with `grep -rl --include='rollout-*.jsonl' '"parent_thread_id":"<session id>"' ~/.codex/sessions | xargs grep -ho '"total_token_usage":{[^}]*}' | tail -1`, and report it apart from the subagents' tokens, since it counts cached input. Name every leg whose usage was not reported. The cost covers loop iterations only, not Phases 7 and 8.

Then decide. The loop converges on an iteration that applies **no** fixes: every fix is content no reviewer has seen, and the commit gate refuses it until one does.

- NO inline fixes applied and none held at the ceiling (everything clean or correctly deferred) → exit loop, converged.
- Fixes applied AND iteration count < ceiling → GOTO Phase 3, scoped by what the fixes were:
  - at least one **substantive** fix → re-run Codex (when its leg is eligible) plus the subagents whose domain the substantive fixes touched, `code-reviewer` always among them when importers were named; a spec defect fix's domain is spec conformance, scoped to the requirement it addressed. A Codex leg that failed gets exactly one retry across the whole cycle. Report the union across iterations, and let any failure stick: `failed (iteration 1: <error>; recovered iteration 3)`, not a bare `participated`.
  - only **mechanical** and **verified message** fixes → a confirmation pass: `review-cycle:code-reviewer` alone, scoped to the fixes' delta, asked whether the fixes are correct and the change is ready to commit, reporting only findings at its threshold; this is what lets the fixed content count as seen. When a fix carries a claim local verification could not reach (the valve), add the Codex leg at `low`, or at the explicit effort argument when one was given; otherwise apply Phase 3's root-table check on any tier, passing no override when the configured effort is already `low`, `minimal`, or `none`. Grade its findings by Phase 4's labels before any fix is applied: a `static-analysis-only` pass contributes questions, not fixes. Name the claim in the summary if no leg could settle it.
- Findings held at the ceiling (Phase 5) → exit loop **held**. Every path is still covered by the iteration that found them, and Phase 10 asks what to do with them.

### Phase 7: Post-loop pass (maintainability + cleanup)

The loop has ended. Run the maintainability auditor **once** here, against the final post-fix state, together with cleanup. Spawn both in a single turn when no changed path is runtime markdown (Phase 1's split): the auditor only reads, and on an ordinary code diff cleanup edits comments and prose, which doesn't change a structural verdict. When the diff's prose IS runtime — agent bodies, skill bodies — a cleanup rewording changes what the auditor is evaluating mid-read, so cleanup (inline or spawned) runs only after its report lands:

1. **`review-cycle:maintainability-auditor`** — if the diff includes non-trivial source-code changes (new or substantially reworked functions, modules, types, or logic). Skip it when the diff is only docs, config, version bumps, or a handful of trivial lines — its ambitious suggestions are noise on small changes.

2. **Cleanup** — comment policy + de-slopify, tier-dependent (below).

**The maintainability spawn also carries Phase 3's `settled in earlier cycles` block**, so it does not re-measure what an earlier cycle settled.

**The report-only spawn carries the containment sentence** — the maintainability auditor, not cleanup, which edits the target by design: *do not edit, stage, or commit anything in `<PROJECT_ROOT>` — work only on a copy in a private directory made with `mktemp -d <SCRATCH>/leg.XXXXXX`, never a shared scratchpad, and delete it when you finish. End every process you started before you report: one left blocked on a pipe you opened outlives both you and the directory. Never reshape a command to slip past a guard; name that directory in your report, and write nowhere outside it. Copy files into it, never symlink anything from the target, and run no package-manager install there nor one a command triggers: in a JavaScript project run the project's tools by path, since the package manager installs when `node_modules` is missing; a script starts with `set -u` and runs `cd <dir> &&` before any git command, and an `rm` guards every variable in its path, as in `"${DIR:?}/…"`, never `"$DIR/…"`.* Phase 3's snapshot does not cover this phase; only Phase 8's coverage check catches a file it leaves changed.

**Grade this leg as well.** Apply Phase 4's labelling from its two receipt lines and carry the label into Phase 9, including the demotion rule for a structural claim about an external tool.

**The auditor does not re-open the loop.** Never auto-apply its structural restructurings; surface them in the summary's "Structural suggestions" section for the user to act on.

**Report-only is about the kind of finding, not about which leg found it.** A measured fault in code this cycle wrote is a defect whichever leg reports it, and goes through the fix-vs-defer policy. Only proposals and scope questions stay surface-only. A fix applied here gets Phase 6's self-check and fact verification, both directions on any guard, before Phase 8.

**Cleanup**, by size, not tier:

- **diffs under ~150 changed lines** — clean inline. Apply the comment policy to comments you touched, and invoke `/review-cycle:de-slopify` via the Skill tool for modified `.md` files and commit-message drafts. Tightening prose must never make it false: correct a claim about a command against a run, and report that correction apart from wording changes. Never touch algorithm logic, type definitions, or test assertions; in runtime markdown, templates, decision tables, literal thresholds, and rule definitions are logic.
- **~150 changed lines or more** — spawn the cleanup subagent, which has de-slopify preloaded:

  ```js
  Agent({
    subagent_type: "review-cycle:cleanup",
    description: "Final cleanup pass — comments + de-slopify",
    prompt: "Run cleanup on the current diff (post-fix state). Apply comment policy to modified code comments and de-slopify to prose surfaces. Do not touch algorithm logic, type definitions, or test assertions."
  })
  ```

  It edits files directly and returns a summary. Scope: comments in modified code, modified `.md` files, commit-message drafts. Excluded: algorithm logic, type definitions, test assertions, and the load-bearing structures in runtime markdown its body names.

**Check every release-note file in play against the diff itself — last, after cleanup has finished editing.** A changeset or bump file (`.changeset/*.md`, or whatever this project uses) is published verbatim, and review may have changed the code it describes. In play means any the diff adds or modifies, plus any already staged before the cycle began. Read each one against the final post-fix state and correct it, or say in the summary that you could not. Do this yourself, whichever cleanup mode runs, and report the corrections in the summary's release-note field, separately from wording changes.

### Phase 8: Confirm coverage

Call the `mcp__review-cycle__status` tool. When `uncovered` is empty, every changed path is content a reviewer saw: continue to Phase 9.

When it is not — Phase 7 fixes or cleanup edits, or a report-only leg that ran while cleanup was editing — run one confirmation pass: `review-cycle:code-reviewer` alone, background, with the Phase 3 brief and receipt ask, scoped to `git diff <lastReviewedTree> <worktreeTree>` from the status tool, asked whether those changes are correct and ready to commit. Findings go through Phases 4–6. A fix it prompts gets one more confirmation pass; if paths are still uncovered after that, stop and list them in the summary rather than looping on.

Skip the confirmation pass when Phase 4 found the target contaminated: report what happened and leave the decision to the user.

### Phase 9: Final summary

**Record the cycle in the ledger first**, with the `mcp__review-cycle__ledger_record` tool, so the next cycle's reviewers do not re-raise what this one settled. Pass as `entries` every finding this cycle deferred, rebutted, or examined and left alone on purpose, and every question, each with its path, line when it has one, kind (`deferred`, `rebutted`, `left-alone`, `question`), the finding, the reason (the deferral criterion, the measurement or documentation that rebutted it, or why it was left alone), and the leg that raised it. Pass as `resolve` the ids of carried entries this cycle fixed, or found no longer apply. Pass as `keep` the ids of every other carried entry that was not reopened: the tool stamps each with its file as this cycle reviewed it, keeps its date, and drops one whose file is gone. A reopened entry the legs settled again goes in `entries` as this cycle now sees it, which dates it today, with its old id in `resolve` when the wording changed. A fixed finding is never recorded: the code changed, so raising it again means it came back. When there is nothing to record, keep or resolve, skip the call. The tool refuses a malformed batch whole and names the first fault; correct it and call again. When the tool does not exist or cannot record, the summary says `not recorded (<its answer, or tool missing>)`. Skip this step when the cycle was aborted.

Call `mcp__review-cycle__sweep` first, so the summary can report what it ended and removed. Then print this summary in your final message, after any Phase 10 commit, as a `text` block, every field by its name below and in this order. Prose before or after it may explain it, but never replaces it:

```text
Review cycle complete.

Tier: light | full
Scope: delta (N files, +A -D vs the last reviewed tree) | full (<no review yet this session | status tool unavailable>)
Iterations: N (converged | ceiling of <max> reached, N findings held | stopped at iteration 1 for a spec decision)
Coverage: all changed paths reviewed | uncovered: <path (edited-after-review | never-reviewed)>, ...
Falsifiable questions: N asked / N answered by measurement / N fell back to reading
Factual corrections (cleanup): N — <the claim that was wrong, and what the run showed> | none
Release-note corrections: N — <file, the claim that no longer matched the diff> | none | not checked (<reason>) | no release-note file in this diff
Unexercised claims raised as questions: N — <each one> | none
Ledger: carried N from earlier cycles (O reopened); recorded A new, U updated, K kept, R resolved[, G gone][, E evicted][, D dropped unreadable][; <note>] | unavailable (<reason>) | not recorded (<reason>)
Target integrity: unchanged (Phase 3 fan-out; Phase 7 not covered) | CONTAMINATED (<leg>, <what differed>) | not checked (<reason>)
Message fixes verified: N (one verification line per fix) | none
  valve: 1 Codex-only pass (effort: low | inherited | <level> (explicit)) | not needed
Codex leg: participated (effort: low | inherited | <level> (explicit)) | skipped (<reason>[; effort <level> requested, unused]) | failed (<error>)
  auth: stored session (not exercised) | no stored session | unknown (probe unsupported)
Leg execution: all executed | no leg reported | <leg> = partial (<what>) / static-analysis-only (<observed cause>) / unknown — naming only legs that were not `executed`
Canonicalization: ran (<commands>) | partial (<tool> unavailable) | no project checks found
Reviewers dropped (stalled): none | <names, each nudged once before dropping>
Reviewers capped (over budget): none | <each `cappedReviews` entry from the status tool, and whether TaskStop stopped it>
Churn: none | <file[:hunks] in every fixing iteration's set (N of N fixing iterations)>
Convergence: iteration 1 only | <iteration N: X of Y from this cycle's fixes[ (confirmation pass)]>, ... [— the loop is generating its own work]
Cost: <iteration N: W min wall-clock, L legs, T subagent tokens, C Codex tokens[, not reported: <legs>]>, ... | not recorded (<reason>)
Scratch swept: <N processes ended, directory removed> | <errors> | not swept (<reason>)
Findings fixed inline: X
  - file:line — issue (source)
  - ...

Findings deferred: Y
  - file:line — issue (source)
    reason: <criterion from fix-vs-defer policy | held at the ceiling | pre-existing>
  - ...

Spec conformance (iteration 1): <spec source / no spec source found>
  - contradicts or leaves out an explicit spec line (defect — fixed or deferred above): ...
  - scope creep against a current source (stopped the cycle for your decision): ...
  - findings against an unverified source (caveated, not acted on): ...
  - pending after a spec stop (iteration 1's other findings, not judged): ...

Structural suggestions (report-only — prompt to address the ones you want):
  - file:line — suggestion (confidence: high/medium/speculative)
  - ... (or "maintainability-auditor not run — diff too small" / "none")

Final state: clean / N findings remain / shelved (<why>)
```

**When anything was deferred or raised as a question, follow the summary, before any question Phase 10 asks, with a paste-ready markdown block** for the pull request description, since the summary is gone with the session: `## Known issues` with one bullet per deferred finding (`` `file:line` — the finding (deferred: the reason) ``), then `### Open questions` with one bullet per question. It repeats the summary, nothing new, and leaves out findings still held at the ceiling, which Phase 10 asks about, and a heading with nothing under it. Never file it in a tracker; when you open the pull request yourself, put it in the body, with any held findings the user chose in Phase 10 to defer added first.

### Phase 10: Finish

When the final state is clean, nothing is still held at the ceiling, and every path is covered, commit the reviewed work now, as its own Bash call, unless `mcp__review-cycle__status` reports `mayCommit` false: the user's stop-before setting stops before a commit, so end the summary by asking in plain prose whether to commit, naming the branch ("Commit the changes to `fix/x`?"). Otherwise commit — `git add …` then `git commit …`, joined by `&&` (the gate refuses a `git add` followed by `;` or a newline). Skip the commit and stop after the summary when the user's message held off a commit ("don't commit", "not yet"), or when findings other than held ones remain that need their decision. When findings are held at the ceiling outside a job (Phase 1), skip the commit and end the summary by listing them and asking in plain prose, not a dialog, whether to apply them or commit with them deferred; the user may answer with something else entirely. When the held findings fall in a function or area an earlier iteration also fixed, offer first to reconsider the approach, naming the smaller design that would remove that area's findings rather than patch them. Applied, they get the re-review Phase 6 gives their class, outside Phase 5's ceiling rule, and that pass's own findings follow Phase 8's rule: one more pass, then stop and list. A clean re-review with every path covered commits as above. Deferred, they leave nothing held: record them as Phase 9 does, kind `deferred`, then commit as above. The gate admits a commit only if every path it records is covered; a refusal names the paths, and nothing is gained by rephrasing the command.

Push only when the user's latest message asked for one ("push it", "ship it"), or when `mcp__review-cycle__status` reports `mayPush`: their stop-before setting lets a push run without asking. After "ship it", also open the pull request; without a request, open one only when the status reports `mayOpenPr`.

## Things to NOT do

- Do NOT push or open a pull request that the user did not ask for and their stop-before setting does not allow. The gate refuses it; ask them in your reply, naming what it pushes and where, and end your turn.
- Do NOT let the Codex leg's status go unreported. Absent is fine and gets named; broken mid-run gets named louder.
- Do NOT pass `name:` when spawning any review subagent, in either the Phase 3 loop fan-out or the Phase 7 post-loop pass. A named background agent parks as `idle` awaiting messages instead of completing and returning its report, so its findings never arrive — and Phase 7 has no watchdog to notice.
- Do NOT auto-create beads or trekker tickets for deferred findings.
- Do NOT edit the tree while reviewers are running. The edited paths lose that review's coverage.
- Do NOT try to turn the gate off. Only the user can, in `/config`.
- Do NOT add comments to code while fixing. The comment policy applies to fix code, not just original code.
