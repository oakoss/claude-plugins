---
review-cycle: patch
pr-watch: patch
pr-kit: patch
---

The offer tool says where the pull requests go. It reads them from `pulls`, a list such as `["316"]` or `["owner/name#53"]`, but its refusal said only "merge needs at least one pull request", and neither pr-watch's wake nor pr-kit's ship skill named the key. An agent that had not loaded the tool's schema guessed `pr`, `prs` and `pullRequests`, got the same refusal each time, and could not ask the merge question, so you had to type "merge 395" yourself. Now every refusal for a missing or misplaced pull request names `pulls` and its shape, a guessed key such as `pr`, `prs` or `repo` is refused by name with the keys the tool does read, pr-watch's wake gives the call (`step "merge", pulls ["owner/name#395"]`, or `step "stack"` for a stack's layer), and the ship and merge skills name the key.
