---
review-cycle: minor
---

A message you type that starts a job on an epic ("do epic cpl-czgp", "ok, lets run the epic cpl-czgp") now lets commits, pushes and pull requests run until the job ends, as a stop-before setting of `merge` would; a setting that stops later stands. Merges, releases, and pushes that ask whatever the setting (the default branch, a tag) still ask. It is read as the same message asking to push would be, so "don't do epic cpl-czgp yet" or one beside a hold starts nothing. The next message that holds or declines a step, even by mentioning a merge, or calls things off ("stop", "never mind"), ends the job, a prompt you did not type neither starts nor ends one, and the job survives a reload of the module. The status tool shows it under `stopBefore.mandate`.
