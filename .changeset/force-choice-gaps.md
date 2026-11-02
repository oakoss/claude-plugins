---
review-cycle: patch
---

A yes to an offer that sets a force push against a plain push grants neither, now including when the offer names a ref with a dot in it (`fix/x.y`), writes the plain side as a backticked `git push` with no flag but `-u` ("or run `git push -u origin fix/x`?"), asks the plain push as a follow-up question ("Force-push now? Or a normal push?"), or puts it after a semicolon ("Force-push with a lease; or push?"). The refusal now quotes the question that offered the choice, where a dotted ref could make it quote a later sentence.
