---
review-cycle: patch
---

The Codex leg's brief now names the project's own checks, the commands the review ran to canonicalize the tree, for Codex to run in its copy, with a JavaScript tool run by path from `node_modules/.bin`. Codex had been guessing at tools the project does not use, such as `prettier`, and a package-manager script tries an install first, which fails without network. The Codex leg's profile now turns network off explicitly (`permissions.review-cycle.network.enabled=false`) rather than relying on Codex's default, and the brief says so, so a failed fetch reads as expected rather than as a defect. Measured on Codex 0.164.0: with the key off, `curl` to `api.github.com` could not resolve the host; with it on, the same call returned 200.
