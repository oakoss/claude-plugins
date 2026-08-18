---
name: cleanup
description: >
  Rewrites existing text into plain technical prose, removing AI writing artifacts and aligning with the Google developer style guide.
  Use when cleaning up READMEs, docs, PR descriptions, changelogs, commit messages, or any LLM-generated prose before it ships.
license: MIT
metadata:
  author: oakoss
  version: '1.0'
---

# Prose cleanup

A manual rewrite pass that removes AI writing artifacts from existing text and aligns it with plain technical prose. The companion `Prose` output style prevents new artifacts; this skill retrofits text that already exists.

**Scope:** prose only. Never rewrite quoted output, error strings, code identifiers, code blocks, linter or build directives (`eslint-disable`, `noqa`, `@ts-expect-error`), or text you're citing from someone else.

## Workflow

1. Read the whole document first. Note its audience, purpose, and the author's voice; a tutorial tolerates more warmth than a reference page, and the author's own fragments and humor stay.
2. Rewrite line by line. Never run regex replacements — every fix below depends on context. Preserve every fact, name, and number; a cleanup pass never changes meaning — never widen a scoped condition ("only under load" must not become "always") and never round a load-bearing number.
3. Apply the four passes in order: cut filler, swap words, fix mechanics, then check structure.
4. Read the result aloud (or simulate it). Recombine sentences that turned choppy; the goal is plain, not terse.
5. Re-scan the result against passes 1 and 2 before returning — banned patterns that survive the rewrite are the most common failure.

## Pass 1: cut filler

Delete these outright — the sentence almost always survives without them:

| Pattern | Fix |
| --- | --- |
| "Great question!", "Absolutely!", "Sure!" | Delete; answer directly |
| "Let me break this down", "Let's dive in", "Let's get started" | Delete; start the content |
| "please note", "it's worth noting", "keep in mind", "note that" | Delete the hedge; state the fact |
| "at its core", "in essence", "fundamentally", "basically" | Delete; say the thing |
| "please" in instructions | Delete ("To view the document, click **View**") |
| "simply", "easy", "easily", "quick", "quickly", "It's that simple" | Delete; difficulty is the reader's call |
| Filler "just" ("just skips the row") | Delete; keep "just" only to contrast a simpler alternative |
| "In conclusion", "To summarize", "I hope this helps" | Delete, or end with a specific takeaway |
| "at this time", "currently", "as of this writing", "not yet" | Delete; describe what is ("Windows isn't supported") |
| Exclamation points | Period, except direct quotes and code |
| "It's not X, it's Y" | State what it is |
| Hedge stacks ("might potentially") | One qualifier, or none |
| "You're absolutely right", "Honestly?", "Genuinely,", "Full stop." | Delete the theater; state the substance |
| "load-bearing" as a metaphor | Name the actual dependency |
| Sentence-final "-ing" trailers ("…, highlighting the importance of") | End on the fact; cut the trailer |
| Sentences ending in asserted importance | End on a number, date, or mechanism |
| Vague comparisons ("X is better than Y") | Name what causes the difference |
| "The architecture enables…", "this approach unlocks…" | Give the sentence a concrete subject that acts |
| Sentences that would fit unchanged in any other document | Cut, or tie them to this document's specifics |
| "best", "simplest", "fastest", "always", "never" | A verifiable claim, or delete |
| "ensures", "guarantees" | Keep only if literally true; otherwise "helps", or state the actual behavior |
| "prevents attacks", "is secure" | "helps protect against", "is designed to" — the next incident invalidates a security absolute |
| Dramatic ellipses ("wait for it ...") | Delete; ellipses only mark omitted text inside quotations |
| Scare quotes | Delete, or code font for literals; quotes never carry emphasis or irony |

## Pass 2: swap words

Vocabulary tells rotate by model generation — the "delve"/"tapestry" set faded after 2024, while structural patterns (antithesis, copula avoidance, "-ing" trailers, uniform cadence) persist. Weight structure over word lists; Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) is the maintained catalog when this list feels stale.

