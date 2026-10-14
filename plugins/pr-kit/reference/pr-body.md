# Pull request body

The default title and body for a pull request the ship skill opens. A repository's own `PULL_REQUEST_TEMPLATE.md` takes priority: keep its headings and required blocks, write each section by the rules below, and remove its comment prompts.

In a repository that squash-merges with the pull request's title and body as the message, they become the commit on the default branch. The branch's commits stay on the pull request, one click away through the `(#N)` in the title, so the body summarizes; it does not retell.

## Template

```markdown
<What changes for the user, and why, in one or two sentences.>

## Changes

- **<Area>:** <the outcome, in one line>.
- **Release:** <package> <level>.

## Review focus

- <Where a reviewer should look hardest, and why.>

## Verification

- `<command>` <result: counts or exit status>.

## Known issues

- <What was deferred or left alone, in one line> (<why>; <tracker id>).

### Open questions

- <A question the work raised that nobody could settle.>

Closes <id>
```

## Rules

- **Title:** the repository's convention (conventional commits where it uses them), stating the behavior change in at most 72 characters. For a branch with several commits, summarize the branch rather than copy one commit.
- **Lead:** one or two sentences. A reader who stops there knows what the pull request does and why. If anything must be done after merging, say so here.
- **Changes:** one line per change, stating the outcome, not the mechanism. A branch with several commits gets one bullet per change, not per commit. Keep a dropped approach when it rules out an obvious alternative, with the reason in one line.
- **Release:** each package the bump files name, with its level (`pr-kit minor`, `review-cycle patch`), or `none` when the bump file releases nothing. Leave the line out in repositories without bump files.
- **Review focus:** one or two places that carry the risk. Leave the section out when nothing stands out.
- **Verification:** the checks that ran for this pull request and what they printed. Never a check that was only configured, and never a narrative of how review went.
- **Known issues:** only when something was deferred or left alone, or a question stays open, with the follow-up's tracker id when one exists. Open questions go under `### Open questions` inside it. Leave the section out otherwise.
- **Closes:** one line per work item the branch finishes, in the tracker's own format (`cpl-v0gn`, `#42`, `ENG-123`). A related item the branch leaves open gets a `Refs` line instead.
- **Leave out:** review rounds, conversation history, screenshots, and agent attribution.
- **Lines:** one line per bullet. GitHub rewraps the squash message, so a long bullet breaks across lines in `git log`.

## Example

Before, as #179 shipped (excerpt):

> - **Stale entries whatever the query**: every entry settled more than 90 days ago comes back on every read, ahead of all others, counted as `reopened`; `matched` counts the rest. The query filter used to hide them, though they are open again by design.
> - **Paging rule in the skill**: read through every reopened entry; then, if `matched` is 0, read again, once, without `query` from offset `reopened`; either way, read on only while entries bear on the change. A simulation of 16 reader variants over 9 ledger shapes found nothing missed, nothing read twice and no loop.

After:

```markdown
Reviews load less context: the ledger read is capped and ranked by the change, and the review skill is a fifth smaller.

## Changes

- **Ledger read:** at most 8,000 characters, ranked by the change's words, with paging.
- **Stale entries:** settled over 90 days ago, they come back on every read, first.
- **Review skill:** pruned from 75,831 to 60,353 characters, with a size cap test.
- **Phase-file split:** reverted; a fresh session skipped its pointers, so later phases ran from memory.
- **Release:** review-cycle patch.

## Review focus

- The ledger paging rule in `skills/review/SKILL.md`: a reader must reach every stale entry exactly once.

## Verification

- `pnpm test` 3,339 passed; `pnpm test:hooks` 486 passed, 0 failed.
- Lint, typecheck, `claude plugin validate --strict` and `oakum check --strict` exit 0.
- Removing the stale-first ordering or the size cap fails its spec.

## Known issues

- The 500-line cap counts the trailing newline, so it allows 499 lines (left alone).
- Loading later phases only when reached needs a mechanism sessions follow (cpl-qxgl).

Closes cpl-v0gn
```
