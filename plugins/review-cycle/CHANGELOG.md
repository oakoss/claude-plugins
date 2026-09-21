# Changelog

All notable changes to the `review-cycle` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.18.1 (2026-09-21)

### Added

`review-sentinel delta` lists every path whose content differs from the marked tree, which after a branch switch or a pull mixes work you have not reviewed with the difference between two branches. Measured: a two-file change on a switched branch reported nine files; a one-file change after a merge reported five, four of them the other branch's already-reviewed work. The cycle hands that list to reviewers as their scope.

The delta now adds one line on stderr when the marked tree and HEAD differ, naming how many paths that covers, so the reader knows some of the list reflects history this session did not author. `/review-cycle:review` relays that instead of claiming the rest of the diff matches the reviewed state. When it cannot tell, it says so; that is distinguished from "no differences", because a failed probe and an empty result both produce an empty stream.

**The list itself is untouched — deliberately.** An earlier attempt filtered it down to paths git reports as modified, staged or untracked. Two rounds of review kept finding files that filtering dropped: pathnames git C-quotes (`é`, tab, `"`, `\`), a file untracked at the mark and then deleted, a truncated record stream, a partial write to the path set, and every path at all when the membership test errored — each at exit 0 with nothing on stderr, while the consumer contract told reviewers the rest of the diff was already reviewed. It was also quadratic: 26 seconds at 2000 changed paths, against 0 before.

Filtering can lose work; annotating cannot. A failed probe now costs a line of advice rather than a file.

### Fixed

The Codex preflight recorded auth as `confirmed` whenever `codex login status` exited 0, and the summary reported that word to the user. The probe does not exercise the credential — its verdict is a pure function of whether `auth.json` exists and parses — so `confirmed` was a claim the cycle had no evidence for.

Measured on codex-cli 0.155.1, three times independently during review: the probe printed `Logged in using ChatGPT` and exited 0 while the refresh token had been revoked server-side. The cycle recorded `confirmed`, spawned the Codex leg, and the leg died against `401 Unauthorized`. The probe prints the identical line and exit code after re-authenticating, and prints it again for an `auth.json` containing only `{}` — nothing in its output distinguishes a working credential from a revoked one, or from no credential at all.

The exit-0 outcome is now `stored session (not exercised)` in `/review-cycle:review`, `/review-cycle:review-pr`, and the plugin README. `/review-cycle:init` stopped printing `✓ authed` for it, which was the same promise in stronger words, and its glyph legend now covers observed-but-not-verified.

One sentence was removed for being false rather than imprecise. Both review skills justified reading a failed leg's status from the completion notification "not from the output file, where a crashed run and a clean run look alike". Measured: the output file records `[exited with code N]` on both, so it is strictly more informative than the notification, which flattens a rejected credential, a rate limit, a sandbox denial and a signal death into the same integer. Both skills now say the exit code reports whether the leg failed and the output file reports why, and both open that file before composing the failure message.

`tests/codex-auth-anchors.bats` anchors the vocabulary across the four files. Its anchors were chosen by mutation rather than by eye, and it states what it checks rather than claiming coverage: a rewrite that keeps every anchored phrase while changing what the surrounding rule means still passes, and no grep can close that.

Phase 1 still makes no API call. Exercising the credential on every review would spend a real request to catch a rare failure.

Deliberately not included: classifying *which* credential a 401 rejected, and the retry and remedy rules that would follow from it. A first attempt shipped that machinery and review found it repeatedly unsound — a branch written for a state the harness makes unreachable, and a recognizer that would fire on a non-fatal `401 Unauthorized` from a subsystem unrelated to auth, at the cost of the leg's retry. It needs its own design pass rather than a widening patch on this one.

A grep that answered the startup probe and then misanswered turned the commit gate off without a word. `dep_probe_grep` tests both directions at startup, but `DEPS_OK` caches that verdict and every later guard trusts it, so `parse_has_commit` read every command as harmless and the gate took the bare exit 0.

Measured with three greps that each pass the startup probe — one reporting "no match" for everything, one misanswering only extended regexes (the mode every verb decision uses), one misanswering a single fixed pattern. Before, on trees both gates deny: exit 0, zero bytes on stdout and zero on stderr, indistinguishable from a pass. After: both gates print one line naming grep and exit 1, and the command proceeds.

Three changes:

- **`parse_has_commit` confirms its own miss along both axes.** A fixed-string miss is confirmed twice — with a needle drawn from the searched text, which varies the pattern, and by re-asking the literal that missed, which varies the haystack. An extended-regex miss re-asks that same pattern about text built to match it, because a five-byte probe cannot vouch for a 250-byte regex. A miss it cannot confirm returns a third code.
- **A gate that cannot tell whether this is a commit stands down instead of ruling.** On the third code both gates report and exit 1, which is non-blocking. Continuing would let a broken grep deny an ordinary Bash call on an answer nothing computed — the trap fail-open exists to avoid.
- **A grep error is no longer read as absence, and the raw-payload fallback matches the prefilter again.** While a dependency is broken the fallback tested only for the literal verb, so a JSON-escaped one (`commit`) reached a quiet exit 0 with the diagnostic stranded in the debug log. It now carries the prefilter's backslash arm.

You see a diagnostic where you previously saw nothing, and a command carrying a backslash is noisy rather than silently denied while grep is broken. A healthy grep is unaffected: measured across 29,284 command strings — the test corpus, an exhaustive three-byte prefix sweep, and random-byte fuzz — the new code returns the same answer as the old one on every input, and never reports an unconfirmable miss.

Known gap: a grep whose fault keys on the *length or bytes of the text being searched* rather than on the pattern still defeats the extended-regex confirmation. Closing it needs the confirmation to re-ask about the failing input itself, which changes how the parser buffers stdin; that is tracked separately.

## 0.18.0 (2026-09-17)

### Added

`tests/gate-dependency-faults.bats` covers 23 gate-and-tool pairs across six fault modes each — `cat`, `jq`, `git`, `grep`, `sed`, `awk`, `date`, `tr`, and `sort`, per gate, for every tool that gate depends on — plus the root-discovery path taken when `CLAUDE_PROJECT_DIR` is unset, a payload whose verb is JSON-escaped, a lib that cannot be loaded, and a broken `jq` reading as an opt-out.

Two further fault modes keep git healthy and break only what it says about one repository: one refuses `--is-inside-work-tree`, one returns an empty `--show-toplevel`. They exist because every other mode breaks git globally, so the liveness branch rejects the shim and the rooted probe never runs — deleting that probe's entire branch left the suite green while the commit gate silently passed an unreviewed tree. Their cells run against a clean fixture and assert a quiet pass first, because on a drifting tree both gates deny for drift and the probe's contribution is invisible.

The suite constrains both directions. Asserting only "not silent" cannot catch a gate that has become too loud, and that is not hypothetical: a probe of this change compared against `'probe'` while `git rev-parse --sq-quote` prefixes its output with a space, so every probe failed, every pass-through exited 1, and an earlier version of this suite still passed — `.claude/hooks/version-bump-gate.bats` caught it by asserting `exit 0` on the no-op cases. The suite now separates a quiet success from a bare nonzero exit and carries its own pass-direction controls.

Verified by mutation, each figure the count of failing tests: making every pass-through exit 1 fails 4, making every one exit 0 fails 8, gutting the diagnostic reporter fails 9, deleting the rooted branch of the git probe fails 2, letting the two prefilter copies drift fails 2, removing the Stop gate's clock probes fails 1, and reverting the opt-out hardening fails 1.

Three weaknesses in the suite's own assertions were measured and closed. `assert_never_silent` rejected only a silent pass, so a gate that exited nonzero while printing nothing satisfied every matrix cell, and gutting the diagnostic reporter cost a single test. It now requires a deny or a diagnostic, and that mutation fails 9. The classifier grepped stdout for the decision token rather than parsing it, so a payload with a stray line before it — whose decision a hook runtime discards — still graded as a block; it now parses with `jq`, which also reads the Stop hook's different verdict shape through the same path. And the column floor filtered unknown tool names through a hardcoded allowlist, so declaring a dependency with no probe passed the floor while the live hook failed on every call with `no probe defined`; it now requires a `dep_probe_<tool>` for every declared tool, and an unknown name fails the test rather than being filtered out of it.

The suite also guards itself: one test proves the classifier still reports silence and still distinguishes a bare nonzero exit, one fails if the global kill-switch would make every gate exit 0, and floors fail if either fault-mode list collapses. `HOME` is deliberately not redirected, because a mise-shimmed `jq` under an unfamiliar `HOME` exits 0 with no stdout and would inject this suite's own fault into every cell at once.

### Changed

**A gate that cannot run now exits 1 rather than 0, which is a user-visible change in behaviour.** Stderr from a hook that exits 0 reaches the debug log only, never the transcript, so a diagnostic printed alongside `exit 0` would have been invisible — a first version of this change did exactly that and graded itself as fixed. Exiting non-zero and not 2 is a non-blocking error: the action proceeds, preserving the fail-open policy, and where the hook emits no valid JSON the transcript shows a hook error notice carrying the first line of stderr. The consequence is that a genuinely broken `jq` or `git` now raises a visible notice on ordinary Bash calls until it is fixed, which is the point, but it is noisier than silence. (The transcript behaviour is verified against the hooks reference at code.claude.com/docs/en/hooks, not measured in-harness; it is the load-bearing unverified claim in this change.)

Each gate names its own consequence in that line, because only the first line surfaces and it is the whole message. The Stop gate used to report that "the commit was not checked" when no commit is in play; it now says unreviewed changes were not detected.

Being first is part of the contract, not a given. A probe pipeline that redirects only the tool's stderr still lets bash print its own job-control line when the tool is killed by a signal, and that line arrives first: measured, a `grep` killed by SIGTERM put bash's own `Done`/`Terminated` job report where the diagnostic should have been, and the gate's message second. Each probe pipeline is brace-grouped with its own redirect, which drops the job message and leaves the status untouched — verified across 47 cells, where old and new forms returned identical exit statuses in every one.

**Both commit gates are faster than before this change, not slower**, which is not what adding six probes to each would suggest. Folding the `jq` known-answer question onto the extraction call removes a process per gate, and on a machine where `jq` resolves to a mise shim that process dominates everything else the gate does.

Measured on a payload containing a double quote — the common case, since the prefilter's backslash arm passes any command carrying one. Three separate batch runs disagreed on the commit gate's sign, so the numbers below come from interleaving the two versions call by call, 40 calls each, which spreads background load across both arms: the version-bump gate's median went from 228.0 to 152.8 ms per call and the commit gate's from 219.5 to 149.4 ms (means 233.6 → 156.4 and 225.6 → 155.4). Both gates fire on the same `PreToolUse`, so an ordinary Bash call carrying a quoted string spends roughly 145 ms less in gates than before. A single non-interleaved batch is not reliable enough to reproduce this: one such run put the commit gate 40 ms slower.

The global kill-switch now suppresses everything. `~/.claude/.disable-review-gate` is tested before the prefilter and before the source loop in all three gates, not merely before the probes. With the kill-switch set and the plugin's libs unreachable, the commit and Stop gates used to exit 1 with a diagnostic on every Bash call carrying a backslash and on every Stop — measured at 207 and 191 bytes of stderr, with no way to turn it off. Both are silent now.

The commit gate's cheap prefilter skips the whole gate when the payload cannot be a commit. It tests the raw payload for the literal `commit` **or a backslash**, because a JSON unicode escape standing in for one of the verb's letters decodes to `commit` only after `jq` reads it — an earlier form tested for the literal alone and turned a real deny into a silent pass, measured in both gates. The backslash arm is a partial filter rather than a narrow escape hatch: any payload whose command contains a double quote passes through.

The version-bump gate derives the plugin name with parameter expansion instead of `sed`, removing a dependency rather than probing it: a dead `sed` used to empty every plugin name, which the loop read as "no plugin affected". Its three coverage answers — plugin.json bumped, marketplace.json bumped, bump file staged — all come from a `grep`, and one stuck at 0 answered yes to all three and waved the commit through. Each is now re-confirmed by scanning the staged diff with bash patterns, no `grep` involved.

`plugins/review-cycle/tests/helpers.bash` and `.claude/hooks/version-bump-gate.bats` now export `GIT_CONFIG_NOSYSTEM=1` alongside their fake `HOME`. Isolating `HOME` alone left `/etc/gitconfig` in play, and on macOS that carries `credential.helper=osxkeychain`; fixture git then hunted a keychain under the fake `HOME`, found none, and macOS prompted to reset one — once per run, hundreds of git invocations deep.

`session-init.sh` and `posttool-slop.sh` were audited and gained no probes; the only change to either is the `cat` removal above. Measured with a `jq` stuck at exit 0: `session-init.sh` exits 0 leaving the mark unchanged, failing toward the gate staying armed; `posttool-slop.sh` emits nothing where a working `jq` emits its advisory context, losing that advice without opening a gate or blocking anything. Neither has a silent-allow path. One residual is known and unfixed: `session-init.sh` reaps stale markers through `gate_marker_is_stale`, and its `|| continue` treats the new unreadable-clock status exactly as "still fresh", so a dead `date` leaves a marker unreaped there. The Stop gate reports that condition, so it is visible from the other caller.

### Fixed

Review agents were told to work in a private `mktemp -d` directory and name it in their report, but only the report-only spawns were told to delete it, and none was told to clean up processes it started. The loop fan-out's prompt in `/review-cycle:review` and the fan-out prompt in `/review-cycle:review-pr` both lacked the deletion clause.

Phase 7 had been asserting otherwise. Its text reads "Carry the same containment clauses Phase 3's prompt carries", then lists "and delete it when you finish" — a clause Phase 3's prompt did not contain. The two have been out of step since the containment rule was introduced.

The cost is measured, not hypothetical. A `code-reviewer` agent built a differential harness in its scratch directory, fed the project's hooks through pipes it never closed, and exited. Every hook blocked on its payload read. Four hours and forty-three minutes later, 26 orphaned processes were still sleeping at 0:00.00 CPU with PPID 1 — six each of the commit and Stop gates, six of the repo-local version-bump gate, and four each of the session-init and post-tool hooks — and the scratch directory was still on disk. They were found by a different session on the same machine, not by the cycle that created them.

All three containment sentences now carry both clauses: delete the directory, and end every process you started before reporting, because one left blocked on a pipe you opened outlives both you and the directory.

This narrows the leak rather than closing it. An agent that stalls or dies mid-run still cleans up nothing, and no instruction can fix that — the cycle would have to sweep for the directories itself, which is filed separately.

All three gates in this repository stopped running and said nothing when a tool they shell out to broke. Measured by fault injection across the two commit-time gates and five fault modes each — a dependency that returns empty output at exit 0, exits 1, exits 127, dies on SIGTERM, or is absent — twenty of the fifty cells produced exit 0, no stdout, and no stderr. That is byte-identical to a genuine pass, so no state existed for anyone to inspect and learn the gate had stopped checking. `jq` and `git` were silent in all ten of their cells, in both gates. The Stop gate was worse: a `jq` exiting 0 with no output made its reentrancy check read as "this stop is already re-entrant" and stand the gate down, and all five `git` fault modes were silent through root resolution.

The originating fault is not hypothetical. `jq` on the affected machine resolves to a mise shim, and mise fails two ways that differ where it matters: with mise relocated out from under the shim it printed nothing and exited 0 (recorded 2026-09-16), while an untrusted config writes to stderr and exits 1 (measured 2026-09-17). Only the second is catchable by exit status, which is why each dependency is now asked a question with a known answer and checked against that answer.

`plugins/review-cycle/hooks/lib/dep-check.sh` holds the probes. `grep` is probed in both directions, because one stuck at 0 claims every pattern matches while one stuck at 1 claims none do, and each fails a gate the opposite way. `git` is probed with `rev-parse --sq-quote` and not only `--version`, because `--version` is answered before repository discovery — a git that runs but refuses this repository, the `safe.directory` shape, passes a liveness check and then fails every question the gate actually asks.

**A probe answered correctly says nothing about the next invocation**, so `jq` is not probed separately at all. Both commit gates ask their known question on the same call that extracts the command and cwd, which is the call whose answer they act on. A `jq` correct for a standalone probe and wrong afterwards used to leave the command empty, which read as "not a commit" and passed silently; it is now a contradiction the gate acts on. That also removes one process from every Bash call, which is where the performance note below comes from.

A jq that rejects invalid JSON is a *working* jq, and the first form of this change could not tell the two apart. The gates now read the payload with `-sRr` and `try fromjson`, so a payload that is not a JSON object is reported as a bad payload rather than sending the user to reinstall a healthy tool.

Both commit gates declare what they transitively depend on. Every decision routes through `command-parse.sh`, which is `awk`, `sed`, `grep`, and `tr`, while the gates declared only `jq`, `grep`, and `git`. The commit and Stop gates also reach their verdict through `review-sentinel`'s `staged_divergence`, which intersects the staged and unstaged path sets with `sort -u` and `grep -qFx`. It already guarded a `sort` that *dies* by checking its exit status — but a `sort` that exits 0 printing nothing writes an empty set, the intersection comes back empty, and that reads as no divergence. Measured on a tree whose worktree matched the mark while unreviewed content sat staged: `review-sentinel check` went from exit 1 to exit 0 with a `sort` stuck at empty-exit-0, and again with a `grep` stuck at exit 1. Both gates now declare `sort`, and the Stop gate declares `grep`.

The Stop gate turned out to depend on more than it declared elsewhere too. `gate_marker_is_stale` reaches a clock through `sed`, `tr`, and `date`, and treated a missing clock as "this marker is still fresh" — so a dead `date` made every in-progress marker immortal and held the gate open permanently, silently. It returns a distinct status for an unreadable clock now, and the gate reports it rather than inheriting a default.

Every hook in the plugin reads its payload with builtin redirection rather than `cat`. That read is the first line of each commit gate, ahead of the prefilter and every probe, so a broken `cat` emptied the payload and the gate exited 0 with no stdout and no stderr, in all six fault modes, in both gates. The Stop gate's block-once record is read the same way for the same reason: a broken `cat` emptied it, the comparison never matched, and block-once degraded into the hard loop its own reason text promises cannot happen.

Sourcing a lib cleanly is not the same as loading it. A truncated `dep-check.sh` sources at exit 0 with its helpers undefined, the missing emitter then fails as a command-not-found, and the script's final `exit 0` runs — measured at 0 bytes of stdout against a tree the gate should have blocked. Each gate now asserts the helpers it needs are defined before using them.

A broken dependency no longer short-circuits the "is this a commit?" decision. Neither a dead `jq`, which empties the command, nor a `grep` stuck at 1, which reports no match, can prove the payload is not a commit — so the gate falls back to the raw payload and proceeds when it carries the literal verb.

That fallback reads the literal **only**, and the distinction is load-bearing. The prefilter's other arm admits any command containing a double quote, which is most of them; gating on that made both gates deny ordinary Bash calls that were never commits — measured at 263 and 190 bytes of deny for `echo "hello world"` with `jq` stuck at empty-exit-0, where the unchanged gates passed in silence. Worse, it was unclearable: the commands that fix it, `/review-cycle:review` and `/review-cycle:accept`, need the same `jq`. That is precisely the loop this plugin's fail-open policy exists to rule out.

Three further silent paths are closed. Every decision was emitted by `jq -n` with a fallback keyed on the exit code, so a `jq` exiting 0 with no output satisfied that check, emitted no decision, and turned a block into a pass at the final step — all the emitters across the three gates now key the fallback on the content. `gate_project_opted_out` tested `jq -e`'s status, so a `jq` stuck at exit 0 answered yes to every test and reported that a project which never opted out had opted out; it now reads the value. The Stop gate's reentrancy short-circuit had the same shape — a `jq` whose only defect was `-e` semantics passed every probe and stood the gate down — and now keys on the answer instead; its pass-through routes through the shared helper too, because a bare `exit 0` in a `case` arm emits nothing and so went silent with a broken `sort`, invisible to any search for pass-through sites. And the version-bump gate's "is this repository in scope?" answers were bare `exit 0`s taken on a root derived from a command a broken parser may have emptied — reproduced: with `jq` stuck at empty-exit-0 the gate wrote its diagnostic and exited 0, which sends that line to the debug log and nowhere the user looks.

Where the gate concludes there is no repository to guard, it now asks why. Root discovery runs through git, so a git that will not answer produces the same empty result as a directory that genuinely holds no repository, and the commit gate took the quiet exit on both. It probes the directory the command pointed at first. The probe itself learned two questions it was missing: `rev-parse --show-toplevel` must print an absolute path, since every gate decides through it and nothing else exercised it; and a `.git` on disk while git denies the work tree is git misanswering rather than a missing repository, which no amount of asking git can settle.

Finally, a healthy git is no longer blamed for a root that is not a work tree. That is a different problem with a different remedy, and it now says so by name.

## 0.17.0

<sub>2026-08-28</sub>

- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  A fix that adds a guard is now exercised against valid input too, not only against the case it was written for.

  Testing a new check against the thing it should catch is instinctive; testing it against input that must still pass is not, and only the second finds a guard that rejects correct work. A guard added during one of this plugin's own review cycles caught its intended attack and was verified doing so, then turned out to fire on an accurate sentence describing the very step it protected — which would have made that section unwriteable and the guard the first thing a later author deleted rather than repaired. Phase 6's self-check now requires both directions whenever a fix adds a check, guard, assertion, or validation.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Report-only now means the kind of finding, not the leg that found it.

  The post-loop reviewers were treated as advisory wholesale, so a spec-conformance finding that quoted a requirement and showed the implementation plainly contradicting it had to be surfaced and handed back rather than fixed, and a measured fault in code the cycle had written minutes earlier arrived under the same heading. Both are defects, and treating them as opinions cost a round trip apiece. What those two legs genuinely own is judgment the cycle cannot supply — whether a restructuring is worth its blast radius, whether the scope was right — so the surface-only treatment now applies to proposals and scope questions, while a contradicted spec line or a measured fault goes through the fix-vs-defer policy like any other finding.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Later iterations now tell reviewers what earlier ones already settled.

  Each iteration's legs started with no memory of the passes before them, so they re-raised decisions the cycle had already made — measured twice in one day: a Codex leg re-raised a rule an earlier iteration had deliberately documented, and another re-raised a claim an earlier iteration had rebutted by measurement. Only the operator's recall stopped both from being re-litigated, and re-litigating costs a full leg's effort. From iteration 2 on, every brief now carries a short block naming what was fixed, what was deferred and why, what was rebutted and on what basis — a measurement, the documentation, or a deliberate design decision — and what was examined and left alone on purpose, all stated as settled and not to be re-reported. That last category earns its place: a judgment that something is fine reads as an unmade decision to the next leg, and comes back as a finding. A leg that thinks one is wrong is told to say so with new evidence rather than restate the original finding. The Codex leg gets the block too, since it carries no memory of its own.
- [#45](https://github.com/oakoss/claude-plugins/pull/45)  *(minor)*
  Phase 7 now checks a diff's release-note file against the diff.

  A changeset or bump file describes the change in the author's words, and release tooling publishes that text verbatim — so a description written before review is a claim about code that review then went on to alter. Nothing checked it: the evidence policy binds claims about what a command does, while here the claim and the code that settles it are both inside the diff. A description that had drifted this way shipped into a version PR and cost a separate branch, review, merge, and release regeneration to correct, after a cleanup pass reported that its claims matched the code without having compared them. Phase 7 now reads every release-note file in play — those the diff adds or modifies, plus any already staged before the cycle began, since a delta-scoped review narrows the diff — against the final post-fix state and corrects it in either cleanup mode, running last so that cleanup — which edits `.md` files itself — cannot rewrite the text after it was verified. The summary reports those corrections separately from wording changes, and the cleanup agent is told never to report that prose matches code it did not actually compare.

## 0.16.2

<sub>2026-08-28</sub>

- [#42](https://github.com/oakoss/claude-plugins/pull/42)  *(patch)*
  Stopped the comment-density hook re-firing on comment-only edits.

  The density heuristic counts comment lines in the text an edit writes, so an edit that rewrites an existing comment block — usually to fix the hook's own earlier finding — measured near 100% comments and fired again, twice in a row in the observed case. The check now skips an edit only when the replaced text and the written text are both entirely comment lines: rewriting comments is comment-editing, and density carries no signal there, while a one-line comment anchor no longer waves a large narrated block through. Whitespace-only lines inside a comment block do not break the skip; a MultiEdit insertion (empty old_string) disqualifies it; edits that touch any code line still fire; Write payloads are unchanged; and the pattern greps still scan the whole file either way.
- [#42](https://github.com/oakoss/claude-plugins/pull/42)  *(patch)*
  Tier agent and skill markdown as runtime, not prose.

  The light-tier rule classified every .md path as prose, so a diff rewriting agent bodies or SKILL.md — the plugin's actual behavior — got the reduced fan-out and a 2-iteration cap while the version-bump gate correctly called the same paths runtime. Markdown a tool loads as instructions now tiers as code wherever it lives: agent bodies, SKILL.md, commands, hook-owned markdown, reference/ files a skill loads, and instruction files like AGENTS.md and CLAUDE.md — so the rule reaches .claude/agents in any repo, not only plugin directories. Under a plugin directory that leaves only README, LICENSE, CHANGELOG, NOTICE, and tests/ as prose, the same runtime split the version-bump gate draws. Two downstream consequences of the same root cause are fixed with it: Phase 7 now sequences cleanup after the report-only reviewers when the diff contains runtime markdown (a rewording mid-read would change what those legs are evaluating), and the cleanup agent's exclusion list names templates, decision tables, thresholds, and rule definitions in runtime markdown as logic it must not de-slopify.

## 0.16.1

<sub>2026-08-28</sub>

- [#40](https://github.com/oakoss/claude-plugins/pull/40)  *(patch)*
  Fixed the reviewed-tree capture failing in every repo that ran /review-cycle:init.

  init gitignores both the state directory and the opt-out marker, and git add refuses (exit 1, 'paths are ignored by one of your .gitignore files') whenever an exclude pathspec names an existing path that gitignore patterns match — a directory, a file, even an empty directory, and even a directory holding a force-committed file, the common .vscode/settings.json idiom — so the tree snapshot fell back to hash-only in exactly the repos the feature targets, and delta scoping never activated. The capture now drops only the pattern-ignored excludes from its add (judged index-free, so tracked content inside an ignored directory cannot mask the verdict) (git skips those paths anyway, so the tree is byte-identical — measured across three ignore shapes and fifteen worktree shapes), while the remaining excludes keep the add out of directories it must not walk: staging them would abort on an unreadable file and cost time plus garbage blobs proportional to their size. The rm --cached sweep still removes every excluded path from the tree, committed ones included. Found by dogfooding minutes after the 0.16.0 release; regression tests now cover the init'd gitignore shape and a committed excluded file.

## 0.16.0

<sub>2026-08-28</sub>

- [#36](https://github.com/oakoss/claude-plugins/pull/36)  *(minor)*
  Grade each review leg by what it could actually verify, so a leg whose build was broken no longer carries the same weight as one whose build worked.

  Every reviewer now opens its report with a two-line receipt: `execution:` naming the heaviest verification that **succeeded** with its first output line, or `none`; and `attempted-but-failed:` naming every verification that would not run — including the project's own suite when the leg never attempted it, since an unattempted check is not a passed one. Orientation commands like `git status` are excluded from line one, because they succeed on a machine where nothing else does.

  Both skills grade each reporting leg from two facts read off the receipt — whether line one names a verification that succeeded, and whether line two says `none` — giving `executed`, `partial`, or `static-analysis-only`, with `unknown` when either line is missing. A receipt quoting a compile error is `static-analysis-only`, never `executed`.

  Demotion keys on the claim's evidence rather than the leg's grade, for one narrow class: how an external tool, framework, or service behaves when the sole support is a manifest, config file, lockfile, or CI file. Gating that on the label would miss the incident outright, since a leg that got any one unrelated check to pass grades `executed` or `partial` — and real legs almost always get something to pass. The label says what the demotion means: `static-analysis-only` could not have checked, `executed` could have and did not. Claims about what the changed code itself does — control flow, error propagation, what a caller observes — are read from the source and stand. A finding already labelled `inferred` keeps its place, since that reflects a budget spent elsewhere rather than a capability that was missing. A leg that merely omitted the receipt is labelled `unknown` and is not demoted for that alone: a formatting miss should not cost you a finding, and a silently dropped finding is worse than an ungraded one you can still read. Omission does not beat candour, though — a report that otherwise shows the leg could not run the checks is demoted exactly as `static-analysis-only` would be.

  The summary reports this the way it reports stalled reviewers: one line naming only the legs that were not `executed`, with the observed cause. A healthy cycle prints `Leg execution: all executed` and nothing more.

  This addresses a failure seen over eight cycles on another repository: the Codex leg's builds failed for an entire session, it kept reasoning confidently from manifests, and two of its findings were wrong — including one asserting that `doctest = false` stops `cargo test --doc` from compiling the crate, which it does not. The summary read identically to a session where everything ran.

  The receipt narrows what a leg can quietly omit; it does not verify, and the skills say so. `partial` still rests on a leg volunteering what it could not reach.

  A new bats suite holds the contract across the files that carry it, catching a requirement dropped from an agent body, a new reviewer agent that never joined it, a renamed label, and an inverted grade mapping. CI's changed-files filter now routes plugin edits to the bats job, so that guard runs on the pull requests it exists for rather than only after merge.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(minor)*
  Added an explicit effort argument to /review-cycle:review and /review-cycle:review-pr that sets the Codex leg's reasoning effort in either direction.

  Diff size is a fine input for fan-out breadth but a poor proxy for reasoning depth: a 20-line change to a gate condition classifies as light on line count and previously had Codex capped at low with no recourse. Saying 'effort medium' (or any of none/minimal/low/medium/high/xhigh/max) in the free-form arguments now overrides the tier's cap — raising included, since an explicit per-invocation argument is the user's choice just as the global config is. With no argument, nothing changes: the light tier still lowers one-directionally and respects a configured low/minimal/none. The argument is validated against the closed set of seven literals before anything reaches the Codex invocation; an unrecognized value stops the cycle with the valid set named rather than running a long review at the wrong depth.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(minor)*
  The sentinel now stores a git tree of the reviewed state, and the review cycle scopes itself to the unreviewed delta instead of re-reviewing the whole diff.

  mark and accept-state capture a tree object of the exact reviewed content (real adds into a scratch index — measured: intent-to-add entries are silently omitted from write-tree, so the capture stages for real; the repository's own index is untouched, byte-compared), protect it with a per-worktree ref under refs/review-cycle/trees/ (measured: gc prunes an unreferenced tree, a single shared name lets one worktree's mark orphan another's tree, and the ref pollutes no porcelain), and write it as a third sentinel line that older versions ignore. A new delta verb prints the changed paths and line counts against that tree — untracked files included, and independent of commits moving HEAD. /review-cycle:review runs it in Phase 1: when a marked tree exists, the tier and the reviewers' changed-file focus come from the delta, so a 20-line follow-up to a converged review gets a proportionate small review instead of forcing the choice between a full-tier re-run and /review-cycle:accept. Without a stored tree (old sentinel, first review) behavior is unchanged, and the summary names which scope ran. The accept escape hatch stays user-only.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  The Codex leg's falsifiable question is now reading-shaped; measurement-shaped questions route to the subagents.

  codex review runs its sandbox read-only by default: read-only commands succeed, but builds, test suites, and temp-directory writes are denied. Measured on codex-cli 0.149.1 during this release's own review cycle — an unoverridden codex review session opened with `sandbox: read-only` in its header, and its attempt to run the project's test suite failed with `mktemp: mkstemp failed ... Operation not permitted`; the same denials recurred across three review iterations on another repository, where the leg burned effort attempting runs the sandbox refused and reported inferred findings every time. The brief now gives Codex a question settleable by reading source, diff, or authoritative documentation (read-only commands included), and reserves questions that require running or perturbing code for the subagent legs, which own writable scratch directories. Codex's findings were already useful as reading; this stops paying for the failing runs.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  Reviewer containment now requires a private mktemp -d — never a shared session scratchpad — and the never-evade rule reaches every spawned leg.

  Two measured incidents drove this. In one cycle a reviewer's copy was mutated mid-run by a sibling agent sharing the session scratchpad, contaminating its first probe round before it noticed and redid everything in an isolated directory. In another, a reviewer ran a different agent's script by accident and received a results matrix it had not authored — a failure mode indistinguishable from fabrication in the final report. Every containment block, and both skills' spawn prompts, now name a private mktemp -d as the only sanctioned workspace, forbid writes anywhere outside it (during this release's own review cycle, an agent briefly wrote a marker file to the repository's parent directory — a location the old wording never prohibited), and reviewers state the directory their measurements ran in so results are traceable to their author.

  The never-evade rule ('never reshape a command to slip past a guard: an opt-out is visible and reviewable, an evasion is neither') previously covered only the four fix-loop agents; it now also covers the maintainability auditor, the spec-conformance analyzer, the cleanup agent, and — via the spawn prompts — any leg the cycle spawns. A new bats suite anchors both requirements across every file that carries them.
- [#38](https://github.com/oakoss/claude-plugins/pull/38)  *(patch)*
  The Stop gate's block message now names the pending-decision case, so the model waits for the user's answer instead of preempting it with a fan-out.

  Measured failure: after a converged cycle, the model presented a small post-review delta with a review-or-accept recommendation and tried to end its turn; the gate's message ('only if the user explicitly asked to defer may you stop again') read as an instruction to launch the cycle immediately, three reviewers were spawned, and the user's /review-cycle:accept arrived seconds later — the spawned reviewers had to be killed mid-run. The gate already blocks once per state, so a second stop attempt passes by design; the message now says that stopping to await the user's pending review-or-accept decision is the right move, and launching the cycle over it preempts a choice that belongs to the user.

  The accept skill gained the matching edge case: when an accept lands while a cycle is in flight, the accept supersedes it — accept-state already retires the cycle's in-progress marker, and the skill now says to stop the spawned reviewers and disregard reports arriving after the accept, instead of letting them run to completion for a report nobody needs.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(patch)*
  The four machine-written state files moved from loose dotfiles under .claude/ into .claude/review-cycle/ — mark, in-progress, pr-in-progress, and stop-block.

  User-facing paths are unchanged: the .claude/.no-review-gate opt-out, the .claude/review-cycle.json config, and the installed pre-commit helper stay where they were. A one-time migration in the SessionStart hook moves old-layout files into the directory, fail-open with a diagnostic; if hooks never fire, the gate sees a missing sentinel and blocks once, after which a review or accept re-establishes it. The sentinel's exclude lists and the paths subcommand collapse the four state entries to one .claude/review-cycle/** glob, and /review-cycle:init derives .gitignore entries from paths at runtime, so initialized projects pick up the new layout on their next init run. This directory is also the home for future cycle state.
- [#39](https://github.com/oakoss/claude-plugins/pull/39)  *(patch)*
  Fixed the gate wrongly re-arming after committing part of a reviewed file (cpl-34d), and made the hot-path check ~50x faster on wide diffs.

  check and match now compare the stored reviewed tree against a freshly captured one when the sentinel carries a tree line — content equality, immune to the hunk-header drift that broke the hash when one file's changes were split across a commit. A divergent index (an entry differing from both the working tree and HEAD) routes to the hash comparison rather than being judged by the tree: the hash alone distinguishes a partial stage the mark saw (passes) from staged unreviewed content (drifts) — measured during review, judging it at the tree turned the former into a false drift that three consecutive accepts could not clear. The routing force-includes the config, so an ignore pattern matching it cannot carry config edits past the gate. Each worktree's marked tree is kept gc-reachable by its own ref under refs/review-cycle/trees/ (linked worktrees share custom refs, so a single name would let one worktree's mark orphan another's tree). The legacy hash path still serves old two-line sentinels, and current-hash is untouched: the in-cycle contamination snapshot deliberately keeps anchor sensitivity so an empty commit stays visible. Measured on a 100-dirty-file repo: the per-path hash check took 1.47s, the tree comparison 0.03s.

## 0.15.0

<sub>2026-08-23</sub>

- [#25](https://github.com/oakoss/claude-plugins/pull/25)  *(minor)*
  `review-sentinel mark` now refuses with exit 3 unless a review cycle is actually running, and the unguarded write moves to a new `accept-state` verb. The old shared verb let any agent declare its own work reviewed: `mark` in one Bash call and `git commit` in the next sailed through, because the PreToolUse gate exits on any command containing no `git commit` and so never saw the pair. `mark` now requires `.claude/.review-in-progress`, which only `cycle-start` writes and only a real cycle runs. The test is presence rather than freshness, but the Stop gate deletes markers past its 60-minute TTL, so a cycle that outruns it reaches Phase 8 with no marker and exits 3; the summary should say so rather than the cycle re-running `cycle-start` to recreate its own evidence. The commit gate's chained pass-through accepts `accept-state && git commit` only — the guarded verb cannot ride the one path that skips the sentinel check. `/review-cycle:review-pr` gets its own marker via new `pr-cycle-start` and `pr-cycle-end` verbs: it reviews a PR head in a throwaway worktree and never reads the working tree, so its marker holds the Stop gate open without licensing a `mark` over local changes nothing reviewed. Re-run `/review-cycle:init`, or add `.claude/.review-pr-in-progress` to `.gitignore` yourself.

  SessionStart now revokes an in-progress marker once it passes the same 60-minute TTL the Stop gate applies, on every startup path including the legacy-sentinel migration. Without that, a session that died mid-review left a marker that licensed the next `mark` over exactly the unreviewed work the gate exists for — the re-seed that used to clear it is skipped in that case by design. The revocation is deliberately stale-only, and `seed` no longer retires the marker at all: `startup` also fires when a second session opens in a repo where the first is mid-cycle, and deleting a live cycle's fresh marker would strand its Phase 8. Retiring a marker now belongs to the verbs that conclude a cycle — `mark`, `accept-state`, and `cycle-end` — plus the two TTL owners, the Stop gate and SessionStart.

  What you do differently: `/review-cycle:accept` and any script that wrote the sentinel by hand must call `accept-state` instead of `mark`. `/review-cycle:review` is unchanged, since Phase 3 already runs `cycle-start`. This raises the bar rather than closing it. `cycle-start` is itself unguarded, so `cycle-start` followed by `mark` still clears the gate, as does `accept-state`. What changes is that the shortest path no longer looks like routine plumbing: `accept-state` names itself in a transcript, and a cycle that declares itself started and then marks without reviewing is a claim someone can check.
- [#27](https://github.com/oakoss/claude-plugins/pull/27)  *(minor)*
  A git failure while computing the state hash now blocks the commit instead of being mistaken for "nothing differs". Every git call in `review-sentinel`'s hash stream reports failure explicitly, and `check`, `match`, and `status` treat that as drift.

  The failure that mattered: the path enumeration runs inside a nested command substitution, so its exit status never reached the surrounding pipeline's status check. A failure there produced an empty diff stream, and an empty stream hashes to `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — the exact value a mark taken on a clean tree stores. The gate reported `verdict: match — this exact state was marked reviewed` on a tree holding unreviewed content.

  Two smaller holes closed alongside it. A per-path `git diff` failure previously blocked or was waved through depending on where the failing path sorted, because nothing guarded the loop and the last iteration's status decided; an unreadable file was a coin flip, not a policy. And the stream is now generated into a file and hashed separately: as a single pipeline, `pipefail` reports the rightmost nonzero status, so a concurrent `shasum` or `cut` failure overwrote the git failure and it read as an ordinary tool error, which hooks fail open on.

  Reproduced in tests four ways — an unreadable file, a shimmed enumeration, a failing `diff.external` driver, and a git failure concurrent with a hash-tool failure — each verified to fail against the previous release.

  The block also tells you what to do about it. The sentinel now reports which operation failed and on which path, with git's own message attached, and the commit gate carries that into its deny reason instead of the generic drift text:

  ```text
  Commit blocked: the review gate could not read the working tree, so it cannot confirm
  this state was reviewed. review-sentinel: git failed while diffing locked.txt (working
  tree) — fatal: cannot hash locked.txt (anchor 3b00f9f8…); treating as drift. Fix the
  underlying problem (most often an unreadable file — check its permissions) and retry.
  /review-cycle:accept will NOT clear this: it fails on the same fault.
  ```

  What you do differently: if your repository can make git fail mid-diff, expect a block where you previously got a coin flip or silence, naming the file. One limitation to know about: `/review-cycle:accept` cannot clear this state, because the write verbs fail on the same fault. Fix the file, or use a gate opt-out. Ordinary drift is unaffected and still gets the ordinary message.
- [#30](https://github.com/oakoss/claude-plugins/pull/30)  *(minor)*
  The review cycle's Phase 6 now has a third fix classification between mechanical and substantive: the verified message fix. A fix whose entire diff is human-facing message text (plus at most a small tested pure helper feeding it) no longer forces a full reviewer re-fan-out — instead the fixing agent must reproduce the state the message addresses, run the printed remedy verbatim, and confirm it clears, recording the reproduction in the cycle summary. Message claims the local environment cannot exercise (another OS or shell, a remote service) get one Codex-only low-effort pass per cycle instead of the full fan-out. Machine-readable output (`--json`, exit codes, parseable formats), check verdicts, and unverified remedies still classify substantive. On the cycle that motivated this change, four full iterations would have been two plus one Codex-only pass; nothing changes for logic fixes.
- [#32](https://github.com/oakoss/claude-plugins/pull/32)  *(minor)*
  Every leg of the review cycle's Phase 3 fan-out — the four fix-loop agents and the Codex leg — now carries one falsifiable question. Phase 3 composes a specific claim per leg before spawning ("which of these new assertions still pass when the code under them is broken?" rather than "review this") and the spawn prompt requires the answer to cite what was run. The four agents also gained the technique that answers it: mutation testing in the test analyzer, fault injection in the silent-failure hunter, differential comparison and oracle sweeps in the code reviewer, and constructing the invalid value in the type-design analyzer. These perturb the system to find defects nobody suspected, which is a different job from the existing empirical-verification rule that settles a claim you already suspect.

  All four techniques require editing code, which the standing rule forbids in the review target. Each agent carries a short behavioral rule — perturb only a copy outside the repository, which needs no version control — and the cycle verifies the target itself rather than asking each agent to vouch for its own cleanliness. Phase 3 snapshots `review-sentinel current-hash` plus `git config --local --list` before spawning and Phase 4 compares before aggregating; Phase 8 refuses to mark a tree that came back contaminated. The hash is what makes this work: an empty commit leaves a `git status` comparison byte-identical and moves only the anchor line, so a status-based check cannot detect the commit clause of the rule it enforces. Phase 7 runs after the comparison and includes an agent that edits by design, so it is not covered — the summary says so rather than implying otherwise.

  `/review-cycle:review-pr` changes too, though it keeps its existing prompts: its report-only instruction now names the worktree and the main checkout specifically, so it forbids edits to the code under review without forbidding the scratch work these techniques need. Extending falsifiable questions to that path is tracked separately.

  Phase 9 gained two lines, so the mechanism can be judged by its own standard: how many questions were asked versus answered by measurement, and whether the target came back unchanged.
- [#34](https://github.com/oakoss/claude-plugins/pull/34)  *(minor)*
  Require a run, not a manifest, behind any claim about what a command does.

  A new evidence policy joins the comment and fix-vs-defer policies, and binds everyone in the cycle rather than only the author applying fixes. A manifest, config file, lockfile, script entry, CI workflow, or flag in documentation says what someone configured or intended; it does not say what the tool does with it. A real finding in the field report was reasoned from a manifest and was wrong: `doctest = false` does not stop `cargo test --doc` from running the doctests. Cargo compiles the crate and runs them anyway; the flag only removes them from plain `cargo test`.

  Three rules follow: name the command and quote what it printed rather than the file you read it from; treat a run you did not observe as no run at all, since a stale file, a redirect the shell refused, a cached artifact, and a skipped job all look like success from a distance; and when the environment cannot exercise a claim, label it inferred or verify it against authoritative documentation instead of stating it flatly. A finding that rests entirely on behavior nobody could exercise is withdrawn and raised as a question.

  The policy reaches every leg. The seven bundled agents carry it in their bodies, so it applies when they are invoked directly as well as inside the cycle. Codex has no body, so both `/review-cycle:review` and `/review-cycle:review-pr` now carry the rule into the intent brief that reaches it — and `review-pr` says why it matters more there, since the PR head sits in a disposable worktree whose dependencies may not be installed and there is no fix loop downstream to catch a manifest-only claim.

  Two agents get the rule in the form their job takes. The maintainability auditor is told that green tests are the weakest form of this evidence, because a suite that does not constrain the code being simplified stays green while the simplification breaks it — so a behavior-preserving claim must say what would have caught it, and when nothing would have, the missing test is the finding. The cleanup agent is told that tightening prose must never make it false, and that a factual correction is reported separately from a wording change, because the author needs to know a claim was wrong rather than merely shorter.

  `/review-cycle:init` now installs all three policies and appends only the ones a `CLAUDE.md` is missing, so re-running it after this upgrade adds the new policy without duplicating the two already there.
- [#33](https://github.com/oakoss/claude-plugins/pull/33)  *(patch)*
  Scope the commit gate to the project and stop matching text the command carries.

  The gate blocked the commit verb in any repository a session touched, not only the project it guards. That collided with the reviewer techniques in this same release: agents building a scratch fixture with real history — a copy at the base revision to diff against — were blocked while building it, and worked around it instead. The gate now stands aside only when the command *proves* the commit lands elsewhere, and gates the project whenever it cannot tell.

  Proving it means reading a leading `cd` chain and the commit's own `-C`, then resolving the result through its nearest existing ancestor, so a fixture that does not exist when the hook runs still resolves — while a not-yet-created subdirectory *of the project* still resolves to the project. `cd` hops compose the way bash composes them when the command is `&&`-joined throughout, or plainly sequenced with every directory already on disk.

  Everything else gates. A hop inside a subshell, a backtick, or an `if` branch may never run; a second commit in the same command lands somewhere the router never read, since everything it reads stops at the first; a path holding a variable, a glob, a `cd` option, a `~+`, a `..` segment, or only partial quoting was never expanded; `--git-dir`, `GIT_DIR`, and `CDPATH` move git or `cd` off the computed path; a payload cwd that is missing or relative names nothing. Both the payload cwd's repository and the one `CLAUDE_PROJECT_DIR` names count as the project, and an unresolvable target is checked against every one of them, so a stale `CLAUDE_PROJECT_DIR` can no longer switch the gate off where you are working.

  Detection runs on the command skeleton rather than the raw text. Quoted arguments, comments, and heredoc bodies are data, so an issue description quoting the phrase or a heredoc writing a setup script no longer counts as an invocation. Command substitutions stay code wherever bash expands them, double quotes and unquoted heredoc bodies included; a quoted command handed to `bash -c`, a cluster like `bash -lc`, `eval`, `ssh`, a heredoc into a shell, or a pipe into one still blocks, as does a path-qualified `/usr/bin/git`. `git commit-tree` and the other hyphenated plumbing verbs are no longer treated as the gated verb — they write an object and move no ref.

  Failures are no longer read as answers. A `grep` that errored, an `awk` that died or produced nothing, and a lexer that lost track of quoting each mean the text was not read, and unread text blocks rather than passes.

  Two limits are deliberate. Commands over 32 KB skip the skeleton and let the raw text decide, because the lexer is quadratic and a hook that takes seconds is its own defect. And the shapes that hand a string to a shell are a named list, so a runner it does not cover — `python3 -c`, a task runner — is missed, and the commit it hides passes; the gate has never claimed to be an adversarial boundary.

  If your project relied on the gate firing in a second repository under the same session, set `CLAUDE_PROJECT_DIR` to that repository, or opt the project out with `{"disabled": true}` in `.claude/review-cycle.json`.

## 0.14.0

<sub>2026-08-18</sub>

- [#23](https://github.com/oakoss/claude-plugins/pull/23)  *(minor)*
  The Codex review leg now receives the intent brief. `codex review`'s scope flags reject a prompt argument, so the brief is passed as a config override (`-c developer_instructions="<brief>"`) — verified additive to `AGENTS.md` on Codex v0.147.0, with no file written into the review target. Codex reviews now know what the change is trying to accomplish, closing the gap where the CLI leg reviewed blind while every Claude-side reviewer got the brief. On a Codex version that drops the undocumented key, the leg degrades to an unbriefed review instead of failing.
- [#23](https://github.com/oakoss/claude-plugins/pull/23)  *(minor)*
  New `/review-cycle:review-pr` skill: single-pass, report-only review of a GitHub pull request, run locally. It fetches the PR head into a disposable detached worktree — the working checkout is never touched — runs the same reviewer fan-out as the review cycle (Codex leg included, briefed, with `--base` against the PR's base branch), and reports findings with explicit per-reviewer coverage so "no findings" is never mistaken for "nobody looked". On request it posts the findings back to the PR as a single COMMENT review whose comments — inline and body-level alike — carry fingerprints that deduplicate across re-runs. It never fixes code, never approves, and never touches the review sentinel.

## 0.13.0

<sub>2026-08-18</sub>

- [#15](https://github.com/oakoss/claude-plugins/pull/15)  *(minor)*
  Aligned the bundled de-slopify skill with the new `prose` plugin's Google-developer-style rules, so cycle cleanup and ad-hoc prose cleanup apply the same standard. The quick reference gains wordiness swaps ("in order to" → "to", "leverage" → "use", "enables you to" → "lets you"), instruction mechanics (active voice, present tense, condition before instruction, second person), and timeless-docs rules ("currently"/"soon" → delete). Claims and punctuation rules join the quick reference too: superlatives and "ensures"/"guarantees" become verifiable claims or "helps", "and/or" and slashed alternatives are spelled out, dramatic ellipses go, and "see" replaces "check out" for links. Generation-stable structural tells round it out — copula avoidance ("serves as" → "is"), sentence-final "-ing" significance trailers, and Claude-era phrases ("You're absolutely right") — with a note that vocabulary tells rotate by model generation while structural patterns persist. The don't-overcorrect floor grows: keep function words like "that" and "then" when they aid parsing, keep articles even in headings, and kept emdashes take no surrounding spaces. Details live in a new "Wordiness and Instruction Patterns" section of the prose-patterns reference.

## [Unreleased]

## [0.12.0] - 2026-08-17

Makes reviewers prove their claims instead of inferring them.

### Added

- **Reviewers are instructed to verify empirically.** Five of the reviewer agents (code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer, spec-conformance-analyzer) now carry a "Verify empirically" section: when a finding rests on a claim a command can settle — an exit code, a build output, whether a test actually covers a path, whether the typechecker actually rejects an invalid construction — run the command and report what happened rather than reasoning about what should happen. Findings are labeled verified (with what was run) or inferred from reading, and verification must never disturb the review target — repros and probe files go in a disposable directory. The two exclusions are deliberate: cleanup originates no findings, and maintainability-auditor's structural suggestions are speculative by design — a probe adds cost without changing a verdict already labeled speculative. Field experience drove this: the findings that mattered came from agents that ran things, and this plugin's own release-breaking `codex login status` bug was caught only by an empirical probe no prompt had asked for.
- **A local eval suite** (`evals/`, run with `claude plugin eval` — see `evals/README.md`). Two cases cover the 0.11.0 behavior that only exists as skill prose: a codex shim exiting 127 must yield a completed Claude-only cycle whose summary names `skipped (not installed)` and never launches `codex review`; a working shim plus a 2-line diff must produce a `codex review` invocation carrying `-c model_reasoning_effort="low"` and a summary reporting `participated (effort: low)`. Shims keep eval runs off any real Codex account. Local-only for now — CI has no `claude` CLI on the runner.
- **Phase 6 verifies facts introduced by fixes, not just the fixes themselves.** The self-check confirmed a finding was addressed but never that new prose was true, so a fix could resolve a finding by asserting something false — surviving until the next fan-out caught it, or shipping. A fix that adds or rewords a factual claim now gets the claim itself checked (run the command it describes, read the code it characterizes, confirm the name or version it cites) before the loop proceeds.

## [0.11.0] - 2026-08-17

Makes the Codex review leg optional, so the cycle runs anywhere Claude Code does, and scales its review depth to the diff.

### Added

- **Codex review depth now follows the diff tier.** Every review ran at the user's globally configured reasoning effort, so a two-line `.gitignore` fix cost the same as a large refactor. Light-tier diffs now pass `-c model_reasoning_effort="low"` when that is a reduction — a config already at `low`, `minimal`, or `none` is left alone; full-tier diffs pass no override and inherit the user's `~/.codex/config.toml`. With `multi_agent = true` the setting reaches Codex's internal review agents, so the reduction compounds across them. The final summary reports which applied.
- The adjustment is **one-directional**: the tier can lower effort but never raise it. A globally configured `medium` is a deliberate choice, and a large diff is not grounds to overrule it.
- Effort, not model name, is the tuning axis: `codex review` exposes neither `--model` nor `--profile` (only `-c key=value`), model names churn often enough that Codex maintains a `[notice.model_migrations]` table, and a name pinned in the skill would rot into an error or a silent downgrade on another user's account. The skill emits the literal `low` and never interpolates a value — Codex does not validate `-c` values locally, so a bad one would surface only as an API failure mid-review.

### Changed

- **Codex is now an optional review leg rather than a hard prerequisite.** Phase 1 probed `codex --version` and stopped the entire cycle when it failed, which made the plugin unusable on any machine or CI runner without an authenticated Codex — including the PR-review contexts it is otherwise well suited to. The probe now records the leg's status and the cycle continues Claude-only when Codex is absent.
- **The Codex leg's status is always named in the final summary** (`Codex leg: participated | skipped (…) | failed (…)`). Degraded coverage stays visible instead of silently halving the review.
- **Absence and mid-run failure are distinguished.** A Codex that never passed the preflight probe is a `skipped` environment, not an error. A Codex that passed the probe and then exited nonzero or returned unusable output during `codex review` is reported as `failed` — the cycle still completes on the subagent findings, but the breakage is surfaced as a regression to look at.
- **`/review-cycle:init` reports Codex as an available upgrade, not a warning.** A missing CLI prints what installing it would add and marks the multi_agent and auth steps not-applicable rather than flagging them.
- **Auth is no longer a gate on the Codex leg.** Only `codex --version` decides participation. `codex login status` reports on a *stored* session only, so it exits nonzero with `Not logged in` whenever Codex is authenticated by environment variable (`OPENAI_API_KEY`) with no login on disk — the standard CI arrangement, and precisely the environment an optional Codex leg exists to serve. It now serves only to enrich a later failure message (`failed (… — no stored session, try codex login)`), and `skipped (not authenticated)` is gone as a status. Caught by this release's own dogfood run.

### Fixed

- **The Codex leg's status is read from the completion notification**, which carries the shell's exit code, rather than inferred from the output file — where a crashed run and a clean run both look like a file with no findings in it. `participated` is also now clearly an outcome recorded after the run, distinct from Phase 1's `eligible` precondition; the two shared a name, which made the launch gate read as depending on its own result.
- **`codex --version` failing no longer always means "not installed".** Exit 127 does; a broken install, a non-executable binary, or a `$PATH` the tool shell can't see does not, and telling those users to `npm install -g` something already installed helps nobody. The probe now classifies on exit code and quotes the actual stderr.
- **Auth state is three-valued and written down when observed.** `no stored session` and `unknown (probe unsupported)` were collapsed, so a user whose CLI simply lacks `login status` was sent to run `codex login` to fix something that wasn't broken. The state is also recorded into the summary draft at Phase 1 rather than recalled at Phase 9 — the loop ends turns and re-wakes across up to four iterations, and it isn't re-derivable later.
- **The light-tier effort lookup reads the root table only.** A plain grep also matched `model_reasoning_effort` under `[profiles.*]`, so a root `minimal` beside an unused profile `medium` read as `medium` and got "lowered" to `low` — raising the user's actual effort, the exact thing one-directionality forbids.
- **A failed Codex leg retries once, not every iteration**, and any iteration's failure sticks in the summary instead of being overwritten by a later success — the iteration Codex missed is usually the one that had the findings.
- **The stall watchdog no longer drops a reviewer on an unrelated wake.** "Hasn't reported by the next wake" counted any wake, including one triggered by other agents milliseconds later, so a nudged reviewer could be discarded while mid-reply. A wake now has to carry information about that reviewer — it idled again, or every other reviewer has since reported.
- **The watchdog's set-relative drop test no longer applies on the light tier.** "Every other reviewer has since reported" is vacuously true when `code-reviewer` is the only Claude-side reviewer, so the light tier could nudge and drop its sole reviewer on any wake — losing the entire Claude side of the review on the tier least able to afford it. Only that reviewer's own notification counts there.
- **Review subagents must be spawned unnamed, in both fan-outs.** Passing `name:` turns a background agent into a persistent addressable teammate that parks as `idle` awaiting messages instead of completing and returning its report, so its findings never arrive and the watchdog spends its one nudge on an agent that was never going to deliver. The rule is now global rather than stated only in the Phase 3 fan-out — Phase 7 spawns agents too, and has no watchdog to notice. Found the hard way: the dogfood run lost all three Claude-side reviewers to this.
- **Phase 2's canonicalization notes have somewhere to land.** A missing formatter or an erroring typecheck was to be "noted", but the summary had no field for it, so "the typecheck tool was missing" and "the typecheck passed" looked the same. The summary template now carries a `Canonicalization:` line, and an abort before Phase 8 prints an abbreviated status instead of reporting nothing at all.

## [0.10.0] - 2026-08-17

Cuts the cycle's stall-and-ceremony overhead — the wall-clock cost that field feedback measured at roughly half of each cycle — without dropping any finding-catching mechanism.

### Added

- **The Stop gate no longer blocks while a review cycle is running.** The cycle writes `.claude/.review-in-progress` at fan-out (new `review-sentinel cycle-start`/`cycle-end` subcommands); while the marker is fresh (under 60 minutes) the Stop hook lets turns end, so the agent awaits background reviewers via completion notifications instead of sleep-loop workarounds. `mark`/`seed` clear the marker; the Stop gate removes stale copies from crashed cycles.
- **Stall watchdog for background reviewers.** A reviewer that goes idle without delivering gets one nudge, then the cycle proceeds without it and names it under "reviewers dropped (stalled)" in the summary.
- **Diff tiering.** Phase 1 classifies the diff once: light diffs — docs-only, or ~25 changed lines or fewer regardless of file type — get Codex + code-reviewer with a 2-iteration default cap and inline cleanup, so a two-line `.gitignore` fix no longer triggers the full apparatus; everything else keeps the full conditional fan-out (default cap 4). The tier is named in the final summary.
- **Reviewers receive an intent brief.** The fan-out prompts were context-free ("review the uncommitted changes"), leaving every reviewer to guess what the change was trying to do — a major source of beside-the-point findings. Phase 3 now composes a 2–4 sentence intent summary plus the changed-file list, passed to each subagent. Codex runs unbriefed: its scope flags reject a prompt argument (found by this release's own dogfood run). Intent only, never expected verdicts.
- **`review-sentinel status`: a diagnostic that answers "why is the gate blocking me".** Prints the resolved root, clean-tree verdict, the Stop-gate markers when present (in-progress age vs TTL, block-once record), stored mark (anchor + hash), the current hash computed from the stored anchor, and a one-line verdict; exit codes mirror `check`. Field feedback showed users bisecting gate behavior with `check` vs `match` (which disagree by design — the clean-tree fast-path) and drawing wrong conclusions; one subcommand now shows the whole picture.

### Changed

- **The Stop gate blocks once per drift state.** It records the state hash it blocked on (`.claude/.review-stop-block`); a later stop on the identical state soft-passes with a warning instead of re-blocking, so a user-directed "keep going, review at the end" batches work naturally. This relaxes only *when* review happens — the commit gate still prevents unreviewed commits, unchanged.
- **Fix verification is a self-check, not an automatic re-fan-out.** After applying fixes, the cycle verifies each against the findings list; a fresh reviewer iteration runs only when some fix was substantive (new logic, edits beyond the flagged lines), and then scoped to Codex plus the reviewers whose domain those fixes touched. Iterations that used to exist purely to confirm mechanical fixes landed are gone.
- **Cleanup only spawns an agent when it pays for itself.** Purely size-based: diffs under ~150 changed lines get the comment-policy and de-slopify pass inline; the cleanup subagent is reserved for larger diffs, whatever the tier — a large docs-only diff is light-tier for fan-out but is exactly the prose volume the agent spawn is for.
- Both new marker files are excluded from the sentinel hash and clean-tree check, and `review-sentinel paths` (which `/review-cycle:init` feeds into `.gitignore`) now lists them. Existing installs: re-run `/review-cycle:init` once so the new marker paths land in your project `.gitignore`.
- **The comment-slop hook now demands the fix instead of suggesting it, and catches narration by arithmetic.** The PostToolUse hook's context was "consider removing or rewriting" — hedged phrasing models shrug off, which is why comment cleanup kept needing repeat requests. It now directs an immediate follow-up Edit, including compressing kept WHY-comments to a line or two. It also gained a comment-density check on the exact text just written (4+ comment lines and ≥30% of the edit): narrating WHAT-comments mostly dodge the pattern greps, but they can't dodge the ratio. The count is careful about what a comment is — C dereferences (`*p = 1;`), `#include` directives, `#[attributes]`, and shebangs don't count, a Write payload's leading header block is exempt (a new file's legitimate header is not an "edit"), and the history-flavored grep is case-insensitive. Comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check, and prose files (`.md`, `.txt`, …) now skip the hook entirely — `#` is a heading there, and the pattern greps would false-positive on lines like a `# Note:` heading; prose belongs to the de-slopify/cleanup lens. The hook now has its own bats suite (26 tests) covering the pattern greps, the density thresholds across all three tool payload shapes, and every silent exit path.
- **History-flavored comments are flagged and banned by policy.** Comments narrating a prior state of the code ("previously", "no longer", "as it did while X") accrete during review passes — each pass explains the previous one, so reviewed comments grow instead of shrink. The hook greps for them, and the comment policy (skill, cleanup agent, reference snippet) now names the pattern: state the current invariant, put the story in the commit message. The review skill additionally forbids a review pass from ever lengthening a comment.
- **The cleanup agent inherits the session model** instead of pinning sonnet — it now only spawns on large diffs, where the stronger model's comment judgment is worth the cost.

### Fixed

- **Gate rejection messages no longer imply the review didn't happen.** Both the PreToolUse deny and the installed git hook said "run /review-cycle:review first" for every drift — misdirecting when a review *had* happened and the state drifted afterward (commit-time formatter, hook manager restoring the index after a rejection, edits since the mark). The messages now distinguish the two cases, name the common causes, note that a hook-manager rejection may have unstaged files, and point at `review-sentinel status`. A new README troubleshooting entry covers the same ground, including what is *not* the cause: staging order and multi-commit batches are both invariant under the hash design (re-verified against clean-room repros this release).
- **Codex now reviews the same diff as the subagents on scoped runs.** `against <ref>` scoped the subagents to `<ref>..HEAD` but Codex was still invoked with `--uncommitted`; the skill now uses `codex review --base <ref>` when a base is given.

## [0.9.0] - 2026-08-03

### Added

- **`review-sentinel install-hook`: opt-in commit-time enforcement.** Installs a git pre-commit hook that runs `review-sentinel check` inside the commit — closing the two structural blind spots of PreToolUse-time evaluation: chains that re-drift the tree after the check (`sed -i … && git commit -a`), and agent commits from outside the session's Bash tool. Only agent sessions are gated (`CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` env guard — humans are never blocked); the kill-switch and per-project opt-outs are honored with the same precedence as the PreToolUse gate; a missing binary or check error fails open. Manager-aware installation: lefthook repos get a guarded helper script plus a lefthook job (config auto-edited only when it has no `pre-commit` key, append failures reported), pre-commit and simple-git-hooks repos get the helper plus a printed snippet (committed config never auto-edited), husky/`core.hooksPath` setups are handled implicitly via `git rev-parse --git-path hooks`. Under plain git a pre-existing hook is relocated to `pre-commit.local` and chained first with its exit status preserved — appending would swallow its failures or sit dead behind an `exit 0` — while a git-tracked hook file (husky commits `.husky/`) is never rewritten: helper plus snippet instead, so no machine-specific path lands in committed files. The embedded binary path is quote-escaped so unusual install paths can't break the hook. `review-sentinel uninstall-hook` reverses everything, restoring a relocated hook. Worktree commits are covered. The PreToolUse gate stays active as the zero-setup default everywhere; the git hook is added depth, never a dependency. New `install-hook.bats` suite (41 tests).
- **SessionStart notes missing commit-time enforcement, context-only.** When the gate is active and no commit-time hook is installed, session-init emits one line into model context describing `install-hook` — explicitly marked not to be suggested unprompted.

### Changed

- **Lexical analysis extracted to `hooks/lib/command-parse.sh`.** The commit-detection regex, commit counting, sanctioned-mark-chain decision, and `cd`/`-C` extraction now live in one sourceable lib of pure string functions, unit-tested without git repos (new `command-parse.bats`, 23 tests). `commit-gate.sh` shrinks to orchestration. The policy rationale moved next to the code that implements it. Marketplace repos' version-bump gates can source the same lib so twin definitions cannot drift.
- **Commit detection runs on the joined command view.** A backslash-continued `git \<newline>commit` is one invocation to bash and is now one invocation to the gate; previously the per-line entry grep missed it entirely.

## [0.8.2] - 2026-08-03

### Fixed

- **Chained `review-sentinel mark && git commit` is no longer denied.** The commit-gate hook fires before the whole Bash chain executes, so it evaluated the sentinel against the pre-mark state and blocked the chained form of the `/accept` flow, forcing mark and commit into separate Bash calls. The pass-through is strict about what qualifies: the command must contain exactly one `git commit`, and a bare `mark` (no `--root`) at a command position, with the binary name at a path boundary, must be joined to it by `&&` with nothing in between — so the commit only runs if the mark actually succeeded. `;`, `||`, and newline separators stay denied (they'd let a failed or short-circuited mark's commit through — including `||` anywhere before the mark), as do commands between mark and commit, a mark after the commit, and extra commits after a marked one. Shell comments are stripped before the prefix match, while the commit count is taken from the raw bytes so a quoted `#` (e.g. `-m "fix #12"`) can never hide a later commit; the single-commit requirement keeps quoted or heredoc text containing the phrase from standing in for the real commit. New `commit-gate.bats` suite (57 tests) pins both directions.
- **`git -C <repo> commit` (and other global-option forms like `git -c k=v commit`) no longer slip past the gate.** The commit detection only matched `commit` immediately after `git`, so the natural cd-free shape `git -C <path> commit` — and subshell/backtick forms like `(git commit …)` — bypassed the sentinel check entirely. Detection now skips global options in every real shape — quoted values with spaces (`-c user.name='A B'`, `-C "/my repo"`), separate-argument long options (`--git-dir <path> --work-tree <path>`) — and recognizes `(`/backtick command openers. The `-C` path feeds project-root resolution the way a leading `cd` already did: extracted only when the command holds a single commit invocation (prose mentioning `git -C` cannot steer the gate), last `-C` wins to match git, it outranks `cd` (the `-C` decides where the commit lands), and relative paths resolve against the cd target or payload cwd.

## [0.8.1] - 2026-06-14

### Fixed

- **A reviewed *new* file no longer reads as drift once `git add`-ed.** An untracked file was hashed via a different representation (a `--UNTRACKED:` content dump) than its staged form (a `git diff --cached` patch), so any `git add`/`git add -A` between marking the sentinel and committing (e.g. routine bead bookkeeping that touches new files) flipped the gate to false drift and blocked the commit. Untracked files are now intent-to-added (`git add -N`) into a throwaway copy of the index, and the index→working-tree segment is diffed against that scratch index, so untracked, staged, and committed forms of the same new file hash identically. The real index and working tree are never mutated, and the index/worktree divergence check that catches the Codex P1 bypass is unaffected (the scratch index covers only the worktree segment). New regression tests cover the untracked→staged and untracked→staged→committed transitions.

## [0.8.0] - 2026-06-05

Closes the loop on a class of spurious review re-triggers: a pre-commit hook that reformats files at commit time leaves working-tree churn the gate reads as fresh unreviewed drift, forcing a needless second review.

### Added

- **Phase 2 "Canonicalize the working tree."** `/review-cycle:review` now brings the tree to the project's canonical state *before* the reviewer fan-out — running the project's own auto-fixers (formatters, `lint --fix`) and fast read-only checks (typecheck, affected tests), sourced from definitions the agent already has (`CLAUDE.md`/`AGENTS.md`, the pre-commit config, `package.json` scripts, `justfile`/`Makefile`/`Taskfile`/`mise`, CI). Reviewers see clean code; the marked state matches what the commit-time hook produces, so a formatter re-running at commit no longer strands changes the gate reads as drift. Auto-fixers are scoped to the changed fileset; slow suites are surfaced rather than run; the whole phase is fail-open. The later phases renumber accordingly (Fan-out → Phase 3, … Stop → Phase 10).
- **README note on pre-commit hooks and review re-triggers** (Troubleshooting). The leave-a-clean-tree principle: a hook that mutates files at commit time must fold those edits into the commit (scope formatters to staged files) or the residue re-fires the gate. Names the common `cargo fmt --all` vs. staged-scoped footgun.

### Changed

- **Agent task-state and IDE exclusions now match at any depth, not just the repo root.** `.beads/`, `.trekker/`, `.vscode/`, `.idea/`, `.zed/`, `.cursor/`, and `.fleet/` are excluded from the sentinel hash wherever they appear, so a monorepo that keeps `.beads/` in a subpackage no longer trips the gate when a `bd`/lefthook pre-commit hook re-exports that subpackage's `issues.jsonl`. Each directory now carries both a root-anchored (`.beads/**`) and an any-depth (`**/.beads/**`) pathspec; the root form is retained because older git pathspec parsers treat a leading `**/` as one-or-more directories rather than zero-or-more. Reverses the deliberate root-only scoping documented in 0.6.2. Test X7 flipped accordingly, with new hash-path and regression coverage (X7b/X7c).

## [0.7.0] - 2026-05-28

Adds two report-only reviewers and consolidates the plugin to a single `review` command, informed by Cursor's `thermo-nuclear-code-quality-review` and Matt Pocock's two-axis `review` skill.

### Added

- **`maintainability-auditor` agent** — an ambitious structural lens: "code-judo" moves (restructurings that delete whole categories of complexity), file-size sprawl (~1000-line threshold), spaghetti-branch growth, weak seams, and testability regressions. Runs once per review as a **report-only** reviewer — its speculative restructurings are surfaced in a "Structural suggestions" section for you to action by prompting, never auto-applied, because high-blast-radius rewrites must not be applied unsupervised in a loop.
- **`spec-conformance-analyzer` agent** — a **report-only** spec axis: checks the diff against its originating issue/task/PRD and reports missing or partial requirements, scope creep, and implemented-but-wrong, each quoted against the spec line. Reported separately from quality findings, because a change can follow every standard while building the wrong thing.

### Changed

- **`/review-cycle:review` is the single command for the whole cycle.** The auto-fix reviewers (Codex, code-reviewer, tests, error handling, type design) run in the fix loop; the two report-only reviewers and the de-slopify cleanup run once *after* the loop converges, against the final post-fix state — so the expensive opus maintainability pass runs a single time rather than on every iteration.
- **Arguments are natural language, not flags** — `against <ref>` and `max <n>` instead of `--base` / `--max-iter`; bare `/review-cycle:review` covers the common case. Flags don't autocomplete in Claude Code and are awkward to dictate.
- **`pr-test-analyzer` fires on any source change**, closing the blind spot where a feature that shipped zero tests skipped coverage analysis entirely.
- **`type-design-analyzer` catches type-boundary smells** — needless optionality, escape-hatch `any` / un-narrowed `unknown`, and casts that paper over a boundary — anywhere in the diff, not only on type declarations.
- **The cleanup agent removes redundant comments decisively.** A comment that restates the code is removed on sight; only a comment that may encode a constraint the agent cannot verify is kept, and it is flagged in the summary for a human to confirm.

### Removed

- **`/review-cycle:inspect` and `/review-cycle:cleanup` skills.** The maintainability lens that `inspect` hosted now runs inside `/review-cycle:review` (report-only), and `/review-cycle:de-slopify` covers ad-hoc prose cleanup; the cleanup *agent* still runs automatically in the cycle. `review` is now the only review command.

## [0.6.3] - 2026-05-13

### Fixed

- **`write_sentinel` correctly reports `printf` failures.** The previous form `err=$(printf '%s\n' "$content" > "$tmp" 2>&1)` intercepted stdout via the file redirect before `2>&1` could merge stderr into the capture, so `err` was always empty and the failure branch was unreachable. The function now checks `printf`'s exit code directly. Functional impact is small (the existing `mv` step catches most downstream failures), but the function now fails honestly on a `printf` error.

### Changed

- **Built-in-exclusion test split per directory.** The single parameterized X4 test became seven small tests so bats can identify which exclusion regressed if one of them breaks.

## [0.6.2] - 2026-05-13

Fixes the bug where edits confined to agent task-state (e.g. `.beads/`) forced a review. Also closes a self-exclusion bypass found by `/review-cycle:review` against an in-progress patch.

### Changed

- **Gate ignores non-code state by default.** Agent task tracker directories (`.beads/`, `.trekker/`) and IDE state directories (`.vscode/`, `.idea/`, `.zed/`, `.cursor/`, `.fleet/`) are now excluded from the sentinel hash. Changes confined to those paths no longer trip the Stop or commit-gate hooks. `/review-cycle:review` still works manually for users who want a review pass anyway. Exclusion is anchored at the repo root; a nested `subproject/.beads/` is still hashed.
- **New `.claude/review-cycle.json` config.** Schema: `{"disabled": bool, "ignore": [string]}`. `disabled: true` opts the project out of all gates. `ignore: [...]` extends the built-in exclusion list with project-specific pathspec-glob patterns. Requires `jq`. The legacy `.no-review-gate` marker is still honored indefinitely; there is no auto-migration, because the old marker was typically gitignored (local-only opt-out) while the new file is meant to be committed (team-wide), and silently converting one to the other could publish an opt-out unintentionally. Users who want to consolidate can write the new file themselves and remove the marker manually.

### Added

- **Pipeline fail-closed on git/jq errors.** A malformed pathspec, missing sha tool, or any mid-pipeline git failure now returns drift (1) instead of silently producing `sha256("")` and passing the gate. Added a smoke-test using the assembled pathspec before hashing.

### Security

- **Self-exclusion bypass closed.** The previous in-progress draft excluded the user-provided ignore file from its own hash, so an unreviewed edit adding `src/**` plus an unreviewed `src/app.ts` change could pass the gate without ever being reviewed. The new config file is **not** in the default excludes AND is force-included in the hash regardless of user `ignore` patterns. Editing `.claude/review-cycle.json` always forces a review pass before its rules take effect, even if the user added patterns that would otherwise match it (e.g. `**`, `.claude/**`).
- **Malformed-pathspec bypass closed.** Earlier draft of the smoke-test returned exit 1 on git rejection, which `check` mapped to exit 2 (internal error, hooks fail-open). A user with a broken `ignore` pattern could therefore disable the gate until the config was fixed. The smoke-test now returns 2 directly, which `check` maps to drift (hooks block).
- **Explicit `disabled: false` honored over stale legacy marker.** `gate_project_opted_out` now honors the config's `disabled` key exclusively when present, so a hand-written `{"disabled": false}` cannot be silently overridden by a leftover `.no-review-gate`.

## [0.6.1] - 2026-05-12

Security and robustness fixes for issues found by running `/review-cycle:review` against the 0.6.0 release before broader adoption. **Users on 0.6.0 should upgrade immediately** — 0.6.0 contained a gate bypass.

### Security

- **Staged-content bypass closed.** The hash now captures both `git diff --cached <anchor>` (anchor → index) and `git diff` (index → working tree) per file, sorted by path. The 0.6.0 implementation used only `git diff <anchor>` (anchor → working tree), so a user could stage unreviewed content, restore the working tree to the reviewed state, and then commit — slipping unreviewed bytes past the gate. Per-path iteration also keeps the hash byte-stable across staging-state changes, so moving reviewed content between staged and unstaged does not drift.

### Fixed

- **`match` subcommand exit codes distinguish error from no-match.** Now exits 2 on real errors (missing sha tool, not in work tree, pipeline failure) and 1 only on actual no-match. The 0.6.0 implementation collapsed all failures to exit 1, breaking `session-init`'s ability to detect a misconfigured environment.
- **Silent failure in legacy-hash migration.** `session-init` now emits a stderr warning when the 0.5.x→0.6.0 migration cannot compute the legacy hash (e.g., missing sha256sum/shasum). Previously the failure was swallowed and the user was left permanently gated with no breadcrumb.
- **Anchor type validation.** Sentinel anchors are now checked via `git cat-file -t` and must resolve to a commit or tree object. The previous `cat-file -e` accepted any object (including blobs and tags), which would have produced a meaningless hash.
- **Pipefail and PIPESTATUS checks** on the hash compute pipeline. A mid-pipeline `git diff` crash now surfaces as a compute error instead of silently producing a valid-looking but wrong hash.

## [0.6.0] - 2026-05-12

> ⚠️ **Withdrawn**: this release contained a gate bypass via staged content. Upgrade to 0.6.1.

### Fixed

- **Multi-commit drift after a single review.** Previously every `git commit` advanced HEAD and shrank the diff the sentinel hashed against, so the gate flagged drift even when no unreviewed content had been introduced. Reviewing a batch and then splitting it into N commits required N reviews. The sentinel now pins (anchor SHA, diff-from-anchor hash) instead of (diff-from-HEAD hash), so committing already-reviewed content does not invalidate the sentinel — the cumulative anchor→working-tree diff stays the same regardless of how many of the reviewed hunks have been committed.

### Changed

- **Sentinel format is now two lines:** `anchor:<40-hex>` (HEAD SHA at mark time, or the empty-tree SHA `4b825dc6…` for unborn HEAD) and `sha256:<64-hex>` (hash of `git diff <anchor>` plus untracked file contents). Migration from 0.5.x is automatic via `session-init` on next startup, with lossless upgrade when the working tree still matches the previously-reviewed state.
- **New `match` subcommand on `bin/review-sentinel`.** Used by `session-init` to decide whether to advance the anchor; differs from `check` in that it does not treat a clean tree as a pass. `check` and `match` together replace the prior pattern of comparing `current-hash` output against the raw sentinel file.
- **`current-hash` output is now two lines** (`anchor:` then `sha256:`) to match the on-disk format. Anyone scripting against the old single-line output will need to update.

### Migrated

- **Single 0.5.x → 0.6.0 migration block** in `session-init.sh` replaces the previous 0.5.0 → 0.5.1 block. Detects any pre-0.6.0 sentinel (bare hex or `sha256:`-prefixed), computes the legacy hash against current state, and re-seeds in the new format only when they match (lossless upgrade). When they don't match, the old sentinel is preserved so the gate fires on the unreviewed drift.

### Behavior unchanged

- The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) keep their existing semantics. Only `session-init` changed; the others just call `review-sentinel check`.
- Clean-tree fast-path is preserved: `check` still exits 0 on a working tree with no changes regardless of stored sentinel content.

## [0.5.2] - 2026-05-12

### Changed

- **`review`, `cleanup`, and `inspect` are now model-invocable.** The commit-gate hook is the actual boundary against unreviewed commits, so blocking model invocation on these skills only created an incoherent flow: the Stop hook would tell Claude to invoke `/review-cycle:review`, and Claude couldn't. `accept` (gate bypass) and `init` (meta-setup) remain user-only.

## [0.5.1] - 2026-05-11

### Changed

- **Gate state is now factored into a shared CLI (`bin/review-sentinel`) and a sourced lib (`hooks/lib/gate.sh`).** The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) each shrink to their actual decision logic; preconditions and sentinel I/O live in one place. `/review-cycle:accept` and Phase 7 also call the CLI instead of re-implementing hash computation inline. The sentinel path (`${PROJECT_ROOT}/.claude/.review-mark`) is unchanged; existing sentinels self-heal on the next `startup` session.

- **Hash now captures content changes, not just file-level state.** Previously the sentinel hashed `git status --porcelain --untracked-files=all` only, so editing an already-modified file (without adding new files) didn't update the hash — the gate would pass when it shouldn't. The new computation concatenates porcelain status, `git diff --cached --binary`, `git diff --binary`, and the contents of untracked files. Splitting staged+unstaged (vs. `git diff HEAD`) covers repos without an initial commit; staged content in unborn repos now correctly contributes to the hash. Subsequent edits to the same file also correctly drift the sentinel.

- **`session-init` re-seeds on `startup` only when the prior state was reviewed.** Re-seeds when the sentinel is missing (first install; pre-existing WIP becomes the baseline) or when the sentinel matches the current state (idempotent refresh). If the sentinel disagrees with the current state, the previous session left unreviewed work; `session-init` keeps the old sentinel and lets Stop/commit gates do their job. `/clear`, `/compact`, and resume events are not `startup` events and don't fire this hook. Trade-off: dependency bumps or IDE edits between sessions now require a one-time `/review-cycle:accept` or `/review-cycle:review` to re-baseline, but quit-and-restart with WIP no longer silently absorbs unreviewed changes.

- **Clean working tree always passes `check`.** The sentinel CLI exits 0 on a clean tree regardless of the stored hash, eliminating the post-commit re-block loop where the user would have to run `/accept` after every commit just to clear the gate.

### Fixed

- **One-time migration from 0.5.0 sentinel format.** 0.5.0 wrote a bare 64-char hex hash; 0.5.1 writes `sha256:<hex>`. On the first 0.5.1 `startup` session that finds an old-format sentinel, `session-init` re-seeds it. This restores self-heal for the upgrade path without absorbing in-session unreviewed work on subsequent restarts.
- **`hooks/posttool-slop.sh`: comment-slop findings rendered with literal `\n` instead of newlines.** Pre-existing bug from 0.5.0 — the `FINDINGS` variable used `"\n\n"` inside double quotes (which doesn't interpret escapes) and jq propagated those as `\\n` into Claude's `additionalContext`. Switched to `$'\n'` so the rendered context is actually newline-separated and readable.
- **`hooks/posttool-slop.sh`: now bails when the modified file is outside any git repo**, matching the scope of the other three hooks. Previously it would inject context for orphan files.
- **`bin/review-sentinel`: defense-in-depth git work-tree check** in `compute_current_hash`. If a refactor ever calls it with a non-repo path, it now returns nonzero instead of silently producing the empty-tree hash and reporting "clean".
- **`bin/review-sentinel`: `read_sentinel` warns to stderr and returns nonzero** on malformed content. Callers can now distinguish missing from corrupted (`check` still treats corrupted as drift; the warning surfaces in the next hook output).
- **`bin/review-sentinel`: `write_sentinel` forwards underlying error to stderr.** Previously `2>/dev/null` swallowed permission/disk-full/path errors silently. The mkdir, write, and rename now each capture stderr and emit a specific message before returning. Temp file is cleaned up on write or rename failure.
- **`hooks/session-init.sh`: strict re-seed.** Only re-seeds when the sentinel exactly matches the current hash (idempotent refresh) or is missing (first install). Previously the conditional piggybacked on `check`'s clean-tree exit-0, which let a transient `git stash` or `git checkout` overwrite a prior-session sentinel with the empty-tree hash. The strict version preserves the prior sentinel as evidence whenever current state diverges.

### Added

- **`/review-cycle:init` now preflights `jq`, `git`, and a sha256 tool** (`sha256sum` or `shasum`). Previously a machine missing any of these would silently fail-open at every hook — the gate would appear to be doing nothing for no obvious reason. Each missing tool now surfaces a clear install hint in the init summary.

- **Bats smoke suite** at `tests/`. Covers the sentinel CLI (seed/mark/check/paths, clean-tree, drift detection, format validation, exit codes) and the gate lib (kill-switch, opt-out marker, project-root resolution chain, composite check). Run with `tests/run.sh`, which wraps bats with a post-suite cleanup to work around a known hang on macOS.

## [0.5.0] - 2026-05-11

### Added

- **PostToolUse comment-slop detector** (`hooks/posttool-slop.sh`). Fires after `Write`, `Edit`, or `MultiEdit` and scans the modified file for high-confidence comment-slop patterns. When detected, returns `hookSpecificOutput.additionalContext` so Claude addresses them on the next turn. Does NOT block — the write already happened; this is informational reinforcement of the comment policy in real time.

  Patterns flagged:
  - Section markers (`// ===== HELPERS =====`)
  - Restate-the-code verbs at start of comment (`// fetches the user`)
  - AI-flavored phrasings (`// Here we ...`, `// Let's ...`, `// This function does ...`)
  - Hedge prefixes (`// Note:`, `// Important:`, `// NB:`)
  - TODO/FIXME without ticket reference (skipped if `#123`, `ABC-123`, or URL follows)
  - Hedge words in comments (`obviously`, `basically`, `simply`, `just`, `actually`)

  Limits: skips binary/lock/build-artifact paths and files over 1MB. Respects the global kill-switch and per-project opt-out marker like the other hooks. Catches the comment patterns Opus 4.7 most often introduces mid-implementation — supplements the cycle's end-of-cycle cleanup with real-time intervention.

## [0.4.2] - 2026-05-10

### Fixed

- commit-gate now correctly resolves the project root when the Bash command is `cd <path> && git commit ...`. Previously, the hook ran `git rev-parse --show-toplevel` from the session cwd (not the cd target), so if the user ran from `$HOME` and cd'd into a project inline, `PROJECT_ROOT` resolved empty and the hook exited 0 fail-open instead of blocking. Now the hook parses a leading `cd <path>` from the command, expands `~`, falls back to the hook input's `cwd` field, then to `CLAUDE_PROJECT_DIR`, then to the shell cwd. Confirmed end-to-end: `git commit` from a different cwd now correctly produces the documented deny.
- Verified that bypassPermissions mode does NOT override hook deny decisions (was an earlier incorrect hypothesis — proven false by a hard-deny test).

## [0.4.1] - 2026-05-10

### Fixed

- commit-gate hook now produces output matching the documented PreToolUse schema. The hook was using the deprecated top-level `decision: "block"` / `reason` fields, which PreToolUse no longer honors (silently treated as "no decision," letting `git commit` through). Switched to `hookSpecificOutput.permissionDecision: "deny"` per the current docs. The hook now actually blocks unreviewed commits — confirmed in isolation with a realistic JSON input. Same class of bug as the Stop hook schema fix in 0.1.2.

## [0.4.0] - 2026-05-10

### Added

- Embedded 4 subagents from Anthropic's pr-review-toolkit at `agents/`:
  - `code-reviewer.md`
  - `silent-failure-hunter.md`
  - `type-design-analyzer.md`
  - `pr-test-analyzer.md`

  Invoked under the plugin namespace as `review-cycle:<agent-name>`. Copied verbatim from `anthropics/claude-plugins-public`; license preserved at `LICENSE-pr-review-toolkit`; attribution in `NOTICE`. The `code-simplifier` and `comment-analyzer` agents are intentionally not migrated (see NOTICE for reasoning).

- New `cleanup` subagent at `agents/cleanup.md`. Preloads the bundled de-slopify skill via the `skills` frontmatter and applies both the comment policy and de-slopify methodology in a single pass. Edits files directly; returns a structured summary.

- New `/review-cycle:cleanup` skill — thin wrapper around the cleanup subagent for `/`-invocable ad-hoc tidy-ups.

- New `/review-cycle:accept` skill — updates the review sentinel to mark the current state as reviewed without running the full cycle. Per-state escape hatch for "I've manually reviewed, let me commit" flows.

### Changed

- Cycle Phase 2 fan-out now spawns each pr-review-toolkit-style subagent directly via the Agent tool with `run_in_background: true`, instead of invoking `/pr-review-toolkit:review-pr all parallel`. Conditional dispatch (code-reviewer always; test/error/type analyzers based on diff scope) moves into the cycle skill's prose. No external slash-command dependency for review agents.
- Cycle Phase 6 cleanup now spawns the `cleanup` subagent instead of invoking the de-slopify skill directly. The cleanup agent owns both the comment policy and the de-slopify application in a single phase.
- Inspect Phase 2 mirrors the same direct-Agent-invocation pattern.

### Notes

- This release drops the runtime dependency on the pr-review-toolkit plugin. The Codex CLI is still required (already true since 0.2.0). The plugin is now fully self-contained for its review work.
- Roadmap remaining: v0.5.0 — PostToolUse hook for real-time comment-slop intervention (optional).

## [0.3.2] - 2026-05-10

### Changed

- Tightened the `/review-cycle:init` summary output. Replaced the bracketed two-column status format (`[✓|⚠|✗] Codex CLI: ...`) with single-glyph leading status (`✓ Codex CLI: ...`). Avoids wrapping in narrow terminals and reads more scannably.

## [0.3.1] - 2026-05-10

### Added

- `/review-cycle:init` skill — one-time setup helper. Verifies Codex CLI and `multi_agent` config, optionally appends the comment + fix-vs-defer policies to `~/.claude/CLAUDE.md` and/or `./CLAUDE.md`, and updates project `.gitignore` to exclude the per-project sentinel files (`.claude/.review-mark`, `.claude/.no-review-gate`). Idempotent — safe to run multiple times. Replaces the manual setup steps previously documented in the README.

## [0.3.0] - 2026-05-10

### Added

- Bundled the `de-slopify` skill at `skills/de-slopify/` (full skill including `references/` subdir). Invokable as `/review-cycle:de-slopify` for ad-hoc prose cleanup, or invoked automatically by the cycle's Phase 6.
- Source remains at [oakoss/agent-skills](https://github.com/oakoss/agent-skills); the bundled copy is a snapshot synced on each plugin release. Cross-agent skills.sh distribution stays at agent-skills; the plugin's copy makes review-cycle self-contained for Claude Code users.

### Changed

- Comment policy in the embedded skill bodies and `reference/policies.md` softened from "default to NO comments, only add when WHY is non-obvious" to "comments are fine; keep them clean and minimal." Same set of bad patterns flagged, but the default action shifts from "remove" to "trim/rewrite" for accurate-but-verbose cases. Aligns with how Opus 4.7 should actually write comments, not just how to suppress them.
- Cycle Phase 6 now invokes the bundled `/review-cycle:de-slopify` directly rather than relying on a user-level `de-slopify` installation.

### Notes

- If you have a user-level `de-slopify` skill installed at `~/.claude/skills/de-slopify/`, you can remove it after upgrading to this version — the plugin's namespaced copy supersedes it. Or keep both; they don't conflict.

## [0.2.0] - 2026-05-10

### Changed

- Codex review is now invoked directly via the `codex review --uncommitted` CLI rather than through the `/codex:review` slash command. The Codex Claude plugin is no longer a dependency — only the Codex CLI binary needs to be installed and authenticated. This simplifies the dependency graph and avoids edge cases around invoking skills with `disable-model-invocation: true` from inside other skills.
- Codex preflight check changed from `/codex:status` slash command to direct `codex --version` invocation.

### Notes

- This is the first step in the dependency-reduction roadmap. Subsequent versions will embed de-slopify (0.3.0) and migrate pr-review-toolkit subagents into this plugin (0.4.0).

## [0.1.2] - 2026-05-10

### Fixed

- Stop hook output no longer includes `hookSpecificOutput`, which is not a valid field for Stop hooks per Claude Code's runtime schema (only `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, and `PostToolBatch` accept `hookSpecificOutput`). Directive content moved into the top-level `reason` field, with a short label in `systemMessage`. Previously the hook produced JSON that failed schema validation at runtime with "Hook JSON output validation failed".

## [0.1.1] - 2026-05-10

### Changed

- Renamed the main action skill from `cycle` to `review` to align with the Anthropic convention used by `pr-review-toolkit:review-pr` and improve discoverability in the `/` autocomplete. Invocation changed from `/review-cycle:cycle` to `/review-cycle:review`. All hook directives, documentation, and policy references updated accordingly.

## [0.1.0] - 2026-05-10

### Added

- Initial release.
- `/review-cycle:cycle` skill — full automated review loop with parallel Codex + pr-review-toolkit fan-out, fix-vs-defer policy, up to 4 iterations, and final de-slopify cleanup.
- `/review-cycle:inspect` skill — read-only inspection pass for sanity checks or pre-commit review.
- SessionStart hook to seed the per-project review sentinel idempotently on fresh session starts.
- Stop hook to gate turn-end on uncommitted-and-unreviewed changes.
- PreToolUse (Bash) hook to block `git commit` when the sentinel doesn't match the current state.
- Per-project opt-out via `.claude/.no-review-gate` and global kill-switch via `~/.claude/.disable-review-gate`.
- Embedded comment and fix-vs-defer policies inside the skills, with standalone copies in `reference/policies.md` for optional CLAUDE.md installation.

Generated by oakum 0.4.0.
