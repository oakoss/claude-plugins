---
review-cycle: minor
---

The findings ledger can follow code that moved. `mcp__review-cycle__ledger_record` takes a `move` list: each item names a carried entry by id and the file its code moved to, with an optional line. The entry keeps its finding, reason and date, takes the new file's path, id and blob, and comes back on reviews of that file instead of the old one. Before, an entry about code moved verbatim to another file stayed on the old path, returned as changed on every review of that file, and could only be resolved or kept there. A move onto an entry already holding that finding at the new path replaces it and counts as updated, and moves in one batch read their entries as they stood before any of them, so their order does not matter. A move to a path that is not a file in the working tree is refused, as an added entry's is. To use it, ask the agent to move an entry by id to its new path.
