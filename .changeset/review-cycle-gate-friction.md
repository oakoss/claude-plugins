---
review-cycle: patch
---

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
