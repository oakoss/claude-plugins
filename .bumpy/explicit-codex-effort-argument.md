---
review-cycle: minor
---

Added an explicit effort argument to /review-cycle:review and /review-cycle:review-pr that sets the Codex leg's reasoning effort in either direction.

Diff size is a fine input for fan-out breadth but a poor proxy for reasoning depth: a 20-line change to a gate condition classifies as light on line count and previously had Codex capped at low with no recourse. Saying 'effort medium' (or any of none/minimal/low/medium/high/xhigh/max) in the free-form arguments now overrides the tier's cap — raising included, since an explicit per-invocation argument is the user's choice just as the global config is. With no argument, nothing changes: the light tier still lowers one-directionally and respects a configured low/minimal/none. The argument is validated against the closed set of seven literals before anything reaches the Codex invocation; an unrecognized value stops the cycle with the valid set named rather than running a long review at the wrong depth.
