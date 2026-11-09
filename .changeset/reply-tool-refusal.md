---
review-cycle: patch
---

A reply to a review thread sent outside the reply tool (`gh api graphql` `addPullRequestReviewThreadReply`, a REST reply to a review comment or one with `in_reply_to`, or the GitHub MCP server's `add_reply_to_pull_request_comment`) is now refused with a pointer to `mcp__review-cycle__reply`, which runs without asking when your `prUpdates` setting allows the reply. Before, the refusal treated it as any other comment and asked for the offer question, so an agent that reached for `gh` first asked you about a reply your setting already allowed: seen on a Pullfrog thread under `push, reply and resolve`. A resolve through `gh` still asks, and now says that under `push, reply and resolve` the reply tool resolves a bot's thread with the reply that names its fix. An unresolve, and a reply sent beside a top-level comment, still get the offer question.
