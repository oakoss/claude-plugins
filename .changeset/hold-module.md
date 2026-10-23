---
review-cycle: none
---

The hold's order, how two holds combine, and how a message moves the one in force now live in one pure module, `hooks/hold.ts`, with the update rule covered by unit tests. Holds behave as before. The gate's saved state keeps the hold as one record, so a session running when review-cycle updates to this version forgets what it held and which reviews it saw.
