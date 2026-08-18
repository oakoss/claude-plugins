---
title: Prose Patterns
description: Emdash alternatives, phrase replacements, linguistic pattern breaking, and voice calibration techniques for removing AI writing artifacts
tags:
  [emdash, phrases, voice, tone, rhythm, punctuation, hedges, openers, closers]
---

# Prose Patterns

## Emdash Alternatives

LLMs overuse emdashes in places where humans would choose commas, semicolons, colons, or parentheses. The fix is never mechanical; each instance requires reading the sentence and choosing the punctuation that fits.

### Replacement Decision Table

| Emdash Usage                      | Best Alternative        | Why                                                     |
| --------------------------------- | ----------------------- | ------------------------------------------------------- |
| Parenthetical aside               | Commas or parentheses   | "The tool, which is fast, works well"                   |
| Introducing a list or explanation | Colon                   | "One thing matters: speed"                              |
| Joining related clauses           | Semicolon               | "We ship daily; the pipeline handles the rest"          |
| Adding a dramatic pause           | Period and new sentence | Split for clarity                                       |
| Chaining three or more clauses    | Restructure entirely    | Multiple emdashes in one sentence is the strongest tell |

### When Emdashes Are Fine

Not every emdash is slop. Keep an emdash when:

- It creates a deliberate interruption that no other punctuation achieves
- The sentence would lose its punch with a comma or semicolon
- It appears once in a paragraph, not three times in a sentence

The test: if you can read the sentence aloud and the emdash pause feels natural, keep it.

## Phrase Replacement Guide

### "Here's Why" Family

These phrases add a clickbait cadence to technical writing. The fix is to delete the lead-in and start with the explanation.

```text
BEFORE: We chose Postgres. Here's why: it handles our query patterns well.
AFTER:  We chose Postgres because it handles our query patterns well.

BEFORE: Here's why it matters: stale cache entries cause duplicate API calls.
AFTER:  Stale cache entries cause duplicate API calls.

BEFORE: Here's the thing about connection pooling.
AFTER:  Connection pooling has a cost most teams miss.
```

### Contrast Formulas

The "It's not X, it's Y" structure is one of the strongest AI tells. The EQ-bench slop score weights this pattern at 25% of total detection.

```text
BEFORE: It's not just a linter; it's a complete code quality system.
AFTER:  This code quality system goes beyond basic linting.

BEFORE: It's not about speed, it's about correctness.
AFTER:  Correctness matters more than speed here.

BEFORE: This isn't just another framework. It's a paradigm shift.
AFTER:  This framework changes how you structure server components.
```

### Forced Enthusiasm

Delete the enthusiasm. Start with what the reader gets.

```text
BEFORE: Let's dive in! We're excited to help you get started.
AFTER:  Install the CLI and run your first command in under a minute.

BEFORE: Ready to supercharge your workflow? Let's get started!
AFTER:  The setup takes two steps.

BEFORE: We're thrilled to announce our latest feature!
AFTER:  Version 3.2 adds streaming responses.
```

### Pseudo-Profound Openers

These phrases promise depth but deliver nothing. Delete them and start with the actual point.

```text
BEFORE: At its core, React is a UI library.
AFTER:  React is a UI library.

BEFORE: In essence, this approach trades memory for speed.
AFTER:  This approach trades memory for speed.

BEFORE: Fundamentally, the architecture relies on event sourcing.
AFTER:  The architecture relies on event sourcing.
```

### Unnecessary Hedges

Hedges weaken statements. If something is worth noting, just note it.

```text
BEFORE: It's worth noting that the API rate-limits to 100 requests per minute.
AFTER:  The API rate-limits to 100 requests per minute.

BEFORE: It's important to remember that migrations are irreversible.
AFTER:  Migrations are irreversible.

BEFORE: Keep in mind that this only works in Node 20+.
AFTER:  Requires Node 20+.
```

### Robotic Closers

```text
BEFORE: In conclusion, TypeScript improves developer experience.
AFTER:  (delete, or) TypeScript catches the bugs that unit tests miss.

BEFORE: To summarize, we covered three key patterns.
AFTER:  (delete the closer entirely; the reader just read the patterns)
```

## Wordiness and Instruction Patterns

Rules shared with the `prose` plugin's output style and cleanup skill so both apply the same standard — mostly from the Google developer documentation style guide (the claims rows come from its excessive-claims page), plus LLM-era structural additions like the copula swap.

### Word Swaps

