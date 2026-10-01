---
review-cycle: patch
---

A prompt that describes your own routine, like "I commit and push", "we commit and push" or "normally commit and then push", no longer counts as a request to push. The parser marked a clause as a description only when it held no verb, so a commit verb let the push that followed through. A clause phrased as a request still counts, as in "I want you to commit separately and push". A yes to the agent asking "Should we commit and push?" or "Should we push?" now grants the push, as a yes to "Should I push?" does.

The README no longer says a Codex leg with missing credentials can block on a login prompt. Measured on codex-cli 0.159.2 with no credentials and no terminal, `codex review` retried and exited 1 after about 15 seconds with `401 Unauthorized`, so the review reports the leg as failed like any other.
