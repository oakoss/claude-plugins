---
review-cycle: patch
---

A commit or push can now end in a pipe into `tail` or `wc`. For example, `git push 2>&1 | tail -3` or `git commit -F msg | tail -n 20 | wc -l` is judged exactly as it would be without the pipe, where it used to be refused, and you had to run it again without the pipe. `tail` may take one line or byte count, nonzero or `+N`, and `wc` its counting flags (`-l`, `-c`, `-w`, `-m`), so both read everything git printed. Some shapes are still refused:

- a filter that may stop reading early or read a file instead, such as `head`, `grep`, `cat file`, `tail -3 log` or `tail -n 0`, which can kill a pre-commit hook still printing, so git aborts while the pipeline reports success;
- a filter that can run or write something, such as `sh`, `sed`, `tee` or `xargs`;
- a pipeline backgrounded with `&`, which would outlive the gate's check after the command;
- any other command joined to a commit by a pipe.

The review skill's canonicalize phase now formats every file type your pre-commit hook rewrites, not only the ones a check script covers. It reads the hook config's globs, so a commit no longer records a reformatted JSON file that no reviewer saw.
