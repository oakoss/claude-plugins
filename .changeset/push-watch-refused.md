---
pr-watch: patch
---

A push whose reads GitHub refuses (a bad token; a token missing a scope or not granted the repository; an organization's SAML SSO, IP allow list or OAuth app restrictions; a repository gh's account cannot see; or, on github.com, no gh login at all) no longer stops being watched silently after 90 seconds, even when a later read fails another way. It retries like a pull request's line and, after 8 failed reads, toasts and tells Claude that pr-watch stopped watching it. A push to a host that is not GitHub still leaves quietly once its 90 seconds are up.
