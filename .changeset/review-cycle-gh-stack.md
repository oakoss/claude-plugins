---
review-cycle: minor
---

The commit gate reads github/gh-stack's `gh stack` commands instead of refusing every one as an unknown extension. Moving around a stack (`view`, `checkout`, `up`, `down`, `top`, `bottom`, `trunk`), `init`, `add` with no options and `unstack --local` run as they are. `rebase` and `sync` rewrite commits as `git rebase` does, so each runs as its own command and its replayed commits are not reported as unreviewed. An option written before the stack command is refused, since its value could hide which command runs. `push`, `sync` and `submit` push every active branch of the stack with `--force-with-lease`, so they need a request for a forced push; `submit` and `link` also open pull requests and are judged as one. `gh stack merge` is refused for now, since it merges every pull request below its target; `rebase --continue`, which commits a conflict's resolution, `add` with an option, `unstack`, `modify` and `switch` are refused with what to run instead.
