---
review-cycle: minor
---

The review loop now stops sooner: by default a light diff gets at most 2 rounds and a full diff at most 3, down from 3 and 5. An explicit `max <n>` still overrides it. The round that reaches the limit applies none of its fixes, since a fix nobody reviewed is one the commit gate refuses. Instead it lists those findings with their severities and asks, in plain prose rather than a dialog, whether to apply them or commit with them deferred. You can also answer with something else entirely. Applied fixes get the same re-review a fix of their kind gets inside the loop, and that pass ends after one more round at most. Committing with them deferred works at once, because every path is still covered by the round that found them.
