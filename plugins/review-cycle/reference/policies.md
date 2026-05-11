# review-cycle policies

These policies are embedded in the review-cycle and inspect skills, so they apply automatically inside the cycle. Copy them into your global or project `CLAUDE.md` if you also want them active outside the cycle (for example, while Claude is implementing code or addressing a PR comment manually).

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

Default to writing NO comments. Only add a comment when the WHY is non-obvious:

- A hidden constraint or invariant not visible in the code
- A workaround for a specific bug (link the issue)
- Behavior that would surprise a reader
- A non-obvious performance reason for an unusual approach

Do NOT write comments that:

- Restate what the code does
- Document parameters or returns that types already convey
- Explain "added for X" or "used by Y" — that belongs in the PR description
- Mark sections (`// ===== SECTION =====`)
- Apologize, hedge, or leave TODOs without tickets

If removing the comment wouldn't confuse a future reader, don't write it.
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

## How these interact with the cycle

Both policies are already embedded in `/review-cycle:cycle` and `/review-cycle:inspect`, so the cycle behaves correctly even without these reference snippets installed.

The reference snippets matter when Claude is doing related work outside the cycle:

- Implementing a feature and would otherwise add unnecessary comments
- Addressing a single PR comment without invoking the cycle
- Writing tests where you don't want excessive `// arrange / // act / // assert` annotations

For those cases, having the policies in your CLAUDE.md keeps Claude's behavior consistent everywhere.
