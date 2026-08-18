# AGENTS.md

Conventions for authoring plugins in this marketplace.

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

Releases are driven by [bumpy](https://bumpy.varlock.dev) bump files; each plugin has a private `package.json` as its version anchor, and `scripts/sync-plugin-versions.mjs` propagates that version into `plugin.json` and `marketplace.json` (CI runs its `--check` mode as a drift gate).

- Use semver: `0.x.y` while pre-stable, `1.0.0` on first stable release.
- **Every behavioral change ships with a bump file**: `.bumpy/<slug>.md` with `"<plugin>": patch|minor|major` frontmatter (`npx bumpy add` writes one). The description is the changelog entry — write it release-notes-grade: what changed, why, and what the user does differently. Do not hand-edit `CHANGELOG.md` for new work; bumpy generates entries when versioning. (Pre-bumpy history in each changelog stays as-is, Keep-a-Changelog format.)
- On push to main with pending bump files, the Release workflow maintains a version PR (`bumpy/version-packages`) carrying the version bumps, changelog entries, and synced manifests. **Merging that PR is the release**; bumpy then tags it.
- Direct releases remain valid for hand-cut cases: bump `plugin.json` + `marketplace.json` + changelog heading together (`npm run version` after writing a bump file does this locally).
- Before releasing, run `claude plugin validate ./plugins/<name> --strict` — catches manifest/structure errors the bats suites don't cover.
- **Runtime changes** (anything under `plugins/<name>/` except `README.md`, `LICENSE*`, `CHANGELOG.md`, `NOTICE`, and `tests/`) require **either a staged bump file naming the plugin or a version bump in the same commit**. A repo-local PreToolUse hook at `.claude/hooks/version-bump-gate.sh` (registered in `.claude/settings.json`) enforces this mechanically; `bumpy ci check` enforces the same rule on PRs in CI. Touch `.claude/.no-version-gate` to opt a project out; tests live next to the hook at `.claude/hooks/version-bump-gate.bats`.

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
