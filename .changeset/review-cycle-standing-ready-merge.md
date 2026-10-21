---
review-cycle: minor
---

An ask to merge or release once a pull request is ready now outlasts the message that asked for it. "merge 46 once CI passes" or "when main is done and the release PR is ready, merge it" stays in force across later messages ("While we wait, lets plan the next work", "hold off on the docs push") until a merge of that pull request succeeds, a message holds or declines a merge or release or retracts what it asked, or the session ends. Before, the next message ended it, so the merge needed a second ask. Such an ask covers its pull request only once it is ready, never through a later "merge it" now, and the agent is told when your message ends one. A reload drops it, and a wake from another plugin such as pr-watch neither grants nor ends it; an unnamed "merge it when it's ready" still lasts only until your next message.

The grammar reads more of these asks:

- A condition joined by "and", and one about the default branch ("when main is done", "once main is green"). Before such a merge, the gate reads GitHub's rolled-up state of the checks and statuses on the default branch's head commit and refuses until it is a success.
- A release once ready: "release when the PR is ready", "release when the release PR is ready", "merge the release PR when it's ready". Each merges oakum's version pull request once it is ready, which covers the release step. One that lasts covers the version pull request open when you asked, or the first opened after.
- A release after a ready merge: "merge it when it's ready, then release it" and "merge 46 once CI passes and release it" now also release once the version pull request is ready. Before, the first granted only the merge and the second granted nothing.
- "merge 46 when the release PR is ready" asks for nothing, since it waits on another pull request.
