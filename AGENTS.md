<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:

- Run `npx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# AGENTS.md

Conventions for authoring plugins in this marketplace.

## Task tracking

Use `bd` (beads). Run `bd prime` for the command reference and session protocol.

Run `pnpm run setup` after cloning. A fresh clone has no beads database — `.beads/embeddeddolt/` and `*.db` are gitignored — so until it runs, `bd` exits 3 in every `.beads/hooks/*` hook and each shim normalizes that to 0, skipping itself with one line on stderr. Setup runs `bd bootstrap`, which clones the task graph from `BD_SYNC_REMOTE` in `.beads/.env`; the graph lives on a Dolt remote, not in this repository. That file is gitignored because it names a private host, and without it bootstrap creates a fresh local database and everything still works.

Prefer `bd bootstrap` to `bd init`. Bootstrap leaves `core.hooksPath` unset and `AGENTS.md` untouched; `bd init` sets the former — making git bypass lefthook silently — rewrites the latter, and commits with a message commitlint rejects. `bd hooks install --beads` sets `core.hooksPath` too, so if you ever regenerate the shims, unset it afterwards. `core.hooksPath` must stay unset: `lefthook.yml` calls `.beads/hooks/*` directly, and lefthook is what runs commitlint and the formatters.

The shims on disk carry `v1.2.2` markers while the binary is 1.3.0. A shim delegates to whichever `bd` is installed, so upgrading already changed the behaviour and only the generated shell policy is stale. That policy is inert while `BEADS_HOOK_TIMEOUT` is unset or a plain integer — measured identical across both sections. Set it to anything else (`abc`, `-1`, `300x`) and the v1.2.2 section exits 125 and blocks the commit, where v1.3.0 warns and falls back to 300 seconds. Regenerating is not blocked: `bd hooks install --beads` rewrites git-tracked shims happily and replaces the `v1.2.2` section cleanly while preserving content outside the markers. It refuses symlinked hooks, and that refusal aborts the whole run rather than skipping the one hook — nothing is written. The reason not to run it is the line above — it sets `core.hooksPath`, which must stay unset here. Unset it afterwards if you ever do. (Measured on bd 1.3.0 in a throwaway clone.)

Do not run `bd setup codex`. This repository is worked in Claude Code; that command writes a `.codex/` directory and an `.agents/` skill nobody here reads. Both `bd init` and `bd setup codex` also append a managed block to this file — strip it and keep the pointer above.

`bd dolt remote add` writes `sync.remote` into `.beads/config.yaml` when the remote is named `origin`, and `bd bootstrap` writes it on its adopting path. On bd 1.3.0 none of them commits it — nor does `bd dolt push` — so it sits as an uncommitted modification to a git-tracked file. Four consequences:

- `bd init` silently configures a Dolt remote derived from `git origin` (`✓ Configured Dolt remote: origin → …`), and a later `bd dolt push` writes the task database into that git remote as `refs/dolt/data`, alongside a `refs/heads/__dolt_remote_info__` branch. Against a public GitHub origin that publishes the task graph. `bd bootstrap` never creates this remote, but it inherits one: when origin already carries `refs/dolt/data`, bootstrap clones from it and wires origin for future push/pull — its own `--help` says so — and the next `bd dolt push` republishes. Measured on bd 1.3.0: against a clean origin it plans `create fresh database` and leaves `bd dolt remote list` empty; with `refs/dolt/data` present it plans `clone from remote` and adopts. `pnpm run setup` is `bd bootstrap --yes`, so nothing prompts. `bd bootstrap --dry-run` shows which path applies; this repo's origin carries no dolt refs today, so it takes the fresh-database path. Point the remote at the Dolt host before any push.
- `bd dolt push` with no Dolt remote configured does **not** adopt one. It prints `No remote is configured — skipping.` and exits 0 — a silent success, so check `bd dolt remote list` rather than the exit code. Its `--yes`, `--no-adopt` and `BD_NO_REMOTE_ADOPT=1` flags exist and `--help` describes a consent prompt, but no prompt appears under any stdin or TTY combination and `--yes` adopts nothing. The binary and its help text disagree. (Measured on bd 1.3.0.)
- `git push` does not sync the task graph. The `pre-push` shim runs `bd hooks run pre-push`, which chains hooks and does not touch the Dolt remote, so `bd dolt push` has to be run explicitly. (Measured on bd 1.3.0 both with and without git's ref list on stdin: the remote's `refs/dolt/data` was unchanged across the hook run.)
- The written `sync.remote` publishes the private host. Strip the `sync:` block from `config.yaml` before staging, or the next `git add -A` sweeps the private host into someone else's commit; the Dolt-level remote lives in the gitignored database directory and survives on its own. Once a real remote exists, later pushes stop rewriting the file.

## Layout

Every plugin lives under `plugins/<name>/` with the following minimum structure:

```bash
plugins/<name>/
├── .claude-plugin/
│   └── plugin.json          # required: manifest
├── README.md                # required: per-plugin docs
├── LICENSE                  # required: per-plugin license (typically MIT)
└── CHANGELOG.md             # required: Keep-a-Changelog format
```

Optional component directories at the plugin root:

- `skills/<skill-name>/SKILL.md` — invoked as `/<plugin-name>:<skill-name>`
- `agents/<name>.md` — custom subagents
- `hooks/hooks.json` plus shell scripts — event handlers
- `reference/` — optional reference docs, snippets, examples
- `.mcp.json`, `.lsp.json`, `monitors/monitors.json` — server integrations

Do **not** put component directories inside `.claude-plugin/`. Only `plugin.json` goes there.

## Manifest conventions

Plugin `plugin.json` must include:

- `name` — kebab-case, matches the directory name
- `description` — one sentence, fits in a plugin listing card
- `version` — semver, bumped on every release that should propagate as an update
- `author` — set to `Oak OSS` with `hello@oakoss.dev` for consistency across plugins
- `license` — typically `MIT`
- `repository` — `https://github.com/oakoss/claude-plugins`
- `homepage` — link to the plugin's subdir on GitHub
- `keywords` — discoverability tags

Marketplace `marketplace.json` includes each plugin with `source: "./plugins/<name>"`.

## Hook conventions

Shell scripts in `hooks/` must:

- Use `#!/usr/bin/env bash` as the shebang
- Be committed executable (`git update-index --chmod=+x` if added on a system without exec bit support)
- Read stdin defensively (`INPUT=$(cat 2>/dev/null || true)`)
- Fail-open on any error — exit 0 rather than trapping the user in a broken loop
- Resolve project root via `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}` because `CLAUDE_PROJECT_DIR` is unreliable in plugin hooks
- Honor a global kill-switch at `~/.claude/.disable-review-gate` (or a plugin-specific equivalent) as the first check
- Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths in `hooks.json`

When the hook needs to use sha256, prefer this cross-platform fallback:

```bash
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  exit 0
fi
```

When blocking, always provide a printf fallback so the block decision is preserved if `jq` fails:

```bash
jq -n '{decision:"block", reason:"..."}' 2>/dev/null \
  || printf '{"decision":"block","reason":"..."}\n'
```

## Skill conventions

- Set `disable-model-invocation: true` only for skills that bypass a safety gate (e.g. marking state as reviewed without reviewing it) or perform meta-setup the user should explicitly initiate (e.g. writing global config). Local side effects like editing files don't qualify on their own — Claude already edits files freely, and the relevant boundary (commit, push, send) should be enforced by a hook, not by hiding the skill. When disabled, the skill is reachable only via `/<plugin>:<skill>` or a hook's `additionalContext` directive.
- Embed any load-bearing policies (comment rules, deferral criteria, etc.) directly in the skill body. The skill should be self-contained.
- If a policy could also apply outside the skill, provide a standalone snippet in `reference/` that users can copy into their `CLAUDE.md`.
- Keep skill bodies under ~500 lines. Move detailed reference material to supporting files in the skill directory.
- When a skill's prose tells the model to invoke another skill, write it as *invoke `/plugin:skill` via the Skill tool* — naming the tool fires more reliably than a bare slash command in prose. Never instruct model-invocation of a `disable-model-invocation: true` skill.
- A skill or agent change is **done when**: `claude plugin validate ./plugins/<name> --strict` passes; `bin/run-bats` is green; every factual claim the new prose makes has been verified against the tool or code it describes; a bump file describes the change; and the body is still under the line budget.

## Versioning and changelog

Releases are driven by [oakum](https://github.com/oakoss/oakum) bump files. Each plugin has a private `package.json` as its version anchor; `oakum version` writes that version, the changelog entry, and the declared `extra-files` — `plugin.json` and this repo's `marketplace.json` entry — in one pass. `.changeset/_config.toml` pins the oakum version, and `oakum check` refuses when the pin and the installed version disagree — `unverified: install pin is X but tool-version is Y` at exit 2, which fails the step. Keep it failing: oakum's docs show a pattern for passing on exit 2, and adopting it here would drop pin-drift detection along with it.

There is deliberately no cross-file drift check. The old `sync-plugin-versions.mjs --check` CI job existed because bumpy versioned only `package.json`, leaving the manifests to drift; oakum writes them itself through `extra-files`, so agreement is a property of how they are written rather than something to verify afterwards. Nothing now catches drift introduced by hand or by a bad merge — `oakum check --strict` validates bump files, not manifest agreement.

- Use semver: `0.x.y` while pre-stable, `1.0.0` on first stable release.
- **Every behavioral change ships with a bump file**: `.changeset/<slug>.md` with `<plugin>: patch|minor|major` frontmatter (`pnpm exec oakum add` writes one). The plugin name is unquoted: oakum refuses a quoted unscoped name with `must not be quoted (only scoped npm names are quoted)`. The description is the changelog entry; write it release-notes-grade: what changed, why, and what the user does differently. Do not hand-edit `CHANGELOG.md` for new work.
- On push to main with pending bump files, the Release workflow maintains a version PR (`oakum/version-packages`) carrying the version bumps, changelog entries, and synced manifests. **Merging that PR is the release**; `oakum release` then tags it and creates the GitHub releases.
- Direct releases remain valid for hand-cut cases: `pnpm exec oakum version` after writing a bump file does the whole propagation locally.
- Before releasing, run `claude plugin validate ./plugins/<name> --strict` — catches manifest/structure errors the bats suites don't cover.
- **Runtime changes** (anything under `plugins/<name>/` except `README.md`, `LICENSE*`, `CHANGELOG.md`, `NOTICE`, and `tests/`) require **either a staged bump file naming the plugin or a version bump in the same commit**. A repo-local PreToolUse hook at `.claude/hooks/version-bump-gate.sh` (registered in `.claude/settings.json`) enforces this mechanically; `oakum check --strict` enforces the same rule on PRs in CI. Note the exemptions are this hook's alone — oakum does not honour them, so a docs-only change to a plugin still needs a bump file to reach a release. Touch `.claude/.no-version-gate` to opt a project out; tests live next to the hook at `.claude/hooks/version-bump-gate.bats`.

## Dependencies

Rejecting versions published in the last 24 hours is pnpm's own default since v11, so `pnpm-workspace.yaml` declaring `minimumReleaseAge: 1440` restates the window rather than tightening it. Declaring it is still load-bearing, measured on 12.4.2: left implicit, pnpm applies the gate and then waives it — writing a `minimumReleaseAgeExclude` entry into `pnpm-workspace.yaml` itself and exiting 0 (`minimumReleaseAgeStrict: true` stops the auto-write — it refuses instead, or prompts to approve when run interactively). Declared explicitly, it refuses at exit 1 and writes nothing. Declaring it is also what makes the key visible to Renovate, below.

A security patch is typically hours old when its fix PR arrives, so it lands inside that window. Measured on pnpm 12.4.2, an enforced gate takes one of two shapes:

- A manifest pinned to the fresh version fails to resolve: `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, listing each held-back version with its publish time and the cutoff. `--trust-lockfile` does not help — it skips verification, not resolution.
- A range the old version still satisfies exits 0, prints `Lockfile passes supply-chain policies`, and leaves the old version in the lockfile. Nothing names the version it declined.

The second shape is the one to watch: a green security PR whose lockfile never moved. Confirm the lockfile names the patched version before merging it.

Renovate clears the first shape itself. For upgrades flagged `isVulnerabilityAlert` it writes the matching `minimumReleaseAgeExclude` entry into the same PR, commented `# Renovate security update: <name>@<version>`, and skips that step entirely when `minimumReleaseAge` is absent or zero (`lib/modules/manager/npm/artifacts.ts`). Security PRs from anywhere else need the entry added by hand, then removed once 24 hours have passed.

An entry is either a name pattern carrying no version, where globs work, or `<name>@<exact-version>`. Combining the two fails with `Invalid value in minimumReleaseAgeExclude: Name patterns are not allowed with version unions`, and a range is never a version. Prefer the pinned form for a temporary waiver: a glob is version-agnostic, so it never expires and exempts the package indefinitely. Use a glob only where that is the intent — `@oakoss/*` here exempts our own scope permanently, trading the gate for not hand-editing an entry at every release. Packages shipping platform binaries need two entries, because the main package's entry does not cover them and they often sit under a different scope: `oxfmt` here resolves 19 `@oxfmt/binding-*` subpackages, so excluding `oxfmt` alone would leave every one of them gated.

## Testing

Test a plugin in-place during development:

```bash
claude --plugin-dir ./plugins/<name>
```

Use `/reload-plugins` to pick up edits without restarting the session. Test hook scripts in isolation by piping sample JSON to stdin:

```bash
echo '{"source":"startup","cwd":"/tmp/test"}' | bash plugins/<name>/hooks/session-init.sh
```

Verify hook scripts exit 0 on every code path that shouldn't trap the user.

### Bats

Plugin and repo-local hooks have `.bats` suites. **Always invoke bats through `bin/run-bats`, never directly.** Bats 1.13 on macOS hangs after the final `ok`/`not ok` line because it holds file descriptors open during post-suite cleanup; the wrapper polls the TAP plan and force-kills bats once every test has reported. A direct `bats path/to/suite.bats` invocation will appear to succeed but leave an orphaned bats process tree that lingers until launchd reaps it.

```bash
bin/run-bats                                # auto-discover every .bats in the repo
bin/run-bats plugins/review-cycle/tests/    # everything under a directory
bin/run-bats path/to/one.bats               # a single file
bin/run-bats -f "test name" path/to.bats    # filter, like bats -f
```

The wrapper never reports a partial run as success: if it kills a stalled bats before every planned test has reported, it prints `only <n>/<total> tests reported` and exits 2. Treat that exit code as a failed run, not a flaky one — it means results are missing, not that tests failed.

Plugin-local wrappers (e.g. `plugins/review-cycle/tests/run.sh`) are thin shims that delegate to `bin/run-bats` and can still be invoked from inside a plugin directory.
