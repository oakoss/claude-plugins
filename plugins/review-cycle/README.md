# review-cycle

Automated multi-agent code review cycle for Claude Code, with a commit gate that admits a commit only when a reviewer saw exactly what it records, and a push or pull request only when you asked for one or set it to go that far.

## What it does

After you implement changes, `review-cycle` fans out parallel reviewers, applies fixes per embedded policies, loops until a pass applies no fixes or reaches its round limit, and runs a final cleanup. Agents work as they like between commits; nothing prompts a review on every turn.

The gate asks one question of a commit and one of a push:

- **Did a reviewer see it?** Every path a commit records must hold content some review-cycle reviewer saw — unchanged from when that reviewer was spawned until it reported. An edit after the last review, an inline fix included, is unreviewed until a reviewer sees it again. A reviewed commit needs nothing else: it stays on your machine, and undoing one is a `git reset`, so the agent commits reviewed work without asking you, unless your [stop-before setting](#stop-before-how-far-the-agent-goes-without-asking) is `commit`.
- **Did you ask for the push?** The latest message you typed has to ask for one ("push it", "ship it", "ok, we can push", or "delete the branch", since deleting a remote branch is a push) or answer yes to the agent's question about one. After the agent asks to delete a branch it names ("Delete `fix/x` from `origin`?"), "delete it" answers too. Any of these allows every push until your next message, not only the one you named. Opening a pull request with `gh pr create` works the same way: "open a PR", "create the pull request" and "ship it" ask for one, and asking for one also allows the push it needs, unless that push would change the default branch or push a tag. Your [stop-before setting](#stop-before-how-far-the-agent-goes-without-asking) can let either run without asking. When neither allows it, the gate refuses the command and tells the agent to stop and ask you in its reply, naming what it would push and where ("Push `fix/x` to origin?"), with the command quoted and any shell aliases expanded. There is no dialog: you answer in your next message, so "yes" allows it, as does a short go-ahead ("ok, lets do that", "sounds good, go ahead"), and anything else, such as "not yet, rename the helper first", is simply your next request. If the command also commits, the refusal says to run the commit on its own. A force push has to be asked for by name: "force push it" (or "yes" to the agent's "Force-push `fix/x` with a lease?") allows `--force-with-lease` and `--force-if-includes`. A bare `--force`, `-f`, `+refspec` or `--mirror` overwrites whatever the remote holds, so the gate points the agent to `--force-with-lease --force-if-includes` instead, and allows a bare force only when the request itself names it ("force push it without a lease", "bare force push", "push it with `--force`"). A bare force mentioned elsewhere in the message, or in the agent's question, grants nothing. Per git's documentation, `--force-with-lease` alone checks against your remote-tracking ref, which a background fetch can move; `--force-if-includes` closes that gap. Question dialogs, the agent's own or another plugin's, never grant anything. Messages from other sessions, background-task notifications and subagents never count, and a `-p` run, with no one to answer, stays refused.

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
installed)  the tree each one saw; spec conformance
            joins the first round)
  └────┬─────┘
       ↓
Scope wrong for the spec? → stop and ask you
       ↓
Aggregate findings → apply fixes
       ↓
Loop until a pass applies no fixes
(at the round limit: hold the last findings, ask you)
       ↓
Post-loop pass, once: maintainability
(report-only) + cleanup
       ↓
Coverage check (confirmation pass if cleanup changed anything)
       ↓
