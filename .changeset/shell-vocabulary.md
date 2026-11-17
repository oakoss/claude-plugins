---
review-cycle: patch
---

The commit gate and the settings guard read one list of programs that run code they are given. The commit gate now refuses a commit or push handed to `tmux`, `screen`, `su` or `flock`, or to a versioned Python such as `python3.12 -c`, as it already did for `bash -c` and `python3 -c`. The settings guard now treats `perl`, `ruby` and `php` as it treats `python` and `node`: a command that names one of them and a settings file is refused, so `perl -e` can no longer write to `settings.json` unseen. Reading the file through one, or searching it for the word (`grep perl ~/.claude/settings.json`), is refused too, as it already was for `python`.
