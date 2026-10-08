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

- **Running.** Of the running workflows that hold a required check (any running one when nothing on the commit is required), the longest gets a progress bar. Its length is the median of that workflow's last 10 successful runs, re-runs left out, learned again each time a run of it finishes, so the bar stops short of full until the run ends; a workflow with no successful run shows only the time so far, and a re-run shows `re-run`, since GitHub keeps its first attempt's start time. The other workflows follow as marks: `✓` passed, `✗` failed, `●` running.
- **Ready to merge.** GitHub reports the pull request mergeable: required checks pass, no review blocks it, and it has no conflicts.
- **Failing.** A job failed in a workflow that holds a required check, or in any workflow when nothing on the commit is required. The line names that job rather than a summary job that failed on it, and links to its log.
- **Blocked.** Conflicts, changes requested, a branch behind its base, or a rule GitHub does not name (`⚠ blocked`).
- **Waiting.** On a review, on a required check from a GitHub App, on GitHub to start the checks, on GitHub to work out the merge state, or on a draft to be marked ready.
- **Merged.** The line names the base branch, `#128 merged into main`, and follows the merge commit's runs there, every workflow counting, with the same bar and marks. Once they finish it reads `✓ checks passed` or names the job that failed. It keeps reading for 90 seconds after the merge in case a later run starts. A passed merge then leaves the band a few seconds later. A failed one stays, read once a minute, until a re-run passes, and then leaves the same way; the `×` removes it sooner. A merge whose commit starts no runs within 90 seconds leaves the band.
- **Pushed.** A branch Claude pushes with `git push` gets a line, `⟳ push <branch>`, that follows the runs on the branch's newest commit the way a merged line does: it reads `✓ checks passed` or names the job that failed, and leaves the same way. A branch that is the head of an open pull request hands its line to that pull request instead, upstream when the branch is on a fork. A push that moved no branch, such as a delete, a tag or `Everything up-to-date`, adds none, and neither does a `git push -q`, which prints nothing to read. A `--dry-run` prints what a push would, so it gets a line: a new branch leaves at its first read, and an existing one shows its current checks. A branch gone by the time it is read leaves at once, and one that cannot be read at all, such as on a host `gh` does not know, leaves once 90 seconds have passed.

When a workflow has run more than once on the same commit, only its newest run counts.

Once nothing the merge waits on is running, a workflow it does not wait on still shows as a mark while it runs or after it fails.

A toast says when a pull request turns ready to merge, a job fails in a workflow the merge waits on, or a merge's runs on the base branch pass or fail, once per change. A line says why when `gh` fails, and `· more checks not shown` when a commit has more check suites than one read returns (100). Hover a line and press `×` to stop watching it. A pull request closed without merging leaves the band.

pr-watch draws above whatever other plugins draw in the same band, rather than replacing it.

## Telling Claude

pr-watch also tells Claude, so you do not have to prompt it. It submits a message to the session, which runs once Claude is idle, when:

- GitHub reports a pull request ready to merge;
- a run fails, in any workflow, as soon as its first job does, naming the jobs failed by then with links to the first job's log and to the run;
- a pull request has merge conflicts or a reviewer requests changes, whatever its checks say;
- a merge's or a push's checks pass, once its 90 seconds are up;
- someone other than you comments on or reviews it.

Each is told once while it lasts: a later job failing in a run already told, such as a summary job, is not told again, while a new run or a re-run that fails, or a pull request ready again after new checks, is. A watch's first read hears the comments and reviews already there without telling them. The message says it is news, not a request to merge. If it cannot be submitted, a toast says so; a hook that refuses it shows its own reason.

After ten reads in a row whose only news was comments and reviews, those stop waking Claude until other news comes, so a chatty bot or thread cannot keep it busy. The tenth message says so.

### Settings

In `/config`:

| Setting | Values | Default |
| --- | --- | --- |
| Wake Claude | `off`, `checks`, `checks and comments` | `checks and comments` |
| Bots wake Claude | `never`, `reviews`, `comments and reviews` | `never` |

`checks` tells everything above except comments and reviews. `off` leaves the line and its toasts as they are. The bot setting applies when Wake Claude includes comments: `reviews` lets a review bot's reviews through, such as CodeRabbit or Copilot, but not bot comments such as plans, coverage reports or previews. Changing a setting reports no history: comments heard while they were not told stay quiet, and whatever still lasts when waking is turned back on is told once.

## Tools for Claude

pr-watch gives Claude three tools, so it can follow a pull request it did not open, such as a teammate's, instead of polling `gh pr checks` or sleeping:

- **`watch`** takes a pull request's number, URL or head branch, with a repository when it is not the current directory's. It reads the pull request at once and answers with what its line shows, along with any news that first read found; pr-watch then tells Claude when that changes.
- **`unwatch`** stops watching a pull request, by number, URL or head branch, or a pushed branch. A number two watched repositories share is refused until the repository is named.
- **`watches`** lists what pr-watch is watching and what each line shows.

## How it works

- It watches the pull request in the output of a `gh pr create` that Claude runs through its Bash tool, and the branches in the output of a `git push` it runs there. Pull requests opened and branches pushed from your own terminal or a GitHub tool are not seen.
- A `gh pr merge` Claude runs that names its pull request (a number, URL or branch) watches it too, if nothing did, and follows its merge onto the base branch; with `--auto`, the line follows the open pull request until it merges. A bare `gh pr merge` is not followed: after `--delete-branch`, or on a fork's branch, nothing names its pull request. Neither is a merge run after a `cd` in the same command or with a `GH_HOST=` prefix, nor a pull request merged more than two minutes before the command started (the leeway is for GitHub's clock), so a command that only mentions an old merge adds nothing.
- It reads each pull request, with its latest 10 comments and 10 reviews, in one `gh api graphql` call: every 10 seconds while any workflow runs or GitHub is still settling, every 60 seconds while it waits on a person. When Claude runs `git push`, `gh pr merge`, `gh run rerun` or `gh workflow run`, it reads every watched pull request at once and every 5 seconds for the next minute, while GitHub starts the new runs. Each workflow's length comes from one `gh api` call the first time pr-watch sees it, asked again a minute later if that call fails.
- It needs [`gh`](https://cli.github.com), logged in to the pull request's host. GitHub Enterprise hosts are passed to `gh` as `--hostname`.
- Watched pull requests last for the session; a new session starts with none.

## Install

```bash
claude plugin marketplace add oakoss/claude-plugins
claude plugin install pr-watch@oakoss
```

pr-watch is a mod: Claude Code runs its hooks module itself. It is built and tested against Claude Code 2.1.289.