git commit ── the gate checks: every path reviewed?
```

## Skills

### `/review-cycle:init`

One-time setup helper. Run after installing the plugin to:

- Check for the optional Codex CLI, verify `multi_agent = true` in `~/.codex/config.toml`, and report stored-login state (advisory — auth doesn't gate the leg)
- Check that `git` is present and that the commit gate loaded (see [Requirements](#requirements))
- Optionally append the comment, fix-vs-defer, and evidence policies to your global or project `CLAUDE.md`

Idempotent — safe to run multiple times. Replaces the manual setup steps below.

### `/review-cycle:review`

The one command for the whole cycle. Fans out reviewers, checks the change against its spec in the first round and stops for your decision when the scope is wrong, auto-applies the safe fixes, loops until a pass applies none, names any file the fixes touched in every round, surfaces structural suggestions for you to act on, runs a final de-slopify pass, and checks that every changed path is covered. When the result is clean, it commits it unless you held off; it pushes only when you asked or your stop-before setting allows it.

The apparatus scales to the diff: light diffs (docs-only, or ~25 changed lines or fewer of anything) get the code reviewer alone, plus spec conformance in the first round when a spec exists; everything else gets the full conditional fan-out. The loop ends on a pass that applies no fixes, since every fix is content no reviewer has seen; a ceiling (2 light, 3 full) stops a cycle that will not converge. The last round applies none of its fixes: it lists them and asks whether to apply them, with one more review of the fixes, or commit with them deferred, which the gate admits because the round that found them covered every path. The Codex leg joins either tier when it's available. Cleanup is a separate, size-only decision — inline under ~150 changed lines, the cleanup agent above that, whatever the tier. Iterations whose fixes were mechanical, or message-only fixes the agent reproduced and verified, get a narrow confirmation pass — the code reviewer alone, on the fixes' delta — instead of a full fan-out; claims local verification can't reach (another OS or shell, a remote service) add the Codex leg to that pass at reduced effort. A reviewer that stalls is nudged once, then dropped and named in the summary rather than holding the cycle hostage. One that keeps working past 30 minutes is capped: the gate keeps each reviewer's clock and asks the session to stop it, and the summary lists it apart from the stalled ones. The budget clears the slowest normal reviewers measured (a 16-minute median for a fan-out's slowest leg, 25 minutes for the slowest reviewer type) and cuts off the 60–70 minute runaways. A plugin reload cancels the clocks of reviewers already running. Every reviewer works in its own directory inside one scratch directory per cycle, which the cycle sweeps at the end: it ends any process still running there, including one a stalled or dropped reviewer left behind, and removes the directory. Every reviewer opens its report with a two-line receipt — the heaviest verification that succeeded, then every verification that did not succeed plus any project check it never attempted — and the summary grades each leg from both lines as `executed`, `partial` with the part it couldn't reach, `static-analysis-only`, or `unknown` when a line is missing. A leg that could not run the project's checks keeps the findings it saw by reading; claims about an external tool's behavior drawn only from a manifest or config become questions instead of fixes, wherever they come from — the label says whether the leg could have checked, not whether the rule applies. A leg that omitted the receipt is labelled but not demoted for that alone, unless something else in its report shows it could not run the checks — a formatting miss should not cost you a finding, but omitting one should not beat admitting it.

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
- `review-cycle:spec-conformance-analyzer` — spec axis: does the diff implement what the originating issue/task/PRD asked for? Runs in the first round of `review` when a spec source is discoverable, so scope creep against a current spec stops the cycle before any review fix, while a missing or contradicted spec line is fixed like any defect; reported separately from quality findings.

## The commit gate

### What it guards against

The gate is there for a well-meaning agent that commits before a review, or pushes before you asked. It checks the commands agents write, such as `git commit`, `git add … && git commit`, a push, or an alias for one, before they run, and refuses one that names a commit or push in a shape it cannot read rather than guess. A command that commits from inside something the gate cannot see into, such as `npm version`, `make release` or a project script, is not checked beforehand: a commit it makes without a review, or a push you did not ask for, is reported after the command runs, so the agent tells you, but it is not refused. If the gate cannot read your shell aliases, an aliased commit is not checked, and the first command the gate lets through unchecked carries a note saying so.

It is not a sandbox. An agent set on getting around it can: an obscure shell construct or an environment trick can run git where the gate does not look, and your own shell (`!`) is never stopped. For containment against an adversarial agent, use an OS-level sandbox; the gate's job is to make the careless path fail loudly, not to make evasion impossible. A gap an ordinary command falls into is a bug; one that needs a deliberately obscure command is out of scope.

### How it works

The gate is a hooks module (`hooks/register.ts`), not a shell script: it keeps what it observes in memory for the session, where no tool the agent holds can reach. It watches:

- **Your prompts.** Only prompts the engine stamps as yours — typed at the terminal, from the Remote Control bridge, or the SDK host's own turn — can grant a push or a pull request. A grant lasts until your next prompt.
- **Reviewer spawns and completions.** A `review-cycle:*` reviewer spawned from the main session counts once it reports with its two-line receipt. The gate captures the working tree as the reviewer starts and again as it finishes; the review covers a path only if the path was part of the change it was shown and held the same content at both moments. A review that ran but could not be counted is named in the next refusal and in the status tool. `review-cycle:cleanup` edits code and never counts, and reviewers `/review-cycle:review-pr` spawns review a PR, not your tree.
- **What reviewers change.** A reviewer works on a copy outside the repository, such as a `mktemp -d` directory under `/tmp`. While it runs, the gate refuses its Edit, Write and NotebookEdit calls on a path inside the repository. Its Bash commands are not refused, since the gate cannot tell where a command writes. Instead the gate compares four things before and after each one: HEAD's commit and branch, the staged entries, the working tree, and the local and worktree git config. The reads leave the index, refs and config alone; the working-tree capture adds unreferenced objects to `.git/objects`, which `git gc` removes. When something changed, the gate tells the reviewer it may have been another agent, asks it to put back a change it made and to report it either way, and lists the change in the status tool under `reviewerChanges`. A part the gate could not read is noted there too. Some things are not checked:
  - writes outside the repository;
  - anything under `.git/` beyond HEAD and the config, such as branches, the stash or hooks;
  - what a background command changes after it returns;
  - ignored files, such as build output or `node_modules`, which never reach a commit;
  - commands a reviewer runs through Monitor;
  - the edits of a subagent a reviewer spawns.

  Each comparison costs about two working-tree captures per reviewer command; one measured 48 ms on a 123-file repository.

- **Every Bash call.** A command that commits or pushes has to take a shape the gate can check: an optional leading `cd <dir>`, any `git add …`, read-only git commands and steps that commit nothing (`fetch`, `branch`, `tag`, `remote`, a fast-forward with `pull --ff-only` when no `git commit` follows, a statement that only assigns variables with no substitution or redirect; `checkout`, `switch`, `stash` and `worktree` only when no `git commit` follows, since they can change what it records), then one `git commit …` (or one command that makes commits from history: `merge`, `cherry-pick`, `revert`, `pull`, `rebase`) and optionally one `git push …`. A `git add` is joined to what follows with `&&`, so a failed add stops the commit; other steps may also use `;` or newlines. The whole command may end in a pipe into `tail` with at most one line or byte count (nonzero, or `+N` to start from line N), or `wc` with its counting flags, as in `git push 2>&1 | tail -3`: those read all of git's output and run nothing. The filter takes no file, redirect or substitution, and the pipeline is not backgrounded with `&`. Other readers such as `head`, `grep` or `cat file` may stop reading early, which can kill a pre-commit hook still printing, so they are refused. Anything else that commits or pushes — a pipeline, a subshell, a substitution, `bash -c`, `eval`, a wrapper like `timeout` or `xargs`, a git alias for commit (aliases of aliases included, and one defined in the same command), `commit <paths>`, an abbreviated long option (`--ame`), `GIT_INDEX_FILE=`, a `GIT_EDITOR`/`GIT_PAGER` that is more than a program name, and git's commit-writing plumbing (`commit-tree`, `fast-import`, `send-pack`, `subtree push`) — is refused with the shape to use instead. Your shell's aliases are expanded as bash expands them, so `gcam "msg"` is judged exactly like `git commit -s -a -m "msg"`, and an alias of several commands is judged like the commands it stands for. An alias for `git` itself is expanded too: `git='git --no-pager'` is judged as git with that option, but a command whose expansion no longer runs git as the gate reads it (`git='hub'`, or git wrapped in a runner the gate refuses) is refused, with `\git …` to run git as itself. A command name or git subcommand the shell would expand as a pattern is refused: `*`, `?`, a closed `[…]` or `{…}`, zsh's `#`, `^` and inner `~`, and a `(` inside a word (`/usr/bin/g(i)t`, `@(git)`). The gate reads your aliases when the session starts, the way Claude Code builds its shell snapshot: `CLAUDE_CODE_SHELL`, else `$SHELL`, whichever names zsh or bash, else zsh, run as a login shell that sources `~/.zshrc` or `~/.bashrc` with no input and with `CLAUDECODE=1` set, then lists them with the same pipeline the snapshot uses. Claude Code writes its own snapshot only once the session's first command has run, so this read is what covers that first command. If the read fails, takes more than ten seconds, or the rc file never gets to the end of it, the gate falls back to the snapshot (under `~/.claude/shell-snapshots/`); if neither can be read, the first command the gate lets through without a check carries a note saying so. Text naming a git commit or push is data only where nothing will run it: an argument to `grep`, `printf` or `gh`, a quoted heredoc into `cat`. Handed to anything that runs code — a shell, an interpreter like `python3`, `find -exec`, a shell reading a pipe or heredoc — it is refused. Commands that make commits from history need neither a review nor your go-ahead, and are not reported afterwards: what they record comes from existing commits, not from the working tree. Their `--continue` forms record a conflict resolution, which is new content, so the gate refuses them, as it does `git am`, which applies patches from outside the repository.

