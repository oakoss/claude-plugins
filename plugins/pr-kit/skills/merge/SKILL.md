---
name: merge
description: Merge a pull request the user asked to merge, or a github/gh-stack stack of them, by the repository's merge method. Use when the user asks to merge ("merge 47", "lets merge it", "merge the stack", "merge up to #42").
---

# Merge

Merge what the user asked for, in one command, then report what landed. The user's request is the consent, and it names what merges: this skill runs only on an explicit ask, never offers a merge itself, and arms auto-merge (`--auto`) only when the user asked for a merge once the pull request is ready.

Run every command that writes as its own Bash call. A commit gate such as review-cycle's judges a merge alone; when it refuses one, report its words and stop, or ask the question it names, since a refusal is never retried in another shape. Pass `--admin` only when the user asked for it in so many words.

## 1. Orient

The pull request is the one the user named, or the current branch's when they named none.

```bash
gh pr view <number> --json number,state,isDraft,mergeStateStatus,baseRefName,headRefName,url
gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge,defaultBranchRef
gh api -X GET 'repos/{owner}/{repo}/stacks' -f pull_request=<number>
gh pr list --base <headRefName> --state open --json number,headRefName
```

- **Not mergeable yet:** stop and say why when `state` is not `OPEN`, `isDraft` is true, or `mergeStateStatus` is `BLOCKED`, `BEHIND` or `DIRTY`, and offer `/pr-kit:fix-ci` for failing checks or `/pr-kit:fix-merge-conflicts` for conflicts. `UNSTABLE` means a check has not passed: one that failed, or one still running. Read them with `gh pr checks <number> --json name,bucket`, and the required ones with `gh pr checks <number> --required --json name,bucket`; both exit 0 while checks are pending, and when none is required the second exits 1 with `no required checks reported`, which means no check is required. Ignore `pass` and `skipping`. When any is `fail` or `cancel`, name it and ask before merging. When the others are `pending`, at least one check is required and every required check is `pass` or `skipping`, merge, and name the pending ones in the report as still running: the repository does not require them, so a merge the user asked for does not wait on them. When no check is required, or a required one is pending, name the pending ones and ask. `UNKNOWN` means GitHub has not computed it yet: read it again once before stopping.
- **Method:** the one merge method the repository allows (`squash`, `merge` or `rebase`, from the three `…Allowed` fields), or the one the user named. When several are allowed and the user named none, ask once which.
- **Stack:** the stacks call answers `[]` for a pull request in no stack. Any stack it lists makes this a stack merge: follow **Stack**, below. Merging a layer by itself with `gh pr merge` would merge it into the layer below, not into the trunk.
- **Built on, but no stack:** when the stacks call answers `[]` and `gh pr list` lists open pull requests based on this one's branch, they are layers GitHub does not know as a stack. A plain merge leaves their branches holding this pull request's original commits, which after a squash merge can conflict with the default branch and take a rebase and a force-push to clear. Follow the chain up, running the same `gh pr list` for each listed branch until it lists none. Merge nothing: name them, and give the user the command to link them, to run in their own terminal: this pull request's number, then each one above it (`! gh stack link <number> <number above>…`). Run here, the gate refuses the link unless the user's message asks for both a pull request and a push, which a yes to merging does not. When a branch has more than one pull request based on it, they form no single stack: name them, with no command. Once linked, a new ask to merge finds the stack. Say too that asking again without linking, in a plain "merge <number>", merges this one alone: when this stop already named them earlier in the conversation and the user asks again to merge this one, merge it by step 2.

## 2. Merge a pull request

```bash
gh pr merge <number> --<method> --delete-branch
```

`--delete-branch` removes the local branch too, moving a checkout of it to the default branch.

## 3. Report

The merge commit on the default branch (`gh pr view <number> --json mergeCommit,mergedAt`, where after a stack merge `<number>` is the top pull request of the set, never the stack's number), every pull request it merged, and what is left: open layers above it, a version pull request the merge triggered. An empty `mergedAt` right after the merge means it has not merged yet, as when a merge queue took it: say so rather than report it merged. Bringing the local default branch current (`git pull --ff-only` on it) needs no question.

## Stack

For a pull request in a github/gh-stack stack, `gh stack merge` replaces step 2. It merges the pull request and every unmerged layer below it into the trunk, all or nothing, and GitHub rebases the layers above onto the new trunk itself.

**Name the set.** Read the layers bottom up from the stacks call's `pull_requests` (an unmerged one has `merged_at: null`): the merge takes every unmerged layer from the bottom up to the pull request, or every unmerged layer for "merge the stack". When the user's message names only some of them, ask once, naming every one ("Merge #41 and #42?"), and end the turn; "merge the stack" or "merge up to #42" already names the set. Read every layer in the set with step 1's `gh pr view` and apply its stops to each, since `gh stack merge` itself checks only that each is open and not a draft.

**Pick the number.** `gh stack merge` reads a bare number as a stack's number first, then as a pull request's. For "merge the stack", pass the stack's own `number` from the stacks call. For a pull request, check that its number is no stack's: `gh api 'repos/{owner}/{repo}/stacks/<number>'` must fail with `HTTP 404`. When it answers, `gh stack merge <number>` would merge that other stack: stop and tell the user to run `gh stack merge` with no number in their own terminal, from a checkout of one of the stack's branches, and pick #<number> in its wizard; where it cannot prompt it merges the whole stack.

**Merge.** `--yes` keeps it from prompting and merges up to that pull request; without a method it would use whichever was last used. A stack merges now or not at all: it takes no `--auto` and no `--admin`, so a request to merge once ready, or past the rules, stops here with that said.

```bash
gh stack merge <number> --yes --<method>
```

Run it as its own Bash call with nothing before it, not even a `cd`: the gate cannot tell which pull requests a stack merge beside other commands reaches.

**Sync, when layers stay open.** The local branches of the open layers are stale until `gh stack sync`, which force-pushes every layer with a lease, so offer it rather than run it: "Force-push the stack with a lease?". When the user agrees, run it as its own Bash call with nothing before it, not even a `cd`, which would change whose stack it pushes. When it runs, read its output, not its exit code: a diverged stack prints `Sync aborted` and exits 0 having changed nothing, so report that, and that the stacks on GitHub and here disagree.

Change the stack itself (`gh stack modify`, `gh stack switch`) only from the user's own terminal: both are interactive, so give the command and say why.
