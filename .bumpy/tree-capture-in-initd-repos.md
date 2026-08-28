---
review-cycle: patch
---

Fixed the reviewed-tree capture failing in every repo that ran /review-cycle:init.

init gitignores both the state directory and the opt-out marker, and git add refuses (exit 1, 'paths are ignored by one of your .gitignore files') whenever an exclude pathspec names an existing path that gitignore patterns match — a directory, a file, even an empty directory, and even a directory holding a force-committed file, the common .vscode/settings.json idiom — so the tree snapshot fell back to hash-only in exactly the repos the feature targets, and delta scoping never activated. The capture now drops only the pattern-ignored excludes from its add (judged index-free, so tracked content inside an ignored directory cannot mask the verdict) (git skips those paths anyway, so the tree is byte-identical — measured across three ignore shapes and fifteen worktree shapes), while the remaining excludes keep the add out of directories it must not walk: staging them would abort on an unreadable file and cost time plus garbage blobs proportional to their size. The rm --cached sweep still removes every excluded path from the tree, committed ones included. Found by dogfooding minutes after the 0.16.0 release; regression tests now cover the init'd gitignore shape and a committed excluded file.
