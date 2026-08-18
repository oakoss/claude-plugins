# Changelog

All notable changes to the `prose` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-17

Initial release. Removes AI filler from Claude's writing with rules distilled from the Google developer documentation style guide.

### Added

- **`Prose` output style** — always-on once selected in `/config`: bans filler phrases and hype vocabulary, enforces active voice, present tense, second person, and condition-before-instruction, and includes a don't-overcorrect floor (contractions, legitimate em dashes, and function words stay). Generation-stable structural tells are covered alongside vocabulary: copula avoidance ("serves as" → "is"), sentence-final "-ing" significance trailers, inanimate-agency subjects, concrete-fact claim endings, and Claude-era phrases ("You're absolutely right"), with a worked register table showing the target voice. A code-comments section applies the same standard at generation time: WHY-only comments, one or two lines, nothing that restates the code or narrates the conversation. Keeps Claude Code's built-in software-engineering instructions via `keep-coding-instructions: true`.
- **`/prose:cleanup`** — a manual rewrite workflow for existing READMEs, docs, PR descriptions, and changelogs: four passes (cut filler, swap words, fix mechanics, check structure) plus read-aloud and self-check verification steps, before/after examples, and a docs-mechanics reference covering headings, lists, procedures, tables, notices, links, code font, placeholders, and UI element conventions.
- **`reference/claude-md-snippet.md`** — the core rules as a copy-paste `CLAUDE.md` block for contexts without output styles.
