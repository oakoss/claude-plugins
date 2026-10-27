# Changelog

All notable changes to the `review-cycle` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.35.0 (2026-10-27)

### Added

The comment policy now deletes a comment unless it is clearly worth keeping: one earns its place only when, without it, the next reader would get something wrong or have to run or search something to learn it. It also names three more kinds of noise: labels on test cases or inputs that already read clearly, narration of the assertion or call on the next line, and a summary of a function short enough to read. A rule is stated once, beside the code that enforces it, and named elsewhere rather than restated. Facts the code holds and will change (counts, lists presented as complete, positions such as "above", the ticket a measurement came from) give way to a pointer at the list or file; a measured version or number stays. The review skill, the cleanup agent and `reference/policies.md` carry the change; the cleanup agent rewrites a useful comment that carries such facts rather than removing it. Judged comment by comment over this repository's last 20 pull requests, the new test drops 21 of 116 added comments the old wording kept, and keeps none it dropped.

`/review-cycle:init` appends a policy only when its heading is missing, so a `CLAUDE.md` that already holds the comment policy keeps the old wording; copy the new block from `reference/policies.md` to update it.

The review loop stops chasing its own fixes. When most of a later round's findings point at fixes the cycle itself made, the cycle applies none of them and stops, as it does at the round limit, and asks you whether to rethink the approach, apply the held fixes, or commit with them deferred. In 138 recent reviews, 105 recorded where round 2's findings came from; in 55 of those most came from round 1's fixes, and stopping there would have skipped 44 of the 332 rounds run. Under a job, those findings shelve the bead as before.

### Fixed

A merge through the GitHub MCP tool now gets the same model check as `gh pr merge` when the answer offering the merge only mentioned another pull request. Before, after an answer that offered a merge and mentioned release PR #52 in passing, "ok, lets merge" let `gh pr merge` run but refused the same merge through the MCP tool.

`/review-cycle:misses` no longer lists a refused command because of words in the command itself. The step a refusal asked about was read back out of its text, quoted command included, so a refused `gh pr comment` whose body said "ask for a merge" could be kept as a missed merge. Each refusal now carries its step.

The Monitor tool now refuses `gh stack rebase` and points it to the Bash tool, where the gate checks it. The command rewrites commits, and Monitor ran it with no check while the Bash tool judged it as history.

The consent-miss list now keeps a refused `gh stack push`, `sync` or `submit` that your message named. Its refusal says the message "doesn't ask for a forced push", which the miss recorder did not read, so `/review-cycle:misses` never listed it.

## 0.34.0 (2026-10-26)

### Added

`mcp__review-cycle__codex_log` now also returns the Codex review's token usage as `tokens`: the input, cached input, output, reasoning and total counts, summed over every session the review ran in (`sessions`: Codex's review session, and any it started, such as its guardian), or `unavailable` with the reason, as for a review not yet finished. The review summary's Cost line reads the Codex leg's tokens from it, in place of a hand-run `grep` over `~/.codex/sessions` that reviews kept skipping and that missed the guardian's tokens: on one review here the guardian held 584,494 of 1,249,268. The tool finds Codex's sessions under `CODEX_HOME`, or `~/.codex` when that is unset or empty, and searches only the folders for the days the review ran, which took under a second here where the whole tree took 27.

Reviewer legs now copy the repository with a script the plugin ships, `scripts/copy-tree.sh`, and the Codex leg runs tests and builds too. Before, Codex ran with the repository read-only and was told to keep to checks that only read, so a test runner writing its cache failed and Codex could not measure anything. The copy holds the working tree as git reports it, staged changes included, with its own git directory: it has the repository's branches and remote-tracking refs, so a base such as `origin/main` resolves, but no remote, and git commands in a copy of a worktree never write to the worktree's index. Each `node_modules` is copied too, cloned where the filesystem supports it: a copy linked to the repository's packages let an install in it rewrite them. Links inside `node_modules` are copied as they are, so one that points outside the copy, such as `npm link` or pnpm's `link:` makes, still points there; Codex cannot write through it, since its sandbox writes only the scratch directory. A copy that fails is removed rather than left partial, and the script warns on stderr when a submodule's changes cannot show in the copy or there are no `node_modules` to copy. On this repository the copy takes about 4 seconds, and the full test suite passes in it under Codex's permission profile. `/review-cycle:review-pr` takes `node_modules` from your checkout, since the pull request's worktree has none.

The status tool's `droppedReviews` and `reviewerChanges` now start again at each commit the gate checks, rather than covering the whole session. Before, every status call repeated entries from earlier review cycles, such as a leg dropped on a branch merged hours ago, and the review skill could read an old "could not check" entry as part of the current cycle. A commit made while one of a review cycle's reviewers still runs leaves both lists alone, so the review skill's rule of noting the count at the snapshot still holds. `cappedReviews` already started again with each cycle.

### Fixed

A "could not check …" entry under `reviewerChanges` in the status tool no longer reads as possible contamination. The review skill now says such an entry is a failed read, and an entry from a leg that had run past its 30-minute budget ends in ", its leg over budget", since stopping that leg can cut the gate's reads off. The entry keeps the parts it could not read and why.

The Codex leg's brief now names the project's own checks, the commands the review ran to canonicalize the tree, for Codex to run in its copy, with a JavaScript tool run by path from `node_modules/.bin`. Codex had been guessing at tools the project does not use, such as `prettier`, and a package-manager script tries an install first, which fails without network. The Codex leg's profile now turns network off explicitly (`permissions.review-cycle.network.enabled=false`) rather than relying on Codex's default, and the brief says so, so a failed fetch reads as expected rather than as a defect. Measured on Codex 0.164.0: with the key off, `curl` to `api.github.com` could not resolve the host; with it on, the same call returned 200.

The consent grammar now reads more answers the way the user meant them, so fewer pushes and merges need the same answer typed twice.

- A yes to an offer that writes out the command, such as "May I run git push --force-with-lease origin fix/x?", grants the force push with a lease. Before, it granted nothing.
- "ok, push" or "yes, push it" in reply to a force-push offer takes the offer's force, as a bare yes does. Before, it granted only a plain push, the gate refused the force push, and the agent asked again. Any other wording is still read as the user's own request: "push it" without the yes, "ok, push to origin", or "yes, but don't force it". After an offer that also names a plain push ("…with a lease, or a plain push?"), "ok, push" picks the plain one.
- A bare yes to "Push to main?" now names `main` (or `master`) without backticks, so a default-branch push it agreed to is no longer refused. Any other branch name still needs backticks.
- "push to origin/main" names `main` as the push's target, as "push to main" does.
- A message typed into the running turn after a yes to several merges now replaces that grant when it holds after "but" ("yes, but not yet", "ok but not now") or takes one pull request back ("skip #4", "#4 can wait", "leave #4 for now"). Taking one back keeps the rest of what a yes would have granted: after "Should I merge #3, then #4?", "skip #4" merges #3 alone. After an offer a yes would not grant, such as one waiting on CI, it keeps none. Before, the declined merge stayed granted.

A gh command piped into `tail` or `wc` at the very end, such as `gh pr merge 62 --squash 2>&1 | tail -4`, is now judged as if it ran on its own, as a commit or push piped the same way already was. Before, the pipe counted as another step that could change which pull request the merge reaches, so the merge was refused and had to be run again without it. The filters allowed are the commit path's: `tail` with at most one count, or `wc` with its counting flags, with no file, redirect or substitution. `head`, `grep` and anything else still count as another step. A merge that would end a standing "merge once ready" ask still has to run without the pipe, since the pipe reports the filter's exit status and a failed merge would read as one that succeeded.

The spec conformance reviewer no longer re-judges a branch's earlier commits. On a branch reviewed one commit at a time, it saw only the newest work against the whole bead, so work an already-reviewed commit introduced came back as scope creep and was dismissed by hand. When the working tree is under review, the review skill now lists the branch's commits and their trailers in the reviewer's prompt as reviewed work. The reviewer counts work listed there as neither scope creep nor missing, and treats an issue ID found only in those commits as context rather than as the spec it was handed. A review against a base ref is unchanged, since its commits are the work under review.

## 0.33.1 (2026-10-24)

### Fixed

A yes to a merge offer that sets pull requests against each other ("Merge #3, or #4?", "Should I merge #3 and #4? Or, merge #5 and #6?", "Merge #3, #4, or both?") now grants no merge, since it does not say which. The two-question form used to grant every pull request named in both. The refusal tells the agent to ask again with a menu ('Say "merge 3", "merge 4", or "merge both".'), and a menu may now offer "merge both" as one of its options. An alternative that hands the merge back or offers another step ("…, or would you rather do it?", "…, or close #4?", "…, or wait for #4?") still lets a yes take the first alternative.

A "not yet" to an offered approval that also mentions a merge ("not yet, before we merge" after "Should I approve #12?") now records the declined approval rather than the mentioned merge. Both hold the same steps; the difference is that the model check stays off afterwards, as it does after any decline, and a refusal says the approval was put off.

Reviewer legs now run no command that installs first. In a JavaScript project they run the project's tools by path (`node_modules/.bin/<tool>`) in their private copies, not through the package manager: in a copy without `node_modules`, `pnpm <script>` and `pnpm exec` install first and run the project's install hooks there, which on pnpm 12 ran lefthook's postinstall in a leg's copy. `/review-cycle:review-pr` legs copy `node_modules` from the main checkout, since the pull request's worktree has none, so when the pull request changes a JavaScript lockfile or a `package.json`'s dependencies, the briefs and the report's new `Dependencies:` line say that results depending on them are inferred.

Replies that pick among offered merges now work in two more shapes. A branch name in parentheses beside a pull request, as in "Merge #277 (`fix/x`) and #278 (`test/y`)?", is read as a label when it starts with a conventional prefix such as `fix/` or `feat/`, so "yes" or "merge both" covers both pull requests rather than only the first. A closing whose last line tells you what to type, such as 'Say "merge 277", "merge 278", or both.', offers its merges to a pick: "merge both", "merge them", "merge only 277" and "merge 277 but not 278" work, while a bare "yes" still names no option. A note that holds a pull request, such as "(do not merge yet)", still keeps a yes from granting it, and a menu with an option that is not a merge, or one inside an example the agent quotes or indents, offers nothing to pick.

A path that opens with a period no longer ends the sentence, so a deferral after it counts: "push .github later" and "push .gitignore when CI passes" no longer grant a push. A name opening with a period or `./` now reads as the bare name does: "push the .gitignore changes" holds as "push the gitignore changes" already did, and "run ./release.sh" holds the release as "run release.sh" did. Ask in other words, such as "push it", when the gate holds one of these.

A note in parentheses beside an offered pull request is now read as its words when it contains a slash or backticks, as other notes already were: a yes to "Merge #3 (WIP/draft) and #4?" or "Approve #3 (`WIP`)?" grants nothing, where it used to. A branch name with a conventional or release tool's prefix, such as "(`fix/docs`)" or "(oakum/version-packages)", is still read as a label.

## 0.33.0 (2026-10-23)

### Added

A message you type that starts a job on an epic ("do epic cpl-czgp", "ok, lets run the epic cpl-czgp") now lets commits, pushes and pull requests run until the job ends, as a stop-before setting of `merge` would; a setting that stops later stands. Merges, releases, and pushes that ask whatever the setting (the default branch, a tag) still ask. It is read as the same message asking to push would be, so "don't do epic cpl-czgp yet" or one beside a hold starts nothing. The next message that holds or declines a step, even by mentioning a merge, or calls things off ("stop", "never mind"), ends the job, a prompt you did not type neither starts nor ends one, and the job survives a reload of the module. The status tool shows it under `stopBefore.mandate`.

The commit gate reads github/gh-stack's `gh stack` commands instead of refusing every one as an unknown extension. Moving around a stack (`view`, `checkout`, `up`, `down`, `top`, `bottom`, `trunk`), `init`, `add` with no options and `unstack --local` run as they are. `rebase` and `sync` rewrite commits as `git rebase` does, so each runs as its own command and its replayed commits are not reported as unreviewed. An option written before the stack command is refused, since its value could hide which command runs. `push`, `sync` and `submit` push every active branch of the stack with `--force-with-lease`. They run on a plain push request, or a stop-before setting that pushes unasked, while that lease can overwrite only what the agent pushed: each branch is in gh-stack's catalog, none is the trunk or the default branch, and each is either new to the remote or still at the commit the gate last saw the agent push there, checked against the remote itself. A remote that pushes anywhere but the one URL it lists branches from, or sets its own `receivepack` or `uploadpack` program, is not checked this way. The gate keeps those commits across reloads. Otherwise they need a request for a forced push, and the refusal names the branch that moved. For `sync`, a layer GitHub's stack holds that the clone's catalog lacks also needs one. A hand-typed `git push --force-with-lease` still needs one every time. A `git push` that would run but updates an unmerged layer on the remote gh-stack pushes it to is refused with `gh stack push` to run instead, since it would leave gh-stack's record of the stack behind; a delete, or a push of a layer to another remote, is judged as any push is. `submit` and `link` also open pull requests and are judged as one. `link` pushes the branches it names without a lease, so a push request covers it, except a branch that is the default, which your message has to name as it would for `git push`. When the gate cannot read that default branch, as with `--remote`, a push request covers `link` with a note to the agent, while a setting that pushes unasked asks. A `link` run beside other commands or in another directory is refused until it runs on its own. `gh stack merge <number>` is judged by what it merges, read from GitHub's stacks API as gh-stack reads the number: every unmerged layer of that stack, or that pull request and every unmerged one below it. Each is judged as `gh pr merge` would judge it, the version pull request's release included, and a merge of several needs your message to name every one, to merge now or once ready (or a stop-before setting that merges without asking). A merge with no number, one run beside other commands or against another repository, and one GitHub cannot place are refused with what to do instead. "Merge the stack", "merge stack #4" and "merge up to #131" name every layer such a merge reaches (the last one, the layers up to that pull request), each still judged as its own merge; they cover `gh stack merge` alone, never a `gh pr merge`. "Push the stack" asks for a push, and "ship the stack" for what "ship it" does. When a stack push needs a forced push, the gate's suggested question is "Force-push the stack with a lease?", which a "yes" grants. `rebase --continue`, which commits a conflict's resolution, `add` with an option, `unstack`, `modify` and `switch` are refused with what to run instead.

An ask to merge or release once a pull request is ready now outlasts the message that asked for it. "merge 46 once CI passes" or "when main is done and the release PR is ready, merge it" stays in force across later messages ("While we wait, lets plan the next work", "hold off on the docs push") until a merge of that pull request succeeds, a message holds or declines a merge or release or retracts what it asked, or the session ends. Before, the next message ended it, so the merge needed a second ask. Such an ask covers its pull request only once it is ready, never through a later "merge it" now, and the agent is told when your message ends one. A reload drops it, and a wake from another plugin such as pr-watch neither grants nor ends it; an unnamed "merge it when it's ready" still lasts only until your next message.

The grammar reads more of these asks:

- A condition joined by "and", and one about the default branch ("when main is done", "once main is green"). Before such a merge, the gate reads GitHub's rolled-up state of the checks and statuses on the default branch's head commit and refuses until it is a success.
- A release once ready: "release when the PR is ready", "release when the release PR is ready", "merge the release PR when it's ready". Each merges oakum's version pull request once it is ready, which covers the release step. One that lasts covers the version pull request open when you asked, or the first opened after.
- A release after a ready merge: "merge it when it's ready, then release it" and "merge 46 once CI passes and release it" now also release once the version pull request is ready. Before, the first granted only the merge and the second granted nothing.
- "merge 46 when the release PR is ready" asks for nothing, since it waits on another pull request.

A merge request that names no pull request ("ok, lets merge") after an answer that only mentions another pull request in its last lines ("Release PR #52 shouldn't trigger Visual. Say the word to merge.") no longer has to be asked twice. The grammar still reads the mentioned number as the one to merge, so the merge of the pull request in question is refused. With the model check on (`review-cycle.modelCheck`, the default), the gate first asks the model whether the answer offered #52 or only mentioned it. Only a reply sure it was mentioned lets the merge run, and then oakum's version pull request still asks before it releases. Any other reply, or none, keeps the refusal, and one that got no answer or could not be read says so. A message holding a number, or a merge a queued message joined, is never put to the model. "Version PR #52 is green. Merge it?" still merges #52.

### Fixed

The commit gate reads "land" in your message as "merge": "go ahead and land it" after a merge offer grants that merge, "land both" picks both offered merges, "land the release PR" grants the release, and "don't land 46" holds the merge and ends a standing ask to merge once ready. Only the whole word counts, so a ref like `release-land` and a landing page, zone, strip or gear are not merges; any other mention of "land" holds a merge the way a mention of "merge" does, so the agent asks first. The agent's own offers are read for "merge" only.

When the consent grammar cannot read a "ship" request, the model check now grants the pull request along with the push, as the grammar's own "ship it" does, so a phrasing like "lets ship the react aria update" opens the PR instead of leaving it held. The model check also reads encouragement to keep working ("push on", "keep going", "carry on") as no request, unless it answers the agent's offer of that step: "Good, push on." grants nothing, while "yes, push on" after "Want me to push?" pushes. A re-measure before this change had read "Good, push on." as a push. Re-measured over the 169 messages the grammar refuses: no wrong yes, 5 of 142 labeled messages missed, p50 1.7 s, p95 3.2 s, about 840 tokens a call, now recorded with the replies.

One yes now covers `gh stack submit`. The consent grammar reads a stack's pull requests ("open its PRs", "open the PRs", "open their pull requests", "open a PR for each layer"), and an offer that lists backticked branches ("Force-push the stack `feat/a`, `feat/b` with a lease and open its PRs?") keeps both of its steps. When `gh stack submit` lacks consent for its pull requests and its leased push would not run on the stop-before setting alone, the commit gate's refusal names the forced push with a lease and the pull requests together, so the agent asks for both in one question instead of one at a time, and one yes runs it. A yes to an offer to merge several named branches into a base ("Merge `fix/a` and `fix/b` into `main`?") now grants nothing, as one naming a single branch already did, since that is a local merge.

The commit gate now refuses only a `claude plugin` removal that reaches review-cycle: one naming `review-cycle` (in any `@marketplace` form and any letter case, as the CLI matches it), the marketplace it was installed from, no plugin or `--all`, or a name only the shell resolves, such as a variable or a glob. It used to refuse every `claude plugin disable`, `uninstall`, `remove` or `rm`, and every marketplace removal, whatever plugin they named, and `--help` too, all with the same "switched on and off only by the user" answer. Removing another plugin and asking for a removal command's help now run. The check reads the command both as typed and through your shell aliases, so an alias for `claude plugin uninstall` is caught and an alias renaming a command the check knows (`sed=gsed`) does not slip past it. When review-cycle runs from a directory (`--plugin-dir`), so its marketplace is unknown, every marketplace removal is still refused.

A hold now stops only the step it names and the steps after it. A message that mentions merging without asking for it ("anything else before we merge 77?"), or a "not yet" to a merge offer, holds merges, approvals and releases, and a push or pull request your stop-before setting allows still runs. It used to hold every step, so a setting of `merge` stopped pushes after any question about merging. A "not yet" to an offer of several steps holds the first one offered and everything after it, so a declined "push and open a PR?" still holds the push, and so does a declined "merge #116 and delete the branch?", since deleting a branch is a push. A step the offer names only by its verb counts too, so a "not yet" to "Push `#130`?" now holds the push, and a later step named beside the decline ("not yet, the release notes need work") does not free it. A later hold keeps what an earlier one held until a message asks for a step, so "don't push yet" followed by "don't merge yet" still holds the push. A hold never stops a commit, every hold stops a reply on GitHub, and a held reply holds only replies.

What your latest message granted now survives a reload of review-cycle's hooks module. A reload used to drop it, so the next step asked again. In a working tree that loads review-cycle from source, a `git merge` from the default branch rewrote the hooks files mid-ship, the module reloaded between the push and the pull request, and "ship it" was refused the pull request it had already granted. The grant is kept with the rest of the gate's record until your next message replaces it; `/clear`, a resume and switching the gate off still drop it.

When `/review-cycle:review` holds findings at the round limit and you answer that they should be deferred, the review now records them in the ledger before committing. The ledger was written in the summary, before your answer, so those findings were never recorded and a later review could raise them again.

Typing pr-kit's `/pr-kit:do-epic <id>` now starts a job on that epic, as "do epic <id>" does, and so does "do epic <id> as drafts" (or "as a draft", "in draft"). Before, the slash command and a drafts request started nothing, so the job's first push stopped to ask.

Under a job started with "do epic <id>", `/review-cycle:review` no longer stops to ask, since you read the job's report rather than each turn. Scope creep against the spec becomes a question in the ledger and the summary, and the cycle runs on; findings held at the round limit are deferred with that reason, and the clean result commits. When those findings fall where an earlier round also fixed or came mostly from the cycle's own fixes, when paths stay unreviewed or a reviewer changed the tree, or when the gate would not admit the commit, the review shelves the bead: it commits nothing and ends with `Final state: shelved (<why>)`. Outside a job nothing changes.

Switching the commit gate off and back on in `/config` no longer forgets the reviews it had seen, so turning it off for a moment no longer costs a fresh review of work a reviewer already covered. A finished review still covers only the content its reviewer saw, so an edit made while the gate was off still needs one. What the gate kept true only by watching is still dropped: reviewer legs still running, the agent's last question, a step you held off, and the current message.

A merge your stop-before setting lets through without asking is now noted as the step it is. At `never stop`, merging oakum's version pull request unasked tells the agent it ran a release, not a merge. After "release it", a merge of some other pull request is noted as a merge run without asking, where before the release request hid it. To name the step, a merge that runs unasked now reads its pull request's head branch with one `gh pr view`. When that read fails, or the gate cannot look the merge up (`GH_REPO=`, `GIT_DIR=` or `env -C` picks where it runs), the merge still runs and is noted as a merge.

A merge you asked for without naming a pull request ("merge it", "ok, lets merge") now covers only a pull request the conversation pointed at: one your messages or the answer you replied to name anywhere, not just in its last lines; one in this repository headed by the branch the checkout is on; or oakum's version pull request. Before, it covered any pull request the agent ran `gh pr merge` on. Any other is refused, and the agent asks you to confirm it by number ("Merge #200?"), so an agent that offered #40 and then merged #200 is caught rather than let through. When your message names a number the gate cannot place ("merge it; do not merge 130"), the answer's numbers do not count. A merge sharing its command with other steps (`gh pr merge 40 && git pull`) runs only when it names a number the conversation pointed at. Where your setting lets merges through without asking, an unnamed request is never stricter than the setting. A bare `gh pr merge` needs no lookup, as before; any other unnamed merge makes the lookups a named merge does, plus one of its head branch when nothing named it.

A message that is only "we can" and a step now asks for that step, as "ok, we can" already did: "We can merge 91" grants the merge of #91, and "We can merge it when it's ready" grants auto-merge. So does a "we can merge" that names its pull request and ends a one-sentence message opening with "let's" or "just", read as the same message without "we can" already is: "Lets just leave it and we can merge PR 47" grants the merge of #47, while "Let's check the logs and we can merge" and "Let's leave it and we can release 47" ask for nothing. A "we can" with anything else beside it in the message, another sentence, line, clause, "and" or "then", still asks for nothing, since that is how options are listed ("We can wait. We can merge 91.", "We can push it, but I'd rather wait"). Neither does "We could merge 91".

A review that is compacted partway now keeps its later phases. After a compaction Claude Code re-attaches the review skill cut to its first 20,000 characters, about a third of it, so a compacted review used to carry on from memory without Phases 3 to 10: the fan-out rules, aggregation, the loop check, the ledger record, the summary and the commit rules. From the time the review skill loads until a commit lands, the hooks module now appends the rest of the skill to the compacted conversation, starting at the section where that copy is cut. Nothing changes for a review that is never compacted, and the skill stays one file.

The settings guard reads a JSON file the way Claude Code parses it. Claude Code skips a settings file that is not a strict JSON object, so a file with comments, a trailing comma or a top-level array switches nothing: writing a JSON array whose text mentions `enabledPlugins`, such as a test corpus, is no longer refused. Adding a comment or a trailing comma to a settings file that switches review-cycle is now refused, since Claude Code then skips the whole file and the switch flips. An edit the guard cannot replay is still refused when the file or the edit names a switch.

## 0.32.0 (2026-10-18)

### Added