For an accepted commit, the gate replays the command's `git add`s against a scratch copy of the index, so it judges exactly the tree the commit would record, then compares each path with the trees reviewers saw. A refusal names every uncovered path as `edited after the last review` or `never reviewed`. The real index is never touched, and a refused `git add … && git commit …` runs neither half.

When a turn you started ends having changed the working tree, and some of what changed has not been seen by any reviewer, the gate sends the agent one prompt telling it to run `/review-cycle:review` and report back, so it does not stop to ask whether to. The gate sends at most one per message of yours. It sends none while a reviewer is still running, none after an interrupted turn, none once a review has been started, and none for unreviewed work left over from before your message. The agent skips the review when your message said not to review, or when it ended the turn on a question you need to answer first.

Scripts and shell functions are opaque: `./release.sh` runs whatever it contains. So after every Bash call, the gate reads what the call added to HEAD's reflog. A commit that slipped past the check — a script that commits, or a pre-commit hook that rewrote a file after the check — is reported back to the agent, which is told to tell you. An entry counts as a commit unless git's own action says it only moved HEAD: a checkout, a reset, a fetch, a fast-forward, a rebase starting or finishing, `gh pr merge` pulling the merged branch. So a commit, amend, merge commit, cherry-pick, revert or rebase pick counts, and so does an entry git gives no known action, which errs toward a report. That includes a commit made on another branch before HEAD came back. Each unbroken run of new commits is judged from where HEAD stood before it, so a rebase counts its own changes and not the upstream it rebased onto, and a commit on a side branch is judged apart from one on this branch. Not seen: a commit built with plumbing and reached by `reset`, which logs only the reset; a commit made in another worktree, which has its own HEAD; in a repository that keeps no HEAD reflog (`core.logAllRefUpdates` off from the start), a commit after which HEAD returns to where it started; and a commit whose reflog entries the same command deleted. The gate says it could not check when HEAD moved and its reflog does not show how, the reflog was expired or rewritten, one command added more than 200 entries, or HEAD is unborn in a reftable repository. A push is seen by the remote-tracking ref it moves or creates, which git logs as `update by push`: one the gate did not check is reported when your latest message did not ask for a push. Not seen: a push to a URL or a remote with no tracking ref, one that deletes a remote branch, one undone before the command ends, one whose reflog git did not keep, and one buried under more than 50 later moves of the same ref in one command.

