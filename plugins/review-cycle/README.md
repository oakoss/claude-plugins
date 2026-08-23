# review-cycle

Automated multi-agent code review cycle for Claude Code, with hook-driven gates that prevent unreviewed commits.

## What it does

After you implement changes, `review-cycle` fans out parallel reviewers, applies fixes per embedded policies, loops until clean, runs a final de-slopify cleanup, and updates a sentinel that signals "this state has been reviewed." A Stop hook automatically prompts you to invoke the cycle when uncommitted changes haven't been reviewed yet. A commit gate hook prevents `git commit` on unreviewed changes — Claude cannot bypass it.

## Architecture

```text
Implement changes
       ↓
Stop hook fires when you finish a turn
       ↓
  Sentinel matches current diff?
       │
       ├── Yes → allow turn to end
       │
       └── No → block with "invoke /review-cycle:review"
              ↓
        /review-cycle:review runs
              ↓
        ┌─────┴─────┐
        ↓           ↓
   Codex review    pr-review-toolkit
   (if available)  (parallel subagents)
        └─────┬─────┘
              ↓
        Aggregate findings
              ↓
        Apply fixes per CLAUDE.md policy
              ↓
        Loop (up to 4 iterations)
              ↓
        Post-loop pass, once:
        report-only reviewers
        (maintainability + spec)
        + de-slopify cleanup
              ↓
        Atomic sentinel write
              ↓
        Summary (with report-only
        suggestions) → stop (no commit)
              ↓
You review the diff and commit yourself
```

## Skills

### `/review-cycle:init`

One-time setup helper. Run after installing the plugin to:

