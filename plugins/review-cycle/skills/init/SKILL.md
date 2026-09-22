---
name: init
description: One-time setup for review-cycle. Checks for the optional Codex CLI and multi_agent config, checks that the commit gate can load, and optionally appends the comment, fix-vs-defer, and evidence policies to CLAUDE.md (global or project). Idempotent — safe to run multiple times.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# Initialize review-cycle

One-time setup for using `review-cycle`. Run it once; re-running is safe and adds anything a newer version introduced.

## What this skill does

Five named checks, each idempotent:

1. **Gate prerequisites** — verifies `git` and `jq` are on `$PATH`, and that this Claude Code build loads hooks modules. The commit gate is a hooks module; where modules are off, it never loads and nothing is gated.
2. **Codex CLI** (optional) — verifies `codex --version` works
3. **Codex multi_agent** (optional) — verifies `~/.codex/config.toml` has `multi_agent = true`
4. **Codex auth** (optional) — reports stored-login state via `codex login status`, advisory only
5. **CLAUDE.md policies** — offers to append the comment, fix-vs-defer, and evidence policies (global or project scope)

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

### Step 1.5: Gate prerequisites

The commit gate runs `git` for every check, and the comment-slop hook reads its payload with `jq`. The gate is a hooks module, an early-access Claude Code feature; a build that has them off never loads it, and nothing is gated.

```bash
command -v git >/dev/null && echo "✓ git" || echo "⚠ git missing"
command -v jq >/dev/null && echo "✓ jq" || echo "⚠ jq missing"
```

Then call the `mcp__review-cycle__status` tool. The gate registers it when it loads, so:

- the tool answers → `✓ commit gate loaded`
- the tool does not exist → `⚠ commit gate not loaded`. Either the gate is switched off (`review-cycle.enabled` in `/config`) or hooks modules are off in this build; for the latter, setting `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` to `1` in the `env` block of `~/.claude/settings.json` turns them on from the next session.

For a missing tool, surface an install hint in the final summary:

- `git`: macOS `xcode-select --install` or `brew install git`; Debian/Ubuntu `apt install git`
- `jq`: macOS `brew install jq`; Debian/Ubuntu `apt install jq`

Continue with subsequent steps regardless — each one is independent.

### Step 2: Codex CLI check

Codex adds a second review leg from a different model family. It is optional — `/review-cycle:review` runs Claude-only without it — so a missing CLI is reported as an available upgrade, not a warning.

```bash
codex --version
```

- If command succeeds: ✓ record version
- If command fails: note that the cycle will run Claude-only, and print what installing it would add:

  ```bash
  npm install -g @openai/codex
  codex login
  ```

  Continue; steps 3 and 4 are moot without the CLI, so skip them.

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

### Step 4: Codex auth check

```bash
codex login status
```

- Exit 0 (e.g. `Logged in using ChatGPT`): use the `-` glyph, not `✓` — report `- Codex auth: stored session (not exercised)`. The probe only shows that `auth.json` exists and parses; it prints this for a revoked session too, so a checkmark promises what no one has tested.
- Reports not logged in: use the `-` glyph, not `⚠` — this is unconfirmed, not broken. "no stored login — fine if you authenticate via `OPENAI_API_KEY`, else run `codex login`". The command only sees a stored session, so it says `Not logged in` for a working env-var setup, which is the normal CI arrangement.
- Subcommand unrecognized (older CLI): report `- Codex auth: unknown (probe unsupported on this CLI)`. Don't silently drop the line — a check that vanishes reads as a check that passed.

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

1. Check which of the headings "Comment policy", "Fix-vs-defer policy", and "Evidence policy" it already contains. If all three are present, mark ✓ already done and continue; if some are, append only the missing ones, so re-running after an upgrade adds what is new without duplicating what is there.

   **Follow `@` imports before deciding.** A `CLAUDE.md` whose body is mostly `@path` lines keeps its real content elsewhere — a common setup is a one-line `CLAUDE.md` importing a shared `AGENTS.md`. Testing only the importing file reports every policy absent and appends duplicates of ones already active. Read the imported file, test its headings too, and append into whichever file already holds the others.
