---
pr-kit: patch
---

Ship now ends its report with review-cycle's merge question, when review-cycle is installed: one question for every pull request the run opened or updated that is not a draft, naming each as `owner/name#n`, such as "Squash-merge oakoss/claude-plugins#344 and oakoss/claude-plugins#345?". A "yes" then merges them. Before, the report only said merging was yours to ask for, so a reply that named no pull request, such as "ok, lets merge them", was refused and had to be asked again with numbers. The full name matters: the report's links make a bare `#344` read as a pull request in an unknown repository.
