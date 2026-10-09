# Changelog

All notable changes to the `pr-watch` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.4.1 (2026-10-09)

### Fixed

Each read of a pull request costs one point of GitHub's GraphQL quota instead of two: an open pull request is read for its head commit's runs and a merged one for its merge commit's, where every read asked for both. The 5,000 points an hour are shared with every `gh` call you and Claude make, so pr-watch now reads the quota left from each answer, and while fewer than a tenth remain it reads every watch on that host once a minute, after a push or merge too, until the quota recovers.

pr-watch pauses when GitHub rate-limits it, and stops polls that would never end. A rate-limited read pauses every watch on that host, whose lines say `rate limited until HH:MM` and are read again as the pause ends. When the last read left no quota, the pause waits for its reset; any other limit waits a minute, doubling each time it is hit again, up to 15 minutes. Other read failures are retried after 10 seconds, doubling up to 5 minutes. After 8 failed reads in a row, about 15 minutes, pr-watch stops watching, toasts why, and tells Claude, so nothing claims to be watching what it cannot read. A line that has shown the same state for half an hour while it waits on a person, such as a pull request waiting on review, conflicts or failed checks, or a failed merge, is read every 5 minutes instead of every minute. Comments and re-runs on it can therefore take up to 5 minutes to reach you.

What is running now shows in blue instead of yellow: the running workflow's name, its progress bar, and the ● beside any other workflow still running. Green still means passed or ready, red failed, and yellow is kept for a pull request that is blocked, such as one with conflicts or requested changes.

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

Generated by oakum 0.4.0.