2. If file exists: back it up to `${file}.bak`.
3. Append the missing policy snippets from `${CLAUDE_PLUGIN_ROOT}/reference/policies.md`. Test each heading with grep rather than skimming for it — `grep -qi '^#\+ *Evidence policy' "$file"` and the same for the other two — and append only the blocks that test absent. Whichever of these step 1 found missing:
   - The "Comment policy" markdown block
   - The "Fix-vs-defer policy" markdown block
   - The "Evidence policy" markdown block
   - Skip the meta/header content from `policies.md` — only the actual policy text in the code blocks gets appended.
4. Use `MultiEdit` or `Edit` to append. Create the file if it doesn't exist.

If user chose "Skip", print the policy snippets to the conversation so they can paste manually later. Note: snippets are also always available at `${CLAUDE_PLUGIN_ROOT}/reference/policies.md`.

### Step 6: Summary

Print a compact checklist of what was done. One line per item, single status glyph at the start of each line:

- `✓` succeeded or already done
- `⚠` needs user action
- `✗` failed
- `-` skipped, not applicable, or observed but not verified

```text
review-cycle init summary:
  ✓ Prereqs: git, jq; commit gate loaded
  ✓ Codex CLI: codex-cli 0.130.0
  ✓ multi_agent enabled
  - Codex auth: no stored login — fine if you authenticate via OPENAI_API_KEY, else run codex login
  ✓ Policies appended to ~/.claude/CLAUDE.md (backup: .bak)

Run /review-cycle:review on a project with uncommitted changes.
```

When something needs manual action, surface it inline with `⚠` and a clear next step. Example:

```text
review-cycle init summary:
  ⚠ Prereqs: commit gate not loaded — set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 in ~/.claude/settings.json env
  - Codex CLI: not installed — review runs Claude-only (npm i -g @openai/codex to add it)
  - multi_agent: n/a without the CLI
  - Codex auth: n/a without the CLI
  - Policies: skipped by user (snippets at ${CLAUDE_PLUGIN_ROOT}/reference/policies.md)

Run /review-cycle:review on a project with uncommitted changes.
```

Keep each line short. Avoid bracketed status fields (`[✓]`) that widen the layout. Avoid two columns. The goal is no line wrapping in a typical 80-100 column terminal.

## Edge cases

- **CLAUDE.md exists but is empty or only contains imports**: backup, then append policies. Safe.
- **CLAUDE.md has different policy text already**: don't clobber, and decide per policy rather than for the file as a whole. A heading that is present is the user's version — leave it alone; a heading that is absent gets appended. Skipping the whole file because one heading matched would mean an upgrade that adds a policy never installs it.
- **~/.codex/config.toml doesn't exist**: create with `[features]\nmulti_agent = true\n` if user opts in.
- **~/.codex/config.toml exists but no `[features]` section**: append `[features]\nmulti_agent = true\n` at the end.
- **`[features]` section exists with other entries**: insert `multi_agent = true` line within that section.
- **User runs from outside a project**: still useful for global setup (Codex + global CLAUDE.md). Offer only the global CLAUDE.md scope.
- **User runs init twice**: idempotent. Each check verifies state first.

## Things to NOT do

- Do NOT enable `multi_agent` without `AskUserQuestion` confirmation. User's codex config requires consent.
- Do NOT append to CLAUDE.md without confirmation (or without backup). User's instructions are sensitive.
- Do NOT run `codex login` automatically. It requires an interactive browser flow.
- Do NOT modify any file outside `~/.codex/`, `~/.claude/`, or the project's `CLAUDE.md`.
- Do NOT abort if one step fails. Each step is independent; continue and report state in the final summary.
