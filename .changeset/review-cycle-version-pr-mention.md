---
review-cycle: minor
---

A merge request that names no pull request ("ok, lets merge") after an answer that only mentions another pull request in its last lines ("Release PR #52 shouldn't trigger Visual. Say the word to merge.") no longer has to be asked twice. The grammar still reads the mentioned number as the one to merge, so the merge of the pull request in question is refused. With the model check on (`review-cycle.modelCheck`, the default), the gate first asks the model whether the answer offered #52 or only mentioned it. Only a reply sure it was mentioned lets the merge run, and then oakum's version pull request still asks before it releases. Any other reply, or none, keeps the refusal, and one that got no answer or could not be read says so. A message holding a number, or a merge a queued message joined, is never put to the model. "Version PR #52 is green. Merge it?" still merges #52.