- Check for the optional Codex CLI, verify `multi_agent = true` in `~/.codex/config.toml`, and report stored-login state (advisory — auth doesn't gate the leg)
- Optionally append the comment, fix-vs-defer, and evidence policies to your global or project `CLAUDE.md`
- Update project `.gitignore` to exclude `.claude/.review-mark` (auto-managed state)

Idempotent — safe to run multiple times. Replaces the manual setup steps below.

### `/review-cycle:review`

The one command for the whole cycle. Fans out reviewers, auto-applies the safe fixes, loops until clean, surfaces report-only findings (spec conformance and structural suggestions) for you to act on, runs a final de-slopify pass, and updates the sentinel.

The apparatus scales to the diff: light diffs (docs-only, or ~25 changed lines or fewer of anything) get the code reviewer with a 2-iteration cap; everything else gets the full conditional fan-out (max 4 iterations). The Codex leg joins either tier when it's available. Cleanup is a separate, size-only decision — inline under ~150 changed lines, the cleanup agent above that, whatever the tier. Iterations whose fixes were mechanical are verified by self-check against the findings list instead of a fresh reviewer fan-out; message-only fixes likewise skip the fan-out once the agent has reproduced the state the message addresses and confirmed the printed remedy clears it. Claims local verification can't reach (another OS or shell, a remote service) get at most one Codex-only reduced-effort pass per cycle. A reviewer that stalls is nudged once, then dropped and named in the summary rather than holding the cycle hostage.

Arguments are natural language — no flags:

- bare `/review-cycle:review` — review the uncommitted working tree, default 4 iterations
- `against <ref>` (e.g. `against main`) — scope to `git diff <ref>..HEAD`
- `max <n>` — override the iteration cap

### `/review-cycle:review-pr`

Single-pass, report-only review of a GitHub pull request, run from your machine. Takes a PR number, URL, or branch (bare invocation reviews the current branch's PR). It fetches the PR head into a disposable detached worktree — your checkout, branch, and index are never touched. The fan-out matches the review cycle's, with the intent brief sourced from the PR's title, body, and commits; on the full tier the report-only pair joins the same pass, since a single pass has no fix loop to shield them from. Findings are reported in the conversation with per-reviewer coverage, so "no findings" is never mistaken for "nobody looked". The Codex leg joins when the CLI is installed, briefed and scoped with `--base` against the PR's base branch.

Nothing is fixed and nothing is posted by default. Say `and post` (or ask after reading the report) to publish the findings as a single COMMENT review — never an approval — with fingerprint-marked comments, inline and body-level alike, that deduplicate across re-runs. The review sentinel and commit gate are untouched: this skill reviews someone's PR, not your working tree.

### `/review-cycle:accept`

Marks the current uncommitted state as reviewed by updating the review sentinel. Use when you've manually reviewed the substance of your changes and want to commit without running the full cycle. Per-state escape hatch (lighter than the project-wide `disabled: true` opt-out).

#### Which verb writes the sentinel

Two subcommands write the sentinel, and they are not interchangeable:

- `review-sentinel mark` is what the review cycle runs at Phase 8. It refuses with exit 3 unless `.claude/.review-in-progress` exists, and only `cycle-start` — the first step of a real cycle — writes that marker. So `mark` cannot be used without first declaring a cycle, and it is not a shape the commit gate's chained pass-through accepts. `/review-cycle:review-pr` deliberately uses a *different* marker (`pr-cycle-start`), because it reviews a PR head in a throwaway worktree and never looks at your working tree — its marker holds the Stop gate open without vouching for local changes. The Stop gate and SessionStart both delete markers older than 60 minutes, so a cycle that outruns the TTL also lands on exit 3.
- `review-sentinel accept-state` is what `/review-cycle:accept` runs. It has no precondition. It is the escape hatch for a human who reviewed the changes themselves.

The split exists because a hook that trusts a file the gated party can write cannot tell a review from a claim of one. The two used to be one verb, so the routine-looking `mark` cleared the gate by itself — and running it in one Bash call, then `git commit` in the next, sidestepped the gate entirely, since the PreToolUse matcher only ever sees one command at a time.

This raises the bar rather than closing the hole. Any verb of a local binary is invocable by whoever holds the shell: `accept-state` is there for the taking, and `cycle-start` is unguarded too, so `cycle-start` followed by `mark` clears the gate while reading like a normal cycle. Nothing a local binary checks can distinguish a review from a claim of one. What changed is that the shortest path is no longer the one that looks like routine plumbing — `accept-state` names itself, and a self-declared cycle that marks without reviewing is a claim someone can check against the transcript.

### `/review-cycle:de-slopify`

Bundled de-slopify skill — methodology for removing AI writing artifacts from prose, maintained here as part of the plugin (originally imported from oakoss/agent-skills, which no longer carries the canonical copy). The cleanup subagent preloads this skill, so the cycle uses it automatically. Invokable directly for ad-hoc cleanup of prose outside the cycle. Aligned with the standalone `prose` plugin's rules, so cycle cleanup and the always-on style apply the same standard.

## Subagents (bundled)

Migrated verbatim from Anthropic's pr-review-toolkit (Apache 2.0; see `LICENSE-pr-review-toolkit` and `NOTICE`):

- `review-cycle:code-reviewer` — general quality + CLAUDE.md compliance
- `review-cycle:silent-failure-hunter` — error handling, swallowed errors
- `review-cycle:type-design-analyzer` — type invariants, encapsulation
- `review-cycle:pr-test-analyzer` — test coverage gaps

New (this plugin):

- `review-cycle:cleanup` — comment policy + de-slopify in one pass, correcting prose whose claims a run contradicts
- `review-cycle:maintainability-auditor` — ambitious structural lens (code-judo moves, file-size sprawl, spaghetti branches, weak seams). Runs in `review` on substantial-code diffs, **report-only** — its speculative restructurings are surfaced for you to action, never auto-applied.
- `review-cycle:spec-conformance-analyzer` — spec axis: does the diff implement what the originating issue/task/PRD asked for? Reported separately from quality findings, when a spec source is discoverable.

## Hooks (active when plugin is enabled)

### SessionStart

Seeds the per-project sentinel at session startup. Re-seeds only when the sentinel is missing (first install — treats pre-existing WIP as "already reviewed") or when the sentinel still matches the current state (idempotent refresh). If the sentinel disagrees with the current state, the previous session left unreviewed work — startup keeps the old sentinel so the Stop and commit gates can do their job. Only fires on `source: "startup"` events, not `/clear`, `/compact`, or `resume`.

Side effect: dependency bumps or IDE edits between Claude sessions (after a clean commit) will be detected as drift on the next startup. Run `/review-cycle:accept` (or `/review-cycle:review`) once to re-baseline. The alternative silently absorbed unreviewed in-progress work into the new baseline whenever Claude was quit.

### Stop

Fires when Claude finishes a turn. If there are uncommitted changes whose hash doesn't match the sentinel, blocks with a directive to invoke `/review-cycle:review`. Fail-open on any error. Two release valves keep the block from becoming ceremony:

- **A running cycle doesn't re-trigger the gate.** The review cycle writes `.claude/.review-in-progress` at fan-out, letting turns end while background reviewers run (their completion notifications re-wake the agent — no sleep-loop workarounds). The marker is retired by the verbs that conclude a cycle — `mark`, `accept-state`, and `cycle-end` — and a stale one from a crashed cycle (over 60 minutes old) is removed and ignored by both the Stop gate and the next SessionStart. `/review-cycle:review-pr` writes `.claude/.review-pr-in-progress` instead, which the Stop gate honors identically but the sentinel does not accept as evidence.
- **Blocks once per drift state.** The gate records the state hash it blocked on; a later stop on the identical state passes with a warning instead of re-blocking, so a user-directed "keep going, review at the end" batches naturally instead of hard-looping. This relaxes only *when* review happens — the commit gate still makes review non-optional before any commit.

### PreToolUse (Bash matcher)

Fires before any Bash command. If the command is `git commit` and the sentinel doesn't match the current state, blocks the commit. This is the deterministic enforcement layer — Claude cannot bypass it with a CLAUDE.md rule or memory.

A chained `review-sentinel accept-state && git commit` (the `/accept` flow) passes when it is exactly that shape: one `git commit` in the call, bare `accept-state` immediately `&&`-joined to it. `mark` does not qualify — see below. The lexical rules and their rationale live in `hooks/lib/command-parse.sh`.

The gate guards one project, and stands aside only when the command proves it commits elsewhere. It reads the target from `git -C` and from the `cd` hops ahead of the commit, resolving a path through its nearest existing ancestor so a fixture the command is about to create still resolves — that is what lets a reviewer build a scratch repo with real history and commit in it. Both the payload cwd's repository and the one `CLAUDE_PROJECT_DIR` names count as the project, so a stale `CLAUDE_PROJECT_DIR` cannot switch the gate off where you are working.

Anything short of proof gates instead. A `cd` only moves the commit if bash reaches it and keeps it, so hops count when the command is `&&`-joined throughout, or plainly sequenced with every directory already on disk. The target is unreadable when a `||`, a pipe, a subshell, or a brace group sits in between; when a substitution, a backtick, or a control keyword like `if` puts a hop in a subshell or a branch that may not run; when the command holds a second commit, since everything the router reads stops at the first; when a path was never expanded — a variable, a glob, a `cd` option, a `~+`, a `..` segment, or a token only partly quoted; when `--git-dir`, `GIT_DIR`, or `CDPATH` moves git or `cd` off the path that was computed; when the payload carries no cwd, or a relative one; or when the lexer could not follow the quoting.

Detection reads the command skeleton, not the raw text. Quoted arguments, comments, and heredoc bodies are data: a tracker description quoting the phrase, or a heredoc writing a setup script, is not an invocation — whichever way its delimiter is quoted. Command substitutions are code wherever bash expands them, double quotes and unquoted heredoc bodies included. A quoted command handed to `bash -c` (or a cluster like `bash -lc`), `eval`, `ssh`, a heredoc into a shell, or a pipe into one is an invocation and still blocks; so is a path-qualified `/usr/bin/git`. That list is a named set, and a runner outside it — `python3 -c "git commit"`, a task runner — is missed, so the commit it carries passes ungated. `git commit-tree` and the other hyphenated plumbing verbs are not the gated verb: they write an object and move no ref.

Every step distinguishes "no" from "could not tell". A `grep` that errored, an `awk` that died, or a lexer that lost track of quoting all mean the text has not been read, and unread text blocks.

Two limits are deliberate. Commands over 32 KB skip the skeleton entirely, because the lexer is quadratic and a slow hook is its own defect; the raw text decides instead, which blocks rather than passes. And the gate has never been an adversarial boundary — see the note on `mark` versus `accept-state` above. It raises the bar against routine unreviewed commits; anyone holding the shell can still call `accept-state`.

### PostToolUse (Write|Edit|MultiEdit matcher)

Fires after every file write. Scans for high-confidence comment slop — section markers, restate-the-code phrasings, hedge prefixes, ticketless TODOs — plus a comment-density check on the text just written (4+ comment lines making up ≥30% of a code edit; a Write payload's shebang and leading header comment block are exempt, since a new file's legitimate header is not an edit). On a hit it injects a directive to fix the comments immediately with a follow-up Edit, so slop is caught at generation time rather than waiting for the review cycle. Never blocks. Prose files (`.md`, `.txt`, …) are skipped entirely — `#` is a heading there, and prose cleanup belongs to de-slopify — and comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check.

## Optional: commit-time enforcement (`install-hook`)

The PreToolUse gate evaluates before a Bash chain runs, on command text. That leaves structural blind spots: a chain that edits files after the check and then commits, or commits issued from a terminal outside the Claude session. For repos where you want ground-truth enforcement, install a git pre-commit hook:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" install-hook
```

The hook runs `review-sentinel check` inside the commit — after everything earlier in the chain has executed — and blocks on drift. Properties:

- **Humans are never gated.** The hook exits immediately unless `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` is set, so it only fires for agent sessions. Commits from your own terminal are untouched.
- **Opt-outs are honored.** The global kill-switch (`~/.claude/.disable-review-gate`), the per-project marker (`.claude/.no-review-gate`), and `.claude/review-cycle.json` `{"disabled": true}` all disable the installed hook with the same precedence as the PreToolUse gate.
- **Fail-open by design.** A missing plugin binary (teammate's machine, uninstall) or a `check` error exits 0.
- **Hook-manager aware.** Lefthook repos get a helper script plus a lefthook job (direct `.git/hooks` writes get clobbered by `lefthook install`; the config is only auto-edited when it has no `pre-commit` key yet). Repos using pre-commit or simple-git-hooks get the helper plus a printed config snippet — their committed config is never auto-edited. Husky and other `core.hooksPath` setups are handled implicitly. Under plain git, a pre-existing hook is relocated to `pre-commit.local` and chained first with its exit status preserved — appending to it instead could swallow its failures, sit dead behind an `exit 0`, or corrupt a non-shell hook. A hook file that is *tracked by git* (husky commits `.husky/`) is never rewritten — you get the helper plus a one-line snippet to add yourself, so no machine-specific path ever lands in a committed file.
- **Worktree-safe.** The hooks path is resolved through `git rev-parse --git-path hooks`, so linked worktrees are covered.
- **Removable.** `review-sentinel uninstall-hook` removes the gate, restores a relocated `pre-commit.local`, and deletes the helper script.

The PreToolUse gate stays active either way — it fails fast (before a doomed chain runs its side effects) while the git hook is the accurate backstop. Per commit, the double check costs a few tens of milliseconds.

## Optional: the Codex review leg

Codex is a second review leg from a different model family, not a prerequisite. `/review-cycle:review` probes for it at preflight: installed, it joins the fan-out; absent, the cycle runs Claude-only and names the skip in its summary. When it runs, it gets the same intent brief as the Claude-side reviewers, passed as a per-invocation config override — nothing is written into your working tree.

Presence of the CLI is the only gate. Auth deliberately isn't one: `codex login status` reports only on a stored session, so it says `Not logged in` for a Codex authenticated by environment variable (the normal CI setup), and skipping on that would drop a working reviewer in the exact environment this supports. If auth turns out to be genuinely missing, the review fails and the summary says so, naming `codex login` as the likely fix.

That makes the plugin usable where Codex isn't — CI, a teammate who hasn't installed it, a machine without an OpenAI subscription — at the cost of the second opinion. Two model families disagreeing about the same diff is where the cycle's coverage comes from, so install it where you can:

1. **Codex CLI installed and authenticated**:

   ```bash
   npm install -g @openai/codex
   codex login
   ```

   Only the Codex CLI binary is used; the Codex Claude plugin is not a dependency.

2. **Multi-agent enabled** in `~/.codex/config.toml`:

   ```toml
   [features]
   multi_agent = true
   ```

   This lets Codex spawn parallel review agents internally during a single `codex review` call, replacing the need for multiple sequential Codex invocations.

The one status the cycle treats as an error is a leg that passes the preflight probe and then dies mid-review: a regression, reported as `failed` rather than folded into the routine skips.

### Review depth follows the tier

A two-line `.gitignore` fix doesn't need the same depth as a 500-line refactor. Light-tier diffs ask Codex for `low` reasoning effort when that would actually be lower than your configured value — if you already run at `low`, `minimal`, or `none`, nothing is overridden. Full-tier diffs pass no override at all and inherit whatever your `~/.codex/config.toml` sets. With `multi_agent = true` the effort applies to Codex's internal review agents too, so the reduction compounds.

The adjustment only ever goes down. If you configured `medium` globally, a large diff won't be silently upgraded to `high` — your config is the ceiling. The summary reports which applied (`participated (effort: low)` vs `(effort: inherited)`).

Effort is the tuning axis rather than model name on purpose: `codex review` exposes neither `--model` nor `--profile` (only `-c`), model names churn often enough that Codex ships its own `[notice.model_migrations]` table, and a name pinned inside the plugin would rot into an error or a silent downgrade on someone else's account.

## Recommended configuration

### Add the policies to your global CLAUDE.md

The skills embed the comment, fix-vs-defer, and evidence policies, so the cycle itself works without setup. But if you want the same policies active outside the cycle (when Claude is implementing code or addressing a single PR comment), copy the snippets from `reference/policies.md` into `~/.claude/CLAUDE.md`.

### Per-project config: `.claude/review-cycle.json`

A single JSON config file controls project-level behavior. All fields are optional:

```json
{
  "disabled": false,
  "ignore": [
    "dist/**",
    "generated/**",
    "tests/fixtures/large-corpora/**"
  ]
}
```

- `disabled: true` opts the project out of all gates.
- `ignore: [...]` extends the built-in exclusion list with project-specific pathspec-glob patterns. Additive; built-ins still apply.

The file is meant to be committed so a team gets the same gate behavior. `jq` is required to read it. Malformed JSON falls back to defaults (gate active, no extra ignores); the gate fails open on `disabled` and fails closed on `ignore` so a typo can't accidentally disable review.

### Migrating from `.no-review-gate`

The legacy `touch .claude/.no-review-gate` marker is still honored indefinitely as a fallback. There is no auto-migration: the old marker was typically gitignored (local-only opt-out) while `review-cycle.json` is meant to be committed (team-wide), and silently converting one to the other could publish an opt-out unintentionally.

To consolidate manually:

```bash
# write the new config explicitly (and commit it if you want team-wide)
echo '{"disabled": true}' > .claude/review-cycle.json
rm .claude/.no-review-gate
```

### Default exclusions

The gate skips paths that are state or preferences rather than reviewable code, so working in them won't force a review:

- Agent task trackers: `.beads/`, `.trekker/`
- IDE state: `.vscode/`, `.idea/`, `.zed/`, `.cursor/`, `.fleet/`
- Gate's own state: `.claude/.review-mark`, `.claude/.review-in-progress`, `.claude/.review-pr-in-progress`, `.claude/.review-stop-block`, plus the legacy `.claude/.no-review-gate` marker (still recognized indefinitely as a fallback)

These directories are excluded at any depth, so a monorepo `subproject/.beads/` is skipped too. `/review-cycle:review` still works manually against excluded paths if you want a pass.

### Adding new `ignore` patterns

Editing `.claude/review-cycle.json` itself drifts the sentinel by design: the config file is force-included in the hash and cannot be excluded by any pattern (including `**`). The flow is:

1. Edit `.claude/review-cycle.json` and add the patterns you want
2. Run `/review-cycle:review` once; reviewers see the config change (and any matching source edits) and you mark
3. From now on, changes within the new patterns don't trip the gate

This prevents an unreviewed config edit from silently hiding source drift.

### Global kill-switch

Emergency disable for all hooks (use if something goes wrong):

```bash
touch ~/.claude/.disable-review-gate
```

Remove the file to re-enable.

### Gitignore the sentinel

The sentinel and the Stop gate's markers are per-project state, not source. Add to your project's `.gitignore` (`/review-cycle:init` does this, sourcing the list from `review-sentinel paths`; installs that ran init before 0.10.0 should re-run it once to pick up the marker paths):

```text
.claude/.review-mark
.claude/.review-in-progress
.claude/.review-pr-in-progress
.claude/.review-stop-block
```

The config file (`.claude/review-cycle.json`) is meant to be committed so the team gets consistent gate behavior. Don't gitignore it.

## State files

```text
${PROJECT}/.claude/.review-mark           two-line sentinel (anchor + sha256)
${PROJECT}/.claude/review-cycle.json      per-project config (disabled, ignore)
${PROJECT}/.claude/.review-in-progress    cycle-running marker (Stop gate passes while fresh)
${PROJECT}/.claude/.review-pr-in-progress review-pr marker (Stop gate only; never licenses mark)
${PROJECT}/.claude/.review-stop-block     state hash the Stop gate last blocked on
${PROJECT}/.claude/.no-review-gate        legacy opt-out marker (still honored)
~/.claude/.disable-review-gate            global kill-switch (user-touched)
```

## Troubleshooting

**Hooks don't fire after install.**
Run `/reload-plugins`. If still nothing, check `claude --debug` for hook registration errors. Verify hook scripts are executable (`ls -l plugins/review-cycle/hooks/`).

**Infinite loop / Claude can't stop.**
Touch the global kill-switch immediately: `touch ~/.claude/.disable-review-gate`. Then file an issue with hook output. The sentinel-based gate should prevent this, but the kill-switch is the safety net.

**Stop hook fires on every turn even after running the cycle.**
The cycle didn't successfully write the sentinel. Check `${PROJECT}/.claude/.review-mark` exists and contains a `sha256:<hex>` line. Re-run `/review-cycle:review` — it should write the sentinel as its final step.

**Commit blocked even though the changes were just reviewed.**
The gate compares the current state against the last mark; a block after a real review means the state changed *after* marking, not that the review didn't count. Diagnose first:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" status
```

It prints the stored mark, the current hash, and a one-line verdict. Common causes of post-review drift, in observed order: a commit-time formatter mutating files (see the next entry), a hook manager restoring the index after a rejected commit (lefthook does this — your staged files are gone; re-stage before retrying), and ordinary edits after the mark, including agent bookkeeping files not covered by the default exclusions. Two things that are *not* the cause: staging order (marking works before or after `git add` — staged, unstaged, and untracked forms of the same content hash identically) and committing in batches (the mark anchors at the HEAD it was taken from, so splitting one reviewed state into several commits keeps passing).

**Review re-triggers right after a commit, on a clean-looking change.**
A pre-commit hook that mutates files at commit time (a formatter or linter) can leave residual working-tree changes the gate correctly reads as fresh unreviewed drift. The rule for any such hook: it must leave a clean tree — only ever touch files that end up *in* the commit. Two ways to guarantee that:

- **Scope formatters to the staged set, not the whole workspace.** `cargo fmt --all`, `prettier --write .`, etc. reformat files beyond what you're committing; with lefthook's `stage_fixed` those unrelated edits aren't re-staged and are stranded dirty after the commit. Use the staged-file form instead — e.g. `rustfmt --edition <ed> {staged_files}`, `prettier --write {staged_files}`.
- **Normalize before you mark.** Run the formatters as part of the change *before* `/review-cycle:review`, so the marked state already equals the formatted state and the commit-time hook is a no-op.

Beads/Trekker exports are already excluded (at any depth), so `bd`'s commit-time `issues.jsonl` re-export is not the cause — look at formatters/linters.

**Codex is missing or not authenticated.**
A missing CLI is not an error — the cycle skips that leg, runs Claude-only, and names the skip in its summary. To add the leg back: `npm install -g @openai/codex`, then `codex login`, and verify `multi_agent = true` in `~/.codex/config.toml`.

Missing auth reads differently: the CLI is present, so the leg runs and then fails (or, in a non-TTY shell, blocks on a login prompt). The summary reports the auth state the preflight observed — `confirmed`, `no stored session`, or `unknown (probe unsupported)` — and suggests `codex login` only for `no stored session`. `unknown` means the probe itself didn't run, not that your credentials are wrong. A `failed` leg with auth `confirmed` means something else broke mid-review — a revoked session or a rate limit.

**False trigger on a project I don't want gated.**
Write `{"disabled": true}` to `.claude/review-cycle.json` in that project root.

## Local development

To test changes to this plugin:

```bash
git clone https://github.com/oakoss/claude-plugins
cd claude-plugins
claude --plugin-dir ./plugins/review-cycle
```

Then `/reload-plugins` to pick up subsequent edits without restarting.

## License

MIT — see `LICENSE`.
