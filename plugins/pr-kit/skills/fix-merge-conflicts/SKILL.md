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

`$ARGUMENTS` is natural language. `against <ref>` (or a bare ref) tells you what is being merged in, which helps you reason about which side is "theirs"; with no argument, resolve whatever conflict markers exist in the working tree.

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

```bash
git add <resolved files>
git diff --cached --check   # fails if any conflict markers remain
```

Confirm no `<<<<<<<`, `=======`, or `>>>>>>>` markers survive anywhere. Then report.

## Output

```
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
