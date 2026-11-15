---
review-cycle: patch
---

Asking a release or publish command for its help no longer counts as a release. The commit gate refused `oakum release --help` as a release nobody had asked for, so its usage could not be read. A command whose only words after `release` or `publish` are `--help` or `-h` (`oakum release --help`, `npm publish -h`, `cargo publish --help`) now runs, as a bare help request to `gh` already did; any other word beside it keeps it a release.
