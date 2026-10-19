---
name: ship
description: Publish the current branch as a pull request, or update its open pull request. Reviews and commits leftover work, runs the project's checks, pushes, closes the branch's finished tracker items, and writes the title and body from one template. Use when the user says "ship it", "let's ship", "ship", or "push it".
---

# Ship

Take the current branch to a pull request in one pass. The user's request is the consent: "ship it" publishes, "push it" updates an open pull request. Nothing here merges, arms auto-merge, or marks a draft ready unless the user asked for that in so many words.

Run every command that writes, pushes, or closes as its own Bash call. A commit gate such as review-cycle's refuses a push or commit joined to other commands, and a refusal is never retried in another shape: report it and stop. When the gate refuses a push the user asked for in other words, ask them to say "ship it" or "push it".

## 1. Orient

```bash
git status --porcelain
git branch --show-current
gh api user --jq .login
gh repo view --json owner,viewerPermission,defaultBranchRef,isFork
gh pr view --json number,url,state,isDraft,title,body
gh stack view --json
```

- **Default branch:** `defaultBranchRef.name`. It may be `main`, `master`, or anything else; use what it says.
- **Not this skill's branch:** stop when the current branch is the default branch, or a release or dependency branch (`*/version-packages`, `renovate/*`, `dependabot/*`), or the work is a `chore(release)` change. Those are opened by their tools.
- **Not the user's repository:** proceed when the owner is the user's own login or `viewerPermission` is `ADMIN` or `MAINTAIN`, and `isFork` is false, since a fork's pull request goes to someone else's project. Otherwise stop before pushing, and tell the user the project's contribution and AI policy decide what a pull request may contain, and that this skill writes for their own repositories.
- **Path:** pick it from the request and the pull request's state.
  - `gh pr view` exits 1 with `no pull requests found`: the **publish** path on "ship it". On "push it" there is nothing to update, so ask whether to publish.
  - An open pull request: the **update** path, whichever phrase the user used.
  - A merged or closed one: stop and ask.
  - Any other failure of `gh pr view`: stop and show it.