The review nudge no longer submits a visible prompt turn when a turn ends with changes no reviewer has seen. Instead your next message carries a reminder the agent reads but you do not see, telling it to run `/review-cycle:review` first unless that message says not to review or answers a question it asked; nothing shows on your screen. The reminder is built when you send, from what is still unreviewed then, so a review started in between leaves nothing to remind. A slash command, a message typed while the agent is working, or one another hook refuses leaves it for your next message. When git fails while checking a finished turn, your next message checks again; if git still cannot, the reminder says so. The review may now wait until you next write, rather than starting on its own. `review-cycle.nudge` in `/config` still turns it off.

### Fixed

`/review-cycle:review` and `/review-cycle:review-pr` no longer tell the model to pass `run_in_background: true` when spawning reviewer subagents. Claude Code 2.1.302 dropped that field from the Agent tool, whose subagents run in the background by default; the Codex leg's Bash launch still passes it.

The settings guard no longer refuses `claude plugin install …` because the command also names a settings file. It counted the subcommand `install` as a program that writes files, so a test install checked in the same command, such as `CLAUDE_CONFIG_DIR=<dir>/claude claude plugin install x && cat <dir>/.claude/settings.local.json`, was refused with "review-cycle is switched on and off only by the user". A `claude` command's arguments no longer count as writers; its redirects still do, and disabling or removing a plugin is refused as before.

The review cycle aims to converge in fewer rounds. Every reviewer brief in `/review-cycle:review` and `/review-cycle:review-pr`, Codex's included, now asks a leg whose findings share a cause to report the cause and the change that removes it, to tag a finding that reproduces on the base as `pre-existing`, and to report within 10 minutes, settling its question first. The code reviewer now reports a pre-existing issue tagged, scored on its own merits, where it used to score it as noise. A confirmed pre-existing finding is deferred to the ledger rather than fixed in the loop, whatever its severity, and the summary lists `pre-existing` as its reason. When findings held at the iteration ceiling fall in an area an earlier iteration also fixed, the cycle first offers to reconsider the approach, naming the smaller design, before asking whether to apply or defer them.

Reviewer legs now keep more of their work inside their own scratch directory. Each reviewer agent makes that directory with `D=$(mktemp -d …) && cd "$D" && …` and stops when `mktemp` fails, where a leg once carried on and wrote its files into the repository under review; it never falls back to a fixed path like `/tmp/x` either. Legs spell that directory's path out in every command, since the Bash tool keeps neither the directory nor `$D` between calls. They edit files there with Edit or Write rather than an interpreter, which the commit gate refuses whenever its code names a git commit, or `sed -i`. And they run any `claude plugin install` from that directory with `CLAUDE_CONFIG_DIR` pointed into it, so a test install no longer lands in your own Claude Code config.

Reviewer legs now have a rule for actions outside the filesystem. Read-only remote calls such as `gh pr view`, `gh api` sent as a GET (a `-f` or `-F` field turns it into a POST unless `-X GET` is passed) or `git ls-remote` are allowed, and the leg's report lists each one; the project's own checks run in the leg's copy, never in your repository; and a leg never creates anything remote (a repository, pull request, release or push) or causes any other side effect. A leg that needs a remote fixture to settle a finding reports it as a question naming what it would test, and you decide from the summary, where legs used to choose between guessing and giving up.

A reply to the agent's offer to merge several pull requests can now pick among them. "merge both" and "merge them" grant every pull request the offer named, and "merge only #3", "merge #3 but not #4" and "merge #3, not #4 yet" grant #3 alone. Before, each of these was refused, and the agent had to ask about one pull request at a time. A pick is one of those whole replies, with an optional "yes" or "ok" before it and "please" after, so a decline ("skip both"), a condition ("merge both once CI passes"), a hesitation ("yes, but wait"), a question, or quoted or pasted text is read as before. A pick says "merge", since a reply like "only #4" could answer another question in the offer ("Which one should I leave open?"); a bare yes still grants every pull request offered. A pick reads only a plain offer, with one question, no "or", and no number but the pull requests it offers to merge; after any other, the reply is read as before. "both" counts only when the offer named two, and a narrowing typed while the agent works replaces what an earlier reply granted. To set an order ("#3 first"), say "merge both"; the agent merges them one at a time.

The commit gate now reads more of the ways a merge is asked for and offered. GitHub's merge methods count as a merge: "squash-merge 116", "squash merge it", "rebase and merge 116" and "squash and merge it when ready" grant what "merge 116", "merge it" and "merge it when ready" do, and a yes to "Should I squash-merge #116?" grants that merge. A merge names every pull request listed after it, so "merge 116, then 117", "merge 116, 117 and 118" and a yes to "Should I merge #116, then #117?" cover each, where only the first was covered before. A number that is not a pull request ("merge 116, 100%") and a pull request after another step ("merge 116 and review 117, then 118") are not added to the merge.

When your yes to the agent's offer grants nothing, the gate's refusal now says why, so the agent asks again in a form your next yes covers instead of guessing. An offer whose question sets a condition, or with a condition word in a sentence after the question ("Should I push? After that, CI will run."), is quoted with that sentence in the agent's own words, and the agent is told to put any explanation before the question. An offer held only by notes in parentheses beside its pull requests ("Merge #3 (rust 1.99.1)?") is named with the notes, and the agent is told to ask without them. The reason appears only on the refusal of a step the offer named (a commit, a push, a pull request, a merge or a release), and a retraction or a later message drops it.

The gate now records how many review rounds each commit took, counting the distinct trees reviewers were given since the previous commit, and the status tool shows the count so far as `roundsSinceCommit` and the last 10 commits as `rounds`. A change to the review loop can now be measured by rounds to converge instead of judged from one session.

`/review-cycle:review` and `/review-cycle:review-pr` now grade their review legs from one shared file, `reference/grading.md`, which each reads before grading the first leg. The two skills used to carry their own copies of the grading table and the Codex receipt rule, and the copies had already drifted. Grading itself is unchanged, except that the review cycle now also states two rules review-pr already had: why a claim a leg labels inferred keeps it out of `partial`, and that a leg that was skipped, failed, dropped or capped carries no execution label, which now names capped legs in both skills.

"ship it as is", "ship as-is" or "lets ship as is" now opens the pull request as "ship it" does. Before, the grammar did not read "as is" after the verb, so the model check decided, and its yes to a push left the pull request held until the user asked again. "push it as is" grants only the push.

## 0.31.0 (2026-10-16)

### Added

A push you asked for no longer goes to the default branch, or pushes a tag, unless your message or the question you answered named where it goes. "push it" while the agent was on `main` used to push `main` without asking, which branch protection does not stop for an admin; the gate now asks, naming the branch and the question to put to you, and a yes to it covers the push. Only exact forms name a target, so nothing around the name can reject or redirect it: a message that is just "push to main", "push main" or "push the main branch" covers `main`; "push the v1.2.0 tag" covers that tag and "push the tags" any tag; and a bare yes covers the target only when the last paragraph of the agent's answer is exactly the question the refusal suggested, "Push to `develop`?" or "Push the `v1.2.0-rc.1` tag?". No request covers deleting the default branch. A push after another git step in the same command (`git fetch && git push`), or to a branch built at run time, now asks rather than running unchecked. The gate reads where a push you asked for goes with the dry run it already makes for pushes your stop-before setting lets through, so such a push costs a round trip to the remote; when that dry run fails or names no ref, the push runs as asked and the agent is told its target went unchecked. GitHub writes follow the same rule: a tag write needs the tag named, a forced update or delete is judged by the branch it names, and a write that names no branch, builds it at run time, or picks its repository outside its words asks.

### Fixed

The review cycle and `/review-cycle:review-pr` grade the Codex leg from the commands it ran, not from its verdict. `codex review` prints its own verdict format, which carries the execution receipt only some of the time, so Codex was usually graded `unknown`. A new `mcp__review-cycle__codex_log` tool reads Codex's output file, with or without color, and lists each command with its status, exit code, and first and last output lines, including commands Codex refused to run. It flags a status that parallel commands leave unclear, and a command chained with `;`, a newline, `||`, `|` or `&`, whose exit code shows only its last part. The skills build Codex's receipt from that list: a chained success confirms only its last part, and the project's test suite counts as unattempted when no command ran it. They no longer ask Codex for receipt lines, and instead ask it to join verification commands with `&&`. A file that is not a Codex log is refused rather than read as a Codex that ran nothing, and the skills then read the receipt off the verdict as before.

The review cycle's final message now carries its summary block field by field, after any commit the cycle makes, with any prose around it explaining the block rather than replacing it. Eval runs caught one final message that retold the summary in prose, dropping fields such as the Codex leg's status, and another that printed it before the commit and ended with prose.

The eval suite's Codex shims now reach the session, so an eval run no longer launches the real Codex CLI, and its graders match what a correct cycle reports.

The commit gate keeps what reviewers saw when its module reloads, which a `/config` change to review-cycle does mid-session, as does saving its hooks while developing it. It used to start over: a review that finished after the reload was not counted, the commit was refused as unreviewed, and the scratch directories a sweep should remove were forgotten. Reviews, the reviewer legs still running, scratch directories, a "don't push yet" hold and the rest of the gate's record are now kept in Claude Code's session state and taken back when the module loads again; a leg still running keeps the rest of its 30-minute budget. What your last message granted is not kept, so after a reload the next push, pull request or merge asks again. Switching review-cycle off in `/config` clears what it kept, so switching it back on starts fresh.

When you ask for a merge, the gate's GitHub lookup of the pull request (`gh pr view`, `gh repo view`) is tried again, for up to 10 seconds, when it times out after 5. When GitHub still does not answer, the refusal tells the agent GitHub was slow and to run the same command again, rather than asking you to confirm a merge you already asked for. Other GitHub lookups keep their single 5-second try, and a lookup that fails with an error rather than a timeout still asks.

## 0.30.0 (2026-10-14)

### Added

A message you type while the agent is still working no longer cancels the push, pull request or merge your earlier message asked for. "Lets file the beads" sent during a ship used to replace "ship it", so the gate refused the push halfway through. Now a queued message adds what it asks for to the turn's grant. It still replaces the grant when a sentence holds, retracts or stops ("ok, wait", "not yet", "never mind", "scratch that", "please stop"), or when it names a step without asking for it ("should we push?"). Any new message still stops a step the gate is checking at that moment, so the agent reads it first; a push stopped that way runs when the agent tries it again.

### Fixed

A yes no longer grants a step the agent offered only on a condition. "Should I merge #168, if the tests pass?", "When CI passes, should I merge #168?", "Should I merge #168? Only if CI passes, though." and "Can we push? Not until CI is green." used to let a plain "yes" run the step at once; now that yes grants nothing. The gate reads the agent's last three lines from their first question on, before rewriting any of it, and any of these words there withholds the offer: "if", "when", "whenever", "once", "until", "unless", "after", "before", "provided", "assuming", "as long as" or "as soon as". A push, pull request, approval or release then goes to the model check, which reads the offer's last six lines; a merge waits until you ask for it outright. This also withholds some offers where the word only orders the steps, such as "Should I push? After that, CI will run.". A condition set before the question, or in other words ("wait for CI, then merge"), is not read.

Two kinds of condition count as met by the yes. An approval phrase that ends its clause: "If that looks right, should I push?", "When you're ready", "If so", "If it looks good", "If you're happy with it", "If that works for you"; "when it's ready" and "once that works" wait on the work and withhold. And a merge once ready, in the question itself: "Should I merge #168 when CI passes?" still grants it with `--auto`. A "not yet" or "hold off" after a conditional offer still holds the step it named.

Typed requests read more of the same words: "merge 168, provided CI passes", "merge 168, assuming CI passes", "merge 168, as long as the tests pass", "merge 168. Only if CI passes." and "push it. But only if CI passes." grant nothing.

A read of the findings ledger now returns at most 8,000 characters, unless its first entry and the answer's header together are longer, where it used to return every entry for the files named: a file reviewed often held dozens, and one read of `consent.ts` loaded 52,835 characters into the reviewing session. The tool takes a `query`, words matched against each entry's finding and reason, and ranks the matches, those holding the most query words first and then the newest. Every entry settled more than 90 days ago comes back whatever the query, ahead of every other entry, since it is open again. `reopened` counts those stale entries, `matched` the rest, and `next` is the `offset` that reads on. Rows are written as compact JSON, and carry `blob` and `current`, as short ids for `git diff`, unless the file is known unchanged. The review skill now passes a `query` naming what the change touches and carries the entries that bear on it, instead of every entry for the changed files.

"nvm", "oh wait, never mind", "sorry, never mind", "actually never mind", "actually, don’t" and "hmm, no wait" now retract what came before them, as "never mind" does. "Commit it. Merge it. nvm." and "merge it, nvm" used to grant the merge. An "nvm" that stands alone reads as "never mind", while "nvm use 20" is left as the Node version manager. A filler word (ok, okay, please, oh, sorry, hmm, um, uh, actually) may open a retraction, so "ok, never mind" and "please, never mind" now retract, and "oh no" and "um, no" retract as "no" does. A message typed while the agent is working that says "nvm" or "actually, don’t" now replaces the turn's grant.

The review skill loads less into the session: its file is 60,353 characters where the last release's was 75,831, and its description, which every session's skill listing carries, is less than half as long. The cut removes measurement history (which CLI version showed what, which cycle measured it), rationale, and rules stated twice; every instruction stays, and so does every phrase the plugin's prose anchors pin. How a review runs does not change.

A subagent command that names `gh` without running it is no longer refused as a pull request step. The gate read `gh` followed by any word as a gh call, so `for c in none gh docs`, `which gh go` and `[ -x /usr/local/bin/gh ]` stopped review subagents with "subagents do not commit, push, open, merge…". Now `which`, `type`, `whereis`, `test` and `[` count as data for both the gh check and the commit check, so `type git commit` is no longer refused either. For the gh check, `[[` and a `for` or `select` loop's `in` list count as data too, and so does any of them after `if`, `while`, `!` or `do`, as in `if [ -x /usr/local/bin/gh ]; then`. A gh call in a loop's body, in zsh's `for x (a b) gh …` short form, or after `&&` is still judged.

## 0.29.0 (2026-10-13)

### Added

A push, pull request, approval or release the consent grammar refuses is now put to a model before the refusal stands. Requests phrased in ways the grammar does not know, such as "Ok, lets ship the react aria update" or "sure, send it up" after the agent offered a push, no longer cost a round trip. The check asks sonnet at low effort through Claude Code's own client and your account, once per message (a call that got no answer is asked again by the next step), and sends only your latest message and the end of the answer it replied to. Its yes counts only when it says the step is asked for now, with no condition or decline, and quotes words you typed, and some messages are refused whatever it says: an ordinal ("merge the first PR"), a later destination, a held tail, a named release ("the release 3.5"), a cut-off destination ("publish to it"), "not yet", "not now", "hold off", or a push from `main`. Its yes lets a step through as Stop before does rather than as your request, so a push it allows, by git, `gh api` or a GitHub tool, still asks where the setting's would, such as one to the default branch. When it lets a step run you see a line on screen saying what it read, the agent is told the same, and `/review-cycle:misses` lists it as a grammar candidate. It never grants a merge, a force push, a commit, a comment or a `--continue`, though its yes to a release lets oakum's version pull request merge, since that merge is the release. It is not asked under `claude -p` or the Agent SDK, nor while a "not yet" holds, and when it cannot answer the step stays refused, saying why. It is on by default; turn it off with Model check in `/config`.

The line the gate logs when a push, pull request, merge or release runs without your asking, because your stop-before setting allows it ("ran a push without asking, since the stop-before setting is merge (/config)."), no longer shows on screen by default. The setting already says those steps need no asking, so the line repeated a choice you made once. The agent is still told, and can mention it. Turn the on-screen line back on with `review-cycle.unaskedNotice` in `/config`. A merge run now on a request to merge once the pull request is ready is always shown, since GitHub's state, not your setting, let it run.

### Changed

A merge request that names pull requests now covers only those, and a merge asked for once a pull request is ready now runs without `--auto` when GitHub already reports it ready. Before, "merge 116" let `gh pr merge 117` run, a ready merge let `--auto` reach any pull request, and "merge 46 when it's ready" refused `gh pr merge 46 --squash` even with every check green.

- **Named merges bind to what GitHub resolves.** One `gh pr view` reads the number, URL, state and merge state of the pull request a merge reaches, by number, branch or URL. It must be one you named ("merge 116"), or the one the agent offered when you named none ("merge it" after "Merge #116?"), and in this repository. A merge of any other pull request is refused whatever your stop-before setting, since a wrong number right after you named one is most likely a mistake, unless the read shows it is oakum's version pull request and the same message asked for a release ("merge 46 and release it"). So is one the gate cannot read (the read fails, the merge shares its command with other steps, or `GH_REPO=`, `GIT_DIR=` or `env -C` picks where it runs), with a refusal that says how to write it instead, or to ask you when the read failed. A pull request named for once ready is never covered by an unnamed merge now ("merge it, and merge 62 once CI passes"). This replaces a pattern that read `/pull/130/files/131` as #131 while gh merges #130.
- **Ready merges.** "merge 46 when it's ready" covers `gh pr merge 46 --auto`, and a plain merge of #46 when GitHub reports `CLEAN`, `HAS_HOOKS` or `UNSTABLE` (what GitHub merges at once, and what pr-watch calls ready); the agent is told why it could. Another merge state refuses, naming it, whatever the setting; `UNKNOWN` says to try again shortly, and a pull request already merged or closed tells the agent to tell you. "merge 46, and merge 62 once CI passes" covers #46 now and #62 once ready. When the gate cannot tell which pull request a ready merge meant (the offer named several), `--auto` covers any, as before, and a merge without it is refused. The consent grammar now records a ready merge's numbers apart from a merge now's. A ready merge of oakum's version pull request is still a release, which asks unless your setting lets releases through. Where releases ask, one not ready yet asks for the release rather than suggesting `--auto`; where they run, a merge of it now on readiness is noted as a release.
- **Commands the gate could misread are refused.** A `gh pr merge` whose short-option cluster puts `-b`, `-F`, `-t`, `-A` or `-R` after its first letter (`-db 166`, where gh reads `166` as the body), one with a word after `--`, and one with such options before `merge` (`gh pr -db merge 46`) are refused until written out. `--admin`, `--auto` and `--approve` are now read before the verb too (`gh pr --admin merge 46`).

### Fixed

A yes to a merge offer that puts the pull request's number in backticks now grants the merge. The gate's refusals told the agent to name things "with names in backticks", so an agent asked "Merge `#163` into `main` now?", and the user's "yes" was refused twice: the backticked number read as "it" and named no pull request. A backticked `#N` now reads as the number, so a yes to "Merge `#116`?", "Approve `#116`?" or "Merge `#116` and `#117`?" grants what it names, and a backticked `main` or `master` after the number and "into" reads as the base. A branch or version named before "into", "to" or "against" in a merge offer stays a branch, so a yes to "Merge `fix/x` into `main`?", "Merge `fix/x` to main now?" or "Merge fix/x into main?" grants nothing: that is a local merge, and the second used to grant a merge of any pull request. A merge that names its base can also end with "now", "please", "thanks", "too" or "again": "merge 163 into main please" and "Merge #163 into main now?" were held or ignored, and now grant the merge. A yes to "Push `#130`?" no longer grants a push; the backticked number used to read as "push it". The refusals now ask for branch and version names in backticks, matching their own examples, which give a pull request's number plain.

More ways of naming where a step goes now count as asking for it. "Publish the branch", "publish the changes", "publish to github" and "publish to origin" ask for a push: editors call a branch's first push publishing it. "Publish the PR" and "publish the PR to github" ask for the pull request step. "Push to npm" and "push the package" ask for a release, as "publish to npm" does, and still ask for no git push. "Push the v1 tag" and "push tag 0.2.0" ask for a push, as "push the tag" did. "Merge into main" and "merge now into main" ask to merge this branch's pull request, as "merge it into main" did. "Merge the version 2 PR" is the release, as "merge the version PR" is. A publish or push is read this way only when nothing but a courtesy word ("now", "please") follows in its clause, so "publish the changes as a PR comment", "publish changes.md" and "push the package.json change" still ask for nothing, as do "publish the docs to the wiki" and "merge the release fixes".

A period before a digit no longer ends a sentence or splits a word, so "merge 130.5" names no pull request where it used to name #130, and "merge it.2" and "push it.2 more to go" ask for nothing. "Merge the version PR now into main" asks for nothing, as "merge the version PR into main" already did: a destination after "now" names a local merge, and it used to grant the release.

Some conditions mean now, and no longer withhold the step: the agent finishing its own work ("push it when you are done", "merge 130 once you're finished"), "as soon as you can" or "as soon as possible" ("commit it as soon as you can"), and not waiting for the checks ("merge it before the checks pass"). Each counts only where it ends the sentence, after a request in plain words with no other condition in it. So "push it when I am done", "push it when you are done with the tests", "push it when you are done and merge it", "push it when you are done, then merge it", "commit it as soon as you can, then push it", "when you are done, push it", "push it -- when you are done, merge it" and "merge it before the checks fail" still wait. In the agent's offer the user is the one who is done, so a yes to "Should I merge it when you are done?" still grants nothing. A yes to an either/or question takes its first alternative when the agent offers it: "Should I push, or would you rather do it?", "Want me to push, or run it in your terminal?" and "Should I commit and push; or wait?" now grant what the first part offers, where the whole question used to grant nothing, and a pull request named only in the other alternative is not the one merged. When the first alternative is not the agent's own step, the yes takes nothing from it: "Would you rather push it yourself, or should I?" and "Do you want to push it, or should I instead?" still grant nothing, and an "or" without a comma lists what is offered, so a yes to "Should I merge #130 or #131?" names neither. A yes to a question about how a commit or push goes agrees to it too, when that is the whole question: "Do we commit, then push?", "Can we push to main?", "Do we push it?" and "We commit, then push?" now grant their steps. Any other "we" question still needs "should we", so "Do we commit and open a PR?", "Do we push and merge?", "Can we push --force?", "Did we push it?", "We push to main, right?" and "Can we push to main, or is it protected?" still grant nothing.

"Once it's ready, do not merge it. Push it." now grants the push, where the whole message used to grant nothing: declining the merge asks for nothing, so the sentences beside it count, but nothing in that message merges or releases.

A retraction made of cue words alone ("no wait", "never mind", "scratch that") and followed straight away by a new request now cancels only the last thing asked for before it. "Open a PR. Bare force push it. No wait, never mind. Force push it" asks for the pull request and a force push with a lease, where it used to ask for the push alone: "never mind" took back the bare force push, not the pull request. The same holds for "commit it. open a PR. never mind. push it", which now asks for the commit and the push. Every other retraction still cancels everything before it: one that says more than its cue words ("merge it. push it. no wait, don't merge. push it", "open a PR. push it. no wait, none of that. merge it"), one whose next sentence asks for nothing ("Merge it. Release it. No. None of that. Commit it."), and one after a semicolon ("open a PR. push it; then merge it. never mind. commit it"). Each of these asks only for what follows the retraction. A retraction with nothing asked after it cancels everything too, so "open a PR. push it. never mind" and "open a PR. push it. never mind. thanks" ask for nothing, as does a request inside the retraction itself ("never mind, merge it").

"When we can", "when you can", "whenever we can", "whenever you can" and "as soon as we can" now mean now, as "as soon as you can" already did, so "Ok, lets merge PR 55 when we can" merges #55 where it used to wait. They count under the same rules: only where they end the sentence, after a request in plain words with no other condition in it. So "push it when I can", "push it when we can review it" and "commit it when we can, then push it" still wait, and a yes to the agent's "Should I merge 130 when you can?" still grants nothing.

The commit gate now lets the agent run `git rebase --continue`, `git merge --continue`, `git cherry-pick --continue` and `git revert --continue` once a reviewer has seen the resolution. Before, it refused every `--continue`, even right after a clean review, so you had to finish the rebase from your own terminal. A `--continue` is now judged like a commit: everything the staged index changes against HEAD must be reviewed (for a merge, that is everything the merge brings in), and your stop-before setting applies, with a refusal that asks to finish the rebase, merge, cherry-pick or revert rather than to commit. `git add … && git rebase --continue` works as one command. An unreviewed resolution is still refused, and the refusal tells the agent to review it; a conflict still unresolved is refused by name rather than as a gate failure. After the command, the resolution commit is checked as a commit is, so a pre-commit hook that changed it is reported; the picks a rebase or cherry-pick replays after it are not.

More ways of asking to finish a rebase, cherry-pick or revert now count as asking for its `--continue`: "continue with the rebase", "finish up the rebase", "carry on with the cherry-pick", "continue rebasing" and "resume the revert" name the operation the way "finish the rebase" does. A merge still needs "finish the merge", "continue the merge" or "complete the merge", because "continue merging" or "resume the merge" usually means pull requests and keeps holding the steps after it. A short "continue", "ok continue", "go on", "carry on" or "keep going" answers the agent's offer to finish an operation and grants that `--continue` alone. After any other offer, or with no offer, it grants nothing, since it usually means keep working. A request or offer that names its branch ("Should I continue the rebase on `fix/x`?") can now be answered with a yes.

