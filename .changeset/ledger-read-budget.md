---
review-cycle: patch
---

A read of the findings ledger now returns at most 8,000 characters, unless its first entry and the answer's header together are longer, where it used to return every entry for the files named: a file reviewed often held dozens, and one read of `consent.ts` loaded 52,835 characters into the reviewing session. The tool takes a `query`, words matched against each entry's finding and reason, and ranks the matches, those holding the most query words first and then the newest; `matched` says how many matched and `next` is the `offset` that reads on. Rows are written as compact JSON, and carry `blob` and `current`, as short ids for `git diff`, unless the file is known unchanged. The review skill now passes a `query` naming what the change touches and carries the entries that bear on it, instead of every entry for the changed files.
