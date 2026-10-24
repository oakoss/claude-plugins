---
review-cycle: patch
---

A yes to a merge offer that sets pull requests against each other ("Merge #3, or #4?", "Should I merge #3 and #4? Or, merge #5 and #6?", "Merge #3, #4, or both?") now grants no merge, since it does not say which. The two-question form used to grant every pull request named in both. The refusal tells the agent to ask again with a menu ('Say "merge 3", "merge 4", or "merge both".'), and a menu may now offer "merge both" as one of its options. An alternative that hands the merge back or offers another step ("…, or would you rather do it?", "…, or close #4?", "…, or wait for #4?") still lets a yes take the first alternative.