| Replace | With |
| --- | --- |
| in order to | to |
| serves as, stands as, functions as, boasts | is, has |
| leverage, utilize | use (utilization stays for resource metrics: "CPU utilization exceeds 75%") |
| enables you to, allows you to | lets you |
| via | through, with, by using |
| e.g. / i.e. / etc. | for example / that is / "such as …" with the tail dropped |
| prior to / subsequently / in the event that | before / then / if |
| desired, wish | want, need |
| impacts (verb) | affects |
| functionality | features, or name the capability |
| performant | the actual measurement |
| comprise | consists of, contains |
| vice versa | spell out the reverse case |
| once (meaning after) | after |
| "let's configure…" | "configure…" or "you configure…" |
| we / our (addressing the reader) | you / your |
| check out, refer to (a link) | see ("For more information about X, see Y") |
| and/or | or, and, or "X, Y, or both" |
| slashed alternatives ("developed/hosted") | or / and |
| "key(s)", "file(s)" | pick a number; no "(s)" plurals |
| new, latest, existing, older (of features) | delete, or anchor to a version or date |
| may (possibility) | might or can ("may" only for permission or policy) |
| should | must (required), can (optional), or say who recommends it and why |
| will / would / could | present tense; can |
| delve, tapestry, landscape, journey | the concrete noun you mean |
| robust, seamless, powerful, comprehensive, cutting-edge | a measurable claim, or nothing |
| click here | descriptive link text |

## Pass 3: fix mechanics

- **Active voice.** "The server sends an acknowledgment", not "an acknowledgment is sent." Passive is fine to emphasize the object ("The file is saved"), soften blame ("Over 50 conflicts were found"), or when the actor is irrelevant.
- **Present tense.** Reserve future tense for genuinely future events (a scheduled job that runs later).
- **Condition before instruction.** "To delete the document, click **Delete**", never "Click **Delete** if you want to delete the document." Readers skip what doesn't apply only if the condition comes first.
- **Second person.** The reader is "you"; "the user" is the end user of what the reader builds.
- **No anthropomorphism.** Components specify, detect, return; they don't want, think, or see.
- **Sentence budget.** Under about 25 words; subject and verb early; the point in the first sentence of each paragraph.
- **One term per concept.** Don't alternate between "repo", "repository", and "project" for the same thing.
- **Pronoun antecedents.** If "it" or "this" could point at two things, repeat the noun ("Set this value to true", not "Set this to true").
- **Serial comma**, always: "zones, regions, and multi-regions".
- **Straight quotes only**, double by default. Commas and periods go inside closing quotes, except around quoted literals — and a literal is better in code font anyway.
- **Hyphens.** Compound modifiers before a noun take one ("well-designed app"); after a verb they don't ("the app is well designed"); "-ly" adverbs never do ("publicly available").

## Pass 4: check structure

For READMEs, tutorials, and reference pages, also apply [documentation mechanics](references/docs-mechanics.md) — headings, lists, procedures, tables, notices, links, code font, placeholders, and UI element conventions in full.

- Headings in sentence case, no trailing period. Task headings start with a bare verb ("Create an instance", not "Creating an instance"); conceptual headings are noun phrases — never lead with an "-ing" verb.
- Bulleted list = unordered set; numbered list = sequence; sentence = everything else. A list with one item, or a numbered list of non-steps, becomes prose.
- List items are parallel in structure, and the intro is a complete sentence ending in a colon.
- Parentheses hide information — readers skip them. Promote anything important to the main sentence.
- Semicolons only between closely related independent clauses, or in lists whose items contain commas.
- Vary sentence and paragraph length; three same-shape bullets in a row and uniform 15-word sentences both read as generated.
- One idea per paragraph, key point in the first sentence, 5-6 sentences at most.
- Link phrasing: "For more information **about** X, see Y" — descriptive link text, punctuation outside the link, never "click here" or a raw URL.
- Notes and callouts only for genuinely skippable asides — a step, prerequisite, or must-know fact belongs in the flow, and stacked notices cancel each other out.

## Don't overcorrect

The floor matters as much as the ceiling. Google's own guide quotes Orwell — "Break any of these rules sooner than say anything outright barbarous" — and ranks project-specific style above every rule here; consistency within the document beats any individual fix. Keep:

- **Articles**, even in headings: "Create a VM instance", not "Create VM instance".
- **Contractions** — "isn't" is harder to misread than "is not".
- **Em dashes** used for a genuine break, roughly one per paragraph at most; match the document's existing spacing convention. The artifact is frequency, not the character.
- **Function words** — "update the rules that you defined", "if X, then Y". Google's guide explicitly says to keep "that", "then", and repeated "if"/"both" when they aid parsing. Terseness never beats clarity.
- **Warmth where the genre allows it** — a tutorial can congratulate at a real milestone; a reference page can't.
- **Existing structure** — headers, tables, and code blocks stay; only the prose inside them changes.

## Before and after

Not recommended: "It's worth noting that this powerful API simply leverages caching in order to seamlessly improve performance!"

Recommended: "The API caches responses, which cuts median latency from 120 ms to 15 ms."

Not recommended: "Let's dive into how we can easily configure the desired settings. Please note that the config file will be located in the root directory."

Recommended: "The config file is in the root directory. To change a setting, edit the file and restart the server."
