# review-cycle evals

Local behavioral checks for the parts of the skill that are pure prose — the
unit and plugin tests cover the hooks module, but nothing else verifies the
model actually follows the skill.

The early-access gate is gone: the Claude Code changelog adds `claude plugin
eval` under v2.1.269. Check for yourself rather than trusting this line, since
it dates fast:

```bash
cd "$(mktemp -d)" && claude plugin eval   # "No eval cases found" means enabled
```

The suite is still not runnable wherever the Docker credential store holds
symlinks — measured on one macOS host with Docker Desktop, which is where its
`bin/` and `cli-plugins/` links come from; the refusal text names no platform.
Reproduce in one command — the run below refuses before any model call, at
`$0.00`:

```bash
claude plugin eval ./plugins/review-cycle \
  --scaffold --ablation none --no-publish \
  --allow-tools Bash --max-cost-usd 1
```

> the Docker (`~/.docker`, `DOCKER_CONFIG`) credential store on this machine
> holds a symbolic link inside it, so the Bash sandbox cannot reliably exclude
> it — a Bash-granting evaluation cannot run here

The symlinks are Docker Desktop's own `~/.docker/bin/` and
`~/.docker/cli-plugins/` entries, not a misconfiguration. The remedy the message
suggests does not reach it — prefix the same command with a clean store and it
refuses identically, which is a second experiment worth re-running rather than
believing:

```bash
DC=$(mktemp -d) && cp ~/.docker/config.json "$DC/" \
  && DOCKER_CONFIG="$DC" claude plugin eval ./plugins/review-cycle \
    --scaffold --ablation none --no-publish \
    --allow-tools Bash --max-cost-usd 1
```

Both cases need `--allow-tools Bash`, so there is no narrower grant that avoids
the sandbox. Tracked as cpl-h1s, which records what was measured and when.

Run before releasing skill-text changes:

```bash
claude plugin eval ./plugins/review-cycle \
  --scaffold --ablation none --no-publish \
  --allow-tools Bash Write Edit SendMessage \
  --max-cost-usd 10
```

`--scaffold` is required (scaffold scripts are off by default), `--ablation
none` skips the meaningless no-plugin baseline arm (without the plugin the
prompt is an unknown slash command), `SendMessage` is granted because the skill
uses it to nudge a stalled review leg, and `--no-publish` keeps the report
local.

## Cases

- **codex-absent-claude-only** — a shim `codex` on PATH exits 127, the code the
  Phase 1 probe must classify as "not installed". The cycle must complete
  Claude-only, never launch `codex review`, and name the skip in the summary.
  The shim shadows the host's real codex; exit 127 exercises the same probe
  branch as true absence without having to strip the host PATH.
- **light-tier-lowers-codex-effort** — a working shim `codex` answers the
  probes and accepts `review`, logging its argv to `$HOME/codex-shim-argv.log`
  (fresh per run; use `--keep-temp` to inspect it). The eval HOME has no
  `~/.codex/config.toml`, so on this 2-line diff the skill must append
  `-c model_reasoning_effort="low"` and report `participated (effort: low)`.

Both diffs are light-tier by design, so each run fans out only `code-reviewer`
and stays cheap. `runs: 1` per case is a smoke-test budget — raise it in the
case frontmatter when you want confidence over speed.

The shims mean no eval run ever touches a real Codex account.
