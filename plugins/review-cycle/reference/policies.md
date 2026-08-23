# review-cycle policies

These policies are embedded in the review-cycle skill, so they apply automatically inside the cycle. Copy them into your global or project `CLAUDE.md` if you also want them active outside the cycle (for example, while Claude is implementing code or addressing a PR comment manually).

Each policy stands alone — copy whichever section applies to your workflow.

- **Global scope**: paste into `~/.claude/CLAUDE.md` — applies in every project on this machine
- **Project scope**: paste into `<project-root>/CLAUDE.md` — applies only in this project
- **Child-directory scope**: paste into `<project>/<subdir>/CLAUDE.md` — applies only when working on files under that subdir

Claude Code reads all three levels and merges them automatically. There is no precedence conflict — these policies are additive.

---

## Comment policy

Recommended scope: **global** (applies to any code Claude writes).

```markdown
# Comment policy

Comments are useful when they add value. Keep them clean and minimal.

A good comment:

- Is accurate (matches the code; remove if stale)
- Earns its place (explains WHY or non-obvious context, not WHAT)
- Is concise (one or two lines unless documenting a complex invariant)

Avoid:

- Restating what the code does
- Section markers like `// ===== HELPERS =====`
- Hedge words, apologies, "obviously", "basically", "just"
- "Note:" / "Important:" prefixes when surrounding text already conveys importance
- TODOs without ticket references
- Cross-references that belong in the PR description ("added for X", "used by Y")
- Comments narrating change history ("previously", "no longer", "as it did before the refactor") — state the current invariant; the story belongs in the commit message
- Multi-line comments on trivial code
- AI-flavored phrasings ("Here we...", "Let's...", "This...")

When in doubt: keep the comment, but make it tighter.
```

---

## Fix-vs-defer policy

Recommended scope: **global** if you frequently address review comments outside the cycle, otherwise **project** for projects where you use the cycle.

```markdown
# Fix-vs-defer policy

When addressing review findings (from the review-cycle skill, PR comments, or any other reviewer):

Default to fixing inline. Defer to a follow-up only if:

- The fix is substantially more work than writing the follow-up itself
- The fix requires architectural changes spanning files outside this PR scope
- The fix requires a new dependency or schema migration not in this PR
- The fix would invalidate unrelated tests

If you can describe the fix in one sentence, just do the fix.

When deferring, briefly state which criterion above applies.
```

---

## Evidence policy

Recommended scope: **global**. Claims about what a command does get written far more often outside a review cycle than inside one.

```markdown
# Evidence policy

A claim about what a command does cites a run of that command.

A manifest, config file, lockfile, script entry, CI workflow, or flag in
documentation says what someone configured or intended. It does not say what
the tool does with it, and the two disagree often enough that the gap is where
wrong claims come from. `doctest = false` in a Cargo manifest does not stop
`cargo test --doc` from running the doctests — cargo compiles the crate and
runs them anyway, and the flag only removes them from plain `cargo test`.
A `skip` in a workflow does not prove the job was skipped on this run, and a
`package.json` script does not prove what the script does when invoked.
A declaration is never evidence for behavior.

- Run it, then quote what it printed. Name the command and the observed
  output, not the file you read it from.
- A run you did not observe is not a run. A stale file, a redirect the shell
  refused, a cached artifact, and a job that skipped all look like success
  from a distance — check that what you are reading came from the invocation
  you just made.
- When you cannot run it, say so. A claim the environment cannot exercise —
  another OS, another shell, a remote service — is labeled inferred rather
  than measured, or verified against authoritative documentation. Never state
  it flatly.

A claim whose measurement was merely out of budget keeps its place, labeled
inferred. A claim about tool behavior that nobody exercised and nothing
documents is not a weak claim but a question — ask it rather than asserting it.
```

---

## How these interact with the cycle

All three policies are already embedded in `/review-cycle:review`, so the cycle behaves correctly even without these reference snippets installed.

The reference snippets matter when Claude is doing related work outside the cycle:

- Implementing a feature and would otherwise add unnecessary comments
- Addressing a single PR comment without invoking the cycle
- Writing tests where you don't want excessive `// arrange / // act / // assert` annotations

For those cases, having the policies in your CLAUDE.md keeps Claude's behavior consistent everywhere.