Subagents never commit or push in the project, and neither does anything run from another worktree of the same repository. Commits in other repositories (a scratch fixture, `git -C /tmp/…`) are not the gate's business. When the gate cannot finish judging a command that may commit or push — git failed, or a target directory does not resolve — it refuses rather than letting it through.

The `mcp__review-cycle__status` tool reports the gate's view: the working tree, the last reviewed tree, which changed paths are uncovered, whether your latest message asked for a push or a pull request, and whether your stop-before setting lets either run. The review skill uses it to scope itself. It also lists `cappedReviews`: each reviewer that ran past its budget, and whether the request to stop it was refused or failed. `mcp__review-cycle__scratch` makes a cycle's scratch directory and `mcp__review-cycle__sweep` sweeps it; both work with the gate switched off.

### Comment-slop check

Runs after every Edit and Write, in the same hooks module as the gate, and also while the gate is switched off. Scans for high-confidence comment slop — section markers, restate-the-code phrasings, hedge prefixes, ticketless TODOs — plus a comment-density check on the text just written (4+ comment lines making up ≥30% of a code edit; a Write payload's shebang and leading header comment block are exempt, since a new file's legitimate header is not an edit). On a hit it injects a directive to fix the comments immediately with a follow-up Edit, so slop is caught at generation time rather than waiting for the review cycle. Never blocks, and scans only files inside a git repository; when git cannot run, the agent is told the scan was skipped. Prose files (`.md`, `.txt`, …) are skipped entirely — `#` is a heading there, and prose cleanup belongs to de-slopify — and comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check.

An edit made through Bash skips this check. So while the gate is on, a Bash command that could write — a redirect, `tee`, `sed`, `cp`, an interpreter, a nested shell — is measured: the working tree is compared before and after it, and if files changed the agent gets a note naming them and telling it to use Edit or Write. The comparison covers the files a review covers: those in the repository that are tracked or not ignored, apart from the review exclusions (`.beads/`, editor folders) and the `ignore` patterns, however the command spelled their paths. A gitignored file or one outside the repository is not seen. A file saved by something else while the command ran is named too, so the note says the files changed while it ran rather than that it changed them. The note never refuses the command, which has already run. Background commands and review subagents are not measured.

### Findings ledger

