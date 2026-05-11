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

- Skills with side effects (modify files, write state, commit) should set `disable-model-invocation: true` so Claude only invokes them explicitly via `/<plugin>:<skill>` or via a hook's `additionalContext` directive.
- Embed any load-bearing policies (comment rules, deferral criteria, etc.) directly in the skill body. The skill should be self-contained.
- If a policy could also apply outside the skill, provide a standalone snippet in `reference/` that users can copy into their `CLAUDE.md`.
- Keep skill bodies under ~500 lines. Move detailed reference material to supporting files in the skill directory.

## Versioning and changelog

- Use semver: `0.x.y` while pre-stable, `1.0.0` on first stable release.
- Every user-visible change goes in `CHANGELOG.md` under `## [Unreleased]`.
- On release, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` and add a fresh `[Unreleased]` heading above it.
- Bump `version` in `plugin.json` and `marketplace.json` together.

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
