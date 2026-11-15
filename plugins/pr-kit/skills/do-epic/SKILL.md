---
name: do-epic
description: Run a beads or tm epic from one message to reviewable pull requests. Plans the epic's items into branches, implements and reviews each, ships them as separate pull requests or a github/gh-stack stack, gets CI green, and ends with one report. Use when the user says "do epic <id>" or "run the epic <id>", optionally "as drafts".
---

# Do epic

Take an epic from the user's one message to open pull requests, without asking anything until the report. The message is the consent: review-cycle's commit gate reads "do epic <id>" as a job on that epic, which lets commits, pushes and pull requests run until the user's next message holds or retracts. A merge, a release, a push to the default branch or of a tag, and a bare force push still stop at the gate, and this skill never attempts them: merging is the user's, after the report.

Nobody answers mid-run. Every question, refusal and judgment call the job meets goes into the report, and the job moves on to the next branch it can still build.

## 1. Confirm the job

Call the `mcp__review-cycle__status` tool. `stopBefore.mandate.epic` must name the epic the user asked for.

- **No mandate, or another epic:** the gate did not start this job, as when the message also held a step ("do epic cpl-x, but hold off on pushing"). Stop, and ask the user to type `do epic <id>` on its own, with `as drafts` when their message asked for drafts.
- **No status tool:** review-cycle is not loaded, so nothing reviews or gates the job. Stop and say so.

Read two choices from the user's message: the epic id, and whether pull requests open as drafts ("as drafts", "as a draft", "as draft PRs").

**The tracker** is the one the repository shows: tm when it has a `.config/tm.toml`, its items Issues keyed like `CPL-12`; beads when it has a `.beads/` directory. Each step below gives both trackers' commands; run only that tracker's. With neither, stop and say so.

## 2. Plan

beads:

```bash
bd show <epic> --json
bd list --parent <epic> --status open,in_progress,blocked --limit 0 --json
bd dep list <ids…> --type blocks --json
```

tm, where `tm list` lists every open child with no cutoff, and an Issue's blockers are the `links` its `tm show` lists with `type` `blocks` and `direction` `inward`:

```bash
tm show <epic> --json
tm list parent:<epic> --json
tm show <id> --json
```

List each child that has children of its own the same way, so a branch parent's items are in the plan too.

**Scope.** Every open item under the epic whose blockers are closed or are themselves in scope. An item blocked by work outside the epic is left out and named in the report with its blocker, and so is a tm Issue in `triage`, which waits on evidence before it is built. A tm Issue in `in_review` has shipped: it is not built again, and an item it blocks is left out until its pull request merges, since a branch off the default branch would lack its commits.

**Branches.** A branch is one reviewable unit: what ships and reverts together. A child that is a branch parent (a `task` with children of its own) is one branch with all its children. Any other item is a branch by itself, unless it and another item change the same files and make sense only together; then file a branch parent for them and move them under it:

```bash
bd create "<what the branch delivers>" -t task --parent <epic> -l <the items' plugin: label>
bd update <child> --parent <new parent>
```

```bash
tm create --type task --title "<what the branch delivers>" --parent <epic> --label <the items' plugin: label>
tm edit <child> --parent <new parent>
```

**Order.** Branch B comes after branch A when any item in B depends on an item in A. A branch with no order to any other is a lane: its own branch off the default branch and its own pull request. Branches joined by order form a stack: one layer per branch, bottom first, in an order that respects every dependency (ties by priority, then id). A stack is strictly linear, so two branches that both depend on one become consecutive layers above it.

**Record the plan** on the epic before building, one line per branch: what it delivers, its lane or stack and layer, its items, the files it should change, the tests that prove it, and what it comes after. beads keeps it in the epic's notes, tm in a comment on the epic:

```bash
bd update <epic> --append-notes "<the plan>"
```

```bash
tm comment <epic> - <<'EOF'
<the plan>
EOF
```

Done when every item in scope is in exactly one branch, every branch is a lane or one layer of one stack, and the plan is recorded on the epic.

## 3. Build each branch

Build lanes one after another, then each stack bottom up, all in this checkout: there are no parallel worktrees. Before each branch, call the status tool again; when the mandate is gone, the user ended the job, so stop building and go to the report.

Start the branch:

```bash
git fetch origin <default>
git switch -c <type>/<short-description> origin/<default>
```

