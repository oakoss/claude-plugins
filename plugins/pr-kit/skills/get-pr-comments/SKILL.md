---
name: get-pr-comments
description: Fetch and summarize review feedback on the active pull request into one prioritized action list. Use when the user asks to "get PR comments", "what did reviewers say", "summarize PR feedback", or "what do I still need to address on this PR".
argument-hint: "[<pr number or url>]"
---

# Get PR comments

Read-only. Turns scattered PR feedback into a single, prioritized list of what to act on.

## Resolve the PR

`$ARGUMENTS` may name the PR (a number or URL). If empty, resolve the PR for the current branch:

```bash
gh pr view --json number,url,title,headRefName,state
```

If no PR exists for the branch, say so and stop — there is nothing to summarize.

## Gather feedback

Pull the three sources of feedback; they live in different places:

```bash
# Inline review threads WITH resolution state — use GraphQL. The REST
# pulls/comments endpoint omits isResolved, so it can't tell you what's
# already been addressed.
gh api graphql -F owner=<owner> -F repo=<repo> -F pr=<number> -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100){
          pageInfo{hasNextPage endCursor}
          nodes{
            isResolved isOutdated
            comments(first:50){pageInfo{hasNextPage} nodes{path line body author{login}}}
          }
        }
      }
    }
  }'

# Review summaries and verdicts (APPROVED / CHANGES_REQUESTED / COMMENTED)
gh pr view <number> --json reviews

# Top-level discussion comments
gh pr view <number> --json comments
```

The caps (100 threads, 50 comments per thread) cover most PRs; if either `pageInfo.hasNextPage` is true, page with `after: <endCursor>` until every thread — and every comment within a long thread — is read. Summarizing from a truncated set can silently drop a blocking thread or the latest ask in a busy one.

Skip threads where `isResolved` is true (already addressed) or `isOutdated` is true (the referenced code has since changed) — don't re-surface those as open work.

## Group and prioritize

Collapse the raw feedback into one action list. For each item, capture the file:line (for inline comments), who raised it, and what it asks for. Order by how much it blocks merge:

1. **Blocking** — `CHANGES_REQUESTED`, correctness/security concerns, "this must change before merge."
2. **Should address** — substantive suggestions the reviewer expects a response to.
3. **Optional / nits** — style preferences, "could also," praise.

Don't pad the list. Merge duplicate threads that ask for the same thing. Drop resolved/outdated threads.

## Output

```
PR #<n> — <title>   (<review state: changes requested / approved / open>)

Blocking (N):
  - file:line — <ask> (@reviewer)

Should address (N):
  - file:line — <ask> (@reviewer)

Optional / nits (N):
  - file:line — <ask> (@reviewer)

Open questions (still need an answer):
  - <question> (@reviewer)
```

End with a one-line read: is this PR blocked, and on what.

To act on the list, hand it to the fix-vs-defer policy — fix the blocking and should-address items inline, decide the nits.
