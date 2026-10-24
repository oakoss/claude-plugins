# Changelog

All notable changes to the `pr-watch` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.6.1 (2026-10-24)

### Fixed

A push whose reads GitHub refuses (a bad token; a token missing a scope or not granted the repository; an organization's SAML SSO, IP allow list or OAuth app restrictions; a repository gh's account cannot see; or, on github.com, no gh login at all) no longer stops being watched silently after 90 seconds, even when a later read fails another way. It retries like a pull request's line and, after 8 failed reads, toasts and tells Claude that pr-watch stopped watching it. A push to a host that is not GitHub still leaves quietly once its 90 seconds are up.

When a pull request turns ready to merge while workflows the merge does not wait on are still running, the toast and what Claude is told now name them and say they are not required ("#128 is ready to merge; Visual capture still running, not required"; Claude is told they were still running when pr-watch read it), so a merge state of `UNSTABLE` no longer needs working out by hand.

A release tool's version pull request is now named "release #259" in the band and in pr-watch's toasts, so it reads apart from ordinary pull requests at a glance. Other pull requests keep their "#N".

A release tool's version pull request (headed `*/version-packages`, as oakum's is, or `changeset-release/*`) is never offered for merging: when it turns ready, its news says that merging it is the release and leaves it for you to ask, it waits for your next message even where review-cycle lets Claude merge unasked, and it puts no `merge #<number>` suggestion in the prompt box.

## 0.6.0 (2026-10-23)

### Added

A stack layer reads ready to merge only once every layer below it has merged or is ready itself, since `gh stack merge` on a layer merges the open layers below it too and GitHub reports each layer ready by itself. Until then its line shows `○ waiting on layer 2/3`, it raises no ready toast or `merge #N` suggestion, and a `watch` with `wake` on the top layer wakes Claude when the whole stack is ready. A layer below that pr-watch does not watch counts as not ready unless GitHub's stacks API reports it merged. When a layer's line changes, the layers above it are read again at once, so a stack turns ready without waiting out their read delay.

The `watch` tool takes `wake`, so Claude can ask to be woken when a pull request turns ready to merge or its merge's checks pass, instead of running its own `gh` polling loop for an ask like "merge it once it's green". Without it nothing changes: a ready pull request and passed checks still wait for your next message. With it, each wakes Claude once, a merge Claude made included; it lasts while the pull request is watched in the session, and `Wake Claude: off` still wins.

### Fixed

pr-watch now follows a github/gh-stack stack's layers without a watch call. A `gh stack submit` Claude runs starts a line for each pull request it prints as `✓ Created PR #<n>`, as `gh pr create` does, even when it failed after opening some; before, its pull requests showed only once watched by hand. Each layer's line carries its place after its number, `#235 ≡ #236 2/3`, counted from the bottom as GitHub's badge is, and a stack's lines sit together, top layer first. An open pull request's stack is asked of GitHub's stacks API again after a `gh stack` command that can change it, and every 10 minutes for a change made elsewhere; a merged layer is asked once it has merged and keeps that answer, and a lookup that fails keeps the last one. A token that may not read the stacks API (HTTP 403) now counts as no stack, as a host without it does, unless a stack is already known. `gh stack submit`, `push`, `sync` and `merge` also have every line read again soon, as a push does.

