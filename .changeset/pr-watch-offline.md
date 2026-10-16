---
pr-watch: patch
---

pr-watch no longer gives up on your pull requests when GitHub cannot be reached. A dropped connection, a laptop offline, or a 502 to 504 from GitHub's gateway used to show `gh`'s raw error in red at once and count toward the 8 failed reads that end a watch, so some 15 minutes offline stopped every watch and told Claude it had given up. Now the line keeps what it last showed, adds a dim `· offline, retrying` from the second such read, and stays: one read at a time tries GitHub, 15 seconds after the last, doubling up to a minute, and every line drops the note as soon as GitHub answers anything. After 15 minutes out of reach a toast names the host and `gh`'s reason once, in case a host or proxy is wrong. The watch tool says when its first read could not reach GitHub. Other failures, such as a refused token or a missing pull request, still show in red and still end the watch after 8 in a row.
