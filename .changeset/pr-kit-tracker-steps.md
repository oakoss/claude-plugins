---
pr-kit: minor
---

Ship and merge now work with tm as well as beads. Each tracker the repository shows acts only on its own ids: beads items close at ship as before, tm items move to `in_review`, and any other item, GitHub issues included, is left to its own integration and said so in the report. Ship notes the pull request and session on each item it updates, with `bd note` or `tm comment`. In a tm repository, once the default branch is current after a merge, merge runs `tm git scan`, which closes each item a `Closes` line on the default branch names. Before, tm items such as `Closes OT-303` stayed open at ship.