A merged layer of a gh-stack stack now reads `merged into main` (the stack's trunk) rather than naming the layer below it. GitHub keeps a merged layer based on the branch beneath it even though its commit landed on the trunk, so pr-watch asks GitHub's stacks API for the trunk, at most once a minute until it answers, then keeps it. A pull request in no stack keeps its base, as does one on a host without the stacks API, and one whose lookup failed until a later try gets an answer. The lookup is a REST call, so its rate limit pauses none of the host's other reads.

A merged pull request's line now follows the branch it merged into past its own merge commit. A push to a branch runs CI on its newest commit only, so the lower layer of a stack merged with `gh stack merge` got no runs and its line sat on `waiting on checks` before leaving; past the 90-second grace it now follows the oldest later commit that has runs, reading `✓ checks passed on a later commit` once they pass. Outside a stack, a merge commit with no runs, as from a path filter, still leaves. A workflow that failed on the merge commit settles once its newest finished run on a later commit passes, reading `✓ <workflow> failed, since passed` before it clears, where before it stayed failing until someone re-ran it. A later commit counts only when it descends from the merge commit among the branch's newest 10, so a failure on a merge buried deeper settles only by a re-run, as before, and a stack layer buried deeper leaves. While a line looks past its merge commit, each read also reads those 10 commits, 2 more GraphQL points.

## 0.5.0 (2026-10-16)

### Added

pr-watch wakes Claude only for news it can act on alone: a failed run, merge conflicts, requested changes, comments and reviews. A pull request turning ready to merge, and a merge's or push's checks passing, now wait for your next message, which carries them to Claude unseen, instead of starting a turn whose answer is "want me to merge?". A ready pull request still wakes Claude where review-cycle's stop-before setting is `release` or `never stop`, since Claude may merge it unasked there; pr-watch reads that setting from the same files review-cycle does.

A ready pull request also suggests `merge #<number>` in the empty prompt box (Tab to take), unless `promptSuggestionEnabled` is off, and a ready pull request or a failed run sends a notification through your notification channel beside the toast. Your next message reads a waiting ready pull request again before calling it ready, so one merged meanwhile is left out; a slash command or another plugin's prompt leaves the news waiting.

A session resumed with `claude --resume` or `/resume` watches its pull requests again, where it used to come back with an empty band. pr-watch saves the pull requests a session watches in its own store, keyed by session id, whenever the list changes; a resumed session keeps its id, so it finds them and reads each at once, telling Claude what changed while it was away: a failed run, conflicts, requested changes, comments, and, with your next message, a pull request now ready to merge or a merge whose checks passed. News told before the exit is not told again. A new session, a fork or a `/clear` starts with none, and pushed branches are not brought back.

### Fixed

A draft pull request's line now shows its checks. It starts `#128 draft ·` and follows them like any other line: the bar while they run, the job that failed, `○ waiting on checks` while a required GitHub App check runs, or `✓ checks passed` once they pass, where it had read `○ waiting on draft` and hidden them. It still never says `ready to merge` while a draft, and now also says what would block the merge once it is marked ready, as in `#128 draft · ✓ checks passed · ⚠ conflicts`. A draft with no checks reads `#128 ○ draft`.

A ready pull request wakes Claude only while review-cycle is loaded with its commit gate on and its stop-before setting past `merge`. pr-watch now reads that setting from review-cycle's own `/config` rows rather than from every review-cycle entry in your settings, so a leftover value from an uninstalled review-cycle, or from another copy of it such as a `--plugin-dir` one, no longer decides; `.claude/settings.json` and `.claude/settings.local.json` still apply as before. With review-cycle absent or its gate switched off, a ready pull request waits for your next message, as it does in a headless `claude -p` session, where `/config` lists no plugin's settings.

A status in the band colors only its mark, not the words beside it. Each other workflow reads ` · CodeQL ` in the normal text color with its mark carrying the state: `●` blue while it runs, `✓` green once it passes, `✗` red when it fails. A line's own status does the same: `✓ ready to merge` and `✓ checks passed` color only the `✓` green, a blocked line only its `⚠` yellow, a failed job only its `✗` red, and the running workflow only its `●` blue. The running `●` and the failed `✗` had drawn uncolored, since their names are links. An error such as `gh failed` still reads red. A mark is drawn whole when a line is too wide for the band; the plain text beside it is cut first.

pr-watch no longer gives up on your pull requests when GitHub cannot be reached. A dropped connection, a laptop offline, or a 502 to 504 from GitHub's gateway used to show `gh`'s raw error in red at once and count toward the 8 failed reads that end a watch, so some 15 minutes offline stopped every watch and told Claude it had given up. Now the line keeps what it last showed, adds a dim `· offline, retrying` from the second such read, and stays: one read at a time tries GitHub, 15 seconds after the last, doubling up to a minute, and every line drops the note as soon as GitHub answers anything. After 15 minutes out of reach a toast names the host and `gh`'s reason once, in case a host or proxy is wrong. The watch tool says when its first read could not reach GitHub. Other failures, such as a refused token or a missing pull request, still show in red and still end the watch after 8 in a row.

A pull request opened after a push now takes over the push's line in place. After `git push` then `gh pr create`, the `⟳ push <branch>` line and the new pull request's line had stacked until the push line's own next read found the pull request, up to about 10 seconds or longer; now the pull request's first read, about a second after it is watched, puts it in the push line's row and drops the push line, keeping what Claude was told of either. This applies within one repository; a push to a fork is still handed to its pull request upstream by the push's own next read.

A prompt with no news kept for it no longer writes pr-watch's kept-news store, so a store that refuses writes no longer shows "could not add its news to your prompt" on every message. When a prompt can neither re-read a pull request's ready line nor put back the news it took, pr-watch now says both: the toast about your prompt keeps the error that stopped it, and a second toast says the news was lost.

A running line now says what its workflow still waits on. Once some of its jobs have finished, it names those left, as in `● CI: Windows ████████████████▉░░░░░░░ 3m29s / ~4m58s`, marking each that has not started `queued`, or counts them past two; a long job name is cut at 24 characters. A re-run now shows how long it has run, as in `● CI re-run: Tests 1m12s`, timed from its attempt's start, which pr-watch asks GitHub for once per attempt, again a minute later if that fails, and no more once GitHub refuses; it still draws no bar, since re-running the failed jobs takes less than the whole workflow. Workflow-length lookups now give up after 10 seconds, so a slow one no longer holds up a pull request's next read.

## 0.4.1 (2026-10-13)

### Fixed

Each read of a pull request costs one point of GitHub's GraphQL quota instead of two: an open pull request is read for its head commit's runs and a merged one for its merge commit's, where every read asked for both. The 5,000 points an hour are shared with every `gh` call you and Claude make, so pr-watch now reads the quota left from each answer, and while fewer than a tenth remain it reads every watch on that host once a minute, after a push or merge too, until the quota recovers.

pr-watch pauses when GitHub rate-limits it, and stops polls that would never end. A rate-limited read pauses every watch on that host, whose lines say `rate limited until HH:MM` and are read again as the pause ends. When the last read left no quota, the pause waits for its reset; any other limit waits a minute, doubling each time it is hit again, up to 15 minutes. Other read failures are retried after 10 seconds, doubling up to 5 minutes. After 8 failed reads in a row, about 15 minutes, pr-watch stops watching, toasts why, and tells Claude, so nothing claims to be watching what it cannot read. A line that has shown the same state for half an hour while it waits on a person, such as a pull request waiting on review, conflicts or failed checks, or a failed merge, is read every 5 minutes instead of every minute. Comments and re-runs on it can therefore take up to 5 minutes to reach you.

What is running now shows in blue instead of yellow: the running workflow's name, its progress bar, and the ● beside any other workflow still running. Green still means passed or ready, red failed, and yellow is kept for a pull request that is blocked, such as one with conflicts or requested changes.

pr-watch no longer tells Claude a pull request is ready to merge after it has merged. A message pr-watch submits runs only once Claude's turn ends, so "#46 ready to merge" read mid-turn arrived after Claude had merged #46 in that same turn. News about a pull request's checks, reviews and comments that arrives during a turn is now held until the turn ends, each line once, and survives a reload of the plugin meanwhile. A pull request it calls ready is read from GitHub again first: if it merged or closed meanwhile, or a later read found it no longer ready, the "ready" line is dropped and the rest is sent; a read that fails counts as still open. Those reads run side by side, so several ready pull requests do not wait on each other. A message that says a pull request is ready to merge now says so first, ahead of failures and comments. pr-watch also no longer wakes Claude with "merged, and the merge commit's checks passed" for a merge Claude made itself: Claude already knows it merged, and a failure on the merge commit still wakes it. A merge GitHub makes later on `--auto` still wakes it either way. The toast and the status line still show both.

## 0.4.0 (2026-10-08)

### Added

A pull request Claude merges with `gh pr merge <number, URL or branch>` now gets a line even when pr-watch was not watching it, such as a version PR a workflow opened: the line follows the merge commit's runs on the base branch, and Claude is told when they pass or fail, as for a pull request it opened. With `--auto`, the line follows the open pull request until it merges. A bare `gh pr merge` of the current branch is not followed, since after `--delete-branch` or on a fork's branch nothing names its pull request; neither is a merge run after a `cd` in the same command or with a `GH_HOST=` prefix, nor a pull request merged more than two minutes before the command started, so a command that only mentions an old merge adds nothing.

Claude can now watch a pull request it did not open, such as a teammate's or one you point it at, with pr-watch's `watch` tool, instead of polling `gh pr checks` or sleeping. The tool answers with what the pull request shows now, and pr-watch then tells Claude when that changes, as for one it opened. `unwatch` stops watching a pull request or a pushed branch, and `watches` lists what pr-watch is watching and what each line shows.

## 0.3.0 (2026-10-08)

### Added

pr-watch now tells Claude what its line shows, so you no longer have to prompt it to check on a pull request. It submits a message to the session, which runs once Claude is idle, when GitHub reports a watched pull request ready to merge; when a run fails, in any workflow, as soon as its first job does, once per run and attempt; when the pull request has merge conflicts or a reviewer requests changes; when a merge's or a push's checks pass; and when someone other than you comments on or reviews it. Each is told once while it lasts, and the message says it is news, not a request to merge.

Two new settings in `/config` choose how much Claude hears. Wake Claude is `off`, `checks` or `checks and comments` (the default). Bots wake Claude is `never` (the default), `reviews`, which lets a review bot such as CodeRabbit or Copilot through but not plan or coverage comments, or `comments and reviews`. Changing either reports no history of comments, and whatever still lasts when waking is turned back on is told once.

After ten reads in a row whose only news was comments and reviews, those stop waking Claude until other news comes, so a chatty bot cannot keep it busy.

### Fixed

A running workflow's estimated length is now the median of its last 10 successful runs, leaving out re-runs, instead of its single latest one. A short run off a release branch or a re-run of a few jobs no longer sets the bar: one pull request showed `~2m13s` while its CI took about four minutes. The estimate is also learned again once each run of that workflow finishes, so it follows the workflow as it gets faster or slower instead of keeping the first length pr-watch saw. A known estimate stays when that lookup fails.

## 0.2.0 (2026-10-05)

### Added

A merged pull request whose checks passed now leaves the band on its own: every run on the merge commit has to be done and 90 seconds past the merge, and the line goes 5 seconds after the band's next read sees both. Before, the `✓ main checks passed` line stayed until your next message.

A merge whose checks failed now stays until they pass. The band reads it once a minute, every 10 seconds while a re-run is going, and clears it the same way once a re-run passes. Your next message no longer clears it; the `×` still does. When Claude runs `gh run rerun` or `gh workflow run`, the band reads every watched pull request at once, as it does after `git push` or `gh pr merge`, so the re-run shows within seconds rather than at the next minute's read.

A branch Claude pushes now gets a line in the band: `⟳ push feat/x · ● CI` with the same progress bar and marks, then `✓ checks passed` or the job that failed, with a toast. It follows the runs on the branch's newest commit and clears the way a merge does: a few seconds after its checks pass and 90 seconds have gone by since the push, or, when they fail, once a re-run passes. Pushing the branch again starts its line over. Before, a push to a branch with no pull request showed nothing.

A push to a branch that heads an open pull request shows that pull request's line instead, the upstream one when the branch is on a fork, adding it if the band was not already watching it. A branch is read from the push's output, `--porcelain` included, and counts when the push moved it, even if the same push had another branch rejected. A push that moved no branch (a delete, a tag, `Everything up-to-date`) adds no line, and `git push -q` prints nothing to read. A `--dry-run` prints what a push would, so it gets a line: a new branch leaves at its first read, and an existing one shows its current checks. A branch gone by the time it is read leaves at once, and one that cannot be read at all, such as on a host `gh` does not know, leaves after 90 seconds rather than staying as an error.

### Fixed

A merged pull request's line now names the branch it merged into, `#140 merged into main · ● CI`, while that branch's checks run, pass or fail. Before, it read `#140 merged · ● CI`, which looked like the pull request's own checks still running; only the passed and waiting lines named the branch, and they now read `✓ checks passed` and `○ waiting on checks` after the same lead.

## 0.1.0 (2026-10-04)

### Added

A merged pull request now stays in the band and follows its merge commit's runs on the base branch, such as a Release workflow on main: `#128 merged · ● Release` with the same progress bar and marks, then `✓ main checks passed` or the job that failed, with a toast. It keeps reading for 90 seconds after the merge in case a later run starts, and the settled line then stays until your next message. Before, a pull request left the band the moment it merged, so what the merge started on the base branch went unseen. A merge whose commit starts no runs within 90 seconds still leaves, as does a pull request closed without merging. The same `gh api graphql` read carries the merge commit's runs; the only extra call is the one that learns a base-branch workflow's usual length, once.

A new plugin: a line above the prompt for each pull request Claude opens with `gh pr create`. While the workflows the merge waits on run, the line shows a progress bar for the longest of them, measured against that workflow's last successful run, with the other workflows as marks. Once they finish, it reads ready to merge, names the job that failed with a link to its log, or says what blocks it: conflicts, changes requested, or a branch behind its base. A toast says when a pull request turns ready or a job fails in a workflow the merge waits on. Hover a line and press × to stop watching it; a pull request that merges or closes leaves on its own. Needs `gh` logged in; built and tested against Claude Code 2.1.289.

### Fixed

The band now reacts to Claude's own `git push` and `gh pr merge` within a second or two, rather than at its next slow poll. A pull request that had settled (failing, ready, or waiting on a review) was read only once a minute, so a fix Claude pushed could take up to a minute to show its new runs. After a push or a merge, every watched pull request is read at once and then every 5 seconds for a minute while GitHub starts the new runs. A push from your own terminal still shows at the next poll.

Generated by oakum 0.5.0.
