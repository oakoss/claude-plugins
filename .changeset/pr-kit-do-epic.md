---
pr-kit: minor
---

New `/pr-kit:do-epic` skill: type "do epic <id>" (or `/pr-kit:do-epic <id>`, adding "as drafts" for draft pull requests) and the agent runs that beads epic to open pull requests without asking anything until its report. It plans the epic's beads into branches and records the plan in the epic's notes, then implements, reviews and commits each branch in turn. Independent branches ship as their own pull requests, and dependent ones as a gh-stack stack. It drives CI to green with `fix-ci`, then reports each pull request with its beads, CI state and review rounds, plus shelved beads, deferred findings, questions and refusals. A bead it cannot finish is stashed and left open, and the skill never merges. It needs review-cycle and `bd`.
