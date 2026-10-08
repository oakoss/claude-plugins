---
name: misses
description: Lists the commit gate's refusals this session of a push, pull request, merge or release that the user's message, or the offer it answered, named, and drafts each as a candidate row for review-cycle's consent grammar spec. Use when the gate refused a step the user seemed to ask for, or to collect consent-grammar misses before fixing the grammar.
allowed-tools: Read
---

# Consent misses

The commit gate reads each message the user types for consent to push, open a pull request, merge or release. When it refuses one of those steps and the user's latest message named that step by its verb, or replied to an offer of it, the refusal may be a miss: the user asked, and the grammar did not read it. The gate keeps up to 20 in memory until Claude Code restarts; nothing leaves the machine.

## Steps

1. Call the `mcp__review-cycle__misses` tool. It returns `{ "misses": [...] }`, least recent first, each with `message` (what the user typed), `offer` (the last lines of the answer their message replied to, or empty), `steps` (the steps named) and `refusal` (what the gate said). If the tool does not exist, the gate is switched off in `/config` or did not load: say so and stop.
2. When the list is empty, say there are none this session and stop.
3. For each miss, show the message, the offer when there is one, the steps and the first sentence of the refusal. Then draft the row it suggests for `plugins/review-cycle/hooks/consent.spec.ts`: a request as `['<message>', <GRANT>]`, or, when there is an offer, a reply as `grantOf('<message>', '<offer>')` expecting `<GRANT>`. The offer is the lines the grammar read, so the row reproduces the refusal as the gate saw it.
4. Leave `<GRANT>` for the user to decide. A miss is a candidate, not a verdict: a refusal of a message that only mentioned a step ("did the push fail?") is the gate working. Ask which rows they meant as requests before adding any to the spec.
