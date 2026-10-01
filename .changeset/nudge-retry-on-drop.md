---
review-cycle: patch
---

The end-of-turn review reminder is tried again after another plugin refuses it. A refusal arrives as `{ drop }` on a resolved `$.prompt.submit`, not as a rejection, so the gate used to treat the reminder as delivered and stayed silent for the rest of that message.
