The loop has ended. Run the maintainability auditor **once** here, against the final post-fix state, together with cleanup. Spawn both in a single turn when no changed path is runtime markdown (Phase 1's split): the auditor only reads, and on an ordinary code diff cleanup edits comments and prose, which doesn't change a structural verdict. When the diff's prose IS runtime — agent bodies, skill bodies — a cleanup rewording changes what the auditor is evaluating mid-read, so cleanup (inline or spawned) runs only after its report lands:

1. **`review-cycle:maintainability-auditor`** — if the diff includes non-trivial source-code changes (new or substantially reworked functions, modules, types, or logic). Skip it when the diff is only docs, config, version bumps, or a handful of trivial lines — its ambitious suggestions are noise on small changes.

2. **Cleanup** — comment policy + de-slopify, tier-dependent (below).

**The maintainability spawn also carries Phase 3's `settled in earlier cycles` block**, so it does not re-measure what an earlier cycle settled.

**The report-only spawn carries the containment sentence** — the maintainability auditor, not cleanup, which edits the target by design: *do not edit, stage, or commit anything in `<PROJECT_ROOT>` — work only on a copy in a private directory made with `mktemp -d <SCRATCH>/leg.XXXXXX`, never a shared scratchpad, and delete it when you finish. End every process you started before you report: one left blocked on a pipe you opened outlives both you and the directory. Never reshape a command to slip past a guard; name that directory in your report, and write nowhere outside it. Copy files into it, never symlink anything from the target, and run no package-manager install there; a script starts with `set -u` and runs `cd <dir> &&` before any git command, and an `rm` guards every variable in its path, as in `"${DIR:?}/…"`, never `"$DIR/…"`.* Phase 3's snapshot does not cover this phase; only Phase 8's coverage check catches a file it leaves changed.

**Grade this leg as well.** Apply Phase 4's labelling from its two receipt lines and carry the label into Phase 9, including the demotion rule for a structural claim about an external tool.

**The auditor does not re-open the loop.** Never auto-apply its structural restructurings; surface them in the summary's "Structural suggestions" section for the user to act on.

**Report-only is about the kind of finding, not about which leg found it.** A measured fault in code this cycle wrote is a defect whichever leg reports it, and goes through the fix-vs-defer policy. Only proposals and scope questions stay surface-only. A fix applied here gets Phase 6's self-check and fact verification, both directions on any guard, before Phase 8.

**Cleanup**, by size, not tier:

- **diffs under ~150 changed lines** — clean inline. Apply the comment policy to comments you touched, and invoke `/review-cycle:de-slopify` via the Skill tool for modified `.md` files and commit-message drafts. Tightening prose must never make it false: correct a claim about a command against a run, and report that correction apart from wording changes. Never touch algorithm logic, type definitions, or test assertions; in runtime markdown, templates, decision tables, literal thresholds, and rule definitions are logic.
- **~150 changed lines or more** — spawn the cleanup subagent, which has de-slopify preloaded:

  ```js
  Agent({
    subagent_type: "review-cycle:cleanup",
    description: "Final cleanup pass — comments + de-slopify",
    prompt: "Run cleanup on the current diff (post-fix state). Apply comment policy to modified code comments and de-slopify to prose surfaces. Do not touch algorithm logic, type definitions, or test assertions."
  })
  ```

  It edits files directly and returns a summary. Scope: comments in modified code, modified `.md` files, commit-message drafts. Excluded: algorithm logic, type definitions, test assertions, and the load-bearing structures in runtime markdown its body names.

**Check every release-note file in play against the diff itself — last, after cleanup has finished editing.** A changeset or bump file (`.changeset/*.md`, or whatever this project uses) is published verbatim, and review may have changed the code it describes. In play means any the diff adds or modifies, plus any already staged before the cycle began. Read each one against the final post-fix state and correct it, or say in the summary that you could not. Do this yourself, whichever cleanup mode runs, and report the corrections in the summary's release-note field, separately from wording changes.
