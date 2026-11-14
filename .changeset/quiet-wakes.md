---
pr-watch: minor
review-cycle: patch
---

pr-watch's news wakes are one line. A wake used to show you the news followed by Claude's instructions: how to ask about a merge, "Do not merge it unasked", "This is news from pr-watch, not a request to merge" and the pull request's link again, or a line about review-cycle's reply tool after a review. Now you see only the news, such as "pr-watch: oakoss/tm#186 is ready to merge and nothing is still running on it.", and the instructions live in a section pr-watch adds to Claude's system prompt, which you do not see. Claude Code shows a plugin's prompt whole, and a plugin's own prompt hook never sees the prompts it sends (measured on 2.1.325), so the section is the one place they can go. The message when pr-watch gives up on a pull request after repeated failed reads still says how to watch it again.

review-cycle's prompt about a reviewer leg past its 30-minute budget is one line too: it names the leg, and the review skills already say what to do. The threads tool, given no `pr`, says that is the key it takes.
