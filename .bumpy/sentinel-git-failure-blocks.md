---
"review-cycle": minor
---

A git failure while computing the state hash now blocks the commit instead of being mistaken for "nothing differs". Every git call in `review-sentinel`'s hash stream reports failure explicitly, and `check`, `match`, and `status` treat that as drift.

The failure that mattered: the path enumeration runs inside a nested command substitution, so its exit status never reached the surrounding pipeline's status check. A failure there produced an empty diff stream, and an empty stream hashes to `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — the exact value a mark taken on a clean tree stores. The gate reported `verdict: match — this exact state was marked reviewed` on a tree holding unreviewed content.

Two smaller holes closed alongside it. A per-path `git diff` failure previously blocked or was waved through depending on where the failing path sorted, because nothing guarded the loop and the last iteration's status decided; an unreadable file was a coin flip, not a policy. And the stream is now generated into a file and hashed separately: as a single pipeline, `pipefail` reports the rightmost nonzero status, so a concurrent `shasum` or `cut` failure overwrote the git failure and it read as an ordinary tool error, which hooks fail open on.

Reproduced in tests four ways — an unreadable file, a shimmed enumeration, a failing `diff.external` driver, and a git failure concurrent with a hash-tool failure — each verified to fail against the previous release.

The block also tells you what to do about it. The sentinel now reports which operation failed and on which path, with git's own message attached, and the commit gate carries that into its deny reason instead of the generic drift text:

```text
Commit blocked: the review gate could not read the working tree, so it cannot confirm
this state was reviewed. review-sentinel: git failed while diffing locked.txt (working
tree) — fatal: cannot hash locked.txt (anchor 3b00f9f8…); treating as drift. Fix the
underlying problem (most often an unreadable file — check its permissions) and retry.
/review-cycle:accept will NOT clear this: it fails on the same fault.
```

What you do differently: if your repository can make git fail mid-diff, expect a block where you previously got a coin flip or silence, naming the file. One limitation to know about: `/review-cycle:accept` cannot clear this state, because the write verbs fail on the same fault. Fix the file, or use a gate opt-out. Ordinary drift is unaffected and still gets the ordinary message.
