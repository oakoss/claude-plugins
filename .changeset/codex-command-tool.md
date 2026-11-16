---
review-cycle: minor
---

The Codex leg's command now comes from a tool, `mcp__review-cycle__codex_command`, instead of being assembled by hand from instructions written out in three places. The tool picks the reasoning effort for the tier and pass from the root table of your `~/.codex/config.toml` (an explicit `effort <level>` still wins, and the light tier and confirmation passes still only ever lower it), runs Codex under the read-only permission profile that writes only the cycle's scratch directory, and appends the sentence telling Codex where it may write. A brief holding a double quote, backslash, backtick, dollar sign or line break is refused, naming which, rather than passed on to break the command's quoting. `/review-cycle:review-pr` now runs its Codex leg under that same read-only profile, in the pull request's worktree; before, it ran with Codex's default sandbox, which can write wherever you can.
