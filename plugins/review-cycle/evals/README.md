# review-cycle evals

Local behavioral checks for the parts of the skill that are pure prose — the
unit and plugin tests cover the hooks module, but nothing else verifies the
model actually follows the skill.

Run before releasing skill-text changes:

```bash
claude plugin eval ./plugins/review-cycle \
  --scaffold --ablation none --no-publish \
  --allow-tools Bash Write Edit SendMessage \
  --max-cost-usd 5
```

`--scaffold` is required (scaffold scripts are off by default), `--ablation
none` skips the meaningless no-plugin baseline arm (without the plugin the
prompt is an unknown slash command), `SendMessage` is granted because the skill
uses it to nudge a stalled review leg, and `--no-publish` keeps the report
local.

Every case but one runs a whole review cycle, fixes and commit included.
Measured on Claude Code 2.1.301: a cycle case cost $0.68 to $1.20 and took 95
to 240 seconds; reviewer-receipt-from-agent-body, which spawns one reviewer,
cost $0.36 in 64 seconds. `--max-cost-usd` is checked before each run starts,
not during one, so a run in flight can pass it; the ceiling above leaves room
for all four. `--case` takes one glob, and a second `--case` replaces the
first.

The cycle ends its turn while its reviewers run in the background, and the
eval waits: each trace holds several `result` events, one per wake, with the
summary in the last.

Add `--keep-temp` to keep each run's directory for debugging. The eval moves
the run's `home/` and `tmp/` into a mode-000 `sealed/` directory and prints the
`chmod 700` that opens it; the trace is `out/trace.jsonl`. Run no git inside a
kept directory.

## Codex shims

Every case that runs the cycle stands a shim in for the `codex` CLI, so no eval
run reaches the real one. The shim is written to `$HOME/.eval-bin` in the eval's own HOME, outside
the reviewed repository, and put first on PATH by lines the scaffold appends to
that HOME's shell startup files. A scaffold's own `export PATH` does not reach
the session, and `case.yaml` may set only `EVAL_*` variables. Without the shim
on PATH the cycle runs the host's real Codex with your credentials: a run on
2.1.301 did, twice, before the startup-file lines were added.

## Cases

- **codex-absent-claude-only** — the shim exits 127, the code the Phase 1
  probe must classify as "not installed". The cycle must complete Claude-only,
  never launch `codex review`, and name the skip in the summary. Exit 127
  exercises the same probe branch as true absence without stripping the host
  PATH.
- **light-tier-lowers-codex-effort** — the shim answers the probes and accepts
  `review`, logging its argv to `$HOME/codex-shim-argv.log`. The eval HOME has
  no `~/.codex/config.toml`, so on this 2-line diff the skill must append
  `-c model_reasoning_effort="low"` and report `participated (effort: low)`.
- **cycle-grades-failed-verification** — the shim's canned review logs two
  commands in codex-cli's format, one that succeeded and one that exited 1, and
  its verdict carries no receipt lines. The cycle must read the log with
  `mcp__review-cycle__codex_log`, and Phase 4's table grades that receipt
  `partial`, so the summary's `Leg execution:` line must grade the Codex leg
  partial and name pytest.
- **reviewer-receipt-from-agent-body** — runs no cycle. The session spawns
  `review-cycle:code-reviewer` with a bare prompt and relays its report, which
  must open with the two receipt lines. The skill's own briefs always ask for
  the receipt, so this case is what shows the agent body carries the ask on
  its own; a grader fails the run if the spawn prompt mentions the receipt.

The cycle cases' diffs are light-tier by design, so each run fans out only
`code-reviewer` beside the Codex leg. `runs: 1` per case is a smoke-test budget — raise it in
the case frontmatter when you want confidence over speed.
