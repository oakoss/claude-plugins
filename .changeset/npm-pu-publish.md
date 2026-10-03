---
review-cycle: patch
---

`npm pu` is now read as a publish, the release step, as `npm pub` and `npm publish` already were: npm accepts any abbreviation of `publish` from `pu`, so an agent's local `npm pu` no longer publishes without the gate seeing it. `npm p` is not an npm command and stays nothing; a dry run (`npm pu --dry-run`) still runs. Releases from a GitHub workflow never pass through the gate and are unaffected.
