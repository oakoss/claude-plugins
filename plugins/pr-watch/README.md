# pr-watch

A line above the Claude Code prompt for each pull request Claude opens, merges by number, URL or branch, or is asked to watch, until the pull request closes, or until its merge has run its checks on the base branch. A branch Claude pushes gets a line too, until its checks pass.

```text
#128 ● CI ████████████▏░░░░░░░░░░░ 1m11s / ~2m20s · CodeQL ✓ · Dependency Review ●
#128 ✓ ready to merge
#128 ✗ CI: Typecheck failed
#128 ⚠ conflicts
#128 merged into main · ● Release ████▏░░░░░░░░░░░░░░ 0m21s / ~1m40s · CI ●
#128 merged into main · ✓ checks passed
⟳ push feat/x · ● CI ███████▏░░░░░░░░░░░░░░░░░ 0m40s / ~2m20s
```

## What it shows

- **Running.** Of the running workflows that hold a required check (any running one when nothing on the commit is required), the longest gets a progress bar. Its length is the median of that workflow's last 10 successful runs, re-runs left out, learned again each time a run of it finishes, so the bar stops short of full until the run ends; a workflow with no successful run shows only the time so far. Once some of that workflow's jobs have finished, the line names those left, `● CI: Windows`, marking each that has not started `queued`, or counts them past two, `● CI: 3 jobs`, with `queued` when none of them has started; a workflow none of whose jobs has started reads `● CI queued`. A re-run reads `● CI re-run` and the time since its attempt started, with no bar, since re-running the failed jobs takes less than the whole workflow. The other workflows follow as marks: `✓` passed, `✗` failed, `●` running.
- **Ready to merge.** GitHub reports the pull request mergeable: required checks pass, no review blocks it, and it has no conflicts.
- **Failing.** A job failed in a workflow that holds a required check, or in any workflow when nothing on the commit is required. The line names that job rather than a summary job that failed on it, and links to its log.
- **Blocked.** Conflicts, changes requested, a branch behind its base, or a rule GitHub does not name (`⚠ blocked`).
- **Waiting.** On a review, on a required check from a GitHub App, on GitHub to start the checks, or on GitHub to work out the merge state.
- **Draft.** A draft's line starts `#128 draft ·` and otherwise follows its checks: the bar while they run, the job that failed, `○ waiting on checks` while a required GitHub App check runs, or `✓ checks passed` once they pass, since a draft is not ready to merge. Conflicts, requested changes or a branch behind its base follow as `· ⚠ conflicts`. A draft with no checks reads `#128 ○ draft`.
- **Merged.** The line names the base branch, `#128 merged into main`; for a layer of a [github/gh-stack](https://github.com/github/gh-stack) stack, which GitHub keeps based on the layer below, it names the stack's trunk, asked of GitHub's stacks API until it answers, at most once a minute, then kept. A host without that API keeps the base. It follows the merge commit's runs there, every workflow counting, with the same bar and marks. Once they finish it reads `✓ checks passed` or names the job that failed. It keeps reading for 90 seconds after the merge in case a later run starts. A passed merge then leaves the band a few seconds later. A failed one stays, read once a minute, until a re-run passes, and then leaves the same way; the `×` removes it sooner. A merge whose commit starts no runs within 90 seconds leaves the band.
- **Pushed.** A branch Claude pushes with `git push` gets a line, `⟳ push <branch>`, that follows the runs on the branch's newest commit the way a merged line does: it reads `✓ checks passed` or names the job that failed, and leaves the same way. A branch that is the head of an open pull request hands its line to that pull request instead, upstream when the branch is on a fork; a pull request in the same repository watched after the push, such as one Claude opens with `gh pr create`, takes over the push's line in place the first time it is read, and a fork's push is handed over upstream by its own next read. A push that moved no branch, such as a delete, a tag or `Everything up-to-date`, adds none, and neither does a `git push -q`, which prints nothing to read. A `--dry-run` prints what a push would, so it gets a line: a new branch leaves at its first read, and an existing one shows its current checks. A branch gone by the time it is read leaves at once, and one that cannot be read at all, such as on a host `gh` does not know, leaves once 90 seconds have passed.

When a workflow has run more than once on the same commit, only its newest run counts.

Once nothing the merge waits on is running, a workflow it does not wait on still shows as a mark while it runs or after it fails.

A toast says when a pull request turns ready to merge, a job fails in a workflow the merge waits on, or a merge's runs on the base branch pass or fail, once per change. A line says why when `gh` fails, and `· more checks not shown` when a commit has more check suites than one read returns (100). Hover a line and press `×` to stop watching it. A pull request closed without merging leaves the band.

pr-watch draws above whatever other plugins draw in the same band, rather than replacing it.

## Telling Claude

pr-watch also tells Claude, so you do not have to prompt it. For news Claude can act on alone, it submits a message to the session, which runs once Claude is idle, when:

- a run fails, in any workflow, as soon as its first job does, naming the jobs failed by then with links to the first job's log and to the run;
- a pull request has merge conflicts or a reviewer requests changes, whatever its checks say;
- someone other than you comments on or reviews it.

News Claude has nothing to do about waits for your next message instead, which carries it to Claude unseen:

- GitHub reports a pull request ready to merge. Merging needs your ask, so this waits, unless [review-cycle](../review-cycle)'s stop-before setting is `release` or `never stop`, which lets Claude merge unasked; then it wakes Claude like the news above. pr-watch reads that setting where review-cycle does: `.claude/settings.local.json`, else the value review-cycle shows in `/config`, made earlier by `.claude/settings.json`. Without review-cycle loaded, or with its commit gate off, a ready pull request waits; so it does in a headless `claude -p` session, where `/config` lists no plugin's settings.
- A merge's or a push's checks pass, once its 90 seconds are up, unless Claude made the merge itself (a failure on the merge commit is still told, at once).

A pull request ready to merge also puts `merge #<number>` in the empty prompt box as a suggestion, Tab to take, unless `promptSuggestionEnabled` is `false` in your settings. A ready pull request and a failed run also send a notification through your notification channel, beside the toast, for when you are away from the terminal.

Each is told once while it lasts: a later job failing in a run already told, such as a summary job, is not told again, while a new run or a re-run that fails, or a pull request ready again after new checks, is. A watch's first read hears the comments and reviews already there without telling them. Each message says it is news, not a request to merge, and one that says a pull request is ready to merge says so first. If it cannot be submitted, a toast says so; a hook that refuses it shows its own reason. News from these reads that arrives while Claude is working is held until the turn ends, each line once. A pull request it calls ready is then read again, and is not called ready if it has merged or closed meanwhile, or a later read found it no longer ready; a read that fails counts as still open. Your next message reads a waiting ready pull request again the same way, for up to 3 seconds, so it is not called ready once it has merged or closed, is no longer watched, or a later read found it no longer ready. Only a message you send carries the news: a slash command, a background task's notification or another plugin's prompt leaves it waiting, as does a message a hook drops. A ready pull request that cannot be kept for your message wakes Claude instead; a toast says so, as it does for passed checks it could not keep.

After ten reads in a row whose only news was comments and reviews, those stop waking Claude until other news comes, so a chatty bot or thread cannot keep it busy. The tenth message says so.

### Settings

In `/config`:

| Setting          | Values                                     | Default               |
| ---------------- | ------------------------------------------ | --------------------- |
| Wake Claude      | `off`, `checks`, `checks and comments`     | `checks and comments` |
| Bots wake Claude | `never`, `reviews`, `comments and reviews` | `never`               |

`checks` tells everything above except comments and reviews. `off` tells Claude nothing, at once or with your next message, and leaves the line, its toasts and notifications as they are. The bot setting applies when Wake Claude includes comments: `reviews` lets a review bot's reviews through, such as CodeRabbit or Copilot, but not bot comments such as plans, coverage reports or previews. Changing a setting reports no history: comments heard while they were not told stay quiet, and whatever still lasts when waking is turned back on is told once.

## Tools for Claude

pr-watch gives Claude three tools, so it can follow a pull request it did not open, such as a teammate's, instead of polling `gh pr checks` or sleeping:

- **`watch`** takes a pull request's number, URL or head branch, with a repository when it is not the current directory's. It reads the pull request at once and answers with what its line shows, along with any news that first read found; pr-watch then tells Claude when that changes.
- **`unwatch`** stops watching a pull request, by number, URL or head branch, or a pushed branch. A number two watched repositories share is refused until the repository is named.
- **`watches`** lists what pr-watch is watching and what each line shows.

## How it works

- It watches the pull request in the output of a `gh pr create` that Claude runs through its Bash tool, and the branches in the output of a `git push` it runs there. Pull requests opened and branches pushed from your own terminal or a GitHub tool are not seen.
- A `gh pr merge` Claude runs that names its pull request (a number, URL or branch) watches it too, if nothing did, and follows its merge onto the base branch; with `--auto`, the line follows the open pull request until it merges. A bare `gh pr merge` is not followed: after `--delete-branch`, or on a fork's branch, nothing names its pull request. Neither is a merge run after a `cd` in the same command or with a `GH_HOST=` prefix, nor a pull request merged more than two minutes before the command started (the leeway is for GitHub's clock), so a command that only mentions an old merge adds nothing.
- It reads each pull request, with its latest 10 comments and 10 reviews, in one `gh api graphql` call: every 10 seconds while any workflow runs or GitHub is still settling, every 60 seconds while it waits on a person, and every 5 minutes once the line has said the same for half an hour, so a pull request left waiting on review, conflicts or failed checks, or a merge left failing, can wait up to 5 minutes for news of a comment or re-run. When Claude runs `git push`, `gh pr merge`, `gh run rerun` or `gh workflow run`, it reads every watched pull request at once and every 5 seconds for the next minute, while GitHub starts the new runs. Each workflow's length comes from one `gh api` call the first time pr-watch sees it, asked again a minute later if that call fails, and once each time a run of it finishes. A re-run's start comes from one `gh api` call per attempt of the workflow the line draws, asked again a minute later if that call fails, until GitHub refuses it.
- Each read costs one point of GitHub's GraphQL quota, 5,000 an hour, which your own and Claude's `gh` calls share: an open pull request is read for its head commit's runs, a merged one for its merge commit's, and the read that first finds it merged reads again for those. While fewer than a tenth of the points are left, every watch on that host is read once a minute, after a push or merge too.
- When GitHub refuses a read for a rate limit, every watch on that host pauses and its line says `rate limited until HH:MM`: until the quota resets when the last read left none, otherwise a minute, doubling each time the limit is hit again up to 15 minutes. Each line on the host is read again as the pause ends, and a push not yet read stays through it. When `gh` cannot reach GitHub at all, as on a dropped connection, a laptop offline, or a 502 to 504 from GitHub's gateway, the line keeps what it last showed, adds a dim `· offline, retrying` from the second such read, and is never given up on: one read at a time tries the host, 15 seconds after the last, doubling up to a minute, and the note leaves every line on it as soon as GitHub answers anything, a refusal included. After 15 minutes out of reach, a toast names the host and `gh`'s reason once, in case the host or a proxy is wrong. A push no read has answered yet waits 15 minutes from the later of the outage and the push, then leaves; if GitHub answers first, it is read. A read that fails for any other reason is retried after 10 seconds, doubling up to 5 minutes, and shows why in red; after 8 in a row, some 15 minutes, pr-watch stops watching that pull request or push, says why in a toast, and tells Claude, as /config allows. Neither a rate limit nor an unreachable GitHub counts toward the 8. A push that no read has answered yet leaves 90 seconds after it, rate limits and an unreachable GitHub aside, as one on a host `gh` cannot read would.
- It needs [`gh`](https://cli.github.com), logged in to the pull request's host. GitHub Enterprise hosts are passed to `gh` as `--hostname`.
- Watched pull requests last for the session, and come back when it is resumed, with `claude --resume` or `/resume`: pr-watch saves them, keyed by session id, in its own store each time the list changes, and a resumed session keeps its id. Each is read again at once and tells what changed while the session was away, once, as above; news already told before the exit is not told again, but a ready pull request or passed checks kept for a message the exit cut short are. A new session, a fork or a `/clear` gets a new id and starts with none. Pushed branches are not brought back. The store keeps the latest 20 sessions.

## Install

```bash
claude plugin marketplace add oakoss/claude-plugins
claude plugin install pr-watch@oakoss
```

pr-watch is a mod: Claude Code runs its hooks module itself.
