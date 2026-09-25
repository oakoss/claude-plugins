# Changelog

All notable changes to the `prose` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.1.2 (2026-09-25)

### Fixed

The README now leads with how to use the rules alongside another output style. Claude Code runs one output style at a time, so if you use Concise or another style, copy the block in `reference/claude-md-snippet.md` into a `CLAUDE.md`: it loads alongside whichever style is active. Use `/prose:cleanup` to rewrite existing text under any style, and select the `prose:Prose` output style when you want the full rule set to replace the active style. The plugin and marketplace descriptions now name the output style, the snippet, and the cleanup skill instead of an always-on style. (cpl-1bx)

The setup instructions are corrected. The style takes effect from your next message, without `/clear` or a new session. It is selected with `/output-style prose:Prose` or through `/config`. The name needs the `prose:` prefix, since `/output-style prose` fails with `Unknown output style "prose"`; `/output-style` with no argument lists the available names. Both `/output-style` and `/config` save the choice to the project's `.claude/settings.local.json`, so it applies to that project only. The cleanup skill's frontmatter no longer carries a `version` of `1.0` that disagreed with the plugin's version. (cpl-1bx)

The output style now follows its own rules, so the cleanup skill no longer "fixes" it. The condition-before-instruction example bolds **Delete** in the style and the snippet, as the bold-UI-names rule requires. The generic-sentence test, in both the style and the cleanup skill, keeps a rule, a definition, or a general fact the reader needs, where read literally it deleted the style's own rules. The long code-comments bullet is split into three under the 25-word budget, and `docs-mechanics.md` no longer ends a series with an ellipsis. (cpl-v6c)

## 0.1.1 (2026-09-17)

### Added

`plugins/prose/tests/prose-rule-anchors.bats` pins the rules above, because nothing in this repository read the prose plugin's runtime markdown. A mutation run reverted each of the five rule changes in turn, and separately inverted two rules outright to "Exclamation points are encouraged; use at least one per paragraph" and "Always run regex replacements": every mutant passed the checks that existed before this suite — `bin/run-bats`, `claude plugin validate --strict`, `markdownlint-cli2`, and `oakum check --strict`. Truncating `output-styles/prose.md` to zero bytes also passed validation, which inspects the manifest and the skill's frontmatter but never the output style.

Its 17 tests fail on each of those seven mutants, on a rename that breaks the skill's citation, and on the partial reverts a first version of the suite let through — among them a ban list whose words are moved into a permissive sentence, a second `would / could` row added beside the corrected one rather than replacing it, the superlatives exception dropped while its subject is kept, a divergent fourth copy of the scope statement added anywhere under the plugin, a copy whose scope statement is moved below the rules it governs, and a hype word added to one copy alone. It stays quiet on a stray `.orig` from a conflicted merge and on gitignored markdown under the plugin, both of which an earlier filesystem walk reported as divergent copies. Two ceilings are measured rather than assumed, and the suite header names both: an anchor kept verbatim while the prose below it says the opposite still passes, and byte-identity across the three copies proves they agree rather than that they are right.

### Changed

The superlatives rule now governs claims about behavior rather than instructions, in all three copies. Twelve lines of `prose.md` use "never" or "always" as imperatives, which the rule as written condemned as unverifiable claims.

### Fixed

The cleanup skill rewrote documents that were already correct, because five of its rules diverged from the Google developer style guide or from each other. A style guide its own cleanup skill wants to rewrite is a defect in one of the two. Measured on this branch in one differential run against the plugin's own `output-styles/prose.md`: the old rules rewrote 51 lines, the new rules 2. Applying a skill is not deterministic, so the counts vary between runs; the mechanism behind them does not. The old run destroyed the entire word-swap list — `in order to → to` became `to → to`, and all 17 entries went the same way — because every entry leads with the banned term.

