---
review-cycle: none
---

The hook test for the gate's own alias read waits until the read appears, up to 10,000 microtask ticks, instead of a fixed 50. On Claude Code 2.1.293 the read lands later than 50 ticks, so the test failed on an unchanged gate. It still checks that the read starts at session start, and now also that the first command starts no second one.
