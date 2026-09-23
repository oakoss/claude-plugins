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
- `hooks/hooks.json` plus a hooks module (`register.ts`) — event handlers
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

## Hooks modules

Hooks here are hooks modules: TypeScript that Claude Code runs itself, named in `hooks.json` as `"modules": ["./register.ts"]`. review-cycle's commit gate and comment-slop check are one module. No plugin ships shell hooks. There is no build step and no runtime dependency — a module imports only relative files and `"claude-code"`.

- Keep every function that calls `$` in the file that registers the hooks. `claude plugin validate` follows `$` only into functions declared there, and refuses a module that passes `$` across an import. Pure logic goes in sibling files, which is also what makes it testable. Code that needs a process can live there too if it takes a runner as a parameter: review-cycle's `git.ts` takes a `Git` function, which `register.ts` builds from `$` (`gitOf`). `validate --strict` accepts that. It is a gap the validator does not check, not a documented pattern, so re-check it when Claude Code updates.
- A hook that throws is skipped and the action proceeds. Where proceeding is the harm a hook exists to prevent, catch with `on(…).catch(handler)` and refuse; everywhere else, fail open, and tell the agent in the result's `context` when a check could not run rather than passing silently.
- Hooks modules are early access. A build without them loads none, silently, and `claude plugin test` prints a notice and exits 0 having run nothing — set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and check that the run reports its tests.
- Pure logic is tested with vitest: `*.spec.ts` beside the module, run by `pnpm test`, which also runs the prose anchors in each plugin's `tests/`. The module that registers hooks is tested with `claude plugin test plugins/<name>` (`pnpm test:hooks` for review-cycle), which runs only `*.test.ts` and whose kit is the only thing that can raise engine events. That kit runs no real processes: a test answers `process.run` itself with `{ value: { exitCode, stdout, stderr } }`, its options under `e.init`.
- Types come from `types/claude-code/claude-code.d.ts`, written by `/plugin-types` (headless: `claude -p "/plugin-types <dir>"`). Regenerating needs a login, so the file is committed; regenerate it when Claude Code updates and the module uses something new. `pnpm typecheck` checks against it, `pnpm lint` runs oxlint type-aware, and `pnpm format` is oxfmt.

## Skill conventions

- Set `disable-model-invocation: true` only for skills that bypass a safety gate (e.g. marking state as reviewed without reviewing it) or perform meta-setup the user should explicitly initiate (e.g. writing global config). Local side effects like editing files don't qualify on their own — Claude already edits files freely, and the relevant boundary (commit, push, send) should be enforced by a hook, not by hiding the skill. When disabled, the skill is reachable only via `/<plugin>:<skill>` or a hook's `additionalContext` directive.
- Embed any load-bearing policies (comment rules, deferral criteria, etc.) directly in the skill body. The skill should be self-contained.
- If a policy could also apply outside the skill, provide a standalone snippet in `reference/` that users can copy into their `CLAUDE.md`.
- Keep skill bodies under ~500 lines. Move detailed reference material to supporting files in the skill directory.
- When a skill's prose tells the model to invoke another skill, write it as *invoke `/plugin:skill` via the Skill tool* — naming the tool fires more reliably than a bare slash command in prose. Never instruct model-invocation of a `disable-model-invocation: true` skill.
- A skill or agent change is **done when**: `claude plugin validate ./plugins/<name> --strict` passes; `pnpm test` is green; every factual claim the new prose makes has been verified against the tool or code it describes; a bump file describes the change; and the body is still under the line budget.

## Versioning and changelog