The list-introduction rule dropped two exemptions Google's lists page states. Verified against that page: an introduction "can end with a colon or a period", and "if the list doesn't need any additional context other than the heading that immediately precedes the list, it's OK to not introduce a list with an introductory sentence." The plugin stated the rule three times, absolutely, and carried neither exemption. Heading-then-bullets is the dominant README shape — every one of the 12 sections in the skill's own `docs-mechanics.md` uses it, along with 5 lists in `prose.md` — so this rule alone rewrote most documents a user pointed cleanup at. All three statements now carry both exemptions. The colon-or-period clause is byte-identical, and describes the colon as Google does: usual immediately before a list, not required. The heading exemption is stated in each file's own voice. The table and code-block requirement is unchanged and now gives its reason — not all screen readers preannounce tables — because Google's tables page states that requirement unconditionally and its single-table exemption covers captions, not introductions.

The scope exemption could not reach the rules it must govern. It sat as the last line of `prose.md`, 43 to 78 lines after the ban list and word-swap list, and read "Don't rewrite quoted output ..." while those sections are generation rules ("Never write ...", "X → Y"). Under the literal text a model could not reproduce a test failure string containing an exclamation point, and the file broke this on three of its own lines. Three copies existed with three different scopes: the always-on one used the softest verb ("Don't rewrite" rather than "never rewrite"), and the copy-paste snippet enumerated three exemption categories against the skill's six. One statement now governs prose you write as well as prose you rewrite, sits above the rules rather than below them, and is byte-identical across `prose.md`, `SKILL.md`, and `claude-md-snippet.md`. It also covers an example quoted to illustrate a rule, including an example of what not to write — a gap the original had too, which left every bad example in a style guide unprotected from its own cleanup pass.

Pass 2 revoked an exception Pass 3 granted. Pass 2 carried an unconditional `will / would / could → present tense` row; Pass 3 granted "Reserve future tense for genuinely future events"; step 5 re-scanned against passes 1 and 2 after Pass 3, so the exception was granted and then revoked, and step 5 won by running last. "Would" and "could" are not future tense either, so the row caught conditionals — two correct subjunctives in `prose.md` were condemned by it. The row now covers "will" alone and carries the exception, step 5 skips what a later pass licensed, and all three copies state the exception rather than banning future tense outright.

The hype lists diverged, so cleanup could not enforce the style. `prose.md` banned "game-changer", "crucial", and "vital", which neither cleanup list carried, so cleanup left them in text the style forbids generating; cleanup banned "journey", which the style permitted. The output style's "Never write" section is now the canonical list, `journey` included, and the skill names it as the authority while still carrying the words itself — `AGENTS.md` requires a skill to be self-contained, and a bare cross-file link degrades to citing nothing if the target moves. What keeps the two from drifting is a test comparing them as sets rather than checking that each contains the expected words: a subset check passes when a word is added to one copy and not the other, which is the direction this defect was filed in.

## [0.1.0] - 2026-08-17

Initial release. Removes AI filler from Claude's writing with rules distilled from the Google developer documentation style guide.

### Added

- **`Prose` output style** — always-on once selected in `/config`: bans filler phrases and hype vocabulary, enforces active voice, present tense, second person, and condition-before-instruction, and includes a don't-overcorrect floor (contractions, legitimate em dashes, and function words stay). Generation-stable structural tells are covered alongside vocabulary: copula avoidance ("serves as" → "is"), sentence-final "-ing" significance trailers, inanimate-agency subjects, concrete-fact claim endings, and Claude-era phrases ("You're absolutely right"), with a worked register table showing the target voice. A code-comments section applies the same standard at generation time: WHY-only comments, one or two lines, nothing that restates the code or narrates the conversation. Keeps Claude Code's built-in software-engineering instructions via `keep-coding-instructions: true`.
- **`/prose:cleanup`** — a manual rewrite workflow for existing READMEs, docs, PR descriptions, and changelogs: four passes (cut filler, swap words, fix mechanics, check structure) plus read-aloud and self-check verification steps, before/after examples, and a docs-mechanics reference covering headings, lists, procedures, tables, notices, links, code font, placeholders, and UI element conventions.
- **`reference/claude-md-snippet.md`** — the core rules as a copy-paste `CLAUDE.md` block for contexts without output styles.

Generated by oakum 0.4.0.
