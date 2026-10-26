---
review-cycle: patch
---

The spec conformance reviewer no longer re-judges a branch's earlier commits. On a branch reviewed one commit at a time, it saw only the newest work against the whole bead, so work an already-reviewed commit introduced came back as scope creep and was dismissed by hand. When the working tree is under review, the review skill now lists the branch's commits and their trailers in the reviewer's prompt as reviewed work. The reviewer counts work listed there as neither scope creep nor missing, and treats an issue ID found only in those commits as context rather than as the spec it was handed. A review against a base ref is unchanged, since its commits are the work under review.
