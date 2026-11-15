---
pr-kit: patch
---

`do-epic` runs in a tm repository. It planned, claimed and shelved with beads (`bd`) commands only, so in a repository tracked with tm its plan step failed. It now uses the tracker the repository shows: tm when it has a `.config/tm.toml`, beads when it has a `.beads/` directory. On tm it reads the epic's children and their blockers with `tm list` and `tm show`, records the plan as a comment on the epic, claims with `tm start`, and gives a shelved Issue back to `todo` with a comment saying why. A child still in `triage` is left out of the plan and named in the report, and one in `in_review`, which ship has already shipped, is not built again; what it blocks waits, named in the report, until its pull request merges.
