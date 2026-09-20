---
review-cycle: patch
---

### Fixed

A grep that answered the startup probe and then misanswered turned the commit gate off without a word. `dep_probe_grep` tests both directions at startup, but `DEPS_OK` caches that verdict and every later guard trusts it, so `parse_has_commit` read every command as harmless and the gate took the bare exit 0.

Measured with three greps that each pass the startup probe — one reporting "no match" for everything, one misanswering only extended regexes (the mode every verb decision uses), one misanswering a single fixed pattern. Before, on trees both gates deny: exit 0, zero bytes on stdout and zero on stderr, indistinguishable from a pass. After: both gates print one line naming grep and exit 1, and the command proceeds.

Three changes:

- **`parse_has_commit` confirms its own miss along both axes.** A fixed-string miss is confirmed twice — with a needle drawn from the searched text, which varies the pattern, and by re-asking the literal that missed, which varies the haystack. An extended-regex miss re-asks that same pattern about text built to match it, because a five-byte probe cannot vouch for a 250-byte regex. A miss it cannot confirm returns a third code.
- **A gate that cannot tell whether this is a commit stands down instead of ruling.** On the third code both gates report and exit 1, which is non-blocking. Continuing would let a broken grep deny an ordinary Bash call on an answer nothing computed — the trap fail-open exists to avoid.
- **A grep error is no longer read as absence, and the raw-payload fallback matches the prefilter again.** While a dependency is broken the fallback tested only for the literal verb, so a JSON-escaped one (`commit`) reached a quiet exit 0 with the diagnostic stranded in the debug log. It now carries the prefilter's backslash arm.

You see a diagnostic where you previously saw nothing, and a command carrying a backslash is noisy rather than silently denied while grep is broken. A healthy grep is unaffected: measured across 29,284 command strings — the test corpus, an exhaustive three-byte prefix sweep, and random-byte fuzz — the new code returns the same answer as the old one on every input, and never reports an unconfirmable miss.

Known gap: a grep whose fault keys on the *length or bytes of the text being searched* rather than on the pattern still defeats the extended-regex confirmation. Closing it needs the confirmation to re-ask about the failing input itself, which changes how the parser buffers stdin; that is tracked separately.
