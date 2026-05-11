---
name: cleanup
description: Run the cleanup agent on modified files in the current diff. Applies the comment policy (clean and minimal) and de-slopify methodology. Acts directly via Edit — does NOT loop, does NOT update the review sentinel. Use after ad-hoc edits to tidy up, or as a standalone cleanup pass outside the full /review-cycle:review cycle.
argument-hint: "[--base <ref>] [--files <file1,file2,...>]"
disable-model-invocation: true
allowed-tools: Agent, Bash, AskUserQuestion
---

# Cleanup

Thin wrapper that spawns the `review-cycle:cleanup` subagent on the current diff. The subagent does the actual work; this skill just makes it `/`-invocable for ad-hoc use.

## Execution

Spawn the cleanup subagent via the Agent tool, forwarding `$ARGUMENTS`:

```
Agent({
  subagent_type: "review-cycle:cleanup",
  description: "Cleanup modified files",
  prompt: "Run cleanup on the current diff. Arguments: $ARGUMENTS"
})
```

The subagent:

- Reads `git diff HEAD` and untracked files
- Applies the comment policy + de-slopify methodology
- Edits files directly
- Returns a structured summary of what changed

Echo the agent's summary to the user verbatim. Do not paraphrase.

## What this skill does NOT do

- Does NOT update the review sentinel. If you want to mark the state as reviewed after cleanup, run `/review-cycle:accept` after.
- Does NOT run any reviewers (Codex, pr-review-toolkit). Use `/review-cycle:review` for that.
- Does NOT loop. One pass over the diff.

## Composition

Typical flows:

- "Just tidy up these recent edits": `/review-cycle:cleanup`
- "Tidy up AND I've manually reviewed the substance": `/review-cycle:cleanup` → `/review-cycle:accept`
- "Full review with cleanup at the end": `/review-cycle:review` (invokes cleanup automatically in Phase 6)
