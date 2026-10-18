---
review-cycle: none
---

The recorded model-check replies now carry the hash of the RULES they answered, and a spec fails when RULES changes without a new recording. `pnpm consent:model` replays them, or with `live` asks the model as the gate does, and scores the consent check against the labeled corpus.
