---
pr-watch: patch
---

A workflow run that fails without any failed job, such as a startup failure from a broken workflow file, now counts as a failure. Before, the watch line read "✓ checks passed" for a merge or push with such a run, and the watch could end before a re-run; an open pull request could read ready. The line now says "<workflow> failed", and a merged pull request's watch stays until a run passes.