The review skill keeps a per-repository ledger of the findings a cycle settled without fixing: deferred, rebutted, examined and left alone on purpose, or raised as a question. At the start of a cycle it reads the entries for the changed paths into every reviewer's brief, so a reviewer in a later session or a follow-up PR does not re-raise what an earlier cycle decided. Each entry records the file as the last cycle to carry it reviewed it; when the file has changed since and the change touches the code the entry cites, the entry is open again. An entry settled more than 90 days ago is open again too, so a deferral nobody revisits does not stay settled for good. At the end the cycle records what it settled, carries forward what it settled again unchanged, and removes the entries it fixed. Fixed findings are never recorded.

The ledger is served by the hooks module's `mcp__review-cycle__ledger` and `mcp__review-cycle__ledger_record` tools, also while the gate is switched off. It lives in the plugin's own store under your Claude Code configuration directory, not in the repository, so it needs no gitignore entry and never shows up as a change. Worktrees of one repository share it. It keeps the newest 100 entries per repository, and ledgers for the 10 repositories recorded to most recently; to drop an entry sooner, ask the agent to resolve it by id. A carried entry whose file is gone is dropped. Stored entries this version cannot read, such as ones a newer version wrote, are dropped by the next record, which says how many.

## Requirements

The commit gate, the comment-slop check and the findings ledger are a mod, which Claude Code loads by default from v2.1.287. Where mods do not load — an older Claude Code, a session started with `--bare`, `disableAllHooks` in your settings, or an organization policy that stops user-installed mods — nothing is gated: the review skill still runs, and says in its summary that no gate is active. `/review-cycle:init` checks whether the gate loaded, and `/plugin` names the mods a session loaded. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, which turned mods on during early access, no longer does anything; remove it from your settings.

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

The gate is one setting, `review-cycle.enabled`, in `/config`. Only you can change it: the gate refuses a change from anywhere but the menu. Changing it reloads the gate, which forgets the reviews it had seen. Claude Code also reloads a plugin when your user settings file changes, so the gate refuses an agent's Edit or Write to a JSON file that changes review-cycle's entries under `enabledPlugins` or `pluginConfigs`, or `disableAllHooks`. A Bash command that writes a file under `.claude` named `settings…`, or that runs `claude plugin disable`, `uninstall` or `remove` (or removes a marketplace, which uninstalls its plugins), is refused too, and so is a Monitor command the gate would otherwise have to judge. The Bash check reads the command as the shell would to find what writes: a redirect other than to `/dev/null`, a word that is a writer such as `cp`, `tee`, `rsync` or `sed -i`, or an interpreter. A command that writes and names a settings file under `.claude` anywhere in its text is refused, so reading settings into another file is refused too. The plugin subcommands count where a word is `claude` (or its npm package, run through `npx`) and a later word is `plugin`. A writer, redirect or plugin subcommand inside a longer quoted argument, such as an issue description, does not count, and neither does `grep -n enabledPlugins README.md > /tmp/hits`. A command that hands a command line to a shell (`bash -c`, `eval`, `sudo -s`, `env -S`, or a wrapper such as `watch` or `tmux`), a `claude -p` prompt, or a command the gate cannot parse is checked by its text. Writing a switch into a shell rc file is out of scope. It applies to every project; to turn review-cycle off for a single project, disable the plugin there with `enabledPlugins` in that project's `.claude/settings.json`.

### Stop before: how far the agent goes without asking

`review-cycle.stopBefore`, in `/config`, picks the first step the agent asks you about: `commit`, `push` (the default), `open PR`, `merge`, `release` or `never stop`. Steps before it run without asking. Each push, pull request, merge or release the gate lets through that way, a push a script makes included, logs a dim line ("ran a push without asking…") naming the setting and where it came from, and tells the agent the same; the line says the step ran, not that it succeeded. A commit below the line is not noted: it is reviewed and local. At or past it, a step needs your request, as above; a `-p` run, with no one to answer, stays refused, so at `commit` it can never commit.

