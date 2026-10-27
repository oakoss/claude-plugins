---
review-cycle: none
---

The Bash and Monitor hooks ask everything they need of a command through one reading, `readCommand` in `command.ts`, which works out each answer only when a hook asks for it. The git alias configuration is parsed there too. No verdict changes.