A reviewer whose report counted is no longer listed as dropped. Before, an interim answer without the execution receipt, sent before the real report or after it, added a "did not open with the execution receipt" entry to `droppedReviews` that the counted report never cleared, so the status tool and a refusal's "reviews not counted" note showed the reviewer as uncounted. Each reviewer now keeps at most one entry, its latest; a counted report removes it, and an answer after a counted report adds none.

When the gate itself fails while checking a command or a GitHub tool call, its refusal no longer ends by handing you the step ("The user can run it from their own terminal", "they can make the change on GitHub themselves"). It now tells the agent to report what failed and stop, and to suggest running the step elsewhere only if you ask. A refusal that reads as the next step invites the agent to offer a way around the check: before 0.28.1 the `--continue` refusal did exactly that, and an agent offered a `!` command that skipped the gate. A refused `git rebase --exec` now offers a route that stays checked: run the rebase without `--exec` and each command as its own step afterwards. That runs the command once rather than after every commit, so the agent asks you when a per-commit run matters.

`git merge --ff-only` is now treated like `git pull --ff-only`: it records no commit, so a chain such as `git stash push && git merge --ff-only main && git stash pop` runs instead of being refused as "more than one command that commits". A merge or pull counts as a fast-forward only when its other options are on a short list (`-q`/`--quiet`, `-v`/`--verbose`, `-n`, `--stat`, `--no-stat`, `--no-edit`, `--autostash`, `--no-autostash`, `--ff`, `--no-ff`, `-X…`, `--strategy-option…`) and the command sets no `git -c`; anything else is checked as before. That is stricter than before for `git pull --ff-only` with other options: `-s ours` records a merge even with `--ff-only` (measured on git 2.56), and its spellings (`-qs ours`, `-ps ours`, `-c pull.twohead=ours`) are too many to list, so this also closes the gap where `git pull --ff-only -s ours` passed as a fast-forward. A pull whose `--upload-pack` runs a git command that commits or pushes (`--upload-pack='git push …'`) is now refused whether or not it fast-forwards; a branch name or merge message that merely mentions `git push` is still data. A strategy set in your own git config is not visible in the command; such a merge is reported after it runs only if it brings in content no reviewer saw. When a step is refused for sharing a command with a commit or push, the refusal now also names that git step ("`cp` alongside `git merge`, which the gate checks as a commit or push").

"Finish the rebase", "continue the merge", "complete the cherry-pick" and "continue the revert" now count as asking for that operation's `--continue`. With your stop-before setting at `commit`, the agent runs the reviewed `--continue` you named instead of asking again whether to commit the resolution. The request covers only the operation you named: it allows no other `--continue`, no plain `git commit` and no push. A "merge" in "continue the merge" is no longer read as a mention of a pull request merge, so it no longer holds the steps after it.

A request that ends its step with "first" now asks for that step: "merge 168 first then start on the docs", "push it first" and "release it first please" grant the merge, push or release, where before the word "first" made the gate read the message as only mentioning the step and hold it. "first" counts only at the end of the step, before courtesies like "please", and not after "the": "merge the first" and "merge the first PR" still ask for nothing. A yes to an agent's offer that ends in "first" ("Should I merge #168 first?") still grants nothing, so the agent asks without it.

Each reviewer agent now waits for its own background runs before it reports. A reviewer that ended its turn while its mutation runs went on in the background sent an interim answer each time, and each one woke the review cycle as if the review had finished: one test-analyzer leg sent about fifteen before its real report. The agent bodies now say that ending the turn delivers the report, so a reviewer never ends it to wait: it waits for the commands it started with a foreground command, such as an `until` loop on their output (at most 10 minutes per call). Because a leg in a review cycle is stopped after 30 minutes and its report lost, a reviewer samples a long check such as a mutation suite rather than running all of it, and labels the rest inferred. When the cycle asks a reviewer for its findings now, it reports what it has and stops what is still running.

## 0.28.0 (2026-10-08)

### Added

`/review-cycle:misses` lists the gate's refusals of a push, pull request, merge or release that your latest message, or the offer it replied to, named by its verb, and drafts each as a candidate row for the consent grammar's spec. A refusal you did not expect is how a consent-grammar miss is found; until now that took pasting the session's transcript. A refusal counts only when the step refused is the one named, and an offer only when your message is a yes or a go-ahead and nothing more. The gate keeps up to 20 in memory until Claude Code restarts, served by the read-only `mcp__review-cycle__misses` tool, and nothing leaves your machine.

### Fixed

"Merge the release", "merge the version PR" and "merge the release PR" now ask for a release, as "release it" does, so the gate lets the agent merge the version pull request. Before, they asked for nothing: the gate read "merge" as naming a pull request, found "release" instead, and held the merge as merely mentioned. Only a request that ends with the noun asks: "merge the release fixes", "merge the release into main" or "merge the release branch" names other work and still asks first, and "don't merge the release yet" still holds the release.

## 0.27.1 (2026-10-08)

### Fixed

The code-reviewer, pr-test-analyzer, silent-failure-hunter and type-design-analyzer descriptions no longer carry `<example>` blocks. Claude Code puts every agent's description in each session's agent listing, so the examples cost context in every session whether or not a review ran; together the four descriptions drop from 6,370 to 2,644 bytes. The scenarios they described now sit in a "When to invoke" section in each agent's body, as pr-review-toolkit did upstream for three of them. Nothing changes in how the review cycle runs these agents.

A gh command asking for help runs. `gh pr merge --help`, `gh pr merge 5 -h` and `gh -R o/r pr merge --help` print help and write nothing, but the gate refused them as merges, so reviewers checking gh's flags reported them as inferred. `-h` or `--help` counts where gh reads it as help. It does not count after an option, which can take it as a value (`gh pr merge -b --help` merges with that body), after `--`, before a `--help=` value, or with input from `xargs`. Measured on gh 2.102.0. A help word after a flag, as in `gh pr merge --admin --help`, still asks.

The findings ledger works in a repository whose `.git` path is long. Its store key was the path itself, and Claude Code's plugin store refuses a key over 256 characters (measured on 2.1.289), so such a repository could neither read nor record its ledger. A path that does not fit is now keyed by its hash. Every other repository keeps the key it has, so no existing ledger moves.

## 0.27.0 (2026-10-05)

### Added

A request to merge now covers merging oakum's version pull request, since merging it is the only way to release. "merge it" or "merge #130" lets the agent merge the version pull request. Before, the gate classed that merge as a release and refused it, so the agent asked "Release `x`?" after you had already said to merge.

These still need you to ask for a release:

- a merge request that names other pull requests: "merge 131", "merge it; do not merge 130", or "merge it" answering "Merge #131?" do not merge #130 ("merge 131 and 130" does);
- a merge asked for once the pull request is ready (`--auto`);
- a merge request in a message that also holds off a release ("merge 131. don't release yet");
- a stop-before setting that lets merges through;
- the other release steps (`gh release create`, `npm publish`, `oakum release`).

### Fixed

"As soon as" now withholds a request the way "when", "once" and "if" do. Before, "merge it as soon as I say so, then release it" granted the release, and "commit it as soon as you can, then push it" granted the push, so the agent could release or push without waiting for the condition. Both now ask first, and a step asked for in the same sentence waits too: "commit and push as soon as checks pass" no longer grants the commit. "Merge it as soon as checks pass" still grants an auto-merge.

The consent spec also checks each cue word on its own, and `pnpm consent:diff` generates openers with hyphens, brackets and curly quotes, the inputs where reading raw text and reading words disagree.

The findings ledger now keeps the newest entries that fit in 384 KiB per repository rather than the newest 100. Real entries measured about 470 bytes each, so a busy repository keeps several hundred settled decisions instead of evicting them once it passes 100, which this repository's did after a week; later cycles then re-raised what the evicted entries had settled. Ten repositories' ledgers still fit the plugin store's 4 MiB.

`/review-cycle:review` now gives every reviewer the findings earlier cycles settled, the test, type and spec reviewers as well as the code reviewer and Codex, with each entry's path, finding and reason rather than its id. Measured over 55 review cycles, about one settled entry in five reached a reviewer's brief in a form it could use, and the narrower reviewers rarely got them at all.

## 0.26.0 (2026-10-04)

### Added

"Merge it when it's ready" now lets the agent turn on auto-merge. A merge asked for once the pull request is ready, or once CI or its checks pass or are green ("merge 116 once CI passes", "go ahead and merge it as soon as the checks are green"), covers `gh pr merge --auto`, which leaves the waiting to GitHub. Before, any condition made the request grant nothing, so the agent asked again.

- **Merging now is refused.** Under such a request, a merge without `--auto` is refused whatever your stop-before setting, and the refusal tells the agent to add `--auto`.
- **GitHub waits only on required checks.** A pull request whose failing checks are not required merges at once.
- **The rest of the sentence waits.** Anything else in the same sentence is not granted, since it may wait on the same condition: "merge it when it's ready, then release it" grants only the merge.
- **Other conditions still ask.** "merge it when I say so" or "commit when the tests pass" asks for nothing.
- **The version PR is still a release.** Merging oakum's version pull request needs its own request.

The status tool reports the request as `autoMergeRequested`.

### Fixed

A reply to the agent's offer to delete a remote branch now allows the delete. When the agent named the branch ("Delete `fix/x` from `origin`?", "Should I delete feat/x from origin?"), no reply was read as asking for it, not even "yes", so the gate refused the delete again and again. Now "yes", "lets delete it" and "delete it" answer such an offer, and "delete the branch from origin" asks for one. A named path is still not a branch: "yes" to "Should I delete src/old.ts?" allows nothing. When the gate refuses a remote branch delete, it now suggests a question that a "yes" answers, and mentions that a merge you asked for already covers `gh pr merge --delete-branch`.

A short go-ahead now answers the agent's question the way "yes" does. "Ok, lets do that", "let's do it", "ok, do that", "sounds good, go ahead" and "great, go ahead" were read as no answer, so the gate refused the push or merge the agent had just offered and the agent asked again. The reply has to be only agreement and a go-ahead: "ok, let's do that later" or "lets do that for the other PR" still allows nothing, and "great" or "looks good" on its own is not a yes.

A refusal caused by a hold now says why the steps are held: "the user held off (their message mentioned a merge without asking for one)" or "(they put off a push the agent offered)". Before, it said only that you had held off, and the agent could not tell which step held or what would lift it, since a question that mentions a step ("anything else before we merge?") holds that step too. The status tool reports the same reason as `stopBefore.heldBy`, the step plus `mentioned` or `declined`.

A readiness condition can now come first: "once PR 133 is ready, lets merge it", "when CI passes, merge it" and "as soon as CI is green, merge it" let the agent run `gh pr merge --auto`, as "merge it once it's ready" already did. Before, a sentence opening with a condition granted nothing, so the agent asked again. Any other leading condition still grants nothing for the whole message: "once it's ready, push it", "once I say so, merge it" or "if CI fails, merge it". So does a sentence that asks for more than the merge under the condition ("once it's ready, release it, merge it"), and one waiting on another pull request than the one it merges ("once PR 133 is ready, merge 134", in either order), since `--auto` waits only on the pull request it merges.

## 0.25.0 (2026-10-03)

### Added

A push you did not ask for no longer opens a dialog. The gate refuses it and tells the agent to stop and ask you in its reply, naming what it would push and where with names in backticks ("Push `fix/x` to `origin`?"), with the command quoted and any shell aliases expanded. You answer in your next message: "yes" allows it, and anything else, such as "not yet, rename the helper first", is simply your next request, which a dialog with fixed choices could not take. If the command also commits, the refusal says to run the commit on its own.

The agent's closing question now counts as offering the push when it names a branch or path ("Push fix/x to origin?", "Committed on fix/x. Push?") or puts the destination in backticks ("to `origin`"), so a "yes" to it grants the push; a "yes" to deleting a path ("Should I delete src/old.ts?") still grants nothing. The dialog's limits are gone with it: no 500-character cap, no "already asking" refusal, and no decline that blocked asking again. A `-p` run, with no one to answer, stays refused.

A force push now has to be asked for by name. "push it" no longer covers one: "force push it", or "yes" to the agent's "Force-push `fix/x` to `origin` with a lease?", allows `--force-with-lease` and `--force-if-includes`. A bare `--force`, `-f`, `+refspec` or `--mirror`, which overwrites whatever the remote holds, is refused with a pointer to `--force-with-lease --force-if-includes`, and runs only when the request itself names it ("force push it without a lease", "bare force push", "push it with `--force`"); a bare force mentioned elsewhere in the message, or in the agent's question, grants nothing.

The gate now reads `git push`'s options exactly, as it does `git commit`'s: an option it does not know, an abbreviation such as `--forc` included, is refused with a request to spell it out.

`gh api` calls and GitHub MCP tools now go through the same Stop before steps as the gh commands they stand for. A `gh api` write to a pull request, merge, review, comment or release endpoint, given as a path or a full URL, takes that step, and so does a GraphQL mutation named in a written-out query (`createPullRequest`, `mergePullRequest`, `addPullRequestReview`, `addComment` and the like). A review approves only when its `event` is `APPROVE`. A merge is looked up like `gh pr merge`, so merging the version pull request still counts as a release; a GraphQL merge names the pull request by id, so it asks where a release could follow. A query or review event built at run time or read from a file, a write whose endpoint is built at run time, and a write fed by `xargs` are refused until written out. A call with an argument built at run time that could be an option names `--method GET` to read. Other reads, and writes to endpoints no step covers, such as opening an issue, run as before.

GitHub MCP tools are matched by name under any server name: `create_pull_request` opens a pull request, `merge_pull_request` merges, `pull_request_review_write` approves on `APPROVE` and comments otherwise, and the comment tools comment. A comment on an issue counts like one on a pull request.

Writes that change branches on GitHub directly, past the commit gate, are the push step: the MCP tools `push_files`, `create_or_update_file`, `delete_file` and `create_branch`, `gh api` writes to `contents/…`, `git/refs…`, `merges`, `merge-upstream` and branch renames, and the GraphQL ref and commit mutations. A request to push allows them, except a forced ref update, which has no lease and needs a request for a bare force. When your setting lets a push through, one that names its branch runs unless that branch is the repository's default (looked up with `gh repo view`; a lookup that fails or prints nothing asks). These ask whatever the setting: one that names no branch, an MCP tool that names no repository, and one that pushes a tag, renames, deletes or force-updates a ref, or is a GraphQL mutation. Subagents are refused all of these.

The merge and release steps of Stop before are now gated. `gh pr merge` and `gh pr review --approve` are the merge step: "merge it", "merge the PR", "merge 116" or "merge 116 into main" asks for a merge and "approve it" for an approval, and a merge you asked for covers `--squash`, `--delete-branch` and `--auto`. `--admin`, which merges past branch protection, is refused outright, and the agent gives you the command to run. "merge main into it" names branches rather than a pull request, so it asks for nothing on GitHub. `gh release create` and the rest of `gh release`'s writes are the release step, and so is merging oakum's version pull request: unless your setting lets both a merge and a release through, the gate asks `gh pr view` which branch a merge comes from, and a merge of `oakum/version-packages` is a release; when that lookup fails, or `GH_REPO=`, `GIT_DIR=` or `env -C` picks where it runs, the merge asks. Unless both steps may run, a merge that shares its command with other steps is refused until it runs on its own; and a `gh pr merge` or `gh pr review` whose pull request or flags are built at run time, whose option value is unquoted, or which is fed by `xargs`, is refused until written out. "release it" or "cut a release" asks for one, and "ship it" still stops at the pull request.

A comment on GitHub (`gh pr comment`, `gh issue comment`, or a `gh pr review` that does not approve) needs your request whatever the setting, such as "address the review comments" or "reply to the reviewer". gh aliases and extensions are not read: a gh word gh does not ship is refused, and the agent runs the gh command written out. A message that mentions merging, approving or releasing without asking holds those steps, as it holds pushes, and the refusal now says "held off" instead of "held off pushing"; a request to approve or to reply lifts no hold. The status tool adds `mayMerge`, `mayRelease` and `commentRequested`.

Package publishes are now the release step of Stop before: `npm publish` (and abbreviations such as `npm pub`), `pnpm publish` (with `-r`, `recursive` or `--filter`), `yarn npm publish`, `yarn publish`, `bun publish`, `cargo publish` and `oakum release`, wherever they stand in the command (`pnpm exec oakum release`, `~/.cargo/bin/cargo publish`). A dry run of npm, pnpm, bun or cargo (`--dry-run`, or cargo's `-n`) runs as before, unless a later `--no-dry-run` or a `false` value turns it off; Yarn's dry run counts as a release. A package script such as `pnpm release`, and anything after `npm run`, is still not read. "publish it" or "publish the package to npm" asks for a release, and a message that mentions publishing holds the step, as release words do. Package words stay with publishing: "push to npm" asks for no git push, and "publish the branch", an editor's name for a first push, asks for no release.

Marking a draft pull request ready for review is now the pull request step: `gh pr ready` (but not `gh pr ready --undo`), the GitHub MCP `update_pull_request` with `draft: false`, and the GraphQL `markPullRequestReadyForReview`. "mark it ready for review" or "ready for review" asks for it, and a mention of a pull request being ready for review holds the steps.

A refusal for a command the gate cannot read now says it "cannot tell which step it takes", since it covers publishes as well as gh, and one that does not parse asks for it to be written so it parses.

The end-of-turn review nudge can be turned off, and it no longer interrupts a question. A new `/config` setting, Review nudge (`review-cycle.nudge`, on by default), turns it off; `{ "options": { "nudge": false } }` under `pluginConfigs` in a project's `.claude/settings.json` turns it off there, and your `.claude/settings.local.json` decides either way, over both. A settings file the gate cannot read, or a `nudge` that is not `true` or `false`, sets nothing, and the other settings decide. Whatever the setting, a turn whose last message ends with a question mark, bold or italic included, is no longer nudged: before, the nudge could fire while the agent waited on your answer. The commit gate is unaffected.

A new `/config` setting, Stop before (`review-cycle.stopBefore`), picks the first step the agent asks you about: `commit`, `push` (the default, as before), `open PR`, `merge`, `release` or `never stop`. Steps before it run without asking; each push, pull request, merge, approval or release that runs that way logs a dim line ("ran a push without asking…") naming the setting and where it came from, and tells the agent, a push a script makes included. The line can move as a project grows: stop before `commit` while little is written down, and later at `push` or past it. A commit still needs a review first, whatever the setting.

A project's `.claude/settings.json` can set it under `pluginConfigs`, but only to stop earlier than your own value; your gitignored `.claude/settings.local.json` can set any step. A value outside the options in either file, or a file the gate cannot read, stops before every step, `commit` included. Only you can change it, in `/config` or by hand; repairing a broken settings file that names review-cycle counts as a change.

Some pushes ask whatever the setting unless you ask for them: a force push, a push to the remote's default branch, a tag push, a push that deletes or force-updates a ref or pushes every branch, one whose target is built at run time, and one after a git step in the same command other than a read or a commit, such as a checkout, fetch or rebase. Before a push runs without asking, the gate repeats it as a dry run, so git names the refs it would update with its own push configuration applied, and reads the remote's default branch with `git ls-remote --symref`; if either fails, or the dry run names no ref, the push asks. A push option given no value, such as a trailing `-o`, is refused. A `git config` before a commit or push counts as a read only when its `--get` or `--list` comes before the name: `git config <name> <value> --get` writes, and is now refused there.

Opening a pull request with `gh pr create` is gated like a push: "open a PR", "create the pull request" and "ship it" ask for one, and asking for one lets the push it needs run through the same checks. Monitor refuses it, and subagents are refused at every step.

A message that mentions pushing, shipping or a pull request without asking for it ("don't push yet", "did the push fail?", "open a PR. do not push."), or "not yet" to the agent's offer, holds pushes and pull requests until a message asks for one. It never holds a commit. "push the tag" now asks for a push. The status tool reports the step in force, where it came from, and whether a commit, push or pull request may run now (`mayCommit`, `mayPush`, `mayOpenPr`).

The settings guard now reads settings files with comments and trailing commas as JSON, so an edit that changes review-cycle's entry on a line of its own is refused like any other.

The review cycle's summary now says three more things. A `Convergence:` line counts, from the second round on, how many of a round's findings came from the cycle's own fixes, and when most did, says the loop is generating its own work, so you can choose between more patches, the structural fix, and cutting the fix that keeps drawing findings; the loop itself runs as before. A `Cost:` line gives each round's wall-clock, legs, subagent tokens and Codex tokens, and names any leg whose usage was not reported, such as a capped leg. Codex's tokens are read from the session log of the child session its review runs in, and kept apart from the subagents' because they count cached input. When anything was deferred or raised as a question, the summary is followed by a paste-ready `## Known issues` block, with `### Open questions`, for the pull request description; the agent never files it in a tracker, and puts it in the body of a pull request it opens itself.

### Fixed

A GitHub MCP tool call that is interrupted while the gate is checking it no longer runs; a Bash command already behaved this way, since past an interruption nothing would report the step it took. The gate's GitHub judging now lives in its own module, `gh-verdict.ts`, which reads GitHub and the settings through lookups that `register.ts` provides, so its rules have unit tests. GitHub pushes and git pushes share one decision about when a push the request does not cover may run.

Updating a pull request's branch from its base is now the push step in every form: `gh pr update-branch`, the GitHub MCP tool `update_pull_request_branch`, and `gh api …/pulls/<n>/update-branch`. The gate looks up the pull request's head branch and asks when it is the repository's default branch, as other GitHub pushes do. One it cannot look up, one whose branch lives in a fork, and a rebase (`gh pr update-branch --rebase`, or GraphQL's `updateMethod: REBASE`, which rewrite the branch and so need a request for a bare force) ask whatever the setting. A pull request named by URL is checked against its own repository's default branch.

The gate asks less where it asked for nothing: `cargo publish -npn` is a dry run; a GraphQL ref mutation whose `force` is a variable set to `false` is not forced; a branch named `refs/heads/refs/topic` is a branch; and a GraphQL review whose declared event variable nothing sets is a comment. Refusals name their cause more exactly: a branch read at run time or from a file (`-F branch=@b.txt`) says so instead of "names no branch", the merge refusal for another repository or host no longer says the place is "picked at run time", and a GitHub MCP call the gate failed to check tells the agent to hand the change to the user. More quoted shell forms that split into several words (`"${u:-$@}"`, `"${u:-${@}}"`, bash's `"${!prefix@}"`, zsh's `"${(Z+c+)x}"`) are read as splitting, so a flag hidden in one is refused.

`npm pu` is now read as a publish, the release step, as `npm pub` and `npm publish` already were: npm accepts any abbreviation of `publish` from `pu`, so an agent's local `npm pu` no longer publishes without the gate seeing it. `npm p` is not an npm command and stays nothing; a dry run (`npm pu --dry-run`) still runs. Releases from a GitHub workflow never pass through the gate and are unaffected.

## 0.24.0 (2026-10-02)

### Added

A Bash command that changes files in the repository now gets a note naming them and telling the agent to make file changes with Edit or Write instead. The comment-slop check and the precise settings check attach to Edit and Write, so an edit made through Bash skipped both: one month's sessions ran 3,178 Bash calls against 218 Edits.

A command that could write is measured by comparing the working tree before and after it: a redirect, `tee`, `sed`, `perl`, `cp`, `mv`, an interpreter (`python`, `node`, `tsx`, …), a script run by its path or with `source`, a nested shell, `xargs` or `find`, even behind an assignment, `if`, `time`, `env` or an alias. So a `cd`, a glob or a script's own logic cannot hide an edit. The comparison covers the files a review covers: tracked or not-ignored files in the repository, apart from the review exclusions (`.beads/`, editor folders) and the `ignore` patterns. A gitignored file or one outside the repository is not seen. Each measured command costs two working-tree snapshots, about 35 ms each in a repository of 145 files, and some read-only commands (`sed -n`, `find`, `node --version`) are measured too. A command that names none of these is not measured.

A file saved by something else while the command ran is named too, so the note says which files changed while the command ran rather than claiming the command changed them. It never refuses the command, which has already run, and when git cannot take the measurement the agent is told the check was skipped. It runs only while the gate is on, and not for background commands or review subagents, whose writes into the repository the gate reports separately.

