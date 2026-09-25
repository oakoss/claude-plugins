# prose

Plain technical prose for Claude: rules that remove AI filler ("claudish"), distilled from the [Google developer documentation style guide](https://developers.google.com/style).

## Choose how to use it

Claude Code runs one output style at a time, so the plugin delivers the same rules three ways:

- **To keep another output style, such as Concise, and still apply the rules to every reply**, copy the block in [`reference/claude-md-snippet.md`](reference/claude-md-snippet.md) into a `CLAUDE.md`. Claude Code loads `CLAUDE.md` alongside whichever output style is active. The snippet is a condensed subset: the bans, the main word swaps, the mechanics, and the comment rules.
- **To rewrite text that already exists**, run `/prose:cleanup` on a README, docs page, PR description, or changelog. It works under any output style.
- **To make the rules the output style itself**, select `prose:Prose`. It carries the full rule set, and it replaces whichever style was active.

## What's inside

- **`Prose` output style**: modifies the system prompt so every response follows the rules: no filler phrases, no hype vocabulary, active voice, present tense, second person, condition before instruction. Code comments follow the same standard: written only for a non-obvious WHY the code can't express, one or two lines, never restating the code. It sets `keep-coding-instructions: true`, so Claude Code's software-engineering behavior is unchanged.
- **`/prose:cleanup`**: a manual rewrite pass for text that already exists. It runs four passes (cut filler, swap words, fix mechanics, check structure) above a don't-overcorrect floor. A docs-mechanics reference covers documentation-specific structure.
- **`reference/claude-md-snippet.md`**: the core rules as a copy-paste block for a `CLAUDE.md` or `AGENTS.md`.

## Set up the output style

To select the style, run `/output-style prose:Prose`, or run `/config` and set **Output style** to **prose:Prose**. In a settings file, set `"outputStyle": "prose:Prose"`.

The name must include the `prose:` plugin prefix. `/output-style prose` fails with `Unknown output style "prose"`. Run `/output-style` with no argument to list the available styles.

The style takes effect from your next message, without `/clear` or a new session. Both `/output-style` and `/config` save the choice to the project's `.claude/settings.local.json`, so it applies to that project only. To use the style in every project, set `outputStyle` in `~/.claude/settings.json`.

The style applies to the main conversation only. Subagents run their own system prompts, except forks, which inherit the full parent prompt.

## What it changes

The following table shows the rules applied to two sentences.

| Before | After |
| --- | --- |
| "It's worth noting that this powerful API simply leverages caching in order to seamlessly improve performance!" | "The API caches responses, which cuts median latency from 120 ms to 15 ms." |
| "Let's dive into how we can easily configure the desired settings." | "To change a setting, edit the config file and restart the server." |

The rules cut both ways: they also protect contractions, legitimate em dashes, and function words like "that" and "then". The goal is plain, not terse.

The `review-cycle` plugin bundles its own `de-slopify` skill, which its review cycle applies to diffs. `prose` is independent of it. Install `prose` alone for the rules and ad hoc cleanup, or both for cleanup inside the review cycle too.

## Sources

The ban lists, word swaps, and mechanics come from the Google developer documentation style guide: its tone, word list, active voice, present tense, clause order, second person, translation, and accessibility pages. A second layer covers LLM-specific patterns the guide predates, such as sycophantic openers, "It's not X, it's Y", and uniform rhythm.

That layer draws on Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) catalog and community anti-slop practice: the humanizer and stop-slop skill family, and the [awesome-claude-output-styles](https://github.com/smixs/awesome-claude-output-styles) collection. The generic-sentence test, bare-artifact delivery, and depth-cancels-limits rules come from that collection.
