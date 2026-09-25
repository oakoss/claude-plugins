---
name: fix-merge-conflicts
description: Resolve merge or rebase conflicts with minimal, correctness-first edits, regenerate lockfiles with tooling, validate the build, and stage the result. Use when the user asks to "fix merge conflicts", "resolve conflicts", or after a merge/rebase leaves the tree conflicted.
argument-hint: "[against <ref>]"
---

# Fix merge conflicts

Get a conflicted tree back to a buildable, staged state. This skill **stages** the resolution; it never commits, pushes, or tags — you (and your review/commit gate) own that step.

## Find the conflicts

```bash
git status --porcelain
git diff --name-only --diff-filter=U
```

`$ARGUMENTS` is natural language. `against <ref>` (or a bare ref) names the other side of the conflict. With no argument, resolve whatever conflict markers exist in the working tree.

### Which side is "ours"

Run `git status` first and check its first lines for `rebase in progress`, because a rebase swaps the sides:

| Operation | `ours` (`:2:`, `<<<<<<< HEAD`) | `theirs` (`:3:`, `>>>>>>>`) |
| --- | --- | --- |
| `git merge <ref>` | your branch | `<ref>`, the branch coming in |
| `git rebase <ref>` | `<ref>`, the upstream you are replaying onto | **your own commit** being replayed |

During a rebase, `git checkout --theirs` keeps your work and `--ours` keeps the upstream. If you apply the merge reading to a rebase, you resolve every conflict backwards, and a passing build does not catch it.

## Resolve each conflict

Work file by file, minimally and correctness-first:

- **Prefer keeping both sides** when they are independent additions (two new imports, two new cases) — most conflicts are not true semantic clashes.
- When the sides genuinely clash, choose the variant that **compiles and preserves public behavior**. Do not invent a third behavior to reconcile them unless that is the obviously correct merge.
- Read enough surrounding code to know which resolution is right. A conflict is a question about intent, not a text-merge puzzle.
- Keep edits scoped to the conflict. Do **not** refactor, rename, or "improve" surrounding code while resolving — that hides the real resolution in noise and is exactly what a reviewer can't audit.

### Lockfiles and generated files

Never hand-edit a conflicted lockfile or other generated artifact. Resolve the source of truth, then regenerate:

```bash
# examples — use whatever the repo uses
npm install        # package-lock.json
pnpm install       # pnpm-lock.yaml
bun install        # bun.lock
cargo build        # Cargo.lock
```

For other generated files (codegen, snapshots), re-run the generator rather than merging the output by hand.

## Validate

Before declaring done, confirm the tree actually builds and behaves:

```bash
# use the repo's real commands
<build>      # compile / typecheck
<lint>
<test>       # the tests relevant to the conflicted areas
```

If validation fails, the resolution is wrong — fix it, don't paper over it.

## Finish

Some conflicts leave no markers: binary files, symlinks, and paths one side deleted or both sides renamed. `git add` stages whatever the working tree holds. For a binary or a symlink that is the `ours` copy, which during a rebase is the upstream, not your commit. Before staging, take every path from `git diff --name-only --diff-filter=U` that has no text markers and decide it explicitly. Keep a side's version with `git checkout --ours -- <path>` or `git checkout --theirs -- <path>`, or drop the path with `git rm <path>`. A side that has no version of the path fails the checkout with `does not have our version` or `does not have their version`. Name each choice in the report. The checks below can't see these conflicts. A submodule conflict is out of scope: `git checkout --ours` and `--theirs` exit 0 on it and change nothing, so stop and hand it back to the user.

```bash
git add <resolved files>
git diff --name-only --diff-filter=U                                # paths still unmerged
git grep -nE '^(<{7,}|\|{7,}|>{7,})( |$)|^={7,}$' -- ':/'           # markers in the working tree
git grep --cached -nE '^(<{7,}|\|{7,}|>{7,})( |$)|^={7,}$' -- ':/'  # markers in what you staged
```

All three commands must print nothing. `-- ':/'` searches the whole repository from any directory, and `{7,}` covers the diff3 `|||||||` line and a `conflict-marker-size` above the default of 7. A smaller size needs its own pattern. The working-tree search covers the file you forgot to stage, and the `--cached` one covers a file you staged before fixing it. `git grep` exits 1 when it finds nothing. An exit of 128 or a `fatal:` line means the search did not run, so the check failed. `git diff --cached --check` is not a substitute: it reads only staged content and also fails on trailing whitespace. A line of only `=` signs can be a Markdown or reStructuredText heading underline, so read each hit before you treat it as a marker. Then report.

## Output

```text
Conflicts resolved: N files
  - path — how it was resolved (kept both / took <side> because …)

Lockfiles regenerated: <yes/no — which>
Build / lint / tests: <result>

Staged and ready for your review. Not committed.
```

## Do NOT

- Do NOT commit, push, merge `--continue` to a commit, or tag — stage and stop.
- Do NOT leave conflict markers in any file.
- Do NOT bundle refactors or unrelated cleanup into the resolution.
- Do NOT hand-edit lockfiles or generated output.
- Do NOT bypass hooks (`--no-verify`).