For a stack, start the bottom layer the same way, and each layer above from the layer below it (`git switch -c <branch> <layer below>`). The stack itself is made at Ship, from the layers that have commits.

Then, for each item in the branch:

1. **Claim it:** `bd update <id> --claim`, or `tm start <id>`.
2. **Implement it** to its description's "Done when", test first where the project has tests, following the project's `AGENTS.md` or `CLAUDE.md`.
3. **Review and commit:** invoke `/review-cycle:review` via the Skill tool. Under the job it never stops to ask: it commits a clean result, or ends with `Final state: shelved (<why>)`. The commit message ends with `Closes <id>`. Note the commit's entry in the status tool's `rounds` for the report, since the tool keeps only the last ten.

**Shelve** an item the review shelved, and one whose implementation cannot meet its "Done when" without a decision from the user. The tree is set aside, not lost:

```bash
git stash push --include-untracked -m "do-epic <id>: <why>"
```

Then give the item back with a note saying why:

```bash
bd unclaim <id>
bd update <id> --append-notes "Shelved by do-epic: <why>. Work in the stash named do-epic <id>."
```

```bash
tm release <id>
tm move <id> todo
tm comment <id> "Shelved by do-epic: <why>. Work in the stash named do-epic <id>."
```

Every item that depends on a shelved item is shelved too, with `blocked by shelved <id>` as its reason. A branch left with no commits is deleted once you have switched off it, to the layer below it or the default branch (`git switch <that branch>`, then `git branch -D <branch>`), and a stack continues from the layer below it.

**A refusal stops the branch.** When the gate refuses a command, the job does not reshape it: record the refusal's words, shelve the branch's unfinished items with that reason, and go on to the next branch.

Done when every branch has commits for each of its items, or each item it lacks is shelved with a reason.

## 4. Ship

Invoke `/pr-kit:ship` via the Skill tool, with `ship it`, plus `as drafts` when the user asked for drafts:

- **A lane:** once its branch is built.
- **A stack:** once every layer is built, adopt the layers that have commits, bottom first, then ship from the top layer. Ship's stack path pushes every layer with `gh stack submit` and opens a pull request for each.

```bash
gh stack init <bottom layer> <next layer> <top layer>
```

Ship runs the project's checks and updates the items each pull request finishes as its tracker says: beads closes them and pushes the task graph, tm moves them to review. When it stops on a failing check or a refusal, record why under `Not shipped`, with the branch and its items, which stay open, and go on to the next lane or stack.

## 5. Get CI green

For each pull request, bottom layer first in a stack, check out its branch, since fix-ci commits to whatever is checked out, then invoke `/pr-kit:fix-ci` via the Skill tool with its number:

```bash
gh pr view <number> --json headRefName
git switch <headRefName>
```

Under the job it pushes each reviewed fix without asking, on a stack layer through `gh stack`, and its round cap stands.

Done when every pull request's checks are green, or fix-ci handed it back and the report says why.

## 6. Report

End with the report, then stop. The job is still running; it ends at the user's next message that holds or retracts.

```text
Epic <id>: <N> pull requests, <M> items finished, <K> shelved

<Each lane:>
#<n> <title> — CI <green | failing: <check> | handed back: <why>>
  Closes: <ids>
  Review rounds: <per commit, as noted at each commit>

<Each stack, its layers bottom up, the order they merge in:>
Stack <number>:
  1. #<n> <title> — CI <…>
     Closes: <ids>
     Review rounds: <per commit>

Not shipped:
  - <branch> (<ids>) — <why ship stopped>

Shelved:
  - <id> — <why> (stash: do-epic <id>)

Left out of scope:
  - <id> — <blocked by <blocker outside the epic> | blocked by <id> (in review, not merged) | in triage>

Deferred findings and questions:
  - <from the `mcp__review-cycle__ledger` tool for each branch's changed files, dated today>

Refusals:
  - <command> — <the gate's words>

Next: <"merge the stack" | "merge #<n>"> when you are ready; the stashes wait for you.
```

## Do NOT

- Do NOT merge, arm auto-merge, mark a draft ready, release, push to the default branch, or force push without a lease. Each is the user's, after the report.
- Do NOT stop to ask mid-run. A question goes in the report.
- Do NOT reshape a command the gate refused, or retry it in another form.
- Do NOT work on an item outside the epic, or file new work beyond the branch parents the plan needs.
- Do NOT discard a shelved item's work: stash it, never `git checkout --` or `git reset --hard`.