The merge step is `gh pr merge` and `gh pr review --approve`; "merge it", "merge the PR" or "merge 116" asks for a merge, and "approve it" for an approval. A merge you asked for covers its `--delete-branch`, `--squash` and `--auto`. A merge asked for once the pull request is ready ("merge it when it's ready", "merge 116 once CI passes", "merge it as soon as the checks are green") covers only `gh pr merge --auto`, which leaves the waiting to GitHub; a merge without `--auto` is refused, whatever the setting. GitHub waits only on what it requires to merge, such as required checks, so a pull request whose failing or pending checks are not required merges at once. The rest of that sentence is not granted, since it may wait on the same condition ("merge it when it's ready, then release it" grants only the merge). Any other condition ("merge it when I say so", "commit when the tests pass") asks for nothing, since the gate cannot see it come true. `--admin`, which merges past branch protection, is never the agent's: the gate refuses it and has the agent give you the command to run. "merge main into it" names branches, not a pull request, so it asks for nothing: that is a local `git merge`, judged when it is pushed. The release step is `gh release create` (and its other writes: `edit`, `delete`, `delete-asset`, `upload`), and merging oakum's version pull request: unless your setting lets both a merge and a release through, the gate asks `gh pr view` which branch a merge comes from, and a merge of `oakum/version-packages` is a release. When that lookup fails, or `GH_REPO=`, `GIT_DIR=` or `env -C` picks where the merge runs, the merge asks; a merge you asked for then asks for a release too. A package publish is the release step as well: `npm publish` (or an abbreviation such as `npm pu` or `npm pub`), `pnpm publish` (with `-r`, `recursive` or `--filter`), `yarn npm publish` and `yarn publish`, `bun publish`, `cargo publish`, and `oakum release`, wherever they stand in the command (`pnpm exec oakum release`, `~/.cargo/bin/cargo publish`). A dry run of npm, pnpm, bun or cargo publishes nothing and runs: `--dry-run` anywhere after the tool, unless a later `--no-dry-run` or a `false` value turns it off, and cargo's `-n`, alone or in a cluster (`-qn`). Yarn's dry run, and `oakum release`, which has none, count as a release. A package script (`pnpm release`, `npm run publish`, and anything after `npm run`) runs whatever it holds, so it is not read, as `make release` is not; a publisher whose command is built at run time before a publish word (`npm "$CMD" publish`) is refused until written out. Marking a draft ready for review is the pull request step: `gh pr ready` (not `--undo`), the MCP `update_pull_request` with `draft: false`, and the GraphQL `markPullRequestReadyForReview`; "mark it ready for review" or "ready for review" asks for it, and a message that mentions a pull request being ready for review holds the steps, as other mentions do. Unless both a merge and a release may run, a merge that shares its command with other steps is refused until it runs on its own, since an earlier step can change which pull request it reaches. A `gh pr merge` or `gh pr review` whose pull request or flags are built at run time (`"$PR"`, `$FLAGS`), whose option value is unquoted (`-b $(cat reply.txt)`, which the shell can split into flags), or which is fed by `xargs`, is refused too, since a hidden `--approve`, `--admin` or `--repo` would go unseen: the agent writes them out, quoting values (`-b "$(cat reply.txt)"`; `"$@"` and `"${a[@]}"` split even in quotes, so they are refused too). "release it", "cut a release" or "publish it" asks for one, and a message that mentions publishing holds it. A publish names a package, never git work: "publish the package to npm" asks for a release, while "publish the branch", an editor's name for a first push, asks for nothing. "ship it" still stops at the pull request. A comment on GitHub (`gh pr comment`, `gh issue comment`, a `gh pr review` that does not approve) is off the ladder: it needs your request, such as "address the review comments" or "reply to the reviewer", whatever the setting. A request to approve or to reply lifts no hold. gh aliases and extensions are not read: a gh word gh does not ship (`gh m`, `gh pr m`, `gh dash`) is refused, whatever you asked for, and the agent runs the gh command itself, written out. A shell alias for gh (`alias g=gh`) is expanded first, as for git. A gh command whose command or verb comes from `xargs`'s input is refused as unread.

A `gh api` call is judged as the gh command it stands for. Its method is the one `-X` names, else `POST` when it sends fields or `--input`, else `GET`, as gh decides; a read is not gated, though a call with an argument built at run time that could be an option (`"$ARGS"`, `"$URL"`) has to name `--method GET` to read. The endpoint may be a path or a full URL; a URL on another host, `--hostname`, or `GH_REPO=` picks another repository. The REST endpoints under `repos/<owner>/<repo>/` that open a pull request (`pulls`), merge one (`pulls/<n>/merge`), review one (`pulls/<n>/reviews…`, an approval when `event` is `APPROVE`), comment (`issues/…/comments`, `pulls/…/comments`) or write a release (`releases…`) take that step; a merge names its pull request, and the repository when the path names one, to the same `gh pr view` lookup. A GraphQL mutation (`gh api graphql -f query=…`) is read by name: `createPullRequest` and `revertPullRequest` open a pull request; `mergePullRequest`, `enablePullRequestAutoMerge` and `enqueuePullRequest` merge, and since they name the pull request by id, they ask where a release could follow; `addPullRequestReview` and `submitPullRequestReview` approve when their `event` argument, or the variable it names (`-f event=…`, `-f 'input[event]=…'`), is `APPROVE`; the review-comment and comment mutations comment. Text inside the query's strings and comments names no mutation. GitHub's schema has no mutation that writes a release. A query or review event built at run time or read from a file (`-f query="$Q"`, `-F query=@q.graphql`, `--input`), a write whose endpoint is built at run time, and a write whose arguments come from `xargs` are refused until written out. A write to any other endpoint or mutation, such as opening an issue, runs as its gh command would.

