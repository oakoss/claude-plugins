---
review-cycle: patch
---

A reviewer's report counts when its execution receipt is marked up. The commit gate counts a review only when the report opens with `execution:` and `attempted-but-failed:` lines, and it dropped a report that wrote them in bold (`**execution:** none`), so a clean review had to run again before the commit went through. Bold or underscored labels, list items and quoted lines now read as the same receipt; a receipt buried below the top of the report still does not count.