The Codex review leg now runs with the repository read-only. In a trusted project Codex's sandbox is `workspace-write`, which could write the repository, and a leg once left probe files there that the commit gate then counted as unreviewed changes. The review passes a permission profile that reads everything and writes only the cycle's scratch directory, and the Codex brief explains it: write only under the scratch path, and report a refused write in the repository under `attempted-but-failed` rather than asking for wider permissions. Codex can still run checks that write nothing, such as typecheck, lint and `git diff`; a test runner that writes inside the repository, such as vitest's `node_modules/.vite-temp`, is refused, so its question stays one that reading can settle. For this run the profile replaces any `writable_roots` set in `~/.codex/config.toml`, so a `pnpm` script that needs to re-resolve dependencies or lock the store is refused too. Measured on codex-cli 0.159.3.

`/review-cycle:review` now checks the change against its spec in the first round, not after the fix loop. Spec conformance runs alongside the other reviewers in iteration 1, on either tier, whenever a spec source is discoverable. A finding that quotes a spec line the code contradicts or leaves out is fixed like any defect. Scope creep against a current spec source stops the cycle before any review fix and asks you, so rounds are no longer spent polishing code you may remove; a spec source the reviewer cannot verify never stops it. A round that fixed a spec defect runs spec conformance again, scoped to that requirement. In a cycle on 2026-10-01, the spec finding arrived only after the loop had closed and cost two extra confirmation passes.

The cycle also names any file its fixes touched in every round. After each round it records the files that round's fixes changed, measured from the tree the round's reviewers were given, and from the second round that applied fixes it flags a file present in every such round, with the latest hunks, as a sign the fixes are not converging there: cut or defer the piece that keeps drawing findings rather than run another round. The summary reports it on a new `Churn:` line, even when the loop later converges. On 2026-10-01 one file was edited in every round of three consecutive cycles, each fix drawing the next finding.

The maintainability reviewer still runs once, after the loop.

A review fix that changes what code imported by files outside the diff does now counts as substantive, however small, even when it would otherwise pass as mechanical or a verified message fix. The review finds those importers by searching for the end of the module path, whatever prefix comes before it (`/shell["']` matches `./shell`, `../hooks/shell` and an alias, where searching for `shell.ts` or `import.*shell` misses a multi-line import), and names them in its summary. When another iteration runs, it includes the code reviewer and asks it which of those callers behave differently, measured old against new on their existing inputs. A passing suite says nothing about callers when no test covers the old behavior they rely on: a parser fix once changed how a sibling module classified commands, every test stayed green, and only a question about the parser's other callers caught it.

The review loop now stops sooner: by default a light diff gets at most 2 rounds and a full diff at most 3, down from 3 and 5. An explicit `max <n>` still overrides it. The round that reaches the limit applies none of its fixes, since a fix nobody reviewed is one the commit gate refuses. Instead it lists those findings with their severities and asks, in plain prose rather than a dialog, whether to apply them or commit with them deferred. You can also answer with something else entirely. Applied fixes get the same re-review a fix of their kind gets inside the loop, and that pass ends after one more round at most. Committing with them deferred works at once, because every path is still covered by the round that found them.

### Fixed

The review skill's canonicalize phase now reads each project check by its exit code. Run the check unpiped or record its exit status: a nonzero exit is never a pass, and output shortened by `tail` or `head` does not count as a clean run. That is how a lint run once hid three errors behind its last two lines. A check that ran and failed is a finding. Only a check that could not run at all, such as a missing tool or an unknown script, is noted and skipped; since both can exit 1, the output decides which case applies.

The commit gate and the Bash settings check now read `tsx`, `ts-node` and `lua` as code runners, as they already read `node` and `python`. Before, `tsx -e "…git commit…"`, `npx ts-node -e "…git push…"` and `lua -e "os.execute('git commit …')"` ran without the gate seeing the commit or push inside, so an agent running a TypeScript codemod through `tsx` could commit unreviewed. Likewise, `tsx -e` or `lua -e` code that wrote a settings file got past the settings check. Both are now refused like the same code passed to `node -e`. In the commit gate, a runner named as a plain word, as in `git commit -m tsx` or `git push origin lua`, is still read as data. The settings check, as it already did for `node` and `python`, also refuses a command that only reads a settings file while naming one of these runners, such as `rg lua ~/.claude/settings.json`; use the Read tool for that.

The gate's Bash check for settings changes no longer refuses a command whose quoted text only mentions a writer, a redirect or a plugin subcommand. Before, a `bd create` or `git commit` whose description named `.claude/settings.json` together with `cp`, `tee`, a `>` or `claude plugin disable` was refused although it wrote nothing. The gate now reads the command as the shell would to find what writes: a real redirect other than to `/dev/null` (a redirect alone, such as `> ~/.claude/settings.json`, included), a word that is a writer such as `cp`, `tee`, `dd`, `rsync` or `sed -i`, or an interpreter. It counts `claude plugin disable`, `uninstall` and `remove` where a word is `claude`, `claude.exe` or its npm package, so `npx @anthropic-ai/claude-code plugin disable …` is refused, with options allowed before `plugin`. A command that writes and names a settings file under `.claude` anywhere in its text is still refused, so reading settings into another file stays refused. Reading one with output sent to `/dev/null` (`> /dev/null`) now passes, while a numbered redirect such as `2>/tmp/err` now counts as a write. A command that hands a command line to a shell (`bash -c`, `eval`, `sudo -s`, `env -S`, or a wrapper such as `watch` or `tmux`), a `claude -p` prompt, or a command the gate cannot parse is still checked by its text.

## 0.23.1 (2026-10-01)

### Fixed

