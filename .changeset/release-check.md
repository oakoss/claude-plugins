---
pr-kit: minor
---

New `/pr-kit:release-check` reads the open release pull request (an oakum or Changesets version PR) before you merge it. It reports each package's old and new version and its new changelog section as it will read, and flags what goes wrong when separate bump-file notes are joined into one release: two notes about the same change, a note leaning on a neighbour that is now elsewhere, a later note undoing an earlier one, and a claim the release itself makes stale. It also flags a manifest left on an old version and a bump file that landed after the pull request was built, and reports the checks, merge state and title. Report-only: say "check the release" before merging the version PR, and fix any finding in its bump file on the base branch.
