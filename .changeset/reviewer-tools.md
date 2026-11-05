---
review-cycle: patch
---

Each reviewer agent now names the tools it uses (Bash, Read, Edit, Write, Glob, Grep, WebFetch) instead of inheriting every tool in the session, MCP servers included. Every review leg costs about 25k fewer tokens before it starts work: a code-reviewer spawn that did nothing measured 50,215 tokens before and 24,714 after. The spec-conformance reviewer also reads a tm issue with `tm show <key>`.
