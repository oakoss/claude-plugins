# review-cycle

Automated multi-agent code review cycle for Claude Code, with a commit gate that admits a commit only when you asked for it and a reviewer saw exactly what it records.

## What it does

After you implement changes, `review-cycle` fans out parallel reviewers, applies fixes per embedded policies, loops until a pass applies no fixes, and runs a final cleanup. Agents work as they like between commits; nothing prompts a review on every turn.

The gate decides at commit time, from two questions:

- **Did you ask for it?** The latest message you typed has to ask for a commit ("commit it", "ship it", "go ahead and commit") or answer yes to the agent's question about one, typed or picked in its question dialog. Pushes need the same. Messages from other sessions, background-task notifications and subagents never count.
- **Did a reviewer see it?** Every path the commit records must hold content some review-cycle reviewer saw — unchanged from when that reviewer was spawned until it reported. An edit after the last review, an inline fix included, is unreviewed until a reviewer sees it again.

Both answers come from what the gate watched in this session: which reviewers the engine spawned, what the working tree held when each started and finished, and which prompts you typed. None of it is a file, so there is nothing to mark, accept, or forge.

## Architecture

```text
Implement changes (no gate while you work)
       ↓
/review-cycle:review (you ask, or the agent runs it before committing)
       ↓
  ┌────┴─────┐
  ↓          ↓
Codex      review-cycle reviewers
(if        (parallel subagents; the gate records
installed)  the tree each one saw)
  └────┬─────┘
       ↓
Aggregate findings → apply fixes
       ↓
Loop until a pass applies no fixes
       ↓
Post-loop pass, once: report-only reviewers
(maintainability + spec) + cleanup
       ↓
Coverage check (confirmation pass if cleanup changed anything)
       ↓
git commit ── the gate checks: you asked? every path reviewed?
```

## Skills

### `/review-cycle:init`

One-time setup helper. Run after installing the plugin to:

- Check for the optional Codex CLI, verify `multi_agent = true` in `~/.codex/config.toml`, and report stored-login state (advisory — auth doesn't gate the leg)
- Check that `git` is present and that the commit gate loaded (see [Requirements](#requirements))
- Optionally append the comment, fix-vs-defer, and evidence policies to your global or project `CLAUDE.md`

Idempotent — safe to run multiple times. Replaces the manual setup steps below.

### `/review-cycle:review`

The one command for the whole cycle. Fans out reviewers, auto-applies the safe fixes, loops until a pass applies none, surfaces report-only findings (spec conformance and structural suggestions) for you to act on, runs a final de-slopify pass, and checks that every changed path is covered. If you asked for a commit, it makes it at the end; otherwise it stops at the summary.

The apparatus scales to the diff: light diffs (docs-only, or ~25 changed lines or fewer of anything) get the code reviewer alone; everything else gets the full conditional fan-out. The loop ends on a pass that applies no fixes, since every fix is content no reviewer has seen; a ceiling (3 light, 5 full) stops a cycle that will not converge, and the summary names what the gate will refuse. The Codex leg joins either tier when it's available. Cleanup is a separate, size-only decision — inline under ~150 changed lines, the cleanup agent above that, whatever the tier. Iterations whose fixes were mechanical, or message-only fixes the agent reproduced and verified, get a narrow confirmation pass — the code reviewer alone, on the fixes' delta — instead of a full fan-out; claims local verification can't reach (another OS or shell, a remote service) add the Codex leg to that pass at reduced effort. A reviewer that stalls is nudged once, then dropped and named in the summary rather than holding the cycle hostage. Every reviewer opens its report with a two-line receipt — the heaviest verification that succeeded, then every verification that did not succeed plus any project check it never attempted — and the summary grades each leg from both lines as `executed`, `partial` with the part it couldn't reach, `static-analysis-only`, or `unknown` when a line is missing. A leg that could not run the project's checks keeps the findings it saw by reading; claims about an external tool's behavior drawn only from a manifest or config become questions instead of fixes, wherever they come from — the label says whether the leg could have checked, not whether the rule applies. A leg that omitted the receipt is labelled but not demoted for that alone, unless something else in its report shows it could not run the checks — a formatting miss should not cost you a finding, but omitting one should not beat admitting it.

The gate remembers what each reviewer saw for the rest of the session, and the next cycle scopes itself to what changed since: a 20-line follow-up to a converged review gets a small review at the delta's tier, not a full re-run. A review from an earlier session does not count; uncommitted work carried across a restart is reviewed again.

Arguments are natural language — no flags:

- bare `/review-cycle:review` — review the uncommitted working tree
- `against <ref>` (e.g. `against main`) — scope to `git diff <ref>..HEAD`
- `max <n>` — override the iteration ceiling
- `effort <level>` — pin the Codex leg's reasoning effort (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`); overrides both the tier cap and your config, raising included

### `/review-cycle:review-pr`

Single-pass, report-only review of a GitHub pull request, run from your machine. Takes a PR number, URL, or branch (bare invocation reviews the current branch's PR). It fetches the PR head into a disposable detached worktree — your checkout, branch, and index are never touched. The fan-out matches the review cycle's, with the intent brief sourced from the PR's title, body, and commits; on the full tier the report-only pair joins the same pass, since a single pass has no fix loop to shield them from. Findings are reported in the conversation with per-reviewer coverage, so "no findings" is never mistaken for "nobody looked". The Codex leg joins when the CLI is installed, briefed and scoped with `--base` against the PR's base branch; `effort <level>` pins its reasoning effort the same way it does in `/review-cycle:review`.

Nothing is fixed and nothing is posted by default. Say `and post` (or ask after reading the report) to publish the findings as a single COMMENT review — never an approval — with fingerprint-marked comments, inline and body-level alike, that deduplicate across re-runs. Its reviewers never count toward your own changes: the gate sees the skill start, and the legs it spawns review the PR, not your working tree.

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

## The commit gate

The gate is a hooks module (`hooks/register.ts`), not a shell script: it keeps what it observes in memory for the session, where no tool the agent holds can reach. It watches:

- **Your prompts.** Only prompts the engine stamps as yours — typed at the terminal, from the Remote Control bridge, or the SDK host's own turn — can grant a commit or push. A grant lasts until your next prompt.
- **Reviewer spawns and completions.** A `review-cycle:*` reviewer spawned from the main session counts once it reports with its two-line receipt. The gate captures the working tree as the reviewer starts and again as it finishes; the review covers a path only if the path was part of the change it was shown and held the same content at both moments. A review that ran but could not be counted is named in the next refusal and in the status tool. `review-cycle:cleanup` edits code and never counts, and reviewers `/review-cycle:review-pr` spawns review a PR, not your tree.
- **Every Bash call.** A command that commits or pushes has to take a shape the gate can check: an optional leading `cd <dir>`, any `git add …`, read-only git commands and steps that commit nothing (`fetch`, `branch`, `tag`, `remote`, a fast-forward with `pull --ff-only` when no `git commit` follows, a statement that only assigns variables with no substitution or redirect; `checkout`, `switch`, `stash` and `worktree` only when no `git commit` follows, since they can change what it records), then one `git commit …` (or one command that makes commits from history: `merge`, `cherry-pick`, `revert`, `pull`, `rebase`) and optionally one `git push …`. A `git add` is joined to what follows with `&&`, so a failed add stops the commit; other steps may also use `;` or newlines. Anything else that commits or pushes — a pipeline, a subshell, a substitution, `bash -c`, `eval`, a wrapper like `timeout` or `xargs`, a git alias for commit (aliases of aliases included, and one defined in the same command), `commit <paths>`, an abbreviated long option (`--ame`), `GIT_INDEX_FILE=`, a `GIT_EDITOR`/`GIT_PAGER` that is more than a program name, and git's commit-writing plumbing (`commit-tree`, `fast-import`, `send-pack`, `subtree push`) — is refused with the shape to use instead. Your shell's aliases are expanded as bash expands them, so `gcam "msg"` is judged exactly like `git commit -s -a -m "msg"`, and an alias of several commands is judged like the commands it stands for. The gate reads them when the session starts, the way Claude Code builds its shell snapshot: `CLAUDE_CODE_SHELL`, else `$SHELL`, whichever names zsh or bash, else zsh, run as a login shell that sources `~/.zshrc` or `~/.bashrc` with no input and with `CLAUDECODE=1` set, then lists them with the same pipeline the snapshot uses. Claude Code writes its own snapshot only once the session's first command has run, so this read is what covers that first command. If the read fails, takes more than ten seconds, or the rc file never gets to the end of it, the gate falls back to the snapshot (under `~/.claude/shell-snapshots/`); if neither can be read, the first command the gate lets through without a check carries a note saying so. Text naming a git commit or push is data only where nothing will run it: an argument to `grep`, `printf` or `gh`, a quoted heredoc into `cat`. Handed to anything that runs code — a shell, an interpreter like `python3`, `find -exec`, a shell reading a pipe or heredoc — it is refused. Commands that make commits from history need your go-ahead but no review: what they record comes from existing commits, not from the working tree. Their `--continue` forms record a conflict resolution, which is new content, so the gate refuses them, as it does `git am`, which applies patches from outside the repository.

For an accepted commit, the gate replays the command's `git add`s against a scratch copy of the index, so it judges exactly the tree the commit would record, then compares each path with the trees reviewers saw. A refusal names every uncovered path as `edited after the last review` or `never reviewed`. The real index is never touched, and a refused `git add … && git commit …` runs neither half.

When a turn you started ends having changed the working tree, and some of what changed has not been seen by any reviewer, the gate sends the agent one prompt telling it to run `/review-cycle:review` and report back, so it does not stop to ask whether to. The gate sends at most one per message of yours. It sends none while a reviewer is still running, none after an interrupted turn, none once a review has been started, and none for unreviewed work left over from before your message. The agent skips the review when your message said not to review, or when it ended the turn on a question you need to answer first.

Scripts and shell functions are opaque: `./release.sh` runs whatever it contains. So after every Bash call, the gate reads what the call added to HEAD's reflog. A commit that slipped past the check — a script that commits, or a pre-commit hook that rewrote a file after the check — is reported back to the agent, which is told to tell you. An entry counts as a commit unless git's own action says it only moved HEAD: a checkout, a reset, a fetch, a fast-forward, a rebase starting or finishing, `gh pr merge` pulling the merged branch. So a commit, amend, merge commit, cherry-pick, revert or rebase pick counts, and so does an entry git gives no known action, which errs toward a report. That includes a commit made on another branch before HEAD came back. Each unbroken run of new commits is judged from where HEAD stood before it, so a rebase counts its own changes and not the upstream it rebased onto, and a commit on a side branch is judged apart from one on this branch. Not seen: a commit built with plumbing and reached by `reset`, which logs only the reset; a commit made in another worktree, which has its own HEAD; in a repository that keeps no HEAD reflog (`core.logAllRefUpdates` off from the start), a commit after which HEAD returns to where it started; and a commit whose reflog entries the same command deleted. The gate says it could not check when HEAD moved and its reflog does not show how, the reflog was expired or rewritten, one command added more than 200 entries, or HEAD is unborn in a reftable repository. A push is seen by the remote-tracking ref it moves or creates, which git logs as `update by push`: one the gate did not check is reported when your latest message did not ask for a push. Not seen: a push to a URL or a remote with no tracking ref, one that deletes a remote branch, one undone before the command ends, one whose reflog git did not keep, and one buried under more than 50 later moves of the same ref in one command.

Subagents never commit or push in the project, and neither does anything run from another worktree of the same repository. Commits in other repositories (a scratch fixture, `git -C /tmp/…`) are not the gate's business. When the gate cannot finish judging a command that may commit or push — git failed, or a target directory does not resolve — it refuses rather than letting it through.

The `mcp__review-cycle__status` tool reports the gate's view: the working tree, the last reviewed tree, which changed paths are uncovered, and whether your latest message asked for a commit or push. The review skill uses it to scope itself.

### Comment-slop check

Runs after every Edit and Write, in the same hooks module as the gate, and also while the gate is switched off. Scans for high-confidence comment slop — section markers, restate-the-code phrasings, hedge prefixes, ticketless TODOs — plus a comment-density check on the text just written (4+ comment lines making up ≥30% of a code edit; a Write payload's shebang and leading header comment block are exempt, since a new file's legitimate header is not an edit). On a hit it injects a directive to fix the comments immediately with a follow-up Edit, so slop is caught at generation time rather than waiting for the review cycle. Never blocks, and scans only files inside a git repository; when git cannot run, the agent is told the scan was skipped. Prose files (`.md`, `.txt`, …) are skipped entirely — `#` is a heading there, and prose cleanup belongs to de-slopify — and comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check.

## Requirements

The commit gate and the comment-slop check are a hooks module, an early-access Claude Code feature. Where hooks modules are off, neither loads and nothing is gated — the review skill still runs, and says in its summary that no gate is active. Turn them on with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` set to `1` in the `env` block of `~/.claude/settings.json`; `/review-cycle:init` checks whether the gate loaded.

While the gate is loaded, Bash inside an `isolation: "worktree"` subagent is refused — an open Claude Code issue (anthropics/claude-code#92533) with any hooks module that watches Bash.

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

The tier adjustment only ever goes down. If you configured `medium` globally, a large diff won't be silently upgraded to `high` — your config is the ceiling. The one thing that outranks both the tier and the config is you, per invocation: say `effort medium` (or any of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) in the arguments to `/review-cycle:review` or `/review-cycle:review-pr` and the Codex leg runs at exactly that effort, raising included — a small diff to a gate condition is light on line count and exactly where deeper reasoning pays. The summary reports which applied (`participated (effort: low)` vs `(effort: inherited)` vs `(effort: medium (explicit))`).

Effort is the tuning axis rather than model name on purpose: `codex review` exposes neither `--model` nor `--profile` (only `-c`), model names churn often enough that Codex ships its own `[notice.model_migrations]` table, and a name pinned inside the plugin would rot into an error or a silent downgrade on someone else's account.

## Configuration

### Turning the gate off

The gate is one setting, `review-cycle.enabled`, in `/config`. Only you can change it: the gate refuses a change from anywhere but the menu. Changing it reloads the gate, which forgets the reviews it had seen. Claude Code also reloads a plugin when your user settings file changes, so the gate refuses an agent's Edit or Write to a JSON file that changes review-cycle's entries under `enabledPlugins` or `pluginConfigs`, `disableAllHooks`, or `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` in `env`. A Bash command that writes while naming one of those keys or a file under `.claude` named `settings…`, or that runs `claude plugin disable` or `uninstall`, is refused too, and so is a Monitor command the gate would otherwise have to judge. The Bash check reads the command's text, so it is a speed bump: a command that builds its target at run time gets past it. It applies to every project; to turn review-cycle off for a single project, disable the plugin there with `enabledPlugins` in that project's `.claude/settings.json`.

### Add the policies to your global CLAUDE.md

The skills embed the comment, fix-vs-defer, and evidence policies, so the cycle itself works without setup. But if you want the same policies active outside the cycle (when Claude is implementing code or addressing a single PR comment), copy the snippets from `reference/policies.md` into `~/.claude/CLAUDE.md`.

### Per-project config: `.claude/review-cycle.json`

Paths that never need review:

```json
{
  "ignore": ["dist/**", "generated/**", "tests/fixtures/large-corpora/**"]
}
```

`ignore` extends the built-in exclusions with pathspec globs. The file is meant to be committed, and it is itself always reviewable: an unreviewed `ignore` entry could hide the change it was added alongside. Malformed JSON adds no patterns.

### Default exclusions

Paths that are state or preferences rather than reviewable code never need review:

- Agent task trackers: `.beads/`, `.trekker/`
- IDE state: `.vscode/`, `.idea/`, `.zed/`, `.cursor/`, `.fleet/`

These are excluded at any depth, so a monorepo `subproject/.beads/` is skipped too.

### Upgrading from 0.18 or earlier

The sentinel is gone, along with `/review-cycle:accept`, the Stop gate, `review-sentinel install-hook`, and every marker file. Nothing reads them any more; in each project that used them you can delete the state directory and the tree refs:

```bash
rm -rf .claude/review-cycle .claude/.no-review-gate
git for-each-ref --format='%(refname)' refs/review-cycle/ | xargs -r -n1 git update-ref -d
```

If you installed the git pre-commit hook, remove it from `.git/hooks/pre-commit` (or your hook manager's config); it calls a binary that no longer ships. `~/.claude/.disable-review-gate` and `.claude/review-cycle.json`'s `disabled` field no longer do anything — use the `/config` setting above.

## Troubleshooting

**Commits are not gated at all.**
The gate did not load. Run `/review-cycle:init`: it reports whether the gate is loaded, and the usual cause is hooks modules being off in this Claude Code build (see [Requirements](#requirements)).

**A commit is refused right after a review.**
The refusal lists the paths and why. `edited after the last review` means content changed after the last reviewer saw it — an inline fix, cleanup, or an edit made while a reviewer was running. Run `/review-cycle:review` again; it scopes itself to what changed. `never reviewed` after a session restart is expected: the gate remembers reviews for the session only.

**"The user's latest message doesn't ask for a commit."**
Say so in your next message ("commit it"). A request made several prompts ago does not carry over, and neither does one relayed by another session.

**A commit landed and the agent reported unreviewed content.**
Usually a pre-commit hook that rewrites files (a formatter) changed content after the gate checked it. Run the formatter before the review — the cycle's canonicalize phase does this when it can find the project's commands — or scope the hook to staged files.

**Codex is missing or not authenticated.**
A missing CLI is not an error — the cycle skips that leg, runs Claude-only, and names the skip in its summary. To add the leg back: `npm install -g @openai/codex`, then `codex login`, and verify `multi_agent = true` in `~/.codex/config.toml`.

Missing auth reads differently: the CLI is present, so the leg runs and then fails (or, in a non-TTY shell, blocks on a login prompt). The summary reports the auth state the preflight observed — `stored session (not exercised)`, `no stored session`, or `unknown (probe unsupported)` — and suggests `codex login` only for `no stored session`. `unknown` means the probe itself didn't run, not that your credentials are wrong. Exit 0 from the probe only means `auth.json` exists and parses; it reports the same for a session whose refresh token has been revoked. A `failed` leg with a stored session means something broke mid-review — a revoked session, or a rate limit.

## Local development

To test changes to this plugin:

```bash
git clone https://github.com/oakoss/claude-plugins
cd claude-plugins
pnpm install
claude --plugin-dir ./plugins/review-cycle
```

Then `/reload-plugins` to pick up subsequent edits without restarting; saving the hooks module reloads it on its own, and a reload forgets the reviews the gate had seen. The module's pure logic is tested with `pnpm test` (vitest), the hooks themselves with `pnpm test:hooks` (`claude plugin test`; hooks modules must be on, see [Requirements](#requirements)), and its types with `pnpm typecheck`.

## License

MIT — see `LICENSE`.