`/review-cycle:init` no longer tells you to set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` when the commit gate is not loaded. Claude Code loads mods, the gate among them, by default from v2.1.287 and ignores that variable, so the advice fixed nothing. Init now names the real causes: a Claude Code older than v2.1.287, a session started with `--bare`, `disableAllHooks` in your settings, or an organization policy that stops user-installed mods. If you set the variable during early access, remove it from your settings. The gate also stops refusing edits that change it, since it no longer switches anything.

A semicolon no longer turns a description into a push request. "we commit; then push" and "I'll commit; then push" grant nothing, as "we commit, then push" already did, and a yes to the agent asking "Do we commit, then push?", "Do we commit; then push?" or "Can we commit, then push?" grants nothing either. Only a semicolon after a sentence about committing or pushing carries over: "I fixed it. Then please push it.", "we're done; then push it", "commit; then push" and a yes to "Should we commit, then push?" or "Should I fix it, then push?" still grant the push.

The gate now reads zsh's control and meta notation in alias values. zsh lists a control byte in an alias as `\C-M`, DEL as `\C-?` and a high byte with a `\M-` prefix (measured on zsh 5.9.2, every byte from 1 to 255). The gate used to read the literal text `C-M`. When the escaped byte was a quote or a backslash, as in `$'a\C-\'` or `$'x\M-'y'`, it also misread where the value ended, so the aliases listed after it ran into that value and went unchecked. The gate now reads each value as zsh means it and keeps every alias that follows.

Command parsing is unchanged: bash never writes this notation, and the gate still reads an unknown `$'…'` escape the way zsh runs it, dropping the backslash, so `git $'c\ommit'` stays gated.

The gate now reads a command's `$'…'` word the way zsh, the Bash tool's shell, runs it. Before, `git $'\commit' -m x`, `git co$'\C-'mmit -m x` and `git co$'\C'mmit -m x` all ran `git commit` while the gate saw no git command and let them through. zsh does not treat `\c` as an escape, and in zsh `\C` and `\M` (each with an optional `-`) set control and meta on the next character, adding nothing when no character follows. A bare `\x`, `\u` or `\U` reads as NUL, which the gate refuses, as it already did for `$'\0'`; such a word used to fail to parse. Measured against zsh 5.9.2 over 1321 escape shapes, every reading agrees except where a word contains NUL: zsh cuts the argument there, and the gate refuses the command.

## 0.23.0 (2026-10-01)

### Added

The commit gate no longer asks whether you want a commit. A commit still needs a reviewer to have seen everything it records, and nothing else: it stays on your machine, and a `git reset` undoes it. The **Commit** / **Don't commit** dialog is gone, and so is the "landed without the user asking" report after a script commits. A pull, merge, rebase or cherry-pick no longer needs a request either, and is not reported.

Pushes still need a request. When your latest message doesn't ask for one, the gate shows the **Push** / **Don't push** dialog as before, and re-checks the review after you answer when the same command also commits. The request parser now also understands "delete the branch" (a `git push --delete` is a push), and "ok, we can push" or "ok we can ship" after an agreement. Like any push request, these allow every push until your next message. "CI is green, we can push" still asks nothing.

`/review-cycle:review` now ends a clean cycle by committing the reviewed work, unless your message held off a commit ("don't commit", "not yet") or findings remain that need your decision. That hold is the skill's to honor; the gate does not read it. It pushes only when you asked. "ship it" covers the whole run: review, commit, push and the pull request.

The status tool's `consent` field is replaced by `pushRequested`, a boolean.

A reviewer that keeps working past 30 minutes no longer holds up the whole cycle. The gate keeps each reviewer's clock, since the cycle only wakes on notifications and a busy reviewer sends none. When one runs over, the gate asks the session to stop it with TaskStop, and the summary lists it under "Reviewers capped (over budget)", apart from stalled reviewers. The status tool reports these as `cappedReviews`. The 30-minute budget comes from 138 measured reviewer runs: a fan-out's slowest leg had a median of 16 minutes, the slowest reviewer type peaked at 25, and runaways ran 60 to 70.

Reviewers no longer leave processes and directories behind. Each cycle makes one scratch directory with the new `mcp__review-cycle__scratch` tool, and every reviewer works in its own directory inside it. At the end, `mcp__review-cycle__sweep` ends any process still running in that directory and removes it. That includes the leftovers of a reviewer that stalled or was dropped and so never cleaned up after itself, like a reader blocked on a pipe nobody writes. It matches the directory and paths inside it, including a quoted mention, but not a neighbour such as `<dir>.log` or `<dir>-old`. A process still running after KILL is reported as an error rather than as ended, and a directory the sweep could not remove stays listed for the next sweep. A process that holds nothing in the directory and does not name it is out of the sweep's reach. `/review-cycle:review` and `/review-cycle:review-pr` both use the new tools, and the summary reports what the sweep ended and removed. In `/review-cycle:review-pr` a capped reviewer counts against coverage like a dropped one, so the verdict cannot read clean.

The review cycle now keeps a findings ledger, so what one cycle settles stays settled in the next. Until now, the list of settled findings lasted only for the cycle that made it. A new session or a follow-up PR started from nothing, and reviewers re-raised findings an earlier cycle had deferred or rebutted by measurement, unless you pasted a "do not re-report" list into the brief yourself. (cpl-e0e.1)

At the end of a cycle, the skill records every finding it deferred, rebutted, or examined and left alone on purpose, and every open question, with the reason and the file as the cycle reviewed it. It carries forward the entries it settled again unchanged, keeping their dates, and removes the ones it fixed; fixed findings are never recorded. At the start of the next cycle it reads the entries for the changed paths into every reviewer's brief, Codex and the report-only reviewers included, as settled. An entry is open again when its file has changed since and the change touches the code it cites, or when it was settled more than 90 days ago, so a deferral nobody revisits does not stay settled for good. A reviewer that thinks a settled entry is wrong must bring new evidence. The summary gains a `Ledger:` line with how many entries were carried over, recorded and resolved.

The ledger is stored in the plugin's own store under your Claude Code configuration directory, not in the repository. It needs no gitignore entry and never appears as a change for the commit gate to refuse, and nothing prompts for permission to write it. All worktrees of a repository share one ledger, which keeps the newest 100 entries. The store keeps ledgers for the 10 repositories recorded to most recently. Stored entries this version cannot read, such as ones a newer version wrote, are dropped by the next record, which says how many. Two new tools serve it, `mcp__review-cycle__ledger` and `mcp__review-cycle__ledger_record`, and they work while the commit gate is switched off. Like the gate, they need hooks modules enabled.

### Fixed

The end-of-turn review reminder is tried again after another plugin refuses it. A refusal arrives as `{ drop }` on a resolved `$.prompt.submit`, not as a rejection, so the gate used to treat the reminder as delivered and stayed silent for the rest of that message.

A prompt that describes your own routine, like "I commit and push", "we commit and push" or "normally commit and then push", no longer counts as a request to push. The parser marked a clause as a description only when it held no verb, so a commit verb let the push that followed through. A clause phrased as a request still counts, as in "I want you to commit separately and push". A yes to the agent asking "Should we commit and push?" or "Should we push?" now grants the push, as a yes to "Should I push?" does.

The README no longer says a Codex leg with missing credentials can block on a login prompt. Measured on codex-cli 0.159.2 with no credentials and no terminal, `codex review` retried and exited 1 after about 15 seconds with `401 Unauthorized`, so the review reports the leg as failed like any other.

Reviewers guard every variable in an `rm` path, as in `"${DIR:?}/…"` rather than `"$DIR/…"`. Claude Code's Bash safety check stops to ask you about an `rm -rf` whose path starts with a variable that could be empty, even under `set -u`, so a reviewer cleaning up its temp directory used to interrupt you with a "Dangerous rm operation" prompt. The rule is in every reviewer's containment instructions and in the spawn prompts of `/review-cycle:review` and `/review-cycle:review-pr`.

## 0.22.1 (2026-09-25)

### Fixed

A commit or push can now end in a pipe into `tail` or `wc`. For example, `git push 2>&1 | tail -3` or `git commit -F msg | tail -n 20 | wc -l` is judged exactly as it would be without the pipe, where it used to be refused, and you had to run it again without the pipe. `tail` may take one line or byte count, nonzero or `+N`, and `wc` its counting flags (`-l`, `-c`, `-w`, `-m`), so both read everything git printed. Some shapes are still refused:

- a filter that may stop reading early or read a file instead, such as `head`, `grep`, `cat file`, `tail -3 log` or `tail -n 0`, which can kill a pre-commit hook still printing, so git aborts while the pipeline reports success;
- a filter that can run or write something, such as `sh`, `sed`, `tee` or `xargs`;
- a pipeline backgrounded with `&`, which would outlive the gate's check after the command;
- any other command joined to a commit by a pipe.

The review skill's canonicalize phase now formats every file type your pre-commit hook rewrites, not only the ones a check script covers. It reads the hook config's globs, so a commit no longer records a reformatted JSON file that no reviewer saw.

When the commit gate cannot build the tree a commit would record, its refusal now says why. It names the step that failed and git's own first error line, such as `git write-tree failed: fatal: …` or `git add failed: fatal: …`. When no error line is printed, it gives the exit code, and a step that timed out is named too. An amend whose parent commit can't be read says so, and a failed comparison names what it compared against. The status tool and the list of reviews that did not count give the same reasons, where they used to say only that the working tree could not be read. Until now the refusal said only "could not compute the tree this commit would record". That was puzzling after you picked Commit in the gate's question, since the check re-runs and the approval is used up with no reason given. (cpl-35t)

## 0.22.0 (2026-09-24)

### Added

Reviewers can no longer quietly change the repository they are reviewing.

- **Edits are refused.** While a `review-cycle:*` reviewer runs, the gate refuses its Edit, Write and NotebookEdit calls on paths inside the repository. The refusal tells the reviewer to copy what it needs into a private `mktemp -d` directory. Scratch work outside the repository, in `/tmp` for example, is unaffected. So are `review-cycle:cleanup`, which edits by design, and the main session.
- **Bash changes are reported.** Before and after each reviewer command, the gate compares HEAD's commit and branch, the staged entries, the working tree, and the local and worktree git config. When one of them changed, the reviewer is asked to put back a change it made and to say so in its report, and the status tool lists the change under `reviewerChanges`. Until now, a reviewer that ran `sed -i` on a source file, switched branches or set a local `user.email` went unnoticed unless the review's own snapshot comparison caught it.

The status tool lists anything it could not check. A background command is compared only until it returns.

### Fixed

The commit gate no longer refuses three kinds of ordinary command.

- `git merge-base`, `git merge-tree` and `git merge-file` no longer count as a `git merge`. A command like `git diff $(git merge-base main HEAD)`, or a script that mentions one, used to be refused. None of them makes a commit.
- The settings guard no longer refuses a Bash command just because it writes something and names a switch key, such as `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test … > out.log`, or a Python heredoc that mentions `enabledPlugins`. The only case that rule covered was writing a switch into a shell rc file, which is a deliberate evasion outside what the gate guards against.
- The plugin-CLI check now reads only the verb after `claude plugin` or `claude plugin marketplace`. Before, `claude --plugin-dir ./plugins/review-cycle -p "remove the dead code"` was refused because the prompt contains "remove".

The gate still refuses `claude plugin disable`, `uninstall` or `remove`, a marketplace removal, and a write to a Claude `settings…` file.

The gate now reads a `git` shell alias and a `(` inside a word the way the shell does. These were two ways a commit or push could reach the shell without the gate judging it:

- **A shell alias named `git`.** The gate read `git` as git whatever your shell aliased it to, so with `alias git='hub'`, or an alias that slips a push in before git, a commit you asked for ran something the gate never judged. The gate now expands an alias for `git` like any other alias, and judges the command on its expansion, which is what runs: `git='git --no-pager'` is judged as git with that option, and a push the alias adds needs your go-ahead. A command whose expansion no longer runs git as the gate reads it, such as `git='hub'` or git wrapped in `noglob`, is refused with `\git …` as the way to run git itself. Text `eval` reparses is read with the alias too, and a git alias the shell alias defines inline (`git='git -c alias.st=push'`, then `git st`) is looked up like any other. (cpl-8p4)
- **A `(` inside a word.** The shell reader ended a word at any `(`, so zsh's grouping and bash's extglob forms slipped past: `/usr/bin/g(i)t push` runs git in plain zsh, and `@(git)` does under `extglob`, but the gate saw no git at all. A `(` inside a word now stays in it and marks it a pattern, so such a command name or git subcommand is refused, and a substitution inside the group (`x($(…))`, which zsh runs before it tries the glob) is judged like any other. zsh's glob qualifiers that run code for each match, `*(e:'cmd':)` and `*(+cmd)` with any delimiter, are not followed, so a command with such a group in a word is refused outright: its code can spell a commit in ways no check reads. A group with an unquoted `|`, such as `src/(core|base)/*.ts`, is an alternation, and a comparison such as `*(Lk+3)` runs no code; both read as before. The gate does not see such a qualifier inside a `${…}` expansion. A subshell, `name()` and `name=( … )` read as before. (cpl-w82)

The gate's question no longer refuses outright when your shell defines an alias for `git`; it shows the expansion like any other alias's.

Review cycles converge sooner. From iteration 2, a finding reopens the loop only in two cases: it shows one of the cycle's own fixes is wrong (at any severity), or it rates important or above on its leg's scale. A finding with no rating counts as important. Any other finding is listed as deferred for you to decide on: a Codex `medium` or `low`, a Suggestion, or a test-gap rating under 7. Until now, each iteration's test-coverage leg could find one more unpinned guard, and pinning it bought another round. From iteration 2, that leg asks only about the guards the cycle's fixes added.

When a reviewer changed the repository, the summary now names who did it. The review reads the entries the gate's `reviewerChanges` record gained since that fan-out's snapshot. A change with no new entry most likely came from the Codex leg, which the gate does not watch.

The settings guard no longer treats a plugin's `.claude-plugin/` directory as Claude's `.claude` directory. So a command such as `cp plugins/review-cycle/.claude-plugin/plugin.json plugins/review-cycle/hooks/settings.ts /tmp/copy/` now runs. Before, it was refused because it named `.claude` and "settings" together, which happens constantly in a plugin repository. Every write to a real `.claude` settings file is refused as before.

The README now says what the commit gate guards against. The gate is there for a well-meaning agent that commits too early, before a review or before you asked, in the commands agents actually write. The README now says so under "What it guards against": what is checked before it runs, what is only reported afterwards (a commit made inside `npm version`, `make release` or a project script), and what is out of scope (an obscure shell construct or an environment trick, and your own `!` shell). It points to an OS-level sandbox for containing an adversarial agent.

The review skill also keeps a reviewer's question about a guard inside what the guard claims to cover: it asks whether the guard catches the cases it documents, not whether a reviewer can find a way around it. A reviewer sent to hunt for a bypass always finds one, and each find costs a review iteration on a case no agent meets by accident. A gap an ordinary command falls into is still a finding.

## 0.21.0 (2026-09-24)

### Added

### The gate asks you before a commit or push you did not ask for

When your latest message does not ask for a commit or push, the gate no longer just refuses. It asks you in Claude Code's own dialog, with fixed choices: **Commit** / **Don't commit**, **Push** / **Don't push**, or **Commit and push** / **Don't**. It asks only once the review check has passed, so it never asks about a commit the review check already refuses. The question shows the whole command, every line of it, with any shell aliases it uses expanded, and how many reviewed files the commit records. Characters that could hide or reorder text are shown as `�`.

- Picking the first choice allows that one command. The gate checks the review again once you answer, and refuses if what the commit records changed while the dialog was open.
- **Don't…** refuses, and the gate does not ask about that verb again until your next message.
- A message you send while the dialog is open, or while the gate re-checks after your answer, replaces the question, and nothing runs. The same holds for a command your typed request allowed: a newer message stops it if it has not started yet.
- Text typed under "Type something." grants nothing. It is passed to the agent, and a retry asks again.
- Esc, "Chat about this", and a `-p` run, where no one can answer, refuse as before. The refusal names the reason.
- A command longer than 500 characters as shown is refused without asking, because the dialog could not show all of it. So is any command the gate would ask about when your shell defines an alias named `git`, since the gate reads `git` as git and could not show what the alias runs.
- A command that is interrupted while the gate checks it does not run.
- While one question is open, another command that needs one is refused rather than queued, and the agent is told to wait for the answer.

The agent's own question dialogs no longer grant a commit or push. Reading the options the agent wrote let its wording decide what your pick meant: "Commit first (Recommended)" granted nothing, and one question that only mentioned a commit could veto another (cpl-gps). The gate compares your pick with its own labels exactly, and the agent can neither see the question nor answer it. A plugin that answers question dialogs on your behalf can still answer the gate's.

Typed requests ("commit it", "ship it") still grant with no dialog, for the rest of your message.

### Fixed

### `[ … ]` beside a commit, push or pull no longer reads as a glob

The commit gate refused a command such as `git pull --ff-only && [ -z "$x" ]` as "a command name the shell would expand": it treated any `[` or `{` in a word as the start of a pattern. The shell starts a bracket or brace pattern only when an unquoted `]` or `}` closes it in the same word, so a lone `[`, the test command, is an ordinary word. The gate now reads it that way, and `[ … ]` is judged exactly like `test …`. Words such as `[g]it` or `{a,b}.ts` are still patterns and still refused where they were.

zsh's extended-glob characters now count as patterns too: `#`, `^`, and `~` inside a word. Under `setopt extendedglob`, `git{#` or `g#it` expands to `git`, so a command name or git subcommand using them is refused. Arguments such as `HEAD^` and `HEAD~1` are unaffected.

### Aliases are checked from the first command of a session

The gate used to read your shell aliases only from Claude Code's shell snapshot, which Claude Code writes only once a session's first Bash command has run. Until then, an aliased commit or push (`gcam "msg"`, `gp`) went unchecked, and every session opened with a note saying the aliases could not be read.

The gate now reads the aliases itself when the session starts, the same way Claude Code builds its snapshot: `CLAUDE_CODE_SHELL`, else `$SHELL`, whichever names zsh or bash, else zsh, run as a login shell sourcing `~/.zshrc` or `~/.bashrc` with no input and `CLAUDECODE=1` set, then listing them with the same pipeline the snapshot uses; with no rc file there are no aliases, as in the snapshot. On a large zsh setup this took about 190 ms and returned the same 238 aliases as the snapshot. If the read fails, takes more than ten seconds, or the rc file never gets to the end of it, the gate falls back to the snapshot as before.

Reading alias values is also more exact: zsh's quoting of a value that ends in a quote, a tab inside a value, and a value bash prints across several lines are now read as the shell reads them.

### An alias after `time -p` is expanded

bash reads the word after `time -p` as a command, so an alias there runs. The gate now expands it too: `time -p gcam "msg"` is judged as the commit it is, where before it passed unchecked. A reserved word such as `time` or `then` now counts only where the shell reads it as one, so `echo time gcam` no longer expands `gcam`.

## 0.20.0 (2026-09-23)

### Added

### The gate tells the agent to run the review, so it no longer asks you

When a turn started by your message ends with changes no reviewer has seen, the commit gate sends the agent one prompt telling it to invoke `/review-cycle:review` and report back. You no longer answer "want me to run the review?" at every stopping point: the review runs, and you hear about the result.

- **One nudge per message of yours.** A review that ends unconverged, or a turn after the nudge, is not nudged again until you write.
- **Only for work done since your message.** The nudge counts only paths the turn changed. A turn that changed nothing gets no nudge, even when older changes are unreviewed, so a question like "what's next?" does not start a review.
- **Not mid-review, and not after an interrupt.** No nudge while a reviewer is still running, none once a review has started for that message, and none when you stop the turn yourself.
- **You can still say no.** The agent skips the review when your message said not to review, or when it ended its turn on a question you need to answer first.

The nudge arrives as a prompt from the plugin, not from you, so it grants no permission to commit or push.

### Fixed

### The commit gate stops refusing and misreporting everyday git

Five fixes to the commit gate, each for a false refusal or a false report seen in daily use:

- **A fast-forward pull needs no permission.** `git pull --ff-only` records no commit, so it runs without your go-ahead, like `git fetch`.
  - A pull that may create a merge commit still needs your go-ahead.
  - Any `git merge` still needs it too, because `merge --ff-only -s ours` still records a merge.
  - The pull is judged as a merge if `--no-ff` or `--ff` comes after `--ff-only`, or if any argument is built from a variable.
  - Run through another program (`timeout 30 git pull --ff-only`), it needs your go-ahead as before.
  - Before a `git commit` in the same command it is refused, like `git checkout`: the pull moves HEAD, and with `--squash` it stages what it brings in.
- **Moving HEAD to an existing commit is no longer reported as a commit.** A checkout, a reset, a fast-forward or `gh pr merge` no longer draws "commit … landed without the user asking". The gate now reads what the command added to HEAD's reflog.
  - **Reported:** every entry except those whose git action only moves HEAD. That covers a commit, amend, merge commit, cherry-pick, revert or rebase pick, plus an entry with no known action, which errs toward a report. The action is read from git's prefix, never the commit subject, so a subject like `feat(start): add` cannot hide a commit. A commit made on another branch counts even after HEAD returns, which was missed before.
  - **Not reported:** a checkout, reset, fetch, fast-forward (`merge -m` included), initial pull, rebase start, finish, abort or plain checkout, and `am --abort`.
  - **What each commit is judged against:** each unbroken run of new commits is judged from where HEAD stood before it. A rebase counts its own changes, not the upstream underneath, and a commit on a side branch is judged apart from one on the current branch.
  - **Not seen:**
    - a commit built with plumbing (`commit-tree`) and reached by `reset`, since the reflog records only the reset;
    - a commit made in another worktree;
    - in a repository that keeps no HEAD reflog (`core.logAllRefUpdates` off from the start), a commit after which HEAD returns to its start;
    - a commit whose reflog entries the same command deleted.
  - **When the reflog can't answer:** the agent is told the gate could not check if HEAD moved without a reflog entry, if the reflog was expired or rewritten, if one command added more than 200 entries, or if HEAD is unborn in a reftable repository.
- **A push the gate did not check is now reported.** A script or alias that pushes moves or creates a remote-tracking ref, which git logs as `update by push`. When your latest message did not ask for a push, the agent is told to tell you, as it already is for commits. Not seen:
  - a push to a URL, or to a remote with no tracking ref;
  - a push that deletes a remote branch;
  - a push undone before the command ends;
  - a push whose reflog git did not keep;
  - a push buried under more than 50 later moves of the same ref in one command.

- **Read-only git with a computed `-C` runs.** `git -C ~/other log` and `git -C "$DIR" status` are allowed. A `-C` built from a variable is allowed only for read-only commands and steps such as `fetch`, `checkout` and `stash`. Anything else is still refused, `git add` included, since the gate could not tell which repository it stages into.
- **A plain variable assignment before a commit is allowed.** `MSG=/tmp/m && git commit -F "$MSG"` passes, since that assignment runs nothing. An assignment with a substitution or a redirect (`X=$(…)`, `X=1 > file`) is still refused beside a commit, because it would run between the gate's check and the commit. The refusal now names the step at fault; before, it could print an empty command name.

### Reviewers keep their copies separate from your checkout

Reviewer agents and the review prompts now forbid symlinking anything from your checkout into a reviewer's copy, and running package-manager installs there. One reviewer's install went through a symlinked `node_modules` and emptied the real one. Every script a reviewer writes must start with `set -u` and `cd <dir> &&` into its own directory before running git. A reviewer once ran git from an unset directory and created `~/.git`.

### The comment-slop check moves into the hooks module

The check that flags comment slop after every Edit and Write is now part of review-cycle's hooks module instead of a shell script. What it flags is unchanged: section markers, restate-the-code and AI phrasings, hedge prefixes and words, ticketless TODOs, history narration, and high comment density in the text just written. It still never blocks, and it runs whether or not the commit gate is switched on.

- **It now needs hooks modules**, like the commit gate: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` set to `1`. Without them the check does not run.
- **It no longer needs `jq`**, so `/review-cycle:init` stops checking for it.
- **When git or the file cannot be read**, the agent is told the scan was skipped, where the shell hook printed a line on stderr.
- **A failed or refused Edit or Write is not scanned**: it wrote nothing.

The gate's Bash rule against switching it off now matches settings paths case-insensitively, so `~/.CLAUDE/SETTINGS.JSON` is caught too. It still refuses any command that writes while naming a switch key, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test … > out.log` included: set the variable in your settings `env` block instead of on the command.

## 0.19.0 (2026-09-23)

### Added

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

## 0.18.1 (2026-09-21)

### Added

`review-sentinel delta` lists every path whose content differs from the marked tree, which after a branch switch or a pull mixes work you have not reviewed with the difference between two branches. Measured: a two-file change on a switched branch reported nine files; a one-file change after a merge reported five, four of them the other branch's already-reviewed work. The cycle hands that list to reviewers as their scope.

The delta now adds one line on stderr when the marked tree and HEAD differ, naming how many paths that covers, so the reader knows some of the list reflects history this session did not author. `/review-cycle:review` relays that instead of claiming the rest of the diff matches the reviewed state. When it cannot tell, it says so; that is distinguished from "no differences", because a failed probe and an empty result both produce an empty stream.

**The list itself is untouched — deliberately.** An earlier attempt filtered it down to paths git reports as modified, staged or untracked. Two rounds of review kept finding files that filtering dropped: pathnames git C-quotes (`é`, tab, `"`, `\`), a file untracked at the mark and then deleted, a truncated record stream, a partial write to the path set, and every path at all when the membership test errored — each at exit 0 with nothing on stderr, while the consumer contract told reviewers the rest of the diff was already reviewed. It was also quadratic: 26 seconds at 2000 changed paths, against 0 before.

Filtering can lose work; annotating cannot. A failed probe now costs a line of advice rather than a file.

### Fixed

The Codex preflight recorded auth as `confirmed` whenever `codex login status` exited 0, and the summary reported that word to the user. The probe does not exercise the credential — its verdict is a pure function of whether `auth.json` exists and parses — so `confirmed` was a claim the cycle had no evidence for.

Measured on codex-cli 0.155.1, three times independently during review: the probe printed `Logged in using ChatGPT` and exited 0 while the refresh token had been revoked server-side. The cycle recorded `confirmed`, spawned the Codex leg, and the leg died against `401 Unauthorized`. The probe prints the identical line and exit code after re-authenticating, and prints it again for an `auth.json` containing only `{}` — nothing in its output distinguishes a working credential from a revoked one, or from no credential at all.

The exit-0 outcome is now `stored session (not exercised)` in `/review-cycle:review`, `/review-cycle:review-pr`, and the plugin README. `/review-cycle:init` stopped printing `✓ authed` for it, which was the same promise in stronger words, and its glyph legend now covers observed-but-not-verified.

One sentence was removed for being false rather than imprecise. Both review skills justified reading a failed leg's status from the completion notification "not from the output file, where a crashed run and a clean run look alike". Measured: the output file records `[exited with code N]` on both, so it is strictly more informative than the notification, which flattens a rejected credential, a rate limit, a sandbox denial and a signal death into the same integer. Both skills now say the exit code reports whether the leg failed and the output file reports why, and both open that file before composing the failure message.

`tests/codex-auth-anchors.bats` anchors the vocabulary across the four files. Its anchors were chosen by mutation rather than by eye, and it states what it checks rather than claiming coverage: a rewrite that keeps every anchored phrase while changing what the surrounding rule means still passes, and no grep can close that.

Phase 1 still makes no API call. Exercising the credential on every review would spend a real request to catch a rare failure.

Deliberately not included: classifying *which* credential a 401 rejected, and the retry and remedy rules that would follow from it. A first attempt shipped that machinery and review found it repeatedly unsound — a branch written for a state the harness makes unreachable, and a recognizer that would fire on a non-fatal `401 Unauthorized` from a subsystem unrelated to auth, at the cost of the leg's retry. It needs its own design pass rather than a widening patch on this one.

A grep that answered the startup probe and then misanswered turned the commit gate off without a word. `dep_probe_grep` tests both directions at startup, but `DEPS_OK` caches that verdict and every later guard trusts it, so `parse_has_commit` read every command as harmless and the gate took the bare exit 0.

Measured with three greps that each pass the startup probe — one reporting "no match" for everything, one misanswering only extended regexes (the mode every verb decision uses), one misanswering a single fixed pattern. Before, on trees both gates deny: exit 0, zero bytes on stdout and zero on stderr, indistinguishable from a pass. After: both gates print one line naming grep and exit 1, and the command proceeds.

Three changes:

- **`parse_has_commit` confirms its own miss along both axes.** A fixed-string miss is confirmed twice — with a needle drawn from the searched text, which varies the pattern, and by re-asking the literal that missed, which varies the haystack. An extended-regex miss re-asks that same pattern about text built to match it, because a five-byte probe cannot vouch for a 250-byte regex. A miss it cannot confirm returns a third code.
- **A gate that cannot tell whether this is a commit stands down instead of ruling.** On the third code both gates report and exit 1, which is non-blocking. Continuing would let a broken grep deny an ordinary Bash call on an answer nothing computed — the trap fail-open exists to avoid.
- **A grep error is no longer read as absence, and the raw-payload fallback matches the prefilter again.** While a dependency is broken the fallback tested only for the literal verb, so a JSON-escaped one (`commit`) reached a quiet exit 0 with the diagnostic stranded in the debug log. It now carries the prefilter's backslash arm.

You see a diagnostic where you previously saw nothing, and a command carrying a backslash is noisy rather than silently denied while grep is broken. A healthy grep is unaffected: measured across 29,284 command strings — the test corpus, an exhaustive three-byte prefix sweep, and random-byte fuzz — the new code returns the same answer as the old one on every input, and never reports an unconfirmable miss.

Known gap: a grep whose fault keys on the *length or bytes of the text being searched* rather than on the pattern still defeats the extended-regex confirmation. Closing it needs the confirmation to re-ask about the failing input itself, which changes how the parser buffers stdin; that is tracked separately.

## 0.18.0 (2026-09-17)

### Added

`tests/gate-dependency-faults.bats` covers 23 gate-and-tool pairs across six fault modes each — `cat`, `jq`, `git`, `grep`, `sed`, `awk`, `date`, `tr`, and `sort`, per gate, for every tool that gate depends on — plus the root-discovery path taken when `CLAUDE_PROJECT_DIR` is unset, a payload whose verb is JSON-escaped, a lib that cannot be loaded, and a broken `jq` reading as an opt-out.

Two further fault modes keep git healthy and break only what it says about one repository: one refuses `--is-inside-work-tree`, one returns an empty `--show-toplevel`. They exist because every other mode breaks git globally, so the liveness branch rejects the shim and the rooted probe never runs — deleting that probe's entire branch left the suite green while the commit gate silently passed an unreviewed tree. Their cells run against a clean fixture and assert a quiet pass first, because on a drifting tree both gates deny for drift and the probe's contribution is invisible.

The suite constrains both directions. Asserting only "not silent" cannot catch a gate that has become too loud, and that is not hypothetical: a probe of this change compared against `'probe'` while `git rev-parse --sq-quote` prefixes its output with a space, so every probe failed, every pass-through exited 1, and an earlier version of this suite still passed — `.claude/hooks/version-bump-gate.bats` caught it by asserting `exit 0` on the no-op cases. The suite now separates a quiet success from a bare nonzero exit and carries its own pass-direction controls.

Verified by mutation, each figure the count of failing tests: making every pass-through exit 1 fails 4, making every one exit 0 fails 8, gutting the diagnostic reporter fails 9, deleting the rooted branch of the git probe fails 2, letting the two prefilter copies drift fails 2, removing the Stop gate's clock probes fails 1, and reverting the opt-out hardening fails 1.

Three weaknesses in the suite's own assertions were measured and closed. `assert_never_silent` rejected only a silent pass, so a gate that exited nonzero while printing nothing satisfied every matrix cell, and gutting the diagnostic reporter cost a single test. It now requires a deny or a diagnostic, and that mutation fails 9. The classifier grepped stdout for the decision token rather than parsing it, so a payload with a stray line before it — whose decision a hook runtime discards — still graded as a block; it now parses with `jq`, which also reads the Stop hook's different verdict shape through the same path. And the column floor filtered unknown tool names through a hardcoded allowlist, so declaring a dependency with no probe passed the floor while the live hook failed on every call with `no probe defined`; it now requires a `dep_probe_<tool>` for every declared tool, and an unknown name fails the test rather than being filtered out of it.

The suite also guards itself: one test proves the classifier still reports silence and still distinguishes a bare nonzero exit, one fails if the global kill-switch would make every gate exit 0, and floors fail if either fault-mode list collapses. `HOME` is deliberately not redirected, because a mise-shimmed `jq` under an unfamiliar `HOME` exits 0 with no stdout and would inject this suite's own fault into every cell at once.

### Changed

**A gate that cannot run now exits 1 rather than 0, which is a user-visible change in behaviour.** Stderr from a hook that exits 0 reaches the debug log only, never the transcript, so a diagnostic printed alongside `exit 0` would have been invisible — a first version of this change did exactly that and graded itself as fixed. Exiting non-zero and not 2 is a non-blocking error: the action proceeds, preserving the fail-open policy, and where the hook emits no valid JSON the transcript shows a hook error notice carrying the first line of stderr. The consequence is that a genuinely broken `jq` or `git` now raises a visible notice on ordinary Bash calls until it is fixed, which is the point, but it is noisier than silence. (The transcript behaviour is verified against the hooks reference at code.claude.com/docs/en/hooks, not measured in-harness; it is the load-bearing unverified claim in this change.)

Each gate names its own consequence in that line, because only the first line surfaces and it is the whole message. The Stop gate used to report that "the commit was not checked" when no commit is in play; it now says unreviewed changes were not detected.

Being first is part of the contract, not a given. A probe pipeline that redirects only the tool's stderr still lets bash print its own job-control line when the tool is killed by a signal, and that line arrives first: measured, a `grep` killed by SIGTERM put bash's own `Done`/`Terminated` job report where the diagnostic should have been, and the gate's message second. Each probe pipeline is brace-grouped with its own redirect, which drops the job message and leaves the status untouched — verified across 47 cells, where old and new forms returned identical exit statuses in every one.

**Both commit gates are faster than before this change, not slower**, which is not what adding six probes to each would suggest. Folding the `jq` known-answer question onto the extraction call removes a process per gate, and on a machine where `jq` resolves to a mise shim that process dominates everything else the gate does.

Measured on a payload containing a double quote — the common case, since the prefilter's backslash arm passes any command carrying one. Three separate batch runs disagreed on the commit gate's sign, so the numbers below come from interleaving the two versions call by call, 40 calls each, which spreads background load across both arms: the version-bump gate's median went from 228.0 to 152.8 ms per call and the commit gate's from 219.5 to 149.4 ms (means 233.6 → 156.4 and 225.6 → 155.4). Both gates fire on the same `PreToolUse`, so an ordinary Bash call carrying a quoted string spends roughly 145 ms less in gates than before. A single non-interleaved batch is not reliable enough to reproduce this: one such run put the commit gate 40 ms slower.

The global kill-switch now suppresses everything. `~/.claude/.disable-review-gate` is tested before the prefilter and before the source loop in all three gates, not merely before the probes. With the kill-switch set and the plugin's libs unreachable, the commit and Stop gates used to exit 1 with a diagnostic on every Bash call carrying a backslash and on every Stop — measured at 207 and 191 bytes of stderr, with no way to turn it off. Both are silent now.

The commit gate's cheap prefilter skips the whole gate when the payload cannot be a commit. It tests the raw payload for the literal `commit` **or a backslash**, because a JSON unicode escape standing in for one of the verb's letters decodes to `commit` only after `jq` reads it — an earlier form tested for the literal alone and turned a real deny into a silent pass, measured in both gates. The backslash arm is a partial filter rather than a narrow escape hatch: any payload whose command contains a double quote passes through.

The version-bump gate derives the plugin name with parameter expansion instead of `sed`, removing a dependency rather than probing it: a dead `sed` used to empty every plugin name, which the loop read as "no plugin affected". Its three coverage answers — plugin.json bumped, marketplace.json bumped, bump file staged — all come from a `grep`, and one stuck at 0 answered yes to all three and waved the commit through. Each is now re-confirmed by scanning the staged diff with bash patterns, no `grep` involved.

`plugins/review-cycle/tests/helpers.bash` and `.claude/hooks/version-bump-gate.bats` now export `GIT_CONFIG_NOSYSTEM=1` alongside their fake `HOME`. Isolating `HOME` alone left `/etc/gitconfig` in play, and on macOS that carries `credential.helper=osxkeychain`; fixture git then hunted a keychain under the fake `HOME`, found none, and macOS prompted to reset one — once per run, hundreds of git invocations deep.

`session-init.sh` and `posttool-slop.sh` were audited and gained no probes; the only change to either is the `cat` removal above. Measured with a `jq` stuck at exit 0: `session-init.sh` exits 0 leaving the mark unchanged, failing toward the gate staying armed; `posttool-slop.sh` emits nothing where a working `jq` emits its advisory context, losing that advice without opening a gate or blocking anything. Neither has a silent-allow path. One residual is known and unfixed: `session-init.sh` reaps stale markers through `gate_marker_is_stale`, and its `|| continue` treats the new unreadable-clock status exactly as "still fresh", so a dead `date` leaves a marker unreaped there. The Stop gate reports that condition, so it is visible from the other caller.

### Fixed

Review agents were told to work in a private `mktemp -d` directory and name it in their report, but only the report-only spawns were told to delete it, and none was told to clean up processes it started. The loop fan-out's prompt in `/review-cycle:review` and the fan-out prompt in `/review-cycle:review-pr` both lacked the deletion clause.

Phase 7 had been asserting otherwise. Its text reads "Carry the same containment clauses Phase 3's prompt carries", then lists "and delete it when you finish" — a clause Phase 3's prompt did not contain. The two have been out of step since the containment rule was introduced.

The cost is measured, not hypothetical. A `code-reviewer` agent built a differential harness in its scratch directory, fed the project's hooks through pipes it never closed, and exited. Every hook blocked on its payload read. Four hours and forty-three minutes later, 26 orphaned processes were still sleeping at 0:00.00 CPU with PPID 1 — six each of the commit and Stop gates, six of the repo-local version-bump gate, and four each of the session-init and post-tool hooks — and the scratch directory was still on disk. They were found by a different session on the same machine, not by the cycle that created them.

All three containment sentences now carry both clauses: delete the directory, and end every process you started before reporting, because one left blocked on a pipe you opened outlives both you and the directory.

This narrows the leak rather than closing it. An agent that stalls or dies mid-run still cleans up nothing, and no instruction can fix that — the cycle would have to sweep for the directories itself, which is filed separately.

All three gates in this repository stopped running and said nothing when a tool they shell out to broke. Measured by fault injection across the two commit-time gates and five fault modes each — a dependency that returns empty output at exit 0, exits 1, exits 127, dies on SIGTERM, or is absent — twenty of the fifty cells produced exit 0, no stdout, and no stderr. That is byte-identical to a genuine pass, so no state existed for anyone to inspect and learn the gate had stopped checking. `jq` and `git` were silent in all ten of their cells, in both gates. The Stop gate was worse: a `jq` exiting 0 with no output made its reentrancy check read as "this stop is already re-entrant" and stand the gate down, and all five `git` fault modes were silent through root resolution.

The originating fault is not hypothetical. `jq` on the affected machine resolves to a mise shim, and mise fails two ways that differ where it matters: with mise relocated out from under the shim it printed nothing and exited 0 (recorded 2026-09-16), while an untrusted config writes to stderr and exits 1 (measured 2026-09-17). Only the second is catchable by exit status, which is why each dependency is now asked a question with a known answer and checked against that answer.

`plugins/review-cycle/hooks/lib/dep-check.sh` holds the probes. `grep` is probed in both directions, because one stuck at 0 claims every pattern matches while one stuck at 1 claims none do, and each fails a gate the opposite way. `git` is probed with `rev-parse --sq-quote` and not only `--version`, because `--version` is answered before repository discovery — a git that runs but refuses this repository, the `safe.directory` shape, passes a liveness check and then fails every question the gate actually asks.

**A probe answered correctly says nothing about the next invocation**, so `jq` is not probed separately at all. Both commit gates ask their known question on the same call that extracts the command and cwd, which is the call whose answer they act on. A `jq` correct for a standalone probe and wrong afterwards used to leave the command empty, which read as "not a commit" and passed silently; it is now a contradiction the gate acts on. That also removes one process from every Bash call, which is where the performance note below comes from.

A jq that rejects invalid JSON is a *working* jq, and the first form of this change could not tell the two apart. The gates now read the payload with `-sRr` and `try fromjson`, so a payload that is not a JSON object is reported as a bad payload rather than sending the user to reinstall a healthy tool.

Both commit gates declare what they transitively depend on. Every decision routes through `command-parse.sh`, which is `awk`, `sed`, `grep`, and `tr`, while the gates declared only `jq`, `grep`, and `git`. The commit and Stop gates also reach their verdict through `review-sentinel`'s `staged_divergence`, which intersects the staged and unstaged path sets with `sort -u` and `grep -qFx`. It already guarded a `sort` that *dies* by checking its exit status — but a `sort` that exits 0 printing nothing writes an empty set, the intersection comes back empty, and that reads as no divergence. Measured on a tree whose worktree matched the mark while unreviewed content sat staged: `review-sentinel check` went from exit 1 to exit 0 with a `sort` stuck at empty-exit-0, and again with a `grep` stuck at exit 1. Both gates now declare `sort`, and the Stop gate declares `grep`.

The Stop gate turned out to depend on more than it declared elsewhere too. `gate_marker_is_stale` reaches a clock through `sed`, `tr`, and `date`, and treated a missing clock as "this marker is still fresh" — so a dead `date` made every in-progress marker immortal and held the gate open permanently, silently. It returns a distinct status for an unreadable clock now, and the gate reports it rather than inheriting a default.

Every hook in the plugin reads its payload with builtin redirection rather than `cat`. That read is the first line of each commit gate, ahead of the prefilter and every probe, so a broken `cat` emptied the payload and the gate exited 0 with no stdout and no stderr, in all six fault modes, in both gates. The Stop gate's block-once record is read the same way for the same reason: a broken `cat` emptied it, the comparison never matched, and block-once degraded into the hard loop its own reason text promises cannot happen.

Sourcing a lib cleanly is not the same as loading it. A truncated `dep-check.sh` sources at exit 0 with its helpers undefined, the missing emitter then fails as a command-not-found, and the script's final `exit 0` runs — measured at 0 bytes of stdout against a tree the gate should have blocked. Each gate now asserts the helpers it needs are defined before using them.

A broken dependency no longer short-circuits the "is this a commit?" decision. Neither a dead `jq`, which empties the command, nor a `grep` stuck at 1, which reports no match, can prove the payload is not a commit — so the gate falls back to the raw payload and proceeds when it carries the literal verb.

That fallback reads the literal **only**, and the distinction is load-bearing. The prefilter's other arm admits any command containing a double quote, which is most of them; gating on that made both gates deny ordinary Bash calls that were never commits — measured at 263 and 190 bytes of deny for `echo "hello world"` with `jq` stuck at empty-exit-0, where the unchanged gates passed in silence. Worse, it was unclearable: the commands that fix it, `/review-cycle:review` and `/review-cycle:accept`, need the same `jq`. That is precisely the loop this plugin's fail-open policy exists to rule out.

Three further silent paths are closed. Every decision was emitted by `jq -n` with a fallback keyed on the exit code, so a `jq` exiting 0 with no output satisfied that check, emitted no decision, and turned a block into a pass at the final step — all the emitters across the three gates now key the fallback on the content. `gate_project_opted_out` tested `jq -e`'s status, so a `jq` stuck at exit 0 answered yes to every test and reported that a project which never opted out had opted out; it now reads the value. The Stop gate's reentrancy short-circuit had the same shape — a `jq` whose only defect was `-e` semantics passed every probe and stood the gate down — and now keys on the answer instead; its pass-through routes through the shared helper too, because a bare `exit 0` in a `case` arm emits nothing and so went silent with a broken `sort`, invisible to any search for pass-through sites. And the version-bump gate's "is this repository in scope?" answers were bare `exit 0`s taken on a root derived from a command a broken parser may have emptied — reproduced: with `jq` stuck at empty-exit-0 the gate wrote its diagnostic and exited 0, which sends that line to the debug log and nowhere the user looks.

Where the gate concludes there is no repository to guard, it now asks why. Root discovery runs through git, so a git that will not answer produces the same empty result as a directory that genuinely holds no repository, and the commit gate took the quiet exit on both. It probes the directory the command pointed at first. The probe itself learned two questions it was missing: `rev-parse --show-toplevel` must print an absolute path, since every gate decides through it and nothing else exercised it; and a `.git` on disk while git denies the work tree is git misanswering rather than a missing repository, which no amount of asking git can settle.

Finally, a healthy git is no longer blamed for a root that is not a work tree. That is a different problem with a different remedy, and it now says so by name.

## 0.17.0

<sub>2026-08-28</sub>

- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  A fix that adds a guard is now exercised against valid input too, not only against the case it was written for.

  Testing a new check against the thing it should catch is instinctive; testing it against input that must still pass is not, and only the second finds a guard that rejects correct work. A guard added during one of this plugin's own review cycles caught its intended attack and was verified doing so, then turned out to fire on an accurate sentence describing the very step it protected — which would have made that section unwriteable and the guard the first thing a later author deleted rather than repaired. Phase 6's self-check now requires both directions whenever a fix adds a check, guard, assertion, or validation.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Report-only now means the kind of finding, not the leg that found it.

  The post-loop reviewers were treated as advisory wholesale, so a spec-conformance finding that quoted a requirement and showed the implementation plainly contradicting it had to be surfaced and handed back rather than fixed, and a measured fault in code the cycle had written minutes earlier arrived under the same heading. Both are defects, and treating them as opinions cost a round trip apiece. What those two legs genuinely own is judgment the cycle cannot supply — whether a restructuring is worth its blast radius, whether the scope was right — so the surface-only treatment now applies to proposals and scope questions, while a contradicted spec line or a measured fault goes through the fix-vs-defer policy like any other finding.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Later iterations now tell reviewers what earlier ones already settled.

  Each iteration's legs started with no memory of the passes before them, so they re-raised decisions the cycle had already made — measured twice in one day: a Codex leg re-raised a rule an earlier iteration had deliberately documented, and another re-raised a claim an earlier iteration had rebutted by measurement. Only the operator's recall stopped both from being re-litigated, and re-litigating costs a full leg's effort. From iteration 2 on, every brief now carries a short block naming what was fixed, what was deferred and why, what was rebutted and on what basis — a measurement, the documentation, or a deliberate design decision — and what was examined and left alone on purpose, all stated as settled and not to be re-reported. That last category earns its place: a judgment that something is fine reads as an unmade decision to the next leg, and comes back as a finding. A leg that thinks one is wrong is told to say so with new evidence rather than restate the original finding. The Codex leg gets the block too, since it carries no memory of its own.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Phase 7 now checks a diff's release-note file against the diff.

  A changeset or bump file describes the change in the author's words, and release tooling publishes that text verbatim — so a description written before review is a claim about code that review then went on to alter. Nothing checked it: the evidence policy binds claims about what a command does, while here the claim and the code that settles it are both inside the diff. A description that had drifted this way shipped into a version PR and cost a separate branch, review, merge, and release regeneration to correct, after a cleanup pass reported that its claims matched the code without having compared them. Phase 7 now reads every release-note file in play — those the diff adds or modifies, plus any already staged before the cycle began, since a delta-scoped review narrows the diff — against the final post-fix state and corrects it in either cleanup mode, running last so that cleanup — which edits `.md` files itself — cannot rewrite the text after it was verified. The summary reports those corrections separately from wording changes, and the cleanup agent is told never to report that prose matches code it did not actually compare.

## 0.16.2

<sub>2026-08-28</sub>

- [#42](https://github.com/oakoss/claude-plugins/pull/42)  *(patch)*
  Stopped the comment-density hook re-firing on comment-only edits.

  The density heuristic counts comment lines in the text an edit writes, so an edit that rewrites an existing comment block — usually to fix the hook's own earlier finding — measured near 100% comments and fired again, twice in a row in the observed case. The check now skips an edit only when the replaced text and the written text are both entirely comment lines: rewriting comments is comment-editing, and density carries no signal there, while a one-line comment anchor no longer waves a large narrated block through. Whitespace-only lines inside a comment block do not break the skip; a MultiEdit insertion (empty old_string) disqualifies it; edits that touch any code line still fire; Write payloads are unchanged; and the pattern greps still scan the whole file either way.
- [#42](https://github.com/oakoss/claude-plugins/pull/42)  *(patch)*
  Tier agent and skill markdown as runtime, not prose.

  The light-tier rule classified every .md path as prose, so a diff rewriting agent bodies or SKILL.md — the plugin's actual behavior — got the reduced fan-out and a 2-iteration cap while the version-bump gate correctly called the same paths runtime. Markdown a tool loads as instructions now tiers as code wherever it lives: agent bodies, SKILL.md, commands, hook-owned markdown, reference/ files a skill loads, and instruction files like AGENTS.md and CLAUDE.md — so the rule reaches .claude/agents in any repo, not only plugin directories. Under a plugin directory that leaves only README, LICENSE, CHANGELOG, NOTICE, and tests/ as prose, the same runtime split the version-bump gate draws. Two downstream consequences of the same root cause are fixed with it: Phase 7 now sequences cleanup after the report-only reviewers when the diff contains runtime markdown (a rewording mid-read would change what those legs are evaluating), and the cleanup agent's exclusion list names templates, decision tables, thresholds, and rule definitions in runtime markdown as logic it must not de-slopify.

## 0.16.1

<sub>2026-08-28</sub>

- [#40](https://github.com/oakoss/claude-plugins/pull/40)  *(patch)*
  Fixed the reviewed-tree capture failing in every repo that ran /review-cycle:init.

  init gitignores both the state directory and the opt-out marker, and git add refuses (exit 1, 'paths are ignored by one of your .gitignore files') whenever an exclude pathspec names an existing path that gitignore patterns match — a directory, a file, even an empty directory, and even a directory holding a force-committed file, the common .vscode/settings.json idiom — so the tree snapshot fell back to hash-only in exactly the repos the feature targets, and delta scoping never activated. The capture now drops only the pattern-ignored excludes from its add (judged index-free, so tracked content inside an ignored directory cannot mask the verdict) (git skips those paths anyway, so the tree is byte-identical — measured across three ignore shapes and fifteen worktree shapes), while the remaining excludes keep the add out of directories it must not walk: staging them would abort on an unreadable file and cost time plus garbage blobs proportional to their size. The rm --cached sweep still removes every excluded path from the tree, committed ones included. Found by dogfooding minutes after the 0.16.0 release; regression tests now cover the init'd gitignore shape and a committed excluded file.

## 0.16.0

<sub>2026-08-28</sub>

- [#36](https://github.com/oakoss/claude-plugins/pull/36)  *(minor)*
  Grade each review leg by what it could actually verify, so a leg whose build was broken no longer carries the same weight as one whose build worked.

  Every reviewer now opens its report with a two-line receipt: `execution:` naming the heaviest verification that **succeeded** with its first output line, or `none`; and `attempted-but-failed:` naming every verification that would not run — including the project's own suite when the leg never attempted it, since an unattempted check is not a passed one. Orientation commands like `git status` are excluded from line one, because they succeed on a machine where nothing else does.

  Both skills grade each reporting leg from two facts read off the receipt — whether line one names a verification that succeeded, and whether line two says `none` — giving `executed`, `partial`, or `static-analysis-only`, with `unknown` when either line is missing. A receipt quoting a compile error is `static-analysis-only`, never `executed`.

  Demotion keys on the claim's evidence rather than the leg's grade, for one narrow class: how an external tool, framework, or service behaves when the sole support is a manifest, config file, lockfile, or CI file. Gating that on the label would miss the incident outright, since a leg that got any one unrelated check to pass grades `executed` or `partial` — and real legs almost always get something to pass. The label says what the demotion means: `static-analysis-only` could not have checked, `executed` could have and did not. Claims about what the changed code itself does — control flow, error propagation, what a caller observes — are read from the source and stand. A finding already labelled `inferred` keeps its place, since that reflects a budget spent elsewhere rather than a capability that was missing. A leg that merely omitted the receipt is labelled `unknown` and is not demoted for that alone: a formatting miss should not cost you a finding, and a silently dropped finding is worse than an ungraded one you can still read. Omission does not beat candour, though — a report that otherwise shows the leg could not run the checks is demoted exactly as `static-analysis-only` would be.

  The summary reports this the way it reports stalled reviewers: one line naming only the legs that were not `executed`, with the observed cause. A healthy cycle prints `Leg execution: all executed` and nothing more.

  This addresses a failure seen over eight cycles on another repository: the Codex leg's builds failed for an entire session, it kept reasoning confidently from manifests, and two of its findings were wrong — including one asserting that `doctest = false` stops `cargo test --doc` from compiling the crate, which it does not. The summary read identically to a session where everything ran.

  The receipt narrows what a leg can quietly omit; it does not verify, and the skills say so. `partial` still rests on a leg volunteering what it could not reach.

  A new bats suite holds the contract across the files that carry it, catching a requirement dropped from an agent body, a new reviewer agent that never joined it, a renamed label, and an inverted grade mapping. CI's changed-files filter now routes plugin edits to the bats job, so that guard runs on the pull requests it exists for rather than only after merge.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(minor)*
  Added an explicit effort argument to /review-cycle:review and /review-cycle:review-pr that sets the Codex leg's reasoning effort in either direction.

  Diff size is a fine input for fan-out breadth but a poor proxy for reasoning depth: a 20-line change to a gate condition classifies as light on line count and previously had Codex capped at low with no recourse. Saying 'effort medium' (or any of none/minimal/low/medium/high/xhigh/max) in the free-form arguments now overrides the tier's cap — raising included, since an explicit per-invocation argument is the user's choice just as the global config is. With no argument, nothing changes: the light tier still lowers one-directionally and respects a configured low/minimal/none. The argument is validated against the closed set of seven literals before anything reaches the Codex invocation; an unrecognized value stops the cycle with the valid set named rather than running a long review at the wrong depth.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(minor)*
  The sentinel now stores a git tree of the reviewed state, and the review cycle scopes itself to the unreviewed delta instead of re-reviewing the whole diff.

  mark and accept-state capture a tree object of the exact reviewed content (real adds into a scratch index — measured: intent-to-add entries are silently omitted from write-tree, so the capture stages for real; the repository's own index is untouched, byte-compared), protect it with a per-worktree ref under refs/review-cycle/trees/ (measured: gc prunes an unreferenced tree, a single shared name lets one worktree's mark orphan another's tree, and the ref pollutes no porcelain), and write it as a third sentinel line that older versions ignore. A new delta verb prints the changed paths and line counts against that tree — untracked files included, and independent of commits moving HEAD. /review-cycle:review runs it in Phase 1: when a marked tree exists, the tier and the reviewers' changed-file focus come from the delta, so a 20-line follow-up to a converged review gets a proportionate small review instead of forcing the choice between a full-tier re-run and /review-cycle:accept. Without a stored tree (old sentinel, first review) behavior is unchanged, and the summary names which scope ran. The accept escape hatch stays user-only.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  The Codex leg's falsifiable question is now reading-shaped; measurement-shaped questions route to the subagents.

  codex review runs its sandbox read-only by default: read-only commands succeed, but builds, test suites, and temp-directory writes are denied. Measured on codex-cli 0.149.1 during this release's own review cycle — an unoverridden codex review session opened with `sandbox: read-only` in its header, and its attempt to run the project's test suite failed with `mktemp: mkstemp failed ... Operation not permitted`; the same denials recurred across three review iterations on another repository, where the leg burned effort attempting runs the sandbox refused and reported inferred findings every time. The brief now gives Codex a question settleable by reading source, diff, or authoritative documentation (read-only commands included), and reserves questions that require running or perturbing code for the subagent legs, which own writable scratch directories. Codex's findings were already useful as reading; this stops paying for the failing runs.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  Reviewer containment now requires a private mktemp -d — never a shared session scratchpad — and the never-evade rule reaches every spawned leg.

  Two measured incidents drove this. In one cycle a reviewer's copy was mutated mid-run by a sibling agent sharing the session scratchpad, contaminating its first probe round before it noticed and redid everything in an isolated directory. In another, a reviewer ran a different agent's script by accident and received a results matrix it had not authored — a failure mode indistinguishable from fabrication in the final report. Every containment block, and both skills' spawn prompts, now name a private mktemp -d as the only sanctioned workspace, forbid writes anywhere outside it (during this release's own review cycle, an agent briefly wrote a marker file to the repository's parent directory — a location the old wording never prohibited), and reviewers state the directory their measurements ran in so results are traceable to their author.

  The never-evade rule ('never reshape a command to slip past a guard: an opt-out is visible and reviewable, an evasion is neither') previously covered only the four fix-loop agents; it now also covers the maintainability auditor, the spec-conformance analyzer, the cleanup agent, and — via the spawn prompts — any leg the cycle spawns. A new bats suite anchors both requirements across every file that carries them.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  The Stop gate's block message now names the pending-decision case, so the model waits for the user's answer instead of preempting it with a fan-out.

  Measured failure: after a converged cycle, the model presented a small post-review delta with a review-or-accept recommendation and tried to end its turn; the gate's message ('only if the user explicitly asked to defer may you stop again') read as an instruction to launch the cycle immediately, three reviewers were spawned, and the user's /review-cycle:accept arrived seconds later — the spawned reviewers had to be killed mid-run. The gate already blocks once per state, so a second stop attempt passes by design; the message now says that stopping to await the user's pending review-or-accept decision is the right move, and launching the cycle over it preempts a choice that belongs to the user.

  The accept skill gained the matching edge case: when an accept lands while a cycle is in flight, the accept supersedes it — accept-state already retires the cycle's in-progress marker, and the skill now says to stop the spawned reviewers and disregard reports arriving after the accept, instead of letting them run to completion for a report nobody needs.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(patch)*
  The four machine-written state files moved from loose dotfiles under .claude/ into .claude/review-cycle/ — mark, in-progress, pr-in-progress, and stop-block.

  User-facing paths are unchanged: the .claude/.no-review-gate opt-out, the .claude/review-cycle.json config, and the installed pre-commit helper stay where they were. A one-time migration in the SessionStart hook moves old-layout files into the directory, fail-open with a diagnostic; if hooks never fire, the gate sees a missing sentinel and blocks once, after which a review or accept re-establishes it. The sentinel's exclude lists and the paths subcommand collapse the four state entries to one .claude/review-cycle/** glob, and /review-cycle:init derives .gitignore entries from paths at runtime, so initialized projects pick up the new layout on their next init run. This directory is also the home for future cycle state.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(patch)*
  Fixed the gate wrongly re-arming after committing part of a reviewed file (cpl-34d), and made the hot-path check ~50x faster on wide diffs.

  check and match now compare the stored reviewed tree against a freshly captured one when the sentinel carries a tree line — content equality, immune to the hunk-header drift that broke the hash when one file's changes were split across a commit. A divergent index (an entry differing from both the working tree and HEAD) routes to the hash comparison rather than being judged by the tree: the hash alone distinguishes a partial stage the mark saw (passes) from staged unreviewed content (drifts) — measured during review, judging it at the tree turned the former into a false drift that three consecutive accepts could not clear. The routing force-includes the config, so an ignore pattern matching it cannot carry config edits past the gate. Each worktree's marked tree is kept gc-reachable by its own ref under refs/review-cycle/trees/ (linked worktrees share custom refs, so a single name would let one worktree's mark orphan another's tree). The legacy hash path still serves old two-line sentinels, and current-hash is untouched: the in-cycle contamination snapshot deliberately keeps anchor sensitivity so an empty commit stays visible. Measured on a 100-dirty-file repo: the per-path hash check took 1.47s, the tree comparison 0.03s.

## 0.15.0

<sub>2026-08-23</sub>

- [#25](https://github.com/oakoss/claude-plugins/pull/25)  *(minor)*
  `review-sentinel mark` now refuses with exit 3 unless a review cycle is actually running, and the unguarded write moves to a new `accept-state` verb. The old shared verb let any agent declare its own work reviewed: `mark` in one Bash call and `git commit` in the next sailed through, because the PreToolUse gate exits on any command containing no `git commit` and so never saw the pair. `mark` now requires `.claude/.review-in-progress`, which only `cycle-start` writes and only a real cycle runs. The test is presence rather than freshness, but the Stop gate deletes markers past its 60-minute TTL, so a cycle that outruns it reaches Phase 8 with no marker and exits 3; the summary should say so rather than the cycle re-running `cycle-start` to recreate its own evidence. The commit gate's chained pass-through accepts `accept-state && git commit` only — the guarded verb cannot ride the one path that skips the sentinel check. `/review-cycle:review-pr` gets its own marker via new `pr-cycle-start` and `pr-cycle-end` verbs: it reviews a PR head in a throwaway worktree and never reads the working tree, so its marker holds the Stop gate open without licensing a `mark` over local changes nothing reviewed. Re-run `/review-cycle:init`, or add `.claude/.review-pr-in-progress` to `.gitignore` yourself.

  SessionStart now revokes an in-progress marker once it passes the same 60-minute TTL the Stop gate applies, on every startup path including the legacy-sentinel migration. Without that, a session that died mid-review left a marker that licensed the next `mark` over exactly the unreviewed work the gate exists for — the re-seed that used to clear it is skipped in that case by design. The revocation is deliberately stale-only, and `seed` no longer retires the marker at all: `startup` also fires when a second session opens in a repo where the first is mid-cycle, and deleting a live cycle's fresh marker would strand its Phase 8. Retiring a marker now belongs to the verbs that conclude a cycle — `mark`, `accept-state`, and `cycle-end` — plus the two TTL owners, the Stop gate and SessionStart.

  What you do differently: `/review-cycle:accept` and any script that wrote the sentinel by hand must call `accept-state` instead of `mark`. `/review-cycle:review` is unchanged, since Phase 3 already runs `cycle-start`. This raises the bar rather than closing it. `cycle-start` is itself unguarded, so `cycle-start` followed by `mark` still clears the gate, as does `accept-state`. What changes is that the shortest path no longer looks like routine plumbing: `accept-state` names itself in a transcript, and a cycle that declares itself started and then marks without reviewing is a claim someone can check.
- [#27](https://github.com/oakoss/claude-plugins/pull/27)  *(minor)*
  A git failure while computing the state hash now blocks the commit instead of being mistaken for "nothing differs". Every git call in `review-sentinel`'s hash stream reports failure explicitly, and `check`, `match`, and `status` treat that as drift.

  The failure that mattered: the path enumeration runs inside a nested command substitution, so its exit status never reached the surrounding pipeline's status check. A failure there produced an empty diff stream, and an empty stream hashes to `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — the exact value a mark taken on a clean tree stores. The gate reported `verdict: match — this exact state was marked reviewed` on a tree holding unreviewed content.

  Two smaller holes closed alongside it. A per-path `git diff` failure previously blocked or was waved through depending on where the failing path sorted, because nothing guarded the loop and the last iteration's status decided; an unreadable file was a coin flip, not a policy. And the stream is now generated into a file and hashed separately: as a single pipeline, `pipefail` reports the rightmost nonzero status, so a concurrent `shasum` or `cut` failure overwrote the git failure and it read as an ordinary tool error, which hooks fail open on.

  Reproduced in tests four ways — an unreadable file, a shimmed enumeration, a failing `diff.external` driver, and a git failure concurrent with a hash-tool failure — each verified to fail against the previous release.

  The block also tells you what to do about it. The sentinel now reports which operation failed and on which path, with git's own message attached, and the commit gate carries that into its deny reason instead of the generic drift text:

  ```text
  Commit blocked: the review gate could not read the working tree, so it cannot confirm
  this state was reviewed. review-sentinel: git failed while diffing locked.txt (working
  tree) — fatal: cannot hash locked.txt (anchor 3b00f9f8…); treating as drift. Fix the
  underlying problem (most often an unreadable file — check its permissions) and retry.
  /review-cycle:accept will NOT clear this: it fails on the same fault.
  ```

  What you do differently: if your repository can make git fail mid-diff, expect a block where you previously got a coin flip or silence, naming the file. One limitation to know about: `/review-cycle:accept` cannot clear this state, because the write verbs fail on the same fault. Fix the file, or use a gate opt-out. Ordinary drift is unaffected and still gets the ordinary message.
- [#30](https://github.com/oakoss/claude-plugins/pull/30)  *(minor)*
  The review cycle's Phase 6 now has a third fix classification between mechanical and substantive: the verified message fix. A fix whose entire diff is human-facing message text (plus at most a small tested pure helper feeding it) no longer forces a full reviewer re-fan-out — instead the fixing agent must reproduce the state the message addresses, run the printed remedy verbatim, and confirm it clears, recording the reproduction in the cycle summary. Message claims the local environment cannot exercise (another OS or shell, a remote service) get one Codex-only low-effort pass per cycle instead of the full fan-out. Machine-readable output (`--json`, exit codes, parseable formats), check verdicts, and unverified remedies still classify substantive. On the cycle that motivated this change, four full iterations would have been two plus one Codex-only pass; nothing changes for logic fixes.
- [#32](https://github.com/oakoss/claude-plugins/pull/32)  *(minor)*
  Every leg of the review cycle's Phase 3 fan-out — the four fix-loop agents and the Codex leg — now carries one falsifiable question. Phase 3 composes a specific claim per leg before spawning ("which of these new assertions still pass when the code under them is broken?" rather than "review this") and the spawn prompt requires the answer to cite what was run. The four agents also gained the technique that answers it: mutation testing in the test analyzer, fault injection in the silent-failure hunter, differential comparison and oracle sweeps in the code reviewer, and constructing the invalid value in the type-design analyzer. These perturb the system to find defects nobody suspected, which is a different job from the existing empirical-verification rule that settles a claim you already suspect.

  All four techniques require editing code, which the standing rule forbids in the review target. Each agent carries a short behavioral rule — perturb only a copy outside the repository, which needs no version control — and the cycle verifies the target itself rather than asking each agent to vouch for its own cleanliness. Phase 3 snapshots `review-sentinel current-hash` plus `git config --local --list` before spawning and Phase 4 compares before aggregating; Phase 8 refuses to mark a tree that came back contaminated. The hash is what makes this work: an empty commit leaves a `git status` comparison byte-identical and moves only the anchor line, so a status-based check cannot detect the commit clause of the rule it enforces. Phase 7 runs after the comparison and includes an agent that edits by design, so it is not covered — the summary says so rather than implying otherwise.

  `/review-cycle:review-pr` changes too, though it keeps its existing prompts: its report-only instruction now names the worktree and the main checkout specifically, so it forbids edits to the code under review without forbidding the scratch work these techniques need. Extending falsifiable questions to that path is tracked separately.

  Phase 9 gained two lines, so the mechanism can be judged by its own standard: how many questions were asked versus answered by measurement, and whether the target came back unchanged.
- [#34](https://github.com/oakoss/claude-plugins/pull/34)  *(minor)*
  Require a run, not a manifest, behind any claim about what a command does.

  A new evidence policy joins the comment and fix-vs-defer policies, and binds everyone in the cycle rather than only the author applying fixes. A manifest, config file, lockfile, script entry, CI workflow, or flag in documentation says what someone configured or intended; it does not say what the tool does with it. A real finding in the field report was reasoned from a manifest and was wrong: `doctest = false` does not stop `cargo test --doc` from running the doctests. Cargo compiles the crate and runs them anyway; the flag only removes them from plain `cargo test`.

  Three rules follow: name the command and quote what it printed rather than the file you read it from; treat a run you did not observe as no run at all, since a stale file, a redirect the shell refused, a cached artifact, and a skipped job all look like success from a distance; and when the environment cannot exercise a claim, label it inferred or verify it against authoritative documentation instead of stating it flatly. A finding that rests entirely on behavior nobody could exercise is withdrawn and raised as a question.

  The policy reaches every leg. The seven bundled agents carry it in their bodies, so it applies when they are invoked directly as well as inside the cycle. Codex has no body, so both `/review-cycle:review` and `/review-cycle:review-pr` now carry the rule into the intent brief that reaches it — and `review-pr` says why it matters more there, since the PR head sits in a disposable worktree whose dependencies may not be installed and there is no fix loop downstream to catch a manifest-only claim.

  Two agents get the rule in the form their job takes. The maintainability auditor is told that green tests are the weakest form of this evidence, because a suite that does not constrain the code being simplified stays green while the simplification breaks it — so a behavior-preserving claim must say what would have caught it, and when nothing would have, the missing test is the finding. The cleanup agent is told that tightening prose must never make it false, and that a factual correction is reported separately from a wording change, because the author needs to know a claim was wrong rather than merely shorter.

  `/review-cycle:init` now installs all three policies and appends only the ones a `CLAUDE.md` is missing, so re-running it after this upgrade adds the new policy without duplicating the two already there.
- [#33](https://github.com/oakoss/claude-plugins/pull/33)  *(patch)*
  Scope the commit gate to the project and stop matching text the command carries.

  The gate blocked the commit verb in any repository a session touched, not only the project it guards. That collided with the reviewer techniques in this same release: agents building a scratch fixture with real history — a copy at the base revision to diff against — were blocked while building it, and worked around it instead. The gate now stands aside only when the command *proves* the commit lands elsewhere, and gates the project whenever it cannot tell.

  Proving it means reading a leading `cd` chain and the commit's own `-C`, then resolving the result through its nearest existing ancestor, so a fixture that does not exist when the hook runs still resolves — while a not-yet-created subdirectory *of the project* still resolves to the project. `cd` hops compose the way bash composes them when the command is `&&`-joined throughout, or plainly sequenced with every directory already on disk.

  Everything else gates. A hop inside a subshell, a backtick, or an `if` branch may never run; a second commit in the same command lands somewhere the router never read, since everything it reads stops at the first; a path holding a variable, a glob, a `cd` option, a `~+`, a `..` segment, or only partial quoting was never expanded; `--git-dir`, `GIT_DIR`, and `CDPATH` move git or `cd` off the computed path; a payload cwd that is missing or relative names nothing. Both the payload cwd's repository and the one `CLAUDE_PROJECT_DIR` names count as the project, and an unresolvable target is checked against every one of them, so a stale `CLAUDE_PROJECT_DIR` can no longer switch the gate off where you are working.

  Detection runs on the command skeleton rather than the raw text. Quoted arguments, comments, and heredoc bodies are data, so an issue description quoting the phrase or a heredoc writing a setup script no longer counts as an invocation. Command substitutions stay code wherever bash expands them, double quotes and unquoted heredoc bodies included; a quoted command handed to `bash -c`, a cluster like `bash -lc`, `eval`, `ssh`, a heredoc into a shell, or a pipe into one still blocks, as does a path-qualified `/usr/bin/git`. `git commit-tree` and the other hyphenated plumbing verbs are no longer treated as the gated verb — they write an object and move no ref.

  Failures are no longer read as answers. A `grep` that errored, an `awk` that died or produced nothing, and a lexer that lost track of quoting each mean the text was not read, and unread text blocks rather than passes.

  Two limits are deliberate. Commands over 32 KB skip the skeleton and let the raw text decide, because the lexer is quadratic and a hook that takes seconds is its own defect. And the shapes that hand a string to a shell are a named list, so a runner it does not cover — `python3 -c`, a task runner — is missed, and the commit it hides passes; the gate has never claimed to be an adversarial boundary.

  If your project relied on the gate firing in a second repository under the same session, set `CLAUDE_PROJECT_DIR` to that repository, or opt the project out with `{"disabled": true}` in `.claude/review-cycle.json`.

## 0.14.0

<sub>2026-08-18</sub>

- [#23](https://github.com/oakoss/claude-plugins/pull/23)  *(minor)*
  The Codex review leg now receives the intent brief. `codex review`'s scope flags reject a prompt argument, so the brief is passed as a config override (`-c developer_instructions="<brief>"`) — verified additive to `AGENTS.md` on Codex v0.147.0, with no file written into the review target. Codex reviews now know what the change is trying to accomplish, closing the gap where the CLI leg reviewed blind while every Claude-side reviewer got the brief. On a Codex version that drops the undocumented key, the leg degrades to an unbriefed review instead of failing.
- [#23](https://github.com/oakoss/claude-plugins/pull/23)  *(minor)*
  New `/review-cycle:review-pr` skill: single-pass, report-only review of a GitHub pull request, run locally. It fetches the PR head into a disposable detached worktree — the working checkout is never touched — runs the same reviewer fan-out as the review cycle (Codex leg included, briefed, with `--base` against the PR's base branch), and reports findings with explicit per-reviewer coverage so "no findings" is never mistaken for "nobody looked". On request it posts the findings back to the PR as a single COMMENT review whose comments — inline and body-level alike — carry fingerprints that deduplicate across re-runs. It never fixes code, never approves, and never touches the review sentinel.

## 0.13.0

<sub>2026-08-18</sub>

- [#15](https://github.com/oakoss/claude-plugins/pull/15)  *(minor)*
  Aligned the bundled de-slopify skill with the new `prose` plugin's Google-developer-style rules, so cycle cleanup and ad-hoc prose cleanup apply the same standard. The quick reference gains wordiness swaps ("in order to" → "to", "leverage" → "use", "enables you to" → "lets you"), instruction mechanics (active voice, present tense, condition before instruction, second person), and timeless-docs rules ("currently"/"soon" → delete). Claims and punctuation rules join the quick reference too: superlatives and "ensures"/"guarantees" become verifiable claims or "helps", "and/or" and slashed alternatives are spelled out, dramatic ellipses go, and "see" replaces "check out" for links. Generation-stable structural tells round it out — copula avoidance ("serves as" → "is"), sentence-final "-ing" significance trailers, and Claude-era phrases ("You're absolutely right") — with a note that vocabulary tells rotate by model generation while structural patterns persist. The don't-overcorrect floor grows: keep function words like "that" and "then" when they aid parsing, keep articles even in headings, and kept emdashes take no surrounding spaces. Details live in a new "Wordiness and Instruction Patterns" section of the prose-patterns reference.

## [Unreleased]

## [0.12.0] - 2026-08-17

Makes reviewers prove their claims instead of inferring them.

### Added

- **Reviewers are instructed to verify empirically.** Five of the reviewer agents (code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer, spec-conformance-analyzer) now carry a "Verify empirically" section: when a finding rests on a claim a command can settle — an exit code, a build output, whether a test actually covers a path, whether the typechecker actually rejects an invalid construction — run the command and report what happened rather than reasoning about what should happen. Findings are labeled verified (with what was run) or inferred from reading, and verification must never disturb the review target — repros and probe files go in a disposable directory. The two exclusions are deliberate: cleanup originates no findings, and maintainability-auditor's structural suggestions are speculative by design — a probe adds cost without changing a verdict already labeled speculative. Field experience drove this: the findings that mattered came from agents that ran things, and this plugin's own release-breaking `codex login status` bug was caught only by an empirical probe no prompt had asked for.
- **A local eval suite** (`evals/`, run with `claude plugin eval` — see `evals/README.md`). Two cases cover the 0.11.0 behavior that only exists as skill prose: a codex shim exiting 127 must yield a completed Claude-only cycle whose summary names `skipped (not installed)` and never launches `codex review`; a working shim plus a 2-line diff must produce a `codex review` invocation carrying `-c model_reasoning_effort="low"` and a summary reporting `participated (effort: low)`. Shims keep eval runs off any real Codex account. Local-only for now — CI has no `claude` CLI on the runner.
- **Phase 6 verifies facts introduced by fixes, not just the fixes themselves.** The self-check confirmed a finding was addressed but never that new prose was true, so a fix could resolve a finding by asserting something false — surviving until the next fan-out caught it, or shipping. A fix that adds or rewords a factual claim now gets the claim itself checked (run the command it describes, read the code it characterizes, confirm the name or version it cites) before the loop proceeds.

## [0.11.0] - 2026-08-17

Makes the Codex review leg optional, so the cycle runs anywhere Claude Code does, and scales its review depth to the diff.

### Added

- **Codex review depth now follows the diff tier.** Every review ran at the user's globally configured reasoning effort, so a two-line `.gitignore` fix cost the same as a large refactor. Light-tier diffs now pass `-c model_reasoning_effort="low"` when that is a reduction — a config already at `low`, `minimal`, or `none` is left alone; full-tier diffs pass no override and inherit the user's `~/.codex/config.toml`. With `multi_agent = true` the setting reaches Codex's internal review agents, so the reduction compounds across them. The final summary reports which applied.
- The adjustment is **one-directional**: the tier can lower effort but never raise it. A globally configured `medium` is a deliberate choice, and a large diff is not grounds to overrule it.
- Effort, not model name, is the tuning axis: `codex review` exposes neither `--model` nor `--profile` (only `-c key=value`), model names churn often enough that Codex maintains a `[notice.model_migrations]` table, and a name pinned in the skill would rot into an error or a silent downgrade on another user's account. The skill emits the literal `low` and never interpolates a value — Codex does not validate `-c` values locally, so a bad one would surface only as an API failure mid-review.

### Changed

- **Codex is now an optional review leg rather than a hard prerequisite.** Phase 1 probed `codex --version` and stopped the entire cycle when it failed, which made the plugin unusable on any machine or CI runner without an authenticated Codex — including the PR-review contexts it is otherwise well suited to. The probe now records the leg's status and the cycle continues Claude-only when Codex is absent.
- **The Codex leg's status is always named in the final summary** (`Codex leg: participated | skipped (…) | failed (…)`). Degraded coverage stays visible instead of silently halving the review.
- **Absence and mid-run failure are distinguished.** A Codex that never passed the preflight probe is a `skipped` environment, not an error. A Codex that passed the probe and then exited nonzero or returned unusable output during `codex review` is reported as `failed` — the cycle still completes on the subagent findings, but the breakage is surfaced as a regression to look at.
- **`/review-cycle:init` reports Codex as an available upgrade, not a warning.** A missing CLI prints what installing it would add and marks the multi_agent and auth steps not-applicable rather than flagging them.
- **Auth is no longer a gate on the Codex leg.** Only `codex --version` decides participation. `codex login status` reports on a *stored* session only, so it exits nonzero with `Not logged in` whenever Codex is authenticated by environment variable (`OPENAI_API_KEY`) with no login on disk — the standard CI arrangement, and precisely the environment an optional Codex leg exists to serve. It now serves only to enrich a later failure message (`failed (… — no stored session, try codex login)`), and `skipped (not authenticated)` is gone as a status. Caught by this release's own dogfood run.

### Fixed

- **The Codex leg's status is read from the completion notification**, which carries the shell's exit code, rather than inferred from the output file — where a crashed run and a clean run both look like a file with no findings in it. `participated` is also now clearly an outcome recorded after the run, distinct from Phase 1's `eligible` precondition; the two shared a name, which made the launch gate read as depending on its own result.
- **`codex --version` failing no longer always means "not installed".** Exit 127 does; a broken install, a non-executable binary, or a `$PATH` the tool shell can't see does not, and telling those users to `npm install -g` something already installed helps nobody. The probe now classifies on exit code and quotes the actual stderr.
- **Auth state is three-valued and written down when observed.** `no stored session` and `unknown (probe unsupported)` were collapsed, so a user whose CLI simply lacks `login status` was sent to run `codex login` to fix something that wasn't broken. The state is also recorded into the summary draft at Phase 1 rather than recalled at Phase 9 — the loop ends turns and re-wakes across up to four iterations, and it isn't re-derivable later.
- **The light-tier effort lookup reads the root table only.** A plain grep also matched `model_reasoning_effort` under `[profiles.*]`, so a root `minimal` beside an unused profile `medium` read as `medium` and got "lowered" to `low` — raising the user's actual effort, the exact thing one-directionality forbids.
- **A failed Codex leg retries once, not every iteration**, and any iteration's failure sticks in the summary instead of being overwritten by a later success — the iteration Codex missed is usually the one that had the findings.
- **The stall watchdog no longer drops a reviewer on an unrelated wake.** "Hasn't reported by the next wake" counted any wake, including one triggered by other agents milliseconds later, so a nudged reviewer could be discarded while mid-reply. A wake now has to carry information about that reviewer — it idled again, or every other reviewer has since reported.
- **The watchdog's set-relative drop test no longer applies on the light tier.** "Every other reviewer has since reported" is vacuously true when `code-reviewer` is the only Claude-side reviewer, so the light tier could nudge and drop its sole reviewer on any wake — losing the entire Claude side of the review on the tier least able to afford it. Only that reviewer's own notification counts there.
- **Review subagents must be spawned unnamed, in both fan-outs.** Passing `name:` turns a background agent into a persistent addressable teammate that parks as `idle` awaiting messages instead of completing and returning its report, so its findings never arrive and the watchdog spends its one nudge on an agent that was never going to deliver. The rule is now global rather than stated only in the Phase 3 fan-out — Phase 7 spawns agents too, and has no watchdog to notice. Found the hard way: the dogfood run lost all three Claude-side reviewers to this.
- **Phase 2's canonicalization notes have somewhere to land.** A missing formatter or an erroring typecheck was to be "noted", but the summary had no field for it, so "the typecheck tool was missing" and "the typecheck passed" looked the same. The summary template now carries a `Canonicalization:` line, and an abort before Phase 8 prints an abbreviated status instead of reporting nothing at all.

## [0.10.0] - 2026-08-17

Cuts the cycle's stall-and-ceremony overhead — the wall-clock cost that field feedback measured at roughly half of each cycle — without dropping any finding-catching mechanism.

### Added

- **The Stop gate no longer blocks while a review cycle is running.** The cycle writes `.claude/.review-in-progress` at fan-out (new `review-sentinel cycle-start`/`cycle-end` subcommands); while the marker is fresh (under 60 minutes) the Stop hook lets turns end, so the agent awaits background reviewers via completion notifications instead of sleep-loop workarounds. `mark`/`seed` clear the marker; the Stop gate removes stale copies from crashed cycles.
- **Stall watchdog for background reviewers.** A reviewer that goes idle without delivering gets one nudge, then the cycle proceeds without it and names it under "reviewers dropped (stalled)" in the summary.
- **Diff tiering.** Phase 1 classifies the diff once: light diffs — docs-only, or ~25 changed lines or fewer regardless of file type — get Codex + code-reviewer with a 2-iteration default cap and inline cleanup, so a two-line `.gitignore` fix no longer triggers the full apparatus; everything else keeps the full conditional fan-out (default cap 4). The tier is named in the final summary.
- **Reviewers receive an intent brief.** The fan-out prompts were context-free ("review the uncommitted changes"), leaving every reviewer to guess what the change was trying to do — a major source of beside-the-point findings. Phase 3 now composes a 2–4 sentence intent summary plus the changed-file list, passed to each subagent. Codex runs unbriefed: its scope flags reject a prompt argument (found by this release's own dogfood run). Intent only, never expected verdicts.
- **`review-sentinel status`: a diagnostic that answers "why is the gate blocking me".** Prints the resolved root, clean-tree verdict, the Stop-gate markers when present (in-progress age vs TTL, block-once record), stored mark (anchor + hash), the current hash computed from the stored anchor, and a one-line verdict; exit codes mirror `check`. Field feedback showed users bisecting gate behavior with `check` vs `match` (which disagree by design — the clean-tree fast-path) and drawing wrong conclusions; one subcommand now shows the whole picture.

### Changed

- **The Stop gate blocks once per drift state.** It records the state hash it blocked on (`.claude/.review-stop-block`); a later stop on the identical state soft-passes with a warning instead of re-blocking, so a user-directed "keep going, review at the end" batches work naturally. This relaxes only *when* review happens — the commit gate still prevents unreviewed commits, unchanged.
- **Fix verification is a self-check, not an automatic re-fan-out.** After applying fixes, the cycle verifies each against the findings list; a fresh reviewer iteration runs only when some fix was substantive (new logic, edits beyond the flagged lines), and then scoped to Codex plus the reviewers whose domain those fixes touched. Iterations that used to exist purely to confirm mechanical fixes landed are gone.
- **Cleanup only spawns an agent when it pays for itself.** Purely size-based: diffs under ~150 changed lines get the comment-policy and de-slopify pass inline; the cleanup subagent is reserved for larger diffs, whatever the tier — a large docs-only diff is light-tier for fan-out but is exactly the prose volume the agent spawn is for.
- Both new marker files are excluded from the sentinel hash and clean-tree check, and `review-sentinel paths` (which `/review-cycle:init` feeds into `.gitignore`) now lists them. Existing installs: re-run `/review-cycle:init` once so the new marker paths land in your project `.gitignore`.
- **The comment-slop hook now demands the fix instead of suggesting it, and catches narration by arithmetic.** The PostToolUse hook's context was "consider removing or rewriting" — hedged phrasing models shrug off, which is why comment cleanup kept needing repeat requests. It now directs an immediate follow-up Edit, including compressing kept WHY-comments to a line or two. It also gained a comment-density check on the exact text just written (4+ comment lines and ≥30% of the edit): narrating WHAT-comments mostly dodge the pattern greps, but they can't dodge the ratio. The count is careful about what a comment is — C dereferences (`*p = 1;`), `#include` directives, `#[attributes]`, and shebangs don't count, a Write payload's leading header block is exempt (a new file's legitimate header is not an "edit"), and the history-flavored grep is case-insensitive. Comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check, and prose files (`.md`, `.txt`, …) now skip the hook entirely — `#` is a heading there, and the pattern greps would false-positive on lines like a `# Note:` heading; prose belongs to the de-slopify/cleanup lens. The hook now has its own bats suite (26 tests) covering the pattern greps, the density thresholds across all three tool payload shapes, and every silent exit path.
- **History-flavored comments are flagged and banned by policy.** Comments narrating a prior state of the code ("previously", "no longer", "as it did while X") accrete during review passes — each pass explains the previous one, so reviewed comments grow instead of shrink. The hook greps for them, and the comment policy (skill, cleanup agent, reference snippet) now names the pattern: state the current invariant, put the story in the commit message. The review skill additionally forbids a review pass from ever lengthening a comment.
- **The cleanup agent inherits the session model** instead of pinning sonnet — it now only spawns on large diffs, where the stronger model's comment judgment is worth the cost.

### Fixed

- **Gate rejection messages no longer imply the review didn't happen.** Both the PreToolUse deny and the installed git hook said "run /review-cycle:review first" for every drift — misdirecting when a review *had* happened and the state drifted afterward (commit-time formatter, hook manager restoring the index after a rejection, edits since the mark). The messages now distinguish the two cases, name the common causes, note that a hook-manager rejection may have unstaged files, and point at `review-sentinel status`. A new README troubleshooting entry covers the same ground, including what is *not* the cause: staging order and multi-commit batches are both invariant under the hash design (re-verified against clean-room repros this release).
- **Codex now reviews the same diff as the subagents on scoped runs.** `against <ref>` scoped the subagents to `<ref>..HEAD` but Codex was still invoked with `--uncommitted`; the skill now uses `codex review --base <ref>` when a base is given.

## [0.9.0] - 2026-08-03

### Added

- **`review-sentinel install-hook`: opt-in commit-time enforcement.** Installs a git pre-commit hook that runs `review-sentinel check` inside the commit — closing the two structural blind spots of PreToolUse-time evaluation: chains that re-drift the tree after the check (`sed -i … && git commit -a`), and agent commits from outside the session's Bash tool. Only agent sessions are gated (`CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` env guard — humans are never blocked); the kill-switch and per-project opt-outs are honored with the same precedence as the PreToolUse gate; a missing binary or check error fails open. Manager-aware installation: lefthook repos get a guarded helper script plus a lefthook job (config auto-edited only when it has no `pre-commit` key, append failures reported), pre-commit and simple-git-hooks repos get the helper plus a printed snippet (committed config never auto-edited), husky/`core.hooksPath` setups are handled implicitly via `git rev-parse --git-path hooks`. Under plain git a pre-existing hook is relocated to `pre-commit.local` and chained first with its exit status preserved — appending would swallow its failures or sit dead behind an `exit 0` — while a git-tracked hook file (husky commits `.husky/`) is never rewritten: helper plus snippet instead, so no machine-specific path lands in committed files. The embedded binary path is quote-escaped so unusual install paths can't break the hook. `review-sentinel uninstall-hook` reverses everything, restoring a relocated hook. Worktree commits are covered. The PreToolUse gate stays active as the zero-setup default everywhere; the git hook is added depth, never a dependency. New `install-hook.bats` suite (41 tests).
- **SessionStart notes missing commit-time enforcement, context-only.** When the gate is active and no commit-time hook is installed, session-init emits one line into model context describing `install-hook` — explicitly marked not to be suggested unprompted.

### Changed

- **Lexical analysis extracted to `hooks/lib/command-parse.sh`.** The commit-detection regex, commit counting, sanctioned-mark-chain decision, and `cd`/`-C` extraction now live in one sourceable lib of pure string functions, unit-tested without git repos (new `command-parse.bats`, 23 tests). `commit-gate.sh` shrinks to orchestration. The policy rationale moved next to the code that implements it. Marketplace repos' version-bump gates can source the same lib so twin definitions cannot drift.
- **Commit detection runs on the joined command view.** A backslash-continued `git \<newline>commit` is one invocation to bash and is now one invocation to the gate; previously the per-line entry grep missed it entirely.

## [0.8.2] - 2026-08-03

### Fixed

- **Chained `review-sentinel mark && git commit` is no longer denied.** The commit-gate hook fires before the whole Bash chain executes, so it evaluated the sentinel against the pre-mark state and blocked the chained form of the `/accept` flow, forcing mark and commit into separate Bash calls. The pass-through is strict about what qualifies: the command must contain exactly one `git commit`, and a bare `mark` (no `--root`) at a command position, with the binary name at a path boundary, must be joined to it by `&&` with nothing in between — so the commit only runs if the mark actually succeeded. `;`, `||`, and newline separators stay denied (they'd let a failed or short-circuited mark's commit through — including `||` anywhere before the mark), as do commands between mark and commit, a mark after the commit, and extra commits after a marked one. Shell comments are stripped before the prefix match, while the commit count is taken from the raw bytes so a quoted `#` (e.g. `-m "fix #12"`) can never hide a later commit; the single-commit requirement keeps quoted or heredoc text containing the phrase from standing in for the real commit. New `commit-gate.bats` suite (57 tests) pins both directions.
- **`git -C <repo> commit` (and other global-option forms like `git -c k=v commit`) no longer slip past the gate.** The commit detection only matched `commit` immediately after `git`, so the natural cd-free shape `git -C <path> commit` — and subshell/backtick forms like `(git commit …)` — bypassed the sentinel check entirely. Detection now skips global options in every real shape — quoted values with spaces (`-c user.name='A B'`, `-C "/my repo"`), separate-argument long options (`--git-dir <path> --work-tree <path>`) — and recognizes `(`/backtick command openers. The `-C` path feeds project-root resolution the way a leading `cd` already did: extracted only when the command holds a single commit invocation (prose mentioning `git -C` cannot steer the gate), last `-C` wins to match git, it outranks `cd` (the `-C` decides where the commit lands), and relative paths resolve against the cd target or payload cwd.

## [0.8.1] - 2026-06-14

### Fixed

- **A reviewed *new* file no longer reads as drift once `git add`-ed.** An untracked file was hashed via a different representation (a `--UNTRACKED:` content dump) than its staged form (a `git diff --cached` patch), so any `git add`/`git add -A` between marking the sentinel and committing (e.g. routine bead bookkeeping that touches new files) flipped the gate to false drift and blocked the commit. Untracked files are now intent-to-added (`git add -N`) into a throwaway copy of the index, and the index→working-tree segment is diffed against that scratch index, so untracked, staged, and committed forms of the same new file hash identically. The real index and working tree are never mutated, and the index/worktree divergence check that catches the Codex P1 bypass is unaffected (the scratch index covers only the worktree segment). New regression tests cover the untracked→staged and untracked→staged→committed transitions.

## [0.8.0] - 2026-06-05

Closes the loop on a class of spurious review re-triggers: a pre-commit hook that reformats files at commit time leaves working-tree churn the gate reads as fresh unreviewed drift, forcing a needless second review.

### Added

- **Phase 2 "Canonicalize the working tree."** `/review-cycle:review` now brings the tree to the project's canonical state *before* the reviewer fan-out — running the project's own auto-fixers (formatters, `lint --fix`) and fast read-only checks (typecheck, affected tests), sourced from definitions the agent already has (`CLAUDE.md`/`AGENTS.md`, the pre-commit config, `package.json` scripts, `justfile`/`Makefile`/`Taskfile`/`mise`, CI). Reviewers see clean code; the marked state matches what the commit-time hook produces, so a formatter re-running at commit no longer strands changes the gate reads as drift. Auto-fixers are scoped to the changed fileset; slow suites are surfaced rather than run; the whole phase is fail-open. The later phases renumber accordingly (Fan-out → Phase 3, … Stop → Phase 10).
- **README note on pre-commit hooks and review re-triggers** (Troubleshooting). The leave-a-clean-tree principle: a hook that mutates files at commit time must fold those edits into the commit (scope formatters to staged files) or the residue re-fires the gate. Names the common `cargo fmt --all` vs. staged-scoped footgun.

### Changed

- **Agent task-state and IDE exclusions now match at any depth, not just the repo root.** `.beads/`, `.trekker/`, `.vscode/`, `.idea/`, `.zed/`, `.cursor/`, and `.fleet/` are excluded from the sentinel hash wherever they appear, so a monorepo that keeps `.beads/` in a subpackage no longer trips the gate when a `bd`/lefthook pre-commit hook re-exports that subpackage's `issues.jsonl`. Each directory now carries both a root-anchored (`.beads/**`) and an any-depth (`**/.beads/**`) pathspec; the root form is retained because older git pathspec parsers treat a leading `**/` as one-or-more directories rather than zero-or-more. Reverses the deliberate root-only scoping documented in 0.6.2. Test X7 flipped accordingly, with new hash-path and regression coverage (X7b/X7c).

## [0.7.0] - 2026-05-28

Adds two report-only reviewers and consolidates the plugin to a single `review` command, informed by Cursor's `thermo-nuclear-code-quality-review` and Matt Pocock's two-axis `review` skill.

### Added

- **`maintainability-auditor` agent** — an ambitious structural lens: "code-judo" moves (restructurings that delete whole categories of complexity), file-size sprawl (~1000-line threshold), spaghetti-branch growth, weak seams, and testability regressions. Runs once per review as a **report-only** reviewer — its speculative restructurings are surfaced in a "Structural suggestions" section for you to action by prompting, never auto-applied, because high-blast-radius rewrites must not be applied unsupervised in a loop.
- **`spec-conformance-analyzer` agent** — a **report-only** spec axis: checks the diff against its originating issue/task/PRD and reports missing or partial requirements, scope creep, and implemented-but-wrong, each quoted against the spec line. Reported separately from quality findings, because a change can follow every standard while building the wrong thing.

### Changed

- **`/review-cycle:review` is the single command for the whole cycle.** The auto-fix reviewers (Codex, code-reviewer, tests, error handling, type design) run in the fix loop; the two report-only reviewers and the de-slopify cleanup run once *after* the loop converges, against the final post-fix state — so the expensive opus maintainability pass runs a single time rather than on every iteration.
- **Arguments are natural language, not flags** — `against <ref>` and `max <n>` instead of `--base` / `--max-iter`; bare `/review-cycle:review` covers the common case. Flags don't autocomplete in Claude Code and are awkward to dictate.
- **`pr-test-analyzer` fires on any source change**, closing the blind spot where a feature that shipped zero tests skipped coverage analysis entirely.
- **`type-design-analyzer` catches type-boundary smells** — needless optionality, escape-hatch `any` / un-narrowed `unknown`, and casts that paper over a boundary — anywhere in the diff, not only on type declarations.
- **The cleanup agent removes redundant comments decisively.** A comment that restates the code is removed on sight; only a comment that may encode a constraint the agent cannot verify is kept, and it is flagged in the summary for a human to confirm.

### Removed

- **`/review-cycle:inspect` and `/review-cycle:cleanup` skills.** The maintainability lens that `inspect` hosted now runs inside `/review-cycle:review` (report-only), and `/review-cycle:de-slopify` covers ad-hoc prose cleanup; the cleanup *agent* still runs automatically in the cycle. `review` is now the only review command.

## [0.6.3] - 2026-05-13

### Fixed

- **`write_sentinel` correctly reports `printf` failures.** The previous form `err=$(printf '%s\n' "$content" > "$tmp" 2>&1)` intercepted stdout via the file redirect before `2>&1` could merge stderr into the capture, so `err` was always empty and the failure branch was unreachable. The function now checks `printf`'s exit code directly. Functional impact is small (the existing `mv` step catches most downstream failures), but the function now fails honestly on a `printf` error.

### Changed

- **Built-in-exclusion test split per directory.** The single parameterized X4 test became seven small tests so bats can identify which exclusion regressed if one of them breaks.

## [0.6.2] - 2026-05-13

Fixes the bug where edits confined to agent task-state (e.g. `.beads/`) forced a review. Also closes a self-exclusion bypass found by `/review-cycle:review` against an in-progress patch.

### Changed

- **Gate ignores non-code state by default.** Agent task tracker directories (`.beads/`, `.trekker/`) and IDE state directories (`.vscode/`, `.idea/`, `.zed/`, `.cursor/`, `.fleet/`) are now excluded from the sentinel hash. Changes confined to those paths no longer trip the Stop or commit-gate hooks. `/review-cycle:review` still works manually for users who want a review pass anyway. Exclusion is anchored at the repo root; a nested `subproject/.beads/` is still hashed.
- **New `.claude/review-cycle.json` config.** Schema: `{"disabled": bool, "ignore": [string]}`. `disabled: true` opts the project out of all gates. `ignore: [...]` extends the built-in exclusion list with project-specific pathspec-glob patterns. Requires `jq`. The legacy `.no-review-gate` marker is still honored indefinitely; there is no auto-migration, because the old marker was typically gitignored (local-only opt-out) while the new file is meant to be committed (team-wide), and silently converting one to the other could publish an opt-out unintentionally. Users who want to consolidate can write the new file themselves and remove the marker manually.

### Added

- **Pipeline fail-closed on git/jq errors.** A malformed pathspec, missing sha tool, or any mid-pipeline git failure now returns drift (1) instead of silently producing `sha256("")` and passing the gate. Added a smoke-test using the assembled pathspec before hashing.

### Security

- **Self-exclusion bypass closed.** The previous in-progress draft excluded the user-provided ignore file from its own hash, so an unreviewed edit adding `src/**` plus an unreviewed `src/app.ts` change could pass the gate without ever being reviewed. The new config file is **not** in the default excludes AND is force-included in the hash regardless of user `ignore` patterns. Editing `.claude/review-cycle.json` always forces a review pass before its rules take effect, even if the user added patterns that would otherwise match it (e.g. `**`, `.claude/**`).
- **Malformed-pathspec bypass closed.** Earlier draft of the smoke-test returned exit 1 on git rejection, which `check` mapped to exit 2 (internal error, hooks fail-open). A user with a broken `ignore` pattern could therefore disable the gate until the config was fixed. The smoke-test now returns 2 directly, which `check` maps to drift (hooks block).
- **Explicit `disabled: false` honored over stale legacy marker.** `gate_project_opted_out` now honors the config's `disabled` key exclusively when present, so a hand-written `{"disabled": false}` cannot be silently overridden by a leftover `.no-review-gate`.

## [0.6.1] - 2026-05-12

Security and robustness fixes for issues found by running `/review-cycle:review` against the 0.6.0 release before broader adoption. **Users on 0.6.0 should upgrade immediately** — 0.6.0 contained a gate bypass.

### Security

- **Staged-content bypass closed.** The hash now captures both `git diff --cached <anchor>` (anchor → index) and `git diff` (index → working tree) per file, sorted by path. The 0.6.0 implementation used only `git diff <anchor>` (anchor → working tree), so a user could stage unreviewed content, restore the working tree to the reviewed state, and then commit — slipping unreviewed bytes past the gate. Per-path iteration also keeps the hash byte-stable across staging-state changes, so moving reviewed content between staged and unstaged does not drift.

### Fixed

- **`match` subcommand exit codes distinguish error from no-match.** Now exits 2 on real errors (missing sha tool, not in work tree, pipeline failure) and 1 only on actual no-match. The 0.6.0 implementation collapsed all failures to exit 1, breaking `session-init`'s ability to detect a misconfigured environment.
- **Silent failure in legacy-hash migration.** `session-init` now emits a stderr warning when the 0.5.x→0.6.0 migration cannot compute the legacy hash (e.g., missing sha256sum/shasum). Previously the failure was swallowed and the user was left permanently gated with no breadcrumb.
- **Anchor type validation.** Sentinel anchors are now checked via `git cat-file -t` and must resolve to a commit or tree object. The previous `cat-file -e` accepted any object (including blobs and tags), which would have produced a meaningless hash.
- **Pipefail and PIPESTATUS checks** on the hash compute pipeline. A mid-pipeline `git diff` crash now surfaces as a compute error instead of silently producing a valid-looking but wrong hash.

## [0.6.0] - 2026-05-12

> ⚠️ **Withdrawn**: this release contained a gate bypass via staged content. Upgrade to 0.6.1.

### Fixed

- **Multi-commit drift after a single review.** Previously every `git commit` advanced HEAD and shrank the diff the sentinel hashed against, so the gate flagged drift even when no unreviewed content had been introduced. Reviewing a batch and then splitting it into N commits required N reviews. The sentinel now pins (anchor SHA, diff-from-anchor hash) instead of (diff-from-HEAD hash), so committing already-reviewed content does not invalidate the sentinel — the cumulative anchor→working-tree diff stays the same regardless of how many of the reviewed hunks have been committed.

### Changed

- **Sentinel format is now two lines:** `anchor:<40-hex>` (HEAD SHA at mark time, or the empty-tree SHA `4b825dc6…` for unborn HEAD) and `sha256:<64-hex>` (hash of `git diff <anchor>` plus untracked file contents). Migration from 0.5.x is automatic via `session-init` on next startup, with lossless upgrade when the working tree still matches the previously-reviewed state.
- **New `match` subcommand on `bin/review-sentinel`.** Used by `session-init` to decide whether to advance the anchor; differs from `check` in that it does not treat a clean tree as a pass. `check` and `match` together replace the prior pattern of comparing `current-hash` output against the raw sentinel file.
- **`current-hash` output is now two lines** (`anchor:` then `sha256:`) to match the on-disk format. Anyone scripting against the old single-line output will need to update.

### Migrated

- **Single 0.5.x → 0.6.0 migration block** in `session-init.sh` replaces the previous 0.5.0 → 0.5.1 block. Detects any pre-0.6.0 sentinel (bare hex or `sha256:`-prefixed), computes the legacy hash against current state, and re-seeds in the new format only when they match (lossless upgrade). When they don't match, the old sentinel is preserved so the gate fires on the unreviewed drift.

### Behavior unchanged

- The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) keep their existing semantics. Only `session-init` changed; the others just call `review-sentinel check`.
- Clean-tree fast-path is preserved: `check` still exits 0 on a working tree with no changes regardless of stored sentinel content.

## [0.5.2] - 2026-05-12

### Changed

- **`review`, `cleanup`, and `inspect` are now model-invocable.** The commit-gate hook is the actual boundary against unreviewed commits, so blocking model invocation on these skills only created an incoherent flow: the Stop hook would tell Claude to invoke `/review-cycle:review`, and Claude couldn't. `accept` (gate bypass) and `init` (meta-setup) remain user-only.

## [0.5.1] - 2026-05-11

### Changed

- **Gate state is now factored into a shared CLI (`bin/review-sentinel`) and a sourced lib (`hooks/lib/gate.sh`).** The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) each shrink to their actual decision logic; preconditions and sentinel I/O live in one place. `/review-cycle:accept` and Phase 7 also call the CLI instead of re-implementing hash computation inline. The sentinel path (`${PROJECT_ROOT}/.claude/.review-mark`) is unchanged; existing sentinels self-heal on the next `startup` session.

- **Hash now captures content changes, not just file-level state.** Previously the sentinel hashed `git status --porcelain --untracked-files=all` only, so editing an already-modified file (without adding new files) didn't update the hash — the gate would pass when it shouldn't. The new computation concatenates porcelain status, `git diff --cached --binary`, `git diff --binary`, and the contents of untracked files. Splitting staged+unstaged (vs. `git diff HEAD`) covers repos without an initial commit; staged content in unborn repos now correctly contributes to the hash. Subsequent edits to the same file also correctly drift the sentinel.

- **`session-init` re-seeds on `startup` only when the prior state was reviewed.** Re-seeds when the sentinel is missing (first install; pre-existing WIP becomes the baseline) or when the sentinel matches the current state (idempotent refresh). If the sentinel disagrees with the current state, the previous session left unreviewed work; `session-init` keeps the old sentinel and lets Stop/commit gates do their job. `/clear`, `/compact`, and resume events are not `startup` events and don't fire this hook. Trade-off: dependency bumps or IDE edits between sessions now require a one-time `/review-cycle:accept` or `/review-cycle:review` to re-baseline, but quit-and-restart with WIP no longer silently absorbs unreviewed changes.

- **Clean working tree always passes `check`.** The sentinel CLI exits 0 on a clean tree regardless of the stored hash, eliminating the post-commit re-block loop where the user would have to run `/accept` after every commit just to clear the gate.

### Fixed

- **One-time migration from 0.5.0 sentinel format.** 0.5.0 wrote a bare 64-char hex hash; 0.5.1 writes `sha256:<hex>`. On the first 0.5.1 `startup` session that finds an old-format sentinel, `session-init` re-seeds it. This restores self-heal for the upgrade path without absorbing in-session unreviewed work on subsequent restarts.
- **`hooks/posttool-slop.sh`: comment-slop findings rendered with literal `\n` instead of newlines.** Pre-existing bug from 0.5.0 — the `FINDINGS` variable used `"\n\n"` inside double quotes (which doesn't interpret escapes) and jq propagated those as `\\n` into Claude's `additionalContext`. Switched to `$'\n'` so the rendered context is actually newline-separated and readable.
- **`hooks/posttool-slop.sh`: now bails when the modified file is outside any git repo**, matching the scope of the other three hooks. Previously it would inject context for orphan files.
- **`bin/review-sentinel`: defense-in-depth git work-tree check** in `compute_current_hash`. If a refactor ever calls it with a non-repo path, it now returns nonzero instead of silently producing the empty-tree hash and reporting "clean".
- **`bin/review-sentinel`: `read_sentinel` warns to stderr and returns nonzero** on malformed content. Callers can now distinguish missing from corrupted (`check` still treats corrupted as drift; the warning surfaces in the next hook output).
- **`bin/review-sentinel`: `write_sentinel` forwards underlying error to stderr.** Previously `2>/dev/null` swallowed permission/disk-full/path errors silently. The mkdir, write, and rename now each capture stderr and emit a specific message before returning. Temp file is cleaned up on write or rename failure.
- **`hooks/session-init.sh`: strict re-seed.** Only re-seeds when the sentinel exactly matches the current hash (idempotent refresh) or is missing (first install). Previously the conditional piggybacked on `check`'s clean-tree exit-0, which let a transient `git stash` or `git checkout` overwrite a prior-session sentinel with the empty-tree hash. The strict version preserves the prior sentinel as evidence whenever current state diverges.

### Added

- **`/review-cycle:init` now preflights `jq`, `git`, and a sha256 tool** (`sha256sum` or `shasum`). Previously a machine missing any of these would silently fail-open at every hook — the gate would appear to be doing nothing for no obvious reason. Each missing tool now surfaces a clear install hint in the init summary.

- **Bats smoke suite** at `tests/`. Covers the sentinel CLI (seed/mark/check/paths, clean-tree, drift detection, format validation, exit codes) and the gate lib (kill-switch, opt-out marker, project-root resolution chain, composite check). Run with `tests/run.sh`, which wraps bats with a post-suite cleanup to work around a known hang on macOS.

## [0.5.0] - 2026-05-11

### Added

- **PostToolUse comment-slop detector** (`hooks/posttool-slop.sh`). Fires after `Write`, `Edit`, or `MultiEdit` and scans the modified file for high-confidence comment-slop patterns. When detected, returns `hookSpecificOutput.additionalContext` so Claude addresses them on the next turn. Does NOT block — the write already happened; this is informational reinforcement of the comment policy in real time.

  Patterns flagged:
  - Section markers (`// ===== HELPERS =====`)
  - Restate-the-code verbs at start of comment (`// fetches the user`)
  - AI-flavored phrasings (`// Here we ...`, `// Let's ...`, `// This function does ...`)
  - Hedge prefixes (`// Note:`, `// Important:`, `// NB:`)
  - TODO/FIXME without ticket reference (skipped if `#123`, `ABC-123`, or URL follows)
  - Hedge words in comments (`obviously`, `basically`, `simply`, `just`, `actually`)

  Limits: skips binary/lock/build-artifact paths and files over 1MB. Respects the global kill-switch and per-project opt-out marker like the other hooks. Catches the comment patterns Opus 4.7 most often introduces mid-implementation — supplements the cycle's end-of-cycle cleanup with real-time intervention.

## [0.4.2] - 2026-05-10

### Fixed

- commit-gate now correctly resolves the project root when the Bash command is `cd <path> && git commit ...`. Previously, the hook ran `git rev-parse --show-toplevel` from the session cwd (not the cd target), so if the user ran from `$HOME` and cd'd into a project inline, `PROJECT_ROOT` resolved empty and the hook exited 0 fail-open instead of blocking. Now the hook parses a leading `cd <path>` from the command, expands `~`, falls back to the hook input's `cwd` field, then to `CLAUDE_PROJECT_DIR`, then to the shell cwd. Confirmed end-to-end: `git commit` from a different cwd now correctly produces the documented deny.
- Verified that bypassPermissions mode does NOT override hook deny decisions (was an earlier incorrect hypothesis — proven false by a hard-deny test).

## [0.4.1] - 2026-05-10

### Fixed

- commit-gate hook now produces output matching the documented PreToolUse schema. The hook was using the deprecated top-level `decision: "block"` / `reason` fields, which PreToolUse no longer honors (silently treated as "no decision," letting `git commit` through). Switched to `hookSpecificOutput.permissionDecision: "deny"` per the current docs. The hook now actually blocks unreviewed commits — confirmed in isolation with a realistic JSON input. Same class of bug as the Stop hook schema fix in 0.1.2.

## [0.4.0] - 2026-05-10

### Added

- Embedded 4 subagents from Anthropic's pr-review-toolkit at `agents/`:
  - `code-reviewer.md`
  - `silent-failure-hunter.md`
  - `type-design-analyzer.md`
  - `pr-test-analyzer.md`

  Invoked under the plugin namespace as `review-cycle:<agent-name>`. Copied verbatim from `anthropics/claude-plugins-public`; license preserved at `LICENSE-pr-review-toolkit`; attribution in `README.md`. The `code-simplifier` and `comment-analyzer` agents are intentionally not migrated (see `README.md` for reasoning).

- New `cleanup` subagent at `agents/cleanup.md`. Preloads the bundled de-slopify skill via the `skills` frontmatter and applies both the comment policy and de-slopify methodology in a single pass. Edits files directly; returns a structured summary.

- New `/review-cycle:cleanup` skill — thin wrapper around the cleanup subagent for `/`-invocable ad-hoc tidy-ups.

- New `/review-cycle:accept` skill — updates the review sentinel to mark the current state as reviewed without running the full cycle. Per-state escape hatch for "I've manually reviewed, let me commit" flows.

### Changed

- Cycle Phase 2 fan-out now spawns each pr-review-toolkit-style subagent directly via the Agent tool with `run_in_background: true`, instead of invoking `/pr-review-toolkit:review-pr all parallel`. Conditional dispatch (code-reviewer always; test/error/type analyzers based on diff scope) moves into the cycle skill's prose. No external slash-command dependency for review agents.
- Cycle Phase 6 cleanup now spawns the `cleanup` subagent instead of invoking the de-slopify skill directly. The cleanup agent owns both the comment policy and the de-slopify application in a single phase.
- Inspect Phase 2 mirrors the same direct-Agent-invocation pattern.

### Notes

- This release drops the runtime dependency on the pr-review-toolkit plugin. The Codex CLI is still required (already true since 0.2.0). The plugin is now fully self-contained for its review work.
- Roadmap remaining: v0.5.0 — PostToolUse hook for real-time comment-slop intervention (optional).

## [0.3.2] - 2026-05-10

### Changed

- Tightened the `/review-cycle:init` summary output. Replaced the bracketed two-column status format (`[✓|⚠|✗] Codex CLI: ...`) with single-glyph leading status (`✓ Codex CLI: ...`). Avoids wrapping in narrow terminals and reads more scannably.

## [0.3.1] - 2026-05-10

### Added

- `/review-cycle:init` skill — one-time setup helper. Verifies Codex CLI and `multi_agent` config, optionally appends the comment + fix-vs-defer policies to `~/.claude/CLAUDE.md` and/or `./CLAUDE.md`, and updates project `.gitignore` to exclude the per-project sentinel files (`.claude/.review-mark`, `.claude/.no-review-gate`). Idempotent — safe to run multiple times. Replaces the manual setup steps previously documented in the README.

## [0.3.0] - 2026-05-10

### Added

- Bundled the `de-slopify` skill at `skills/de-slopify/` (full skill including `references/` subdir). Invokable as `/review-cycle:de-slopify` for ad-hoc prose cleanup, or invoked automatically by the cycle's Phase 6.
- Source remains at [oakoss/agent-skills](https://github.com/oakoss/agent-skills); the bundled copy is a snapshot synced on each plugin release. Cross-agent skills.sh distribution stays at agent-skills; the plugin's copy makes review-cycle self-contained for Claude Code users.

### Changed

- Comment policy in the embedded skill bodies and `reference/policies.md` softened from "default to NO comments, only add when WHY is non-obvious" to "comments are fine; keep them clean and minimal." Same set of bad patterns flagged, but the default action shifts from "remove" to "trim/rewrite" for accurate-but-verbose cases. Aligns with how Opus 4.7 should actually write comments, not just how to suppress them.
- Cycle Phase 6 now invokes the bundled `/review-cycle:de-slopify` directly rather than relying on a user-level `de-slopify` installation.

### Notes

- If you have a user-level `de-slopify` skill installed at `~/.claude/skills/de-slopify/`, you can remove it after upgrading to this version — the plugin's namespaced copy supersedes it. Or keep both; they don't conflict.

## [0.2.0] - 2026-05-10

### Changed

- Codex review is now invoked directly via the `codex review --uncommitted` CLI rather than through the `/codex:review` slash command. The Codex Claude plugin is no longer a dependency — only the Codex CLI binary needs to be installed and authenticated. This simplifies the dependency graph and avoids edge cases around invoking skills with `disable-model-invocation: true` from inside other skills.
- Codex preflight check changed from `/codex:status` slash command to direct `codex --version` invocation.

### Notes

- This is the first step in the dependency-reduction roadmap. Subsequent versions will embed de-slopify (0.3.0) and migrate pr-review-toolkit subagents into this plugin (0.4.0).

## [0.1.2] - 2026-05-10

### Fixed

- Stop hook output no longer includes `hookSpecificOutput`, which is not a valid field for Stop hooks per Claude Code's runtime schema (only `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, and `PostToolBatch` accept `hookSpecificOutput`). Directive content moved into the top-level `reason` field, with a short label in `systemMessage`. Previously the hook produced JSON that failed schema validation at runtime with "Hook JSON output validation failed".

## [0.1.1] - 2026-05-10

### Changed

- Renamed the main action skill from `cycle` to `review` to align with the Anthropic convention used by `pr-review-toolkit:review-pr` and improve discoverability in the `/` autocomplete. Invocation changed from `/review-cycle:cycle` to `/review-cycle:review`. All hook directives, documentation, and policy references updated accordingly.

## [0.1.0] - 2026-05-10

### Added

- Initial release.
- `/review-cycle:cycle` skill — full automated review loop with parallel Codex + pr-review-toolkit fan-out, fix-vs-defer policy, up to 4 iterations, and final de-slopify cleanup.
- `/review-cycle:inspect` skill — read-only inspection pass for sanity checks or pre-commit review.
- SessionStart hook to seed the per-project review sentinel idempotently on fresh session starts.
- Stop hook to gate turn-end on uncommitted-and-unreviewed changes.
- PreToolUse (Bash) hook to block `git commit` when the sentinel doesn't match the current state.
- Per-project opt-out via `.claude/.no-review-gate` and global kill-switch via `~/.claude/.disable-review-gate`.
- Embedded comment and fix-vs-defer policies inside the skills, with standalone copies in `reference/policies.md` for optional CLAUDE.md installation.

Generated by oakum 0.5.0.