Releases are driven by [oakum](https://github.com/oakoss/oakum) bump files. Each plugin has a private `package.json` as its version anchor; `oakum version` writes that version, the changelog entry, and the declared `extra-files` — `plugin.json` and this repo's `marketplace.json` entry — in one pass. `.changeset/_config.toml` pins the oakum version, and `oakum check` refuses when the pin and the installed version disagree — `unverified: install pin is X but tool-version is Y` at exit 2, which fails the step. Keep it failing: oakum's docs show a pattern for passing on exit 2, and adopting it here would drop pin-drift detection along with it.

There is deliberately no cross-file drift check. The old `sync-plugin-versions.mjs --check` CI job existed because bumpy versioned only `package.json`, leaving the manifests to drift; oakum writes them itself through `extra-files`, so agreement is a property of how they are written rather than something to verify afterwards. Nothing now catches drift introduced by hand or by a bad merge — `oakum check --strict` validates bump files, not manifest agreement.

- Use semver: `0.x.y` while pre-stable, `1.0.0` on first stable release.
- **Every behavioral change ships with a bump file**: `.changeset/<slug>.md` with `<plugin>: patch|minor|major` frontmatter (`pnpm exec oakum add` writes one). The plugin name is unquoted: oakum refuses a quoted unscoped name with `must not be quoted (only scoped npm names are quoted)`. The description is the changelog entry; write it release-notes-grade: what changed, why, and what the user does differently. Do not hand-edit `CHANGELOG.md` for new work. A note that is a heading with nothing under it renders no changelog section at all — `oakum version` consumes the file and the release says nothing about what you wrote. Since oakum 0.4.0 `check --strict` refuses it, naming the file: measured here, exit 1 under `--strict` against exit 0 without it. `version` itself still says nothing when it consumes one, so the gate is the only thing that catches it.
- On push to main with pending bump files, the Release workflow maintains a version PR (`oakum/version-packages`) carrying the version bumps, changelog entries, and synced manifests. **Merging that PR is the release**; `oakum release` then tags it and creates the GitHub releases.
- **The version PR's title is what lands on main, not its commit.** This repository allows squash-merge only and sets `squash_merge_commit_title = PR_TITLE`, so GitHub discards the `chore(release): version packages` subject oakum writes on the branch and uses the PR title instead. oakum 0.3.1 titled that PR `Version Packages`, which landed unconventionally (#55 was renamed by hand before merging). 0.3.2 defaults the title to the version commit's **built-in** message — the schema is explicit that a configured `commit-message` does not change it, which is why setting one was never the remedy and why #55 was misnamed with one already configured. Measured 2026-09-21 on the live branch under 0.3.2: the version commit's subject and PR #62's title are both `chore(release): version packages`, so the default lands conventionally and no rename is needed. Re-check after the first release on 0.4.0, since the workflow rebuilds that PR on every push to main; if it ever regresses, set `title` in `.changeset/_config.toml`, which takes the same `oakum status --json` document the commit message does.
- Direct releases remain valid for hand-cut cases: `pnpm exec oakum version` after writing a bump file does the whole propagation locally.
- Before releasing, run `claude plugin validate ./plugins/<name> --strict` — catches manifest and structure errors the tests don't cover.
- **Any change under `plugins/<name>/` needs a bump file naming that plugin.** There are no exemptions: a README-only or tests-only change still needs one, `<plugin>: none` or empty frontmatter if it should not release — a bare `none` line is refused. `oakum check --strict` decides, in CI's `Bump files` job. That is the only gate: nothing checks locally, so run `pnpm exec oakum check --strict` yourself before pushing if you want the answer sooner. A lefthook `pre-push` command was tried and removed — `oakum check` derives its range from the checked-out HEAD rather than from the refs being pushed, so pushing a branch while standing on `main` examined `main`, found nothing, and exited 0 while the uncovered branch reached the remote. Measured in a clone against a local bare remote.

  A repo-local PreToolUse hook used to enforce a looser version of this rule and was retired. Measured on oakum 0.4.0 against throwaway clones, all three at exit 1: a runtime change with no bump file (`changed with no covering intent`); a hand bump with all three manifests agreeing (`manifest 0.18.2 is above tagged 0.18.1`, plus the coverage error); and manifests disagreeing (the coverage error again). The hook offered a hand bump as an alternative to a bump file and waived docs and tests — both paths oakum refuses, so it was permitting what CI then rejected.

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

Use `/reload-plugins` to pick up edits without restarting the session; saving a hooks module reloads it on its own.

```bash
pnpm test          # vitest: modules' pure logic and prose anchors
pnpm test:hooks    # claude plugin test: the modules' hooks
pnpm typecheck && pnpm lint && pnpm format:check
```

Prose anchors (`plugins/<name>/tests/*.spec.ts`) pin wording that skills and agents load as instructions, where nothing else would notice it going missing. Write each against a mutation: remove the phrase it anchors and confirm the test fails.
