1. **Codex review (background)**, only when Phase 1 recorded the leg as `eligible`. Run the CLI directly, not the `/codex:review` slash command, with the subagents' scope: `--uncommitted`, or `--base <ref>` when the user gave a base. The scope flags reject a prompt argument, so the brief rides a config override: `-c "developer_instructions=\"<brief>\""`.

   **Reshape the brief for the flag**, falsifiable question included (step 2): the value is parsed as TOML through one layer of shell quoting, so flatten it into one line of plain prose with no double quotes, backslashes, backticks, or dollar signs (apostrophes are fine). Name files and identifiers bare; keep the changed-file list, comma-separated.

   **Keep the repository read-only for Codex.** In a trusted project its sandbox is `workspace-write`, which can write the repository. Two more overrides run it under a permission profile that reads everything and writes only `<SCRATCH>`. Write the absolute scratch path itself into the filesystem table and the brief on every Codex launch this cycle; when `mcp__review-cycle__scratch` failed, run `mktemp -d` once and use the path it prints. Then pass the filesystem table as one `-c` value, since a dotted key splits on the dot in the scratch path. The brief says so in this sentence: *The repository is read-only for this review, by design: write only inside <SCRATCH>, making your own directory there with mktemp -d <SCRATCH>/codex.XXXXXX and pointing TMPDIR at it. A command that writes inside the repository, such as a test runner writing a cache, fails with Operation not permitted; that is expected, not a defect in the change and not a reason to request wider permissions. List it under attempted-but-failed and continue with checks that only read.*

   **An explicit effort argument wins over the tier.** When Argument parsing validated one, append `-c model_reasoning_effort="<that literal>"` on either tier, raising included. The rest of this paragraph and the next apply only without one. On the **full** tier pass no override: the user's `~/.codex/config.toml` decides. On the **light** tier, lower the effort only when it would actually be lower. Read the configured value from the root table only, since a `[profiles.*]` key is not what runs:

   ```bash
   awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model_reasoning_effort/{print}' ~/.codex/config.toml 2>/dev/null
   ```

   The effort scale, ascending, is `none` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`; the API rejects anything else. Append `-c model_reasoning_effort="low"` when the configured effort is above `low` or nothing is configured. When it is already `low`, `minimal`, or `none`, **pass no override**: the tier never raises effort. Emit only a literal from that set, since Codex does not validate `-c` values before the API call.

   Record the effort actually passed (`low`, `inherited`, or `<level> (explicit)`) in the summary draft at the spawn; the tier alone does not say it.

   Assemble the invocation from these parts:

   ```bash
   # full tier, working-tree scope (re-derive the root in this call — shell values
   # don't survive between Bash calls):
   cd "$(git rev-parse --show-toplevel)" && codex review --uncommitted -c 'default_permissions="review-cycle"' -c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "<SCRATCH>"="write"}' -c "developer_instructions=\"<brief>\""
   # base scope: swap --uncommitted for --base <ref>
   # light tier: append -c model_reasoning_effort="low"
   # explicit effort argument: append -c model_reasoning_effort="<validated literal>" on either tier
   ```

   ```js
   Bash({
     command: "<the invocation assembled above>",
     description: "Codex review",
     run_in_background: true
   })
   ```

   `developer_instructions` is additive: Codex still reads the repo's `AGENTS.md`. Never add `--strict-config`: an unrecognized key then fails the leg instead of degrading to an unbriefed review. Tier on effort, never on a model name. Save the shell ID; you read its output when notified.
