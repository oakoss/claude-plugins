---
review-cycle: minor
---

A review fix that changes what code imported by files outside the diff does now counts as substantive, however small, even when it would otherwise pass as mechanical or a verified message fix. The review finds those importers by searching for the end of the module path, whatever prefix comes before it (`/shell["']` matches `./shell`, `../hooks/shell` and an alias, where searching for `shell.ts` or `import.*shell` misses a multi-line import), and names them in its summary. When another iteration runs, it includes the code reviewer and asks it which of those callers behave differently, measured old against new on their existing inputs. A passing suite says nothing about callers when no test covers the old behavior they rely on: a parser fix once changed how a sibling module classified commands, every test stayed green, and only a question about the parser's other callers caught it.
