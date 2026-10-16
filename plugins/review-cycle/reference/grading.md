# Grading a review leg

How `/review-cycle:review` and `/review-cycle:review-pr` label each leg by what it could actually run. Both skills read this before grading a leg; it is the one copy of these rules.

A _verification_ is a command that exercises this project — its build, test suite, typecheck, linter, schema or manifest validator, or a repro the leg's findings rest on. Reading commands (`git status`, `git diff`, `ls`, `cat`, `find`, `grep`, `rg`) are not verifications: they succeed on a machine where nothing else does.

If either receipt line is absent, or present with nothing after it, the leg is `unknown`. Otherwise read two facts off the receipt:

| line one names a verification that succeeded | `attempted-but-failed:` | label                              |
| -------------------------------------------- | ----------------------- | ---------------------------------- |
| yes                                          | `none`                  | `executed`                         |
| yes                                          | anything else           | `partial (<what was unreachable>)` |
| no                                           | —                       | `static-analysis-only`             |

`execution: none`, a line one naming no verification, and one naming a verification that failed are the same row: a receipt quoting a compile error is `static-analysis-only`, never `executed`. A category the leg says it could not exercise at all also makes it `partial`; a claim it labelled `inferred` does not, since that reflects a budget spent elsewhere, and naming what you inferred must never cost the grade a silent leg keeps.

A leg that was skipped, failed, dropped, or capped carries no execution label: its outcome already says why, and calling it `unknown` would blur "we cannot tell what it did" into "it never ran".

## The Codex leg

**Write the Codex leg's receipt yourself, from its command log**, even when its verdict carries one: call `mcp__review-cycle__codex_log` with its output file. Line one is the heaviest verification among its `succeeded` commands not `guessed`, with an output line; line two lists every verification that `exited`, was `rejected`, stayed `unfinished` or is `guessed`, one whose output lines show it failed despite exit 0, and the project's build or test suite when no command ran it. A `masked` success confirms only its last part; its earlier verifications go on line two. A leg that participated with no commands has `execution: none`. When the tool is missing or answers with an error, read the receipt off its verdict as for any leg.
