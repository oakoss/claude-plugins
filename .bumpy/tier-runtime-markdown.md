---
review-cycle: patch
---

Tier agent and skill markdown as runtime, not prose.

The light-tier rule classified every .md path as prose, so a diff rewriting agent bodies or SKILL.md — the plugin's actual behavior — got the reduced fan-out and a 2-iteration cap while the version-bump gate correctly called the same paths runtime. The tier predicate now draws the gate's split: under a plugin directory only README, LICENSE, CHANGELOG, NOTICE, and tests/ are prose; agent bodies, SKILL.md, hook-owned markdown, commands, and reference/ files that skills load tier as code. Two downstream consequences of the same root cause are fixed with it: Phase 7 now sequences cleanup after the report-only reviewers when the diff contains runtime markdown (a rewording mid-read would change what those legs are evaluating), and the cleanup agent's exclusion list names templates, decision tables, thresholds, and rule definitions in runtime markdown as logic it must not de-slopify.
