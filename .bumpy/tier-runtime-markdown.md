---
review-cycle: patch
---

Tier agent and skill markdown as runtime, not prose.

The light-tier rule classified every .md path as prose, so a diff rewriting agent bodies or SKILL.md — the plugin's actual behavior — got the reduced fan-out and a 2-iteration cap while the version-bump gate correctly called the same paths runtime. Markdown a tool loads as instructions now tiers as code wherever it lives: agent bodies, SKILL.md, commands, hook-owned markdown, reference/ files a skill loads, and instruction files like AGENTS.md and CLAUDE.md — so the rule reaches .claude/agents in any repo, not only plugin directories. Under a plugin directory that leaves only README, LICENSE, CHANGELOG, NOTICE, and tests/ as prose, the same runtime split the version-bump gate draws. Two downstream consequences of the same root cause are fixed with it: Phase 7 now sequences cleanup after the report-only reviewers when the diff contains runtime markdown (a rewording mid-read would change what those legs are evaluating), and the cleanup agent's exclusion list names templates, decision tables, thresholds, and rule definitions in runtime markdown as logic it must not de-slopify.
