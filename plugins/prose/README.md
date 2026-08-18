# prose

Plain technical prose for Claude: an always-on output style and a cleanup skill that remove AI filler ("claudish"), distilled from the [Google developer documentation style guide](https://developers.google.com/style).

## What's inside

- **`Prose` output style** — modifies the system prompt so every response follows the rules: no filler phrases, no hype vocabulary, active voice, present tense, second person, condition before instruction. Code comments follow the same standard: written only for a non-obvious WHY the code can't express, one or two lines, never restating the code. Sets `keep-coding-instructions: true`, so Claude Code's software-engineering behavior is unchanged.
- **`/prose:cleanup`** — a manual rewrite pass for text that already exists: READMEs, docs, PR descriptions, changelogs. Four passes (cut filler, swap words, fix mechanics, check structure) plus an explicit don't-overcorrect floor, with a docs-mechanics reference for documentation-specific structure (headings, lists, procedures, tables, notices, placeholders, UI elements).
- **`reference/claude-md-snippet.md`** — the core rules as a copy-paste block for a `CLAUDE.md`, for contexts where the output style doesn't load.

## Setup

Install the plugin, then select the style once:

1. Run `/config` and set **Output style** to **Prose**. (Or set `"outputStyle": "prose:Prose"` in a settings file — plugin styles are namespaced as `plugin:style`.)
2. It takes effect on the next session or after `/clear`, and stays on — nothing to invoke per session.

The style applies to the main conversation only; subagents run their own system prompts (forks excepted — they inherit the full parent prompt).

## What it changes

| Before | After |
| --- | --- |
| "It's worth noting that this powerful API simply leverages caching in order to seamlessly improve performance!" | "The API caches responses, which cuts median latency from 120 ms to 15 ms." |
| "Let's dive into how we can easily configure the desired settings." | "To change a setting, edit the config file and restart the server." |

The rules cut both ways: the style also protects contractions, legitimate em dashes, and function words like "that" and "then" — the goal is plain, not terse.

Related: the `review-cycle` plugin bundles its own `de-slopify` skill, which its review cycle applies automatically to diffs. `prose` is independent of it — install this plugin alone for the always-on style and ad-hoc cleanup, or both for cycle-integrated cleanup too.

## Sources

The ban lists, word swaps, and mechanics come from the Google developer documentation style guide (tone, word list, active voice, present tense, clause order, second person, translation, and accessibility pages), plus a layer of LLM-specific patterns the guide predates (sycophantic openers, "It's not X, it's Y", uniform rhythm). The LLM layer draws on Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) catalog and community anti-slop practice — the humanizer/stop-slop skill family and the [awesome-claude-output-styles](https://github.com/smixs/awesome-claude-output-styles) collection (the generic-sentence test, bare-artifact delivery, and depth-cancels-limits rules come from there).
