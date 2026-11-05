---
name: misses
description: Lists the commit gate's refusals, this session's or the ones kept from earlier sessions, of a push, pull request, merge or release that the user's message, or the offer it answered, named, and drafts each as a candidate row for review-cycle's consent grammar spec. Use when the gate refused a step the user seemed to ask for, or to collect consent-grammar misses before fixing the grammar.
allowed-tools: Read
---

# Consent misses

The commit gate reads each message the user types for consent to push, open a pull request, merge or release. When it refuses one of those steps and the user's latest message named that step by its verb, or replied to an offer of it, the refusal may be a miss: the user asked, and the grammar did not read it. The gate keeps this session's, up to 20, and the plugin's store the newest 200 from every session and repository; nothing leaves the machine.

## Steps

1. Call the `mcp__review-cycle__misses` tool. It returns `misses`, this session's, and `recorded`, the newest 20 kept from every session, both least recent first, each with `message` (what the user typed), `offer` (the last lines of the answer their message replied to, or empty), `steps` (the steps named), `refusal` (what the gate said) and `kind`; a recorded one also has its `date` and `repo`. `counts` totals every one kept, and `recordedError`, when present, says why `recorded` is null or why `unsaved` session misses are not in it yet. An entry of `kind` `model` is no refusal: the grammar refused the step, and the model check read the message for it, quoting the words it read. It is a miss all the same, since the grammar should have read it. If the tool does not exist, the gate is switched off in `/config` or did not load: say so and stop.
2. Work from `misses`. When it is empty, say there are none this session and work from `recorded` instead, naming each one's date and repository; when both are empty, say so and stop.
3. For each miss, show the message, the offer when there is one, the steps and the first sentence of the refusal, or the model check's quote for one of `kind` `model`. Then draft the row it suggests for `plugins/review-cycle/hooks/consent.spec.ts`: a request as `['<message>', <GRANT>]`, or, when there is an offer, a reply as `grantOf('<message>', '<offer>')` expecting `<GRANT>`. The offer is the lines the grammar read, so the row reproduces the refusal as the gate saw it.
4. Leave `<GRANT>` for the user to decide. A miss is a candidate, not a verdict: a refusal of a message that only mentioned a step ("did the push fail?") is the gate working. Ask which rows they meant as requests before adding any to the spec.
