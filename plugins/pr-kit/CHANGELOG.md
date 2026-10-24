# Changelog

All notable changes to the `pr-kit` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.3.1 (2026-10-24)

### Fixed

When review-cycle's gate refuses a merge, the merge skill asks its question naming each pull request by number alone ("Merge #41 and #42?"), so your yes covers every one of them.

After a merge, `merge` asks pr-watch to watch the repository's open release pull request (headed `*/version-packages` or `changeset-release/*`), when pr-watch is installed, so the version pull request's rebuild and checks show above the prompt without polling. It never offers or runs that merge: merging it is the release, and stays your ask.

`ship` no longer stops to ask when the branch's name was used before for a pull request that has since merged or closed and the branch holds only new work: that pull request's head commit is not in the branch's history, and every commit the branch adds was authored after it closed. `ship` then renames the local branch to one no pull request has used, says so in its report, and goes on as for a branch with no pull request. A branch that continues the earlier work, a rebased one included, or a gh-stack layer still stops and asks.

## 0.3.0 (2026-10-23)

### Added

New `/pr-kit:do-epic` skill: type "do epic <id>" (or `/pr-kit:do-epic <id>`, adding "as drafts" for draft pull requests) and the agent runs that beads epic to open pull requests without asking anything until its report. It plans the epic's beads into branches and records the plan in the epic's notes, then implements, reviews and commits each branch in turn. Independent branches ship as their own pull requests, and dependent ones as a gh-stack stack. It drives CI to green with `fix-ci`, then reports each pull request with its beads, CI state and review rounds, plus shelved beads, deferred findings, questions and refusals. A bead it cannot finish is stashed and left open, and the skill never merges. It needs review-cycle and `bd`.

Adds `/pr-kit:merge`, which merges the pull request you asked to merge with the repository's merge method, asking which when it allows several, and reports the merge commit and what is left. It stops on a closed, draft, blocked, behind or conflicted pull request, and asks before merging past a failing check that is not required. On a github/gh-stack layer it merges with `gh stack merge`, which merges every unmerged layer below too, so it names them all and asks when your message did not, and checks each is ready; "merge the stack" merges every open layer from any of them. It checks that the number names no stack, since `gh stack merge` reads a stack's number first, and offers `gh stack sync` for the layers left open. `/pr-kit:ship` now reads a stack sync's output, since a diverged stack prints `Sync aborted` and still exits 0.

`/pr-kit:ship` ships a github/gh-stack stack. When the branch is a layer, it pushes every layer and opens each missing pull request with `gh stack submit --auto --open`, then rewrites each new pull request's title and body from that layer's own commits. It checks each layer's pull request first and leaves `--open` off when one is a draft or you asked for drafts, since `--open` would mark existing drafts ready; new layers then open as drafts, and the report says so. Shipping from a lower layer asks first when it would open pull requests for layers above it that have none, since those may still be in progress; updating layers that already have one needs no question. It merges nothing into a layer, stops to offer `gh stack rebase --no-trunk` when a layer is missing commits from the one below, runs the checks on the top layer and returns to your branch, closes each layer's tracker items and lists its known issues from that layer's own commits, and treats a `⚠ failed` line from `submit` as a failure even though it exits 0. A stack it cannot read stops the ship rather than being shipped as an ordinary branch.

### Fixed

The merge skill no longer waits on a check the repository does not require. GitHub reports a pull request as `UNSTABLE` both when such a check failed and while one is still running, and the skill used to treat both as a failure to ask about, so "merge 56" sat waiting for a CodeQL scan while pr-watch already showed the pull request ready. It now reads the checks and the required ones: a failed or cancelled check is still named and asked about, and when the others are only still running and every required check passed, it merges and names them in the report. With no required checks, or one still running, it asks. A repository that wants a check to hold merges makes it a required check.

`/pr-kit:fix-ci` no longer asks "Should I commit and push the fixes?" when review-cycle's gate already lets a push run (its status tool reports `mayPush`), as under a job started with "do epic <id>". Nobody is there to answer during a job, so the question stopped it. On a layer of a gh-stack stack it now pushes with `gh stack push`, rebasing the layers above first, since review-cycle's gate refuses a plain `git push` of a layer.

