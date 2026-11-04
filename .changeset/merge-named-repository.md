---
review-cycle: minor
---

You can now let the agent merge a pull request in another repository by naming it with its repository: "merge linesmith#53" (a repository of this one's owner), "merge oakoss/linesmith#53", or its GitHub link, or a yes to an offer naming it that way ("Merge oakoss/linesmith#53?"). That covers `gh pr merge 53 -R oakoss/linesmith`; before, the gate refused every merge outside the session's repository however you asked. A bare number still names only this repository, so "merge 53" never merges linesmith's #53. Beside a pull request named with its repository, a bare number names neither ("merge linesmith#53 and 54" covers only linesmith#53), so name each one with its repository. A yes to an offer like "Merge oakoss/linesmith#53?", or one linking `[#53](…/oakoss/linesmith/pull/53)`, used to grant a merge of this repository's #53; it now names linesmith's.
