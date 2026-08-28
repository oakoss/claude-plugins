---
review-cycle: patch
---

Stopped the comment-density hook re-firing on comment-only edits.

The density heuristic counts comment lines in the text an edit writes, so an edit that rewrites an existing comment block — usually to fix the hook's own earlier finding — measured near 100% comments and fired again, twice in a row in the observed case. The check now skips an edit only when the replaced text and the written text are both entirely comment lines: rewriting comments is comment-editing, and density carries no signal there, while a one-line comment anchor no longer waves a large narrated block through. Whitespace-only lines inside a comment block do not break the skip; a MultiEdit insertion (empty old_string) disqualifies it; edits that touch any code line still fire; Write payloads are unchanged; and the pattern greps still scan the whole file either way.
