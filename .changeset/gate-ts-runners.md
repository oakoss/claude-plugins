---
review-cycle: patch
---

The commit gate and the Bash settings check now read `tsx`, `ts-node` and `lua` as code runners, as they already read `node` and `python`. Before, `tsx -e "…git commit…"`, `npx ts-node -e "…git push…"` and `lua -e "os.execute('git commit …')"` ran without the gate seeing the commit or push inside, so an agent running a TypeScript codemod through `tsx` could commit unreviewed. Likewise, `tsx -e` or `lua -e` code that wrote a settings file got past the settings check. Both are now refused like the same code passed to `node -e`. In the commit gate, a runner named as a plain word, as in `git commit -m tsx` or `git push origin lua`, is still read as data. The settings check, as it already did for `node` and `python`, also refuses a command that only reads a settings file while naming one of these runners, such as `rg lua ~/.claude/settings.json`; use the Read tool for that.
