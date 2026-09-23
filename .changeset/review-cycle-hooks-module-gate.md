---
review-cycle: minor
---

### Breaking: the commit gate is now a hooks module, and the sentinel is gone

The gate now decides from what it watched in the session, not from a file an agent could write. A commit is admitted only when:

- **you asked for it**: your latest typed message asks for a commit ("commit it", "ship it"), answers yes to the agent's question about one, or picks a commit option in its question dialog. Messages from other sessions, background-task notifications and subagents never count. Pushes need the same.
- **a reviewer saw it**: every path the commit records was part of the change a review-cycle reviewer was shown, and held the same content from when that reviewer was spawned to when it reported. An edit after the last review, inline fixes included, is unreviewed until a reviewer sees it again.

A refused commit names each uncovered path as `edited after the last review` or `never reviewed`. Commands that commit or push must take a shape the gate can check: `git add …` joined with `&&`, read-only git commands and steps that commit nothing (`fetch`, `branch`, `tag`), then `git commit …` (or one of `merge`, `cherry-pick`, `revert`, `pull`, `rebase`, which need your go-ahead but no review; their `--continue` forms and `git am` are refused, since they record new content), then optionally `git push …`. Other shapes that visibly commit or push are refused with that shape as the fix: pipelines, substitutions, `bash -c`, `eval`, wrappers like `timeout` or `xargs`, git aliases for commit, `commit <paths>`, abbreviated long options, `GIT_INDEX_FILE=`, and commit-writing plumbing like `commit-tree`. Your shell aliases are expanded as bash expands them, so `gcam "msg"` is judged as the `git commit` it stands for. A script that commits is opaque; the gate reports its commit afterwards rather than preventing it. Text naming git that nothing will run, such as a quoted `grep` pattern or a heredoc body, no longer trips the gate. A commit or push request is read narrowly: "commit it", "push to main" and "fix the parser and commit" grant, while a sentence that also holds off, sets a condition or describes a process ("push it, but not until CI passes", "usually I review, then commit") grants nothing, and the agent asks. Subagents never commit or push in the project.

**Removed:**

- `bin/review-sentinel` and the mark
- `/review-cycle:accept`
- the Stop gate, which prompted a review at the end of every turn
- the SessionStart seed
- `review-sentinel install-hook`
- `~/.claude/.disable-review-gate`, `.claude/.no-review-gate`, and `review-cycle.json`'s `disabled` field

The gate's one off switch is `review-cycle.enabled` in `/config`, which only you can change. Claude Code reloads the plugin when user settings change, so an agent's change to review-cycle's `enabledPlugins` or `pluginConfigs` entries, `disableAllHooks`, or `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` in a settings file is refused too, as are `claude plugin disable` and a Monitor command that would need the gate's judgement. To turn review-cycle off for a single project, set `enabledPlugins` in that project's `.claude/settings.json`.

**The review cycle loops until a pass applies no fixes.** Previously a fixed iteration cap ended it. Every fix is content no reviewer has seen, so mechanical fixes now get a narrow confirmation pass (code-reviewer alone, on the fix delta) instead of ending the loop. A ceiling (3 light, 5 full) stops a cycle that will not converge. After the post-loop cleanup, the cycle checks coverage and confirms anything cleanup changed. When you asked for a commit, the cycle makes it at the end.

**New:** the `mcp__review-cycle__status` tool reports the gate's view of the working tree. `/review-cycle:init` now checks that the gate loaded; it no longer edits `.gitignore`.

**Requires hooks modules.** They are an early-access Claude Code feature. Set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` to `1` in the `env` block of `~/.claude/settings.json`; without it the gate never loads and nothing is gated. While the gate is loaded, Bash inside an `isolation: "worktree"` subagent is refused (anthropics/claude-code#92533).

**Review memory lasts one session.** Uncommitted work carried across a restart is reviewed again.

**To clean up after upgrading**, in each project that used the old gate, delete `.claude/review-cycle/` and `.claude/.no-review-gate`, delete the `refs/review-cycle/trees/*` refs, and remove the git pre-commit hook if you installed one. Nothing reads any of them any more.