Merge now checks for open pull requests built on the one being merged when GitHub knows no stack for it. A plain squash merge can leave each such pull request conflicting with the default branch, needing a rebase and a force-push, so merge stops, names them, and gives the user the `gh stack link` command to run in their own terminal; asking to merge again once they are linked takes the stack path, and asking again without linking them merges the one alone, as before. Ship's `gh stack submit` and `gh stack sync`, merge's `gh stack merge` and `gh stack sync`, and fix-ci's `gh stack push` now say to run each as its own command with nothing before it, not even a `cd`, since review-cycle's commit gate can refuse a stack push or merge that runs beside other commands.

## 0.2.1 (2026-10-16)

### Fixed

`/pr-kit:ship` now pushes the branch before closing the beads it finishes. It used to close and sync them first, so a push the commit gate refused left items closed for work that had not shipped, and the report had to name them for you to reopen. Now a refused push stops the ship with nothing closed.

## 0.2.0 (2026-10-14)

### Added

New `/pr-kit:ship` skill takes the current branch to a pull request when you say "ship it", and updates the open one when you say "push it". It reviews and commits leftover work, merges in the default branch when behind, runs the project's full checks and stops on a failure, closes the beads the branch finishes and pushes the task graph, then pushes and writes the title and body. The body follows the repository's own pull request template when there is one, else the new `reference/pr-body.md`: a short lead, one line per change, the checks that ran and what they printed, and known issues. Drafts, auto-merge and agent attribution happen only when you ask, and it stops on a repository that is not yours.

## 0.1.4 (2026-10-01)

### Fixed

`/pr-kit:fix-ci` now asks "Should I commit and push the fixes?" before its first push. Its old question, "commit and push the fixes each round?", never counted as a push request with review-cycle, so a yes to it still left every round's push waiting on the Push dialog. The skill also describes review-cycle's gate as it now works: a commit needs only a review, and the push is what needs your request.

## 0.1.3 (2026-09-25)

### Fixed

`get-pr-comments` no longer drops review threads that are still open. It used to skip every thread GitHub marks outdated, but outdated means only that a later push changed the code the comment was left on, not that anyone resolved the thread. A thread that is outdated but unresolved now appears under **Possibly stale — verify**, located by its original line. Its thread query also pages now: it declares the `$endCursor` variable that `gh api --paginate` needs, so a PR with more than 100 threads is read in full, and a thread with more than 50 comments is read to the end with a follow-up query. (cpl-0ye)

`fix-merge-conflicts` checks the whole tree for leftover conflict markers. The old `git diff --cached --check` looked only at staged files, so it missed the file you forgot to stage, and it failed on trailing whitespace in a correctly resolved file. The skill now lists unmerged paths and runs `git grep` for marker lines over the whole repository, in both the working tree and the staged content, including diff3 base markers and a `conflict-marker-size` above 7. It names the conflicts that leave no markers (binary files, symlinks, and paths one side deleted or both sides renamed), which `git add` would otherwise resolve silently to whatever the working tree holds, and has you keep a side or drop the path explicitly and report it. It also says that a rebase swaps the sides. During `git rebase`, "ours" is the upstream and "theirs" is your own commit, so the skill has you check `git status` for `rebase in progress` before you pick a side. (cpl-r73)

pr-kit now has prose-anchor tests in `plugins/pr-kit/tests/` that pin these fixes and the contracts from the previous audit: the tree guard in `make-pr-easy-to-review`, the round cap in `fix-ci`, that no skill tells the model to invoke a skill with model invocation disabled, that every gh field a skill fills in is one it fetched, and that the README's `gh` requirement matches the skills that call `gh`. (cpl-k3s)

## 0.1.2 (2026-09-23)

### Fixed

`/pr-kit:fix-ci` no longer tells agents about review-cycle's sentinel or `/review-cycle:accept`, which review-cycle has removed. It now describes the new commit gate: a commit is admitted only if a reviewer saw exactly what it records and you asked for it, so the skill says not to edit between the review and the commit, and to ask you once, before the first commit, whether to commit and push the fixes.

## 0.1.1 (2026-09-17)

### Fixed

