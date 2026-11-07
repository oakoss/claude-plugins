---
review-cycle: minor
---

A new `/config` setting, Pull request updates (`prUpdates`), lets the fix for a failing check or a review go out without asking. Set to `push fixes`, a push runs unasked when every branch it updates heads your own open, unapproved pull request, on the same host and repository the push goes to; before, the agent asked before every such push unless Stop before let all pushes through. Each one is shown on screen and told to the agent, naming the branch and pull request. A first push, the default branch, a force push (so a lower layer of a stack), a tag, a version, Renovate or Dependabot branch, a fork's or someone else's pull request, an approved one, another host or a local path, and any GitHub read that fails still ask, and the refusal says why `push fixes` did not apply. The default, `ask`, changes nothing. The fix's commit still follows Stop before, a committed `.claude/settings.json` can only make it ask, and it is off under `claude -p`.
