---
review-cycle: patch
---

The settings guard reads a JSON file the way Claude Code parses it. Claude Code skips a settings file that is not a strict JSON object, so a file with comments, a trailing comma or a top-level array switches nothing: writing a JSON array whose text mentions `enabledPlugins`, such as a test corpus, is no longer refused. Adding a comment or a trailing comma to a settings file that switches review-cycle is now refused, since Claude Code then skips the whole file and the switch flips. An edit the guard cannot replay is still refused when the file or the edit names a switch.
