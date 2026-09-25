---
prose: patch
---

The README now leads with how to use the rules alongside another output style. Claude Code runs one output style at a time, so if you use Concise or another style, copy the block in `reference/claude-md-snippet.md` into a `CLAUDE.md`: it loads alongside whichever style is active. Use `/prose:cleanup` to rewrite existing text under any style, and select the `prose:Prose` output style when you want the full rule set to replace the active style. The plugin and marketplace descriptions now name the output style, the snippet, and the cleanup skill instead of an always-on style. (cpl-1bx)

The setup instructions are corrected. The style takes effect from your next message, without `/clear` or a new session. It is selected with `/output-style prose:Prose` or through `/config`. The name needs the `prose:` prefix, since `/output-style prose` fails with `Unknown output style "prose"`; `/output-style` with no argument lists the available names. Both `/output-style` and `/config` save the choice to the project's `.claude/settings.local.json`, so it applies to that project only. The cleanup skill's frontmatter no longer carries a `version` of `1.0` that disagreed with the plugin's version. (cpl-1bx)

The output style now follows its own rules, so the cleanup skill no longer "fixes" it. The condition-before-instruction example bolds **Delete** in the style and the snippet, as the bold-UI-names rule requires. The generic-sentence test, in both the style and the cleanup skill, keeps a rule, a definition, or a general fact the reader needs, where read literally it deleted the style's own rules. The long code-comments bullet is split into three under the 25-word budget, and `docs-mechanics.md` no longer ends a series with an ellipsis. (cpl-v6c)
