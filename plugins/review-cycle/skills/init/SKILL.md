---
name: init
description: One-time setup for review-cycle. Verifies Codex CLI and multi_agent config, optionally appends comment + fix-vs-defer policies to CLAUDE.md (global or project), and updates .gitignore to exclude per-project sentinel files. Idempotent — safe to run multiple times.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# Initialize review-cycle

One-time setup for using `review-cycle`. Run this once globally, then optionally re-run inside any project to handle project-level `.gitignore` entries.

## What this skill does

Six named checks, each idempotent:

1. **Hook prerequisites** — verifies `jq`, `git`, and a sha256 tool (`sha256sum` or `shasum`) are on `$PATH`. The hooks silently fail-open if any are missing, so a misconfigured machine would have the gate quietly disabled.
2. **Codex CLI** — verifies `codex --version` works
3. **Codex multi_agent** — verifies `~/.codex/config.toml` has `multi_agent = true`
4. **Codex auth** — reminder to run `codex login` if needed
5. **CLAUDE.md policies** — offers to append comment + fix-vs-defer policies (global or project scope)
6. **Project `.gitignore`** — adds the sentinel and opt-out marker entries if inside a git repo

Each step checks state first. If something is already configured, it reports "✓ already done" and continues.

## Execution

### Step 1: Detect context

```bash
PROJECT_ROOT=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel)
fi
```

Remember whether we're inside a git repo. Project-scope options only apply when `PROJECT_ROOT` is set.

### Step 1.5: Hook prerequisites

Verify that `jq`, `git`, and a sha256 tool are available. The hooks fail-open if any are missing, which means the gate would silently do nothing on this machine.

```bash
command -v jq >/dev/null && echo "✓ jq" || echo "⚠ jq missing"
command -v git >/dev/null && echo "✓ git" || echo "⚠ git missing"
if command -v sha256sum >/dev/null; then
  echo "✓ sha256sum"
elif command -v shasum >/dev/null; then
  echo "✓ shasum"
else
  echo "⚠ no sha256 tool (need sha256sum or shasum)"
fi
```

For any missing tool, surface a clear install hint in the final summary:

- `jq`: macOS `brew install jq`; Debian/Ubuntu `apt install jq`
- `git`: macOS `xcode-select --install` or `brew install git`; Debian/Ubuntu `apt install git`
- `sha256sum`/`shasum`: should ship with the OS; on macOS use `shasum` (already present), on Linux `sha256sum` (coreutils)

Continue with subsequent steps regardless — each one is independent.

### Step 2: Codex CLI check

```bash
codex --version
```

