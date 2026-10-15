---
pr-watch: minor
---

pr-watch wakes Claude only for news it can act on alone: a failed run, merge conflicts, requested changes, comments and reviews. A pull request turning ready to merge, and a merge's or push's checks passing, now wait for your next message, which carries them to Claude unseen, instead of starting a turn whose answer is "want me to merge?". A ready pull request still wakes Claude where review-cycle's stop-before setting is `release` or `never stop`, since Claude may merge it unasked there; pr-watch reads that setting from the same files review-cycle does.

A ready pull request also suggests `merge #<number>` in the empty prompt box (Tab to take), unless `promptSuggestionEnabled` is off, and a ready pull request or a failed run sends a notification through your notification channel beside the toast. Your next message reads a waiting ready pull request again before calling it ready, so one merged meanwhile is left out; a slash command or another plugin's prompt leaves the news waiting.
