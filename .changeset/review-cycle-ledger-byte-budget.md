---
review-cycle: patch
---

The findings ledger now keeps the newest entries that fit in 384 KiB per repository rather than the newest 100. Real entries measured about 470 bytes each, so a busy repository keeps several hundred settled decisions instead of evicting them once it passes 100, which this repository's did after a week; later cycles then re-raised what the evicted entries had settled. Ten repositories' ledgers still fit the plugin store's 4 MiB.