A GitHub MCP tool is judged the same way, by its name under any server name: `create_pull_request` and `create_pull_request_with_copilot` open a pull request, `merge_pull_request` merges (looked up with its number and repository on gh's default host; without both it asks where a release could follow), `pull_request_review_write` approves when its event is `APPROVE` and comments otherwise, and `add_issue_comment`, `update_issue_comment`, `add_reply_to_pull_request_comment` and `add_comment_to_pending_review` comment. The official server ships no tool that writes a release. A comment on an issue counts like one on a pull request, since the API does not tell them apart.

Some writes change branches on GitHub directly, past the commit gate, so no review covers them: the MCP tools `push_files`, `create_or_update_file`, `delete_file` and `create_branch`, and the `gh api` writes to `contents/…`, `git/refs…`, `merges`, `merge-upstream` and `branches/…/rename`, and the GraphQL `createCommitOnBranch`, `createLinkedBranch`, `createRef`, `updateRef`, `updateRefs`, `deleteRef` and `mergeBranch`. They are the push step: a request to push allows them, except a forced ref update (`force=true`, or a ref mutation's `force` not written or set as `false`), which has no lease and so needs a request for a bare force. When your setting lets a push through, one that names its branch runs unless that branch is the repository's default, which the gate asks `gh repo view` for (for `{owner}/{repo}`, the current repository); a lookup that fails or prints nothing asks. The lookup uses gh's default host, which is assumed to be the one the MCP server writes to. These ask whatever the setting: one that names no branch or a branch read at run time, an MCP tool that names no repository, and one that pushes a tag, renames, deletes or force-updates a ref, or is a GraphQL mutation. Updating a pull request's branch from its base (`gh pr update-branch`, `update_pull_request_branch`, `pulls/<n>/update-branch`) is a push to that pull request's own branch: the gate asks `gh pr view` for it and asks when it is the default branch. One it cannot look up (by id, as GraphQL's `updatePullRequestBranch` names it, or after another step in the command), one whose branch is in a fork, and `gh pr update-branch --rebase` (or GraphQL's `updateMethod: REBASE`), which rewrites the branch and so needs a request for a bare force, ask whatever the setting. The default branch is read for the repository the pull request's branch lives in, so a URL naming another repository is checked against that one. Subagents are refused all of these, as they are the gh commands.

A script that merges or releases is not seen afterwards, since nothing local records it.

The line moves as a project grows: a new project with little written down might stop before `commit`, so the agent asks before each one, and move to `push` and later steps as its docs carry more of the decisions. A commit always needs a review first, whatever the setting; history commands such as `merge` and `rebase` stay off the ladder.

Some pushes ask whatever the setting, unless your latest message asks for them: a force push (see above), a push to the remote's default branch, a tag push, a push that deletes or force-updates a remote ref or pushes every branch, one whose remote or branch is built at run time, and one after a git step in the same command other than a read or a commit, such as a checkout, fetch or rebase, which can change where it goes. Before letting a push run without asking, the gate runs the same push as a dry run (`--dry-run` first, then `--dry-run --porcelain --no-verify --no-quiet --recurse-submodules=no` after its own options, so no hook runs, a submodule's included), so git itself names the refs it would update with all of its push configuration applied (`push.default`, `branch.<name>.pushRemote`, `remote.<name>.push`, `push.followTags`), and reads each remote's default branch with `git ls-remote --symref`. A ref already up to date still counts, since a commit in the same command lands before the push. That costs a round trip to the remote; when either fails (offline, or it would prompt for credentials), or the dry run names no ref, the push asks. A push option given no value (`git push origin main -o`) is refused, since the dry run's flags would become its value. At the default setting no dry run is made. A push from inside a script such as `./release.sh` cannot be judged before it runs, so these checks do not reach it; it is reported afterwards.

Asking for a pull request ("open a PR") lets the push it needs run without a note, through the same checks: a PR request does not cover a push to the default branch or a tag.

The setting also applies per project, under `pluginConfigs` in the project's `.claude/settings.json` (keyed `review-cycle` or `review-cycle@<marketplace>`, with `{ "options": { "stopBefore": "…" } }`). Claude Code does not read plugin options from project files, so the gate reads them itself. A committed `.claude/settings.json` can only make it stop earlier than your own value; your gitignored `.claude/settings.local.json` can set any step. In either file, a value outside the options stops before every step, so a typo never loosens it; when a file cannot be read, the gate also stops before every step and names the file. Only you change it: the gate refuses a change from anywhere but the menu, and an agent's edit to the entry in a settings file, as it does for the off switch. The status tool reports the step in force, where it came from, and whether a commit, an ordinary push, a pull request, a merge or a release may run now (`mayCommit`, `mayPush`, `mayOpenPr`, `mayMerge`, `mayRelease`), and whether a reply on GitHub (`commentRequested`) or a merge once the pull request is ready (`autoMergeRequested`) was asked for.

A message that mentions pushing, shipping, opening a pull request, merging, approving or releasing without asking for it ("don't push yet", "did the merge go through?", "anything else before we ship?", "the release notes look good"), or answers "not yet" to the agent's offer of one, holds pushes, pull requests, merges, approvals and releases until a message asks for one, whatever the setting. A hold is read by mention, not by grammar, so it sometimes holds when you meant nothing by it; the cost is one question. What the same message asks for still runs ("push it; don't open a PR yet" pushes). A hold never stops a commit, and it lives in the session's memory, so a second session does not see it.

The gate reads these gh commands wherever they run as a command, as it reads git: behind variable assignments or a wrapper such as `env`, `sudo` or `timeout`, with gh's options before or after `pr`. Text inside quotes is not read, so `bash -c "gh pr create"` goes unseen. A gh command beside a git commit or push in one command is refused; run them apart. Monitor refuses them, as it does a push. Subagents never commit, push, open, merge, approve or comment on a pull request, or release, in the project, whatever the setting.

### The review nudge

When a turn ends with changes no reviewer has seen, the gate prompts the agent to run `/review-cycle:review`, once per message of yours. It stays quiet when the turn's last message ends with a question mark, bold or italic included, since the agent is waiting on your answer. `review-cycle.nudge`, in `/config` (on by default), turns it off. Per project, `{ "options": { "nudge": false } }` under `pluginConfigs` in `.claude/settings.json` turns it off there, for a repository where reviews do not pay, such as a notes vault; your `.claude/settings.local.json` decides either way, over both. A settings file the gate cannot read, or a `nudge` that is not `true` or `false`, sets nothing, and the other settings decide. The commit gate is unaffected: a commit still needs a review.

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
The gate did not load. Run `/review-cycle:init`: it reports whether the gate is loaded. Either the gate is switched off in `/config`, or mods did not load in this session (see [Requirements](#requirements) for the causes).

**A commit is refused right after a review.**
The refusal lists the paths and why. `edited after the last review` means content changed after the last reviewer saw it — an inline fix, cleanup, or an edit made while a reviewer was running. Run `/review-cycle:review` again; it scopes itself to what changed. `never reviewed` after a session restart is expected: the gate remembers reviews for the session only.

**"The user's latest message doesn't ask for a push."**
The agent tried to push without your asking, and should now be asking you in its reply. Answer yes to its question, or ask in your next message ("push it"). The same goes for "doesn't ask for a pull request" (or a merge, an approval, a release or a comment on GitHub), and for "held off", which follows a message that told it to hold off. To let it push without asking, set [stop before](#stop-before-how-far-the-agent-goes-without-asking) to a later step. A request made several prompts ago does not carry over, and neither does one relayed by another session; a `-p` run has no one to answer, so its push stays refused.

**A commit landed and the agent reported unreviewed content.**
Usually a pre-commit hook that rewrites files (a formatter) changed content after the gate checked it. Run the formatter before the review — the cycle's canonicalize phase does this when it can find the project's commands — or scope the hook to staged files.

**Codex is missing or not authenticated.**
A missing CLI is not an error — the cycle skips that leg, runs Claude-only, and names the skip in its summary. To add the leg back: `npm install -g @openai/codex`, then `codex login`, and verify `multi_agent = true` in `~/.codex/config.toml`.

Missing auth reads differently: the CLI is present, so the leg runs and then fails: measured on codex-cli 0.159.2 with no credentials and no terminal, `codex review` retried and exited 1 after about 15 seconds with `401 Unauthorized`, and did not wait for a login. The summary reports the auth state the preflight observed — `stored session (not exercised)`, `no stored session`, or `unknown (probe unsupported)` — and suggests `codex login` only for `no stored session`. `unknown` means the probe itself didn't run, not that your credentials are wrong. Exit 0 from the probe only means `auth.json` exists and parses; it reports the same for a session whose refresh token has been revoked. A `failed` leg with a stored session means something broke mid-review — a revoked session, or a rate limit.

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
