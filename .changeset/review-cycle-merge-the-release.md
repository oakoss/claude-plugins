---
review-cycle: patch
---

"Merge the release", "merge the version PR" and "merge the release PR" now ask for a release, as "release it" does, so the gate lets the agent merge the version pull request. Before, they asked for nothing: the gate read "merge" as naming a pull request, found "release" instead, and held the merge as merely mentioned. Only a request that ends with the noun asks: "merge the release fixes", "merge the release into main" or "merge the release branch" names other work and still asks first, and "don't merge the release yet" still holds the release.
