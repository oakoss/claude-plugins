# review-cycle evals

Local behavioral checks for the parts of the skill that are pure prose — the
bats suites cover the hooks, but nothing else verifies the model actually
follows the skill.

`claude plugin eval` is in early access as of 2026-08: it needs an environment
variable provided by Anthropic during onboarding (not self-service; set it in
`~/.claude/settings.json` under `env` once obtained). Quick check: run
`claude plugin eval` in an empty directory — "early access" means not enabled,
"No eval cases found" means enabled. Until then this suite is authored but not
runnable.

Run before releasing skill-text changes:

```bash
claude plugin eval ./plugins/review-cycle \
  --scaffold --ablation none --no-publish \
  --allow-tools Bash Write Edit \
  --max-cost-usd 10
```

`--scaffold` is required (scaffold scripts are off by default), `--ablation
none` skips the meaningless no-plugin baseline arm (without the plugin the
prompt is an unknown slash command), and `--no-publish` keeps the report local.

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
