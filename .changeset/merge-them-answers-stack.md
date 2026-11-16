---
review-cycle: patch
---

"Merge them", "merge all of them" and "merge it" now answer a stack merge question ("Merge up to #402?", "Merge the stack?") as a yes does, merging that stack. Before, the commit gate read "merge it" as a merge of the question's pull request alone and "merge them" as no merge at all, so it refused `gh stack merge` and asked again. "Merge both" still names exactly two pull requests, since a stack question does not say how many layers it covers.