- If command succeeds: ✓ record version
- If command fails: ⚠ print install instructions:
  ```
  npm install -g @openai/codex
  codex login
  ```
  Note this in the summary and continue (don't abort — other steps may still apply).

### Step 3: Codex multi_agent config

Read `~/.codex/config.toml` if it exists. Look for `multi_agent = true` (any whitespace) under `[features]`.

If missing:
- Use `AskUserQuestion` with options:
  - "Enable multi_agent in ~/.codex/config.toml (recommended)"
  - "Skip — I'll configure manually"
- If user enables: append (or create) the config:
  ```toml
  [features]
  multi_agent = true
  ```
  Backup existing config to `~/.codex/config.toml.bak` first if the file exists.
- If user skips: note in summary, continue.

### Step 4: Codex auth reminder

Auth state can't be precisely detected without interpreting codex CLI output. Print a reminder:
- If `~/.codex/auth.json` exists (or equivalent token file): assume authed, no warning.
- Otherwise: warn "Run `codex login` if you haven't already."

### Step 5: CLAUDE.md policies

Determine scope. If `PROJECT_ROOT` is set, use `AskUserQuestion`:

- Question: "Where should the review-cycle policies live?"
- Options:
  - "Global (~/.claude/CLAUDE.md) — applies to every project"
  - "Project (./CLAUDE.md) — applies only to this repo"
  - "Both — install in both locations"
  - "Skip — I'll handle this manually"

If `PROJECT_ROOT` is not set, default to global without asking.

For each chosen target file:

1. Check if it already contains a heading "Comment policy" or "Fix-vs-defer policy". If both present, mark ✓ already done and continue.
2. If file exists: back it up to `${file}.bak`.
3. Append the policy snippets from `${CLAUDE_PLUGIN_ROOT}/reference/policies.md`. Specifically:
   - The "Comment policy" markdown block
   - The "Fix-vs-defer policy" markdown block
   - Skip the meta/header content from `policies.md` — only the actual policy text in the code blocks gets appended.
4. Use `MultiEdit` or `Edit` to append. Create the file if it doesn't exist.

If user chose "Skip", print the policy snippets to the conversation so they can paste manually later. Note: snippets are also always available at `${CLAUDE_PLUGIN_ROOT}/reference/policies.md`.

### Step 6: Project .gitignore

Only run this step if `PROJECT_ROOT` is set.

Get the entries to add from the sentinel CLI so this stays in sync with whatever the hooks actually write:

```bash
GITIGNORE="$PROJECT_ROOT/.gitignore"
ENTRIES_TO_ADD=()
while IFS= read -r line; do
  ENTRIES_TO_ADD+=("$line")
done < <("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" paths)
```

For each entry:
- If `.gitignore` exists and already contains the entry (exact line match), skip.
- Otherwise, append it (create `.gitignore` if missing).

No user prompt — these entries are safe and minimal.

### Step 7: Summary

Print a compact checklist of what was done. One line per item, single status glyph at the start of each line:

- `✓` succeeded or already done
- `⚠` needs user action
- `✗` failed
- `-` skipped or not applicable

```
review-cycle init summary:
  ✓ Prereqs: jq, git, sha256sum
  ✓ Codex CLI: codex-cli 0.130.0
  ✓ multi_agent enabled
  ✓ Codex auth detected
  ✓ Policies appended to ~/.claude/CLAUDE.md (backup: .bak)
  - .gitignore: skipped (not in a git repo)

Run /review-cycle:review on a project with uncommitted changes.
```

When something needs manual action, surface it inline with `⚠` and a clear next step. Example:

```
review-cycle init summary:
  ⚠ Prereqs: jq missing — brew install jq
  ✓ Codex CLI: codex-cli 0.130.0
  ⚠ multi_agent not enabled — add `multi_agent = true` to [features] in ~/.codex/config.toml
  ⚠ Codex auth not detected — run: codex login
  - Policies: skipped by user (snippets at ${CLAUDE_PLUGIN_ROOT}/reference/policies.md)
  ✓ .gitignore updated in /Users/.../my-project

Run /review-cycle:review on a project with uncommitted changes.
```

Keep each line short. Avoid bracketed status fields (`[✓]`) that widen the layout. Avoid two columns. The goal is no line wrapping in a typical 80-100 column terminal.

## Edge cases

- **CLAUDE.md exists but is empty or only contains imports**: backup, then append policies. Safe.
- **CLAUDE.md has different policy text already**: don't clobber. Match on heading "# Comment policy" or "# Fix-vs-defer policy". If either exists, mark ✓ and skip (assume the user has their own version).
- **~/.codex/config.toml doesn't exist**: create with `[features]\nmulti_agent = true\n` if user opts in.
- **~/.codex/config.toml exists but no `[features]` section**: append `[features]\nmulti_agent = true\n` at the end.
- **`[features]` section exists with other entries**: insert `multi_agent = true` line within that section.
- **User runs from outside a project**: still useful for global setup (Codex + global CLAUDE.md). Skip project steps.
- **User runs init twice**: idempotent. Each check verifies state first.

## Things to NOT do

- Do NOT enable `multi_agent` without `AskUserQuestion` confirmation. User's codex config requires consent.
- Do NOT append to CLAUDE.md without confirmation (or without backup). User's instructions are sensitive.
- Do NOT run `codex login` automatically. It requires an interactive browser flow.
- Do NOT modify any file outside `~/.codex/`, `~/.claude/`, `${PROJECT_ROOT}/.claude/`, or `${PROJECT_ROOT}/.gitignore`.
- Do NOT abort if one step fails. Each step is independent; continue and report state in the final summary.
