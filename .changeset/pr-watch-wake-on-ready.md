---
pr-watch: minor
---

The `watch` tool takes `wake`, so Claude can ask to be woken when a pull request turns ready to merge or its merge's checks pass, instead of running its own `gh` polling loop for an ask like "merge it once it's green". Without it nothing changes: a ready pull request and passed checks still wait for your next message. With it, each wakes Claude once, a merge Claude made included; it lasts while the pull request is watched in the session, and `Wake Claude: off` still wins.