fix-ci no longer points at `/review-cycle:accept`, which is `disable-model-invocation: true` and exists for a human who reviewed the change themselves — instructing it both dead-ended the step and, if routed around, let the skill self-certify a fix it then pushed. The loop gains a hard cap of three rounds, or two on the same check: the previous same-check heuristic never fired when a fix for one check broke another, so an oscillation could write unbounded commits to a live PR. The merge-the-base guardrail now names its commands and uses the PR baseRefName instead of assuming main, and routes a conflict to /pr-kit:fix-merge-conflicts. The README no longer claims fix-ci stages and hands off; it commits and pushes each round by design, and now says so.

make-pr-easy-to-review now verifies a history rewrite before force-pushing. The tree captured before the rewrite is stored in a git ref rather than a shell variable, which does not survive between tool calls — so the byte-identical check had nothing to compare and the "do not push" rule never fired. The comparison no longer pits two command substitutions against each other either: that form passes when BOTH are empty, and command substitution discards git's exit code, so a git that is absent, shimmed, broken, or run outside a repository produced exit 0 with no output — byte-identical to a genuine pass. It now uses `--verify`, chains with `&&`, and prints `TREES MATCH <sha>`; the instruction is to push only on seeing that token, because a silent exit 0 is a failure rather than a pass. Measured: dead git exits 1, no git on PATH exits 127, outside a repository exits 128. Verification is now one command that works for same-repo and fork PRs alike, replacing a fallback with two failure modes on the fork PRs its surrounding section was written for: `fatal: ambiguous argument` when the head branch name is absent from the base repo, and — worse, because it is quiet — exit 0 with a phantom diff when the base repo happens to carry an unrelated branch of that name. The fork URL is built from headRepository.nameWithOwner rather than headRepositoryOwner, which is an object and produced a malformed URL. The push now states its lease explicitly, against the head recorded before the rewrite: the bare --force-with-lease reads a remote-tracking ref a freshly added fork remote does not have, and is rejected as `stale info` even when nothing is wrong. Measured — the explicit form succeeds with no tracking ref and still refuses when someone else pushed during the rewrite, leaving their commit intact. A `stale info` rejection now means stop and tell the user, never fetch and retry, which would refresh the lease to include their work and then overwrite it.

make-pr-easy-to-review no longer leaves three quieter ways for a history rewrite to reach a force-push unverified. The capture steps chain with `&&` and use `--verify`, so a failed fetch stops the run instead of recording the tree of a tracking ref nobody refreshed. The fork remote is named per PR and its URL confirmed before pushing: `git remote add` exits 3 when the name is taken, and the push then goes to whatever repository the leftover name refers to while the PR under work goes untouched. The exit 3 is measured; whether the lease also passes depends on that repository's branch happening to sit at the recorded sha, so the failure is a misdirected push rather than a guaranteed one. And the capture refs are cleared on abort as well as on success, with the invariant stated that they are written once per run from the fetched ref and never from HEAD, because re-capturing from HEAD after a blocked attempt certifies the rewrite against itself.

## [0.1.0] - 2026-05-28

Initial release. A pull-request workflow toolkit that complements `review-cycle` with PR-stage helpers. Every action that touches the remote or rewrites history stages and hands off, or asks first — nothing pushes or commits unreviewed.

### Added

- **`/pr-kit:get-pr-comments`** — fetches review and discussion comments on the active PR and returns a single prioritized action list grouped by severity and actionability. Read-only. Pairs with the fix-vs-defer policy: triage here, then address.
- **`/pr-kit:fix-merge-conflicts`** — resolves conflicts with minimal, correctness-first edits, regenerates lockfiles with package-manager tooling (never hand-edited), validates build/lint/tests, and **stages** the result. Never commits, pushes, or tags — it hands off to your review and commit gate.
- **`/pr-kit:make-pr-easy-to-review`** — improves reviewability without changing behavior: a TL;DR that matches the diff, separation of core vs generated files, and called-out risks. Commit-history rewrites and force-pushes are **gated behind explicit approval** and verified by tree identity; if the PR is too large to make reviewable with notes, it recommends splitting instead.
- **`/pr-kit:fix-ci`** — drives PR checks to green: watches the check set (`gh pr checks`), diagnoses the root failure, applies the smallest fix, then routes each fix through `/review-cycle:review` before committing and pushing. Retries flaky checks once with evidence, merges `main` for failures already fixed there rather than bloating the PR, and never bypasses hooks (`--no-verify`).

Generated by oakum 0.5.0.
