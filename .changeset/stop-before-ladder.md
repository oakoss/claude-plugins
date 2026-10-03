---
review-cycle: minor
---

A new `/config` setting, Stop before (`review-cycle.stopBefore`), picks the first step the agent asks you about: `commit`, `push` (the default, as before), `open PR`, `merge`, `release` or `never stop`. Steps before it run without asking; each push, pull request, merge, approval or release that runs that way logs a dim line ("ran a push without asking…") naming the setting and where it came from, and tells the agent, a push a script makes included. The line can move as a project grows: stop before `commit` while little is written down, and later at `push` or past it. A commit still needs a review first, whatever the setting.

A project's `.claude/settings.json` can set it under `pluginConfigs`, but only to stop earlier than your own value; your gitignored `.claude/settings.local.json` can set any step. A value outside the options in either file, or a file the gate cannot read, stops before every step, `commit` included. Only you can change it, in `/config` or by hand; repairing a broken settings file that names review-cycle counts as a change.

Some pushes ask whatever the setting unless you ask for them: a force push, a push to the remote's default branch, a tag push, a push that deletes or force-updates a ref or pushes every branch, one whose target is built at run time, and one after a git step in the same command other than a read or a commit, such as a checkout, fetch or rebase. Before a push runs without asking, the gate repeats it as a dry run, so git names the refs it would update with its own push configuration applied, and reads the remote's default branch with `git ls-remote --symref`; if either fails, or the dry run names no ref, the push asks. A push option given no value, such as a trailing `-o`, is refused. A `git config` before a commit or push counts as a read only when its `--get` or `--list` comes before the name: `git config <name> <value> --get` writes, and is now refused there.

Opening a pull request with `gh pr create` is gated like a push: "open a PR", "create the pull request" and "ship it" ask for one, and asking for one lets the push it needs run through the same checks. Monitor refuses it, and subagents are refused at every step.

A message that mentions pushing, shipping or a pull request without asking for it ("don't push yet", "did the push fail?", "open a PR. do not push."), or "not yet" to the agent's offer, holds pushes and pull requests until a message asks for one. It never holds a commit. "push the tag" now asks for a push. The status tool reports the step in force, where it came from, and whether a commit, push or pull request may run now (`mayCommit`, `mayPush`, `mayOpenPr`).

The settings guard now reads settings files with comments and trailing commas as JSON, so an edit that changes review-cycle's entry on a line of its own is refused like any other.