| Replace                                  | With                                       |
| ---------------------------------------- | ------------------------------------------ |
| in order to                              | to                                         |
| leverage, utilize                        | use (utilization stays for resource metrics) |
| enables you to, allows you to            | lets you                                   |
| via                                      | through, with, by using                    |
| e.g. / i.e. / etc.                       | for example / that is / "such as ..."      |
| prior to / subsequently                  | before / then                              |
| desired, wish                            | want, need                                 |
| impacts (verb)                           | affects                                    |
| comprise                                 | consists of, contains                      |
| currently, now, soon, not yet            | delete; describe what is                   |
| may (possibility)                        | might or can (keep "may" for permission)   |
| will / would / could                     | present tense; can                         |
| check out, refer to (links)              | see                                        |
| and/or, slashed alternatives             | or, and, or "X, Y, or both"                |
| new, latest, existing (of features)      | delete, or anchor to a version or date     |
| best, fastest, ensures, guarantees       | a verifiable claim, "helps", or delete     |
| serves as, stands as, functions as       | is, has                                    |

### Instruction Mechanics

Active voice and present tense are the default; make the actor explicit.

```text
BEFORE: The service is queried, and an acknowledgment will be sent.
AFTER:  Send a query to the service. The server sends an acknowledgment.
```

Passive stays in three cases: emphasizing the object ("The file is saved"), softening blame ("Over 50 conflicts were found"), or an irrelevant actor.

Condition comes before instruction, so readers can skip what doesn't apply:

```text
BEFORE: Click Delete if you want to delete the entire document.
AFTER:  To delete the entire document, click Delete.
```

Address the reader as "you"; "please" belongs only in requests for an actual favor; don't anthropomorphize software (components specify, detect, and return; they don't want, think, or see).

### Keep Function Words

Terseness is not the goal. Google's guide explicitly keeps "that", "then", "all of the", and repeated "if"/"both" when they aid parsing:

```text
KEEP: Update the rules that you previously defined.
KEEP: If the key is not found, then the default value is returned.
KEEP: Create a VM instance. (articles stay, even in headings)
```

## Linguistic Pattern Breaking

Human writing has irregular rhythm. AI writing is metronomic. Breaking the pattern is as important as fixing individual phrases.

### Sentence Length Variation

Mix short punchy sentences (under 8 words) with longer explanatory ones (15-25 words). If every sentence in a paragraph is 12-18 words, the text reads as AI-generated regardless of vocabulary.

```text
BEFORE (uniform):
The caching layer handles invalidation automatically. The system checks
for stale entries every thirty seconds. The background worker processes
the queue in batches of fifty items.

AFTER (varied):
Invalidation is automatic. The system checks for stale entries every
thirty seconds, and a background worker drains the queue in batches
of fifty. Most teams never touch these defaults.
```

### List Structure Variation

AI defaults to lists of exactly three items, with parallel grammatical structure. Humans produce uneven lists.

```text
BEFORE (AI-typical):
- Improved performance
- Enhanced reliability
- Better developer experience

AFTER (human):
- 40% faster cold starts
- Fewer OOM crashes in production (we saw zero last quarter)
- Autocomplete actually works now
```

### Contractions and Informality

Use contractions where the tone allows. "Don't", "won't", "we're", "it's" signal human authorship. Formal writing that never contracts feels robotic.

### Specificity Over Generics

Replace vague claims with concrete details. Names, version numbers, dates, error codes, and measurements make text feel authored by someone with actual experience.

```text
BEFORE: This significantly improves performance.
AFTER:  p95 latency dropped from 340ms to 90ms after switching to connection pooling.

BEFORE: Many developers find this approach helpful.
AFTER:  Three teams at our company adopted this after the Postgres 16 upgrade.
```

## Voice Calibration

Before editing any document, answer three questions:

1. **Who is writing?** A maintainer speaks differently from a marketing team. An individual contributor writes differently from a VP.
2. **What tone?** Conversational, professional, terse, friendly. Pick one and hold it.
3. **Who is reading?** Fellow engineers tolerate jargon. End users need plain language. Stakeholders want outcomes.

Then maintain that voice consistently. Inconsistent voice across sections is itself a tell; LLMs often shift register between paragraphs because each paragraph is generated semi-independently.

### The Read-Aloud Test

After editing, read the full text aloud. If any sentence makes you pause awkwardly, cringe, or sounds like a chatbot, it needs another pass. A competent developer should be able to read the document without thinking "AI wrote this."
