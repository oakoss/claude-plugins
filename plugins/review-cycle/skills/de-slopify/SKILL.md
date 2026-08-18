---
name: de-slopify
description: >
  Removes AI writing artifacts from documentation and code.
  Use when editing LLM-generated prose, reviewing READMEs, polishing docs before publishing, or cleaning up AI-generated code.
  Use for emdash cleanup, formulaic phrase removal, tone calibration, over-commented code, verbose naming, and AI code smell detection.
license: MIT
metadata:
  author: oakoss
  version: '1.0'
---

# De-Slopify

## Overview

De-slopify is a methodology for removing telltale signs of AI-generated content from documentation, prose, and code. LLMs produce statistically regular output with characteristic vocabulary, punctuation habits, and structural patterns that make text and code feel inauthentic. Some patterns appear over 1,000x more frequently in LLM output than human writing.

**When to use:** Before publishing READMEs, after AI-assisted writing sessions, during documentation reviews, when reviewing AI-generated code for over-engineering, before committing prose or code that an LLM touched.

**When NOT to use:** On code logic or algorithms where correctness matters more than style. On technical specifications where precision outweighs voice. On content that was already human-written and reads naturally.

## Quick Reference

| Category    | Pattern                                         | Fix                                                        |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Punctuation | Emdash overuse                                  | Semicolons, commas, colons, or split into two sentences    |
| Phrase      | "Here's why" / "Here's why it matters"          | Explain why directly without the lead-in                   |
| Phrase      | "It's not X, it's Y"                            | "This is Y" or restate the distinction                     |
| Phrase      | "Let's dive in" / "Let's get started"           | Delete; just start the content                             |
| Phrase      | "It's worth noting" / "Keep in mind"            | Delete the hedge; state the fact                           |
| Phrase      | "At its core" / "In essence" / "Fundamentally"  | Delete; say the thing directly                             |
| Vocabulary  | "delve", "tapestry", "landscape", "nuanced"     | Replace with plain, specific language                      |
| Vocabulary  | "revolutionize", "cutting-edge", "game-changer" | Replace with concrete claims or delete                     |
| Structure   | Uniform sentence length throughout              | Mix short (5-word) and long (20+ word) sentences           |
| Structure   | Perfectly balanced lists of exactly 3 items     | Vary list length; humans use 2, 4, or odd counts           |
| Structure   | Generic claims without specifics                | Add names, dates, numbers, or first-person detail          |
| Sycophancy  | "Great question!" / "Absolutely!"               | Delete; answer the question directly                       |
| Meta        | "Let me break this down..." / "Let me explain"  | Delete the preamble; just break it down                    |
| Structure   | Numbered lists where a sentence suffices        | Use a sentence; reserve lists for genuinely parallel items |
| Closer      | "In conclusion" / "To summarize"                | Delete or replace with a specific takeaway                 |
| Phrase      | "please" in instructions / "please note"        | Delete; state the instruction                              |
| Phrase      | "simply", "easy", "quickly" in instructions     | Delete; difficulty is the reader's call                    |
| Wordiness   | "in order to", "prior to", "via", "e.g.", "i.e."| Swap for "to", "before", "with", "for example", "that is"  |
| Vocabulary  | "leverage", "utilize", "enables you to"         | "use", "lets you"                                          |
| Vocabulary  | "currently", "now", "soon", "not yet"           | Delete; describe what is                                   |
| Grammar     | Passive voice, future tense ("will send")       | Active voice, present tense (passive has 3 sanctioned uses)|
| Grammar     | Instruction before condition ("Click X if...")  | Condition first ("To delete the file, click X")            |
| Person      | "we" / "let's" addressing the reader            | "you" or the imperative                                    |
| Claims      | "best", "fastest", "ensures", "guarantees"      | A verifiable claim, "helps", or delete                     |
| Punctuation | Dramatic ellipses, "and/or", "developed/hosted" | Delete drama; "or", "and", or "X, Y, or both"              |
| Vocabulary  | "check out" / "refer to" for links              | "see"; "about", never "on" ("more information about X")    |
| Links       | "click here" / "this document" / raw URLs       | Short descriptive link text; punctuation outside the link  |
| Vocabulary  | "serves as", "stands as", "boasts"              | "is", "has"                                                |
| Structure   | Sentence-final "-ing" trailers ("highlighting") | End on the fact; cut the trailer                           |
| Claude-isms | "You're absolutely right" / "Full stop."        | Delete; state the substance                                |
| Code        | Over-commented trivial functions                | Remove comments that restate the code                      |
| Code        | Unnecessary abstractions and design patterns    | Flatten to the simplest working solution                   |
| Code        | Verbose or overly descriptive variable names    | Use domain-appropriate concise names                       |
| Code        | Defensive error handling on every operation     | Handle errors only where failure is realistic              |

Vocabulary tells rotate by model generation — the "delve"/"tapestry" set faded after 2024. The structural patterns above (antithesis, copula avoidance, trailers, uniform rhythm) persist across generations; weight them over word lists.

## Common Mistakes

| Mistake                                        | Correct Pattern                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Replacing every emdash mechanically            | Evaluate context; sometimes an emdash is the right choice                                  |
| Editing code blocks for style                  | Focus on prose; leave code examples and technical syntax untouched                         |
| Removing all structure to sound casual         | Keep headers, tables, and lists intact; rewrite prose only                                 |
| Over-correcting into choppy fragments          | Read aloud after editing; recombine sentences that lost flow                               |
| Applying fixes without defining target voice   | Set persona, tone, and audience before starting edits                                      |
| Running regex replacements instead of reading  | Manual line-by-line review is required; context determines fixes                           |
| Ignoring AI code smells                        | Review AI-generated code for over-engineering, verbose names, and unnecessary abstractions |
| Removing all LLM-typical words unconditionally | Some flagged words are perfectly natural in context; use judgment                          |
| Stripping linter or build directives           | `eslint-disable`, `noqa`, `@ts-expect-error` are functional, not prose; never remove them  |
| Stripping function words for terseness         | Keep "that", "then", and repeated "if"/"both" when they aid parsing; clarity beats brevity |
| Re-spacing or substituting kept emdashes       | Match the document's existing spacing convention; never substitute an en dash              |

## Delegation

- **Scan a repository for documentation files that need de-slopifying**: Use `Explore` agent
- **Rewrite an entire documentation site to remove AI artifacts**: Use `Task` agent
- **Plan a documentation voice guide and editorial workflow**: Use `Plan` agent
- **Review AI-generated code for slop patterns**: Use `code-reviewer` agent

> For systematic quality auditing across 12 dimensions (architecture, security, testing, performance, etc.), use the `quality-auditor` skill.

## References

- [Prose patterns: emdash alternatives, phrase replacements, and voice calibration](references/prose-patterns.md)
- [Before-and-after examples of common AI writing fixes](references/before-and-after.md)
- [AI slop vocabulary: words and phrases that signal LLM authorship](references/slop-vocabulary.md)
- [Code slop: detecting and fixing AI-generated code smells](references/code-slop.md)
- [Review workflow: prompts, checklists, and integration](references/review-workflow.md)
