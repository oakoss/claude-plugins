---
review-cycle: patch
---

More ways of naming where a step goes now count as asking for it. "Publish the branch", "publish the changes", "publish to github" and "publish to origin" ask for a push: editors call a branch's first push publishing it. "Publish the PR" and "publish the PR to github" ask for the pull request step. "Push to npm" and "push the package" ask for a release, as "publish to npm" does, and still ask for no git push. "Push the v1 tag" and "push tag 0.2.0" ask for a push, as "push the tag" did. "Merge into main" and "merge now into main" ask to merge this branch's pull request, as "merge it into main" did. "Merge the version 2 PR" is the release, as "merge the version PR" is. A publish or push is read this way only when nothing but a courtesy word ("now", "please") follows in its clause, so "publish the changes as a PR comment", "publish changes.md" and "push the package.json change" still ask for nothing, as do "publish the docs to the wiki" and "merge the release fixes".

A period before a digit no longer ends a sentence or splits a word, so "merge 130.5" names no pull request where it used to name #130, and "merge it.2" and "push it.2 more to go" ask for nothing. "Merge the version PR now into main" asks for nothing, as "merge the version PR into main" already did: a destination after "now" names a local merge, and it used to grant the release.