- **Stack:** when `gh stack view --json` exits 0 and one of its `branches` has `isCurrent: true`, the branch is a layer of a github/gh-stack stack: follow **Stack path**, below, on publish and update alike. Three answers mean an ordinary branch: an exit 2 that prints `is not part of a stack`, a listing with no current layer (the branch is a stack's trunk), and gh refusing `stack` because gh-stack is not installed. Any other failure, such as `failed to load stack state`, may be a stack it cannot read: stop and show it.

## 2. Commit leftover work

When `git status --porcelain` shows changes, review them before committing: invoke `/review-cycle:review` via the Skill tool when that plugin is installed, otherwise show the user the diff and wait for their OK. Commit each logical group in the repository's message style. Never bypass hooks.

## 3. Check

Bring the branch current with the default branch when it is behind, by merging, since rebasing a pushed branch would force a force-push:

```bash
git fetch origin <default>
git rev-list --count HEAD..origin/<default>
git merge origin/<default>
```

Run only the merge when the count is above zero. On a conflict, stop with the merge in progress and offer `/pr-kit:fix-merge-conflicts`, or `git merge --abort` to back out.

On the stack path, run the fetch and the count against the trunk, skip the merge, and check as **Stack path** says.

Then run the project's full checks: the commands its `AGENTS.md` or `CLAUDE.md` names for "done", else its pre-commit and CI configuration, else `package.json` scripts. Typically: the test suite, typecheck, lint, format check, and any validator or bump-file check the repository uses. Run each check unpiped and read its exit code: piped into `tail` or `head`, `$?` is that command's status, not the check's. For a long log, send it to a file (`<check> >| <log> 2>&1; echo $?`, where `>|` overwrites under `noclobber`) and read the file's end. On any failure, stop and show its output; shipping waits for a fix. Keep each command and the line it printed (counts, exit status): the body's Verification section is written from these, not from memory.

## 4. Push

```bash
git push -u origin <branch>
```

On the stack path, push as **Stack path** says instead.

A refused push ends the ship here, before any item is closed.

## 5. Close finished tracker items

List the work items the branch's commits name:

```bash
git log --format=%B origin/<default>..HEAD | grep -E '^(Closes|Fixes|Refs)\b' | sort -u
```

An item the branch finishes goes in the body's `Closes` lines: every `Closes` or `Fixes` item, and a `Refs` item only when this branch completes it, such as the bead the work was started for. Every other `Refs` item stays a `Refs` line, open. Beads ids (`abc-x1y2`), GitHub issues (`#42`), and other trackers' keys (`ENG-123`) all follow the same rule.

Close only beads here, and on the update path only items the publish did not close:

```bash
bd close <id> --reason "<one line: what shipped>"
```

Then push the task graph when a remote exists. When `bd dolt remote list` lists nothing, skip the push and say so in the report, since `bd dolt push` with no remote exits 0 having pushed nothing:

```bash
bd dolt remote list
bd dolt push
```

GitHub issues close themselves when the pull request merges. Other trackers close through their own integration; leave them to it.

On the stack path, list and close the items per layer, as **Stack path** says.

## 6. Write the pull request

Read `${CLAUDE_PLUGIN_ROOT}/reference/pr-body.md` and write the title and body by it. Then look up the repository's own template and recent titles, from the repository root. The listing is the result: `find` exits 1 when `.github` or `docs` is missing.

```bash
find .github . docs -maxdepth 1 -iname 'pull_request_template*' 2>/dev/null || true
gh pr list --state merged --limit 20 --json title
```

- **Repository template first:** read every file or directory the `find` lists; it sets the headings. Fill its headings by the reference's rules and remove its comment prompts. From a directory of templates, use the one named for the change (`bug.md`, `feature.md`), and ask when none clearly fits.
- **Title convention:** match the form of the merged titles.
- **Title check:** when the repository lints commit messages (a `commitlint` config), run its linter on the title before using it; the title becomes the squash commit's subject.
- **Known issues:** when the `mcp__review-cycle__ledger` tool exists, read it for the branch's changed files (`git diff --name-only origin/<default>...HEAD`) and list the entries dated on or after the branch's first commit. Add what this conversation deferred that the ledger lacks. On the stack path, read it per layer, over that layer's range.
- **Attribution:** none, unless the repository's template or contribution guide asks for disclosure, or the user does. Then disclose in the slot the repository names.

Write the body to a file in the scratchpad and pass it with `--body-file`.

**Publish path:**

```bash
gh pr create --base <default> --head <branch> --title "<title>" --body-file <file>
```

Add `--draft` only when the user asked for a draft. When the user asked for auto-merge, arm it after creating, with the repository's merge method.

**Update path:** rewrite the body for the whole branch, not an appended note: the new changes join Changes, Verification comes from this run's checks, and Known issues is current. Change the title only when the branch's scope outgrew it.

```bash
gh pr edit <number> --body-file <file>
```

On the stack path, write each layer's pull request as **Stack path** says instead.

## 7. Report

The pull request URL, the items closed, and anything the checks or review left for the user. Merging is theirs to ask for.

## Stack path

For a layer of a github/gh-stack stack, these replace the merge in step 3, the push in step 4, and the pull request commands in step 6, and scope steps 5 and 6 to each layer. Every other step runs as written. Read two things from step 1's `gh stack view --json`:

- `trunk`, the branch the bottom layer merges into. It stands for `<default>` in every step, and may be another branch than the repository's default.
- `branches`, listed from the bottom up. Each has a `name` and a `needsRebase`, and a `pr` with its `number` once it has a pull request. The view does not say whether a pull request is a draft.

Each layer's own work is its range: `<layer below>..<layer>`, with `origin/<trunk>` below the bottom layer.

**Check.** Merge nothing into a layer, since a merge commit in one layer lands in every layer above it. After step 2's commits, read `gh stack view --json` again. A layer with `needsRebase: true` lacks commits of the layer below it (only the layer directly above a new commit is flagged), so stop, tell the user, and offer `gh stack rebase --no-trunk`, which rebases each layer onto the one below without moving the stack onto the trunk; the push after it forces every layer with a lease. Once it completes, ship again from step 3; when it stops on a conflict, show it and offer `gh stack rebase --continue` after the user resolves it, or `gh stack rebase --abort`. When the bottom layer is behind the trunk, say so in the report and offer `gh stack sync`, which rebases the stack onto the trunk and pushes it. Run step 3's checks on the top layer, which holds every layer's changes: when the current branch is another layer, check out the top with `gh stack top` and run them there, then return with `git checkout <branch>` whether they pass or fail, before stopping or going on.

**Push.** A layer above the current one with no `pr` gets a new pull request from this push. When there is one, name those layers and ask before pushing ("This also opens pull requests for `three` and `four`. Ship those too?"), since they may still be in progress; pushing layers that already have a pull request needs no question. On a no, stop before pushing: `gh stack submit --auto` opens a pull request for every layer without one, so tell the user they can run `gh stack submit` in their own terminal and deselect those layers in its editor. Then read each listed pull request's draft state, push every layer, and open a pull request for each that has none:

```bash
gh pr view <number> --json isDraft
gh stack submit --auto --open
```

- **Drafts:** `--open` opens new layers ready for review and also marks every existing draft ready. Leave it off when any layer's pull request is a draft, or when the user asked for drafts. Without it, new layers open as drafts; say so in the report.
- **No editor:** `gh stack submit --auto` keeps `submit` from opening its editor when a terminal is attached.
- **Its output:** `submit` prints `Created PR #<n> (<url>) for <branch>` for each pull request it opens, and exits 0 even after printing `⚠ failed to create PR for <branch>`. A failure line, or any non-zero exit, ends the ship there. Say which layers it pushed, since those stay pushed.
- **A gate refusal:** `submit` forces every layer it pushes with a lease. When the commit gate refuses it, pass the gate's question to the user as written rather than asking them to say "ship it".

**Tracker items and pull requests.** Open none: `submit` did. The layers to write are each one a `Created PR #<n>` line names, and on the update path the current layer too. For each, over that layer's range alone:

- Run step 5's listing and closing (`git log --format=%B <range>`), so each layer's pull request closes only what that layer finishes.
- Read Known issues from the ledger for that range's changed files (`git diff --name-only <layer below>...<layer>`).
- Write its title and body by the reference. Verification names the top layer as where the checks ran.

```bash
gh pr edit <number> --title "<title>" --body-file <file>
```
