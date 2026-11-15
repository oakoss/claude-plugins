---
pr-watch: patch
---

pr-watch tells Claude when a pull request falls behind its base. Where the base requires branches to be up to date, such a pull request never reads ready to merge, and nothing woke Claude: its line showed `behind base` and stayed there. Now Claude hears "is behind main, so it is not ready to merge until it is brought up to date" once while it lasts, and for a pull request it opened in the session it brings the branch up to date as ship's update does and pushes it. A stack layer's line says it is one, and Claude tells you and offers `gh stack sync` instead, since ship merges nothing into a layer. A release pull request is left alone, since its tool rebuilds it, and a behind line held through a turn is dropped once a later read shows the branch up to date.
