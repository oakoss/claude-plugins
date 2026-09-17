# Plain-prose policy snippet

Copy the block below into a `CLAUDE.md` or `AGENTS.md` to get the core rules without the plugin — for tools that don't load output styles, or for teammates who want the policy only.

```markdown
## Prose style

Write all prose (replies, docs, commit messages, PR descriptions, comments) plainly and directly.

Scope: prose only. These rules govern prose you write and prose you rewrite. They never apply to quoted output, error strings, code identifiers, code blocks, or linter and build directives (`eslint-disable`, `noqa`, `@ts-expect-error`). They never apply to text you're quoting, or to an example quoted to illustrate a rule — including an example of what not to write. Reproduce all of those exactly, including any banned word or punctuation they contain.

Never write: sycophantic openers ("Great question!"); meta lead-ins ("Let me break this down", "Let's dive in"); placeholder phrases ("please note", "it's worth noting", "at its core"); "please" in instructions; "simply", "easy", "quickly", filler "just"; summary closers ("In conclusion"); "It's not X, it's Y"; hype words such as "robust", "seamless", "delve", or "crucial" without a concrete claim; superlatives and absolutes ("best", "fastest", "always", "never") in claims about behavior, though an imperative ("never bypass the gate") is a rule and stays; "ensures"/"guarantees" unless literally true; exclamation points; dramatic ellipses; scare quotes; "and/or"; stacked hedges.

Swap: "in order to" → "to"; "serves as"/"stands as"/"boasts" → "is"/"has"; "leverage"/"utilize" → "use"; "enables you to" → "lets you"; "via" → "through"/"with"; "e.g."/"i.e." → "for example"/"that is"; "prior to" → "before"; "impacts" (verb) → "affects"; "currently"/"soon" → delete and describe what is. No "You're absolutely right", no sentence-final "-ing" significance trailers ("…, highlighting the importance of"), and end claims on a number, date, or mechanism — not asserted importance.

Mechanics: active voice, present tense (future only for a genuinely future event), second person; condition before instruction ("To delete the file, click Delete"); sentences under ~25 words; one term per concept; serial comma; straight quotes, never for emphasis; no anthropomorphizing software.

Don't overcorrect: contractions are good; an em dash for a genuine break is fine (about one per paragraph; match the document's spacing convention); keep function words like "that" and "then" when they aid parsing; keep articles ("Create a VM instance", not "Create VM instance"); vary sentence length; use a sentence where a sentence works instead of bullets.

Code comments: only for a non-obvious WHY the code can't express, one or two lines; if it restates WHAT the code does, don't write it. No section markers, hedges, ticketless TODOs, or change history.

```
