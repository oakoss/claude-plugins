# Jev (TypeSafe System One) for the review-cycle plugin

- Date: 2026-09-19
- Author: Jace Babin
- Scope: Whether TypeSafe's Jev model should be built into `review-cycle`, and where the plugin's wall clock actually goes.

## Question

Jev is a "System One" model that returns typed judgments with calibrated
probabilities instead of generated text. Three questions:

1. Can it do anything `review-cycle` needs — deduplicating findings across legs,
   filtering findings a previous iteration already settled, grading execution
   receipts?
2. Can it make the cycle faster? Runs take from a couple of minutes to 30+, over
   1-3 iterations.
3. Is there repetitive work in the reviews that a cheap classifier would excel at?

## Sources

- <https://docs.typesafe.ai/llms.txt> — docs index; every page serves Markdown with `.md` appended
- <https://docs.typesafe.ai/api> — request and response schema
- <https://docs.typesafe.ai/models> — pricing, context, rate limits
- <https://docs.typesafe.ai/model-jaggedness/jev-1.13> — first-party failure modes
- <https://docs.typesafe.ai/cookbooks/entity_alignment> — pairwise merge decision, three-level Score
- <https://docs.typesafe.ai/cookbooks/skill_suggestion> — two-stage rank-then-verify
- <https://docs.typesafe.ai/cookbooks/parallel_questions> — batching many questions into one request
- <https://openrouter.ai/typesafe/jev-1.13> — provider listing
- <https://varlock.dev/llms-full.txt> — credential handling, proxy, agent guidance
  (<https://varlock.dev/llms.txt> is an index only and does not carry these statements)
- <https://github.com/cobanov/awesome-jev> — ecosystem list, reviewed 2026-09-19
- <https://github.com/valentynkit/jev-belay> — Claude Code Stop hook using Jev
- <https://github.com/qkal/Canny> — evidence ledger for agent "done" claims
- <https://github.com/devagrawal09/jev-review> — staged code-review workflow
- <https://github.com/doeixd/jev-pref> — `AGENTS.md` preferences as a Jev linter
- Local transcripts under `~/.claude/projects/-Users-jacebabin--code-github-oakoss-claude-plugins/`

## Findings

### What Jev is

One endpoint, `POST https://api.typesafe.ai/v1/systemone`. A request carries a
`state` (string, object, or array of text), a `model`, and a `questions` map whose
keys you choose. Answers return under the same keys. No SDK required: `curl` and
`jq` are enough.

Three question types:

| Type | Returns |
| --- | --- |
| Noul | `noul`, a 0-1 probability of yes. No confidence field. |
| Choice | `choice`, `probabilities` across options, `confidence` |
| Score | `score` (probability-weighted, lands between levels), `probabilities`, `legend`, `confidence` |

`confidence` measures how concentrated the distribution is. The docs are explicit
that this is distribution shape, not workflow correctness.

It does not generate text, cannot run commands, and its own jaggedness page names
literal reading, arithmetic, date ordering, counting, and multi-hop indirection as
failure modes. (Documented, not measured here.)

### Access and cost

Vendor-documented unless marked measured. Checked 2026-09-19:

- **Documented** (<https://docs.typesafe.ai/models>): $0.042 per million input
  tokens, output free.
- **Documented** (same page): 64k context per request, 32k for `state` plus the
  longest question.
- **Measured** by querying OpenRouter's own endpoint — OpenRouter
  (`typesafe/jev-1.13`, listed 2026-09-18): identical price, **32,000**
  context, `supported_parameters: []`, architecture `text->decisions`. The request
  shape through OpenRouter was not verified — no key available — so whether
  `probabilities` and `confidence` survive that path is unconfirmed.
- **Measured here**: 80 calls completed in 12.0s wall clock at 4 workers.

### Credential handling

`varlock` 1.20.0 (Homebrew standalone binary) resolving from 1Password, with a
personal schema at `~/.env.jev` passed with `-p`. varlock deliberately does not
auto-load a global schema. Completion went to `~/.zfunc/_varlock`, matching the
existing convention; `.zshrc` needed no changes, and the instructions on
varlock.dev would have appended an `fpath` line after `compinit` already ran.

**Defect found (varlock 1.20.0).** A function argument containing an unquoted space
silently degrades to a string literal. No error at parse, load, or run:

```env-spec
# ---
FOO=regex(^abc def$)
```

`varlock load --format json` prints `{ "FOO": "regex(^abc def$)" }` at exit 0.

A literal **space** inside the parentheses is the sole trigger, and it suppresses
function parsing entirely. Measured across 11 cases on varlock 1.20.0: a tab in the
same position parses correctly and errors; padding inside the parentheses parses
correctly; quoting fixes it. It is not function-specific — reproduced on `regex()`,
`exec()`, and `fallback()` — and it defeats even the unknown-function check, since
`FOO=notafunction(abc def)` also loads clean at exit 0 while `FOO=notafunction(abcdef)`
errors with `Unknown resolver function: notafunction()`.

In our case `op(op://Infrastructure Secrets/TypeSafe Jev/credential)` produced a
55-character literal against a real key of 108, surfacing only as a 401 from the
API. Quoting the reference fixes it. Not yet reported upstream.

### Does it work on findings?

Eight hand-labelled pairs of `review-cycle` findings, one three-level Score plus
three diagnostic Nouls, one request per pair:

| id | label | score | conf | routed to |
| --- | --- | --- | --- | --- |
| s01 | same | 1.96 | 0.94 | suppress as duplicate |
| s02 | not_same | 1.01 | 0.99 | hand to reviewer |
| s03 | not_same | 0.01 | 0.99 | keep both |
| s04 | same | 1.52 | 0.28 | suppress as duplicate |
| s05 | ambiguous | 1.20 | 0.69 | hand to reviewer |
| s06 | not_same | 0.11 | 0.84 | keep both |
| s07 | same | 1.77 | 0.65 | suppress as duplicate |
| s08 | not_same | 1.05 | 0.87 | hand to reviewer |

Zero false suppressions. The hard case is `s02`: the identical `cat`-versus-builtin
weakness in `commit-gate.sh` and `stop-gate.sh`. Jev refused to merge them and the
nouls said why — `same_mechanism` 0.91, `same_location` 0.02.

A question-wording defect surfaced on the same pair: `single_edit_fixes_both`
returned 0.87 for findings in two different files, because the original wording
("would one and the same edit resolve both") reads as the same *kind* of edit. That
is the literal-reading failure mode, hit on the third call.

### Run-to-run drift

Ten runs of each identical request:

| id | min | max | spread |
| --- | --- | --- | --- |
| s01 | 1.94 | 1.97 | 0.030 |
| s02 | 1.01 | 1.01 | 0.000 |
| s03 | 0.01 | 0.01 | 0.000 |
| s04 | 1.43 | 1.54 | **0.110** |
| s05 | 1.16 | 1.21 | 0.050 |
| s06 | 0.09 | 0.12 | 0.030 |
| s07 | 1.72 | 1.82 | 0.100 |
| s08 | 1.05 | 1.07 | 0.020 |

Widest spread 0.110, against the ~0.05 that Canny's source states. One pair in eight
changed its routed outcome across identical requests: `s04` straddles the 1.50 cut
point, so its earlier "correct" answer was a coin toss that landed well.

**Drift concentrates at decision boundaries.** Confident answers are stable to three
decimals. That makes a dead band the right instrument: it targets the unstable
region. Round-to-nearest, which the entity-alignment cookbook uses, is unsafe for a
decision that suppresses findings.

### Where review-cycle's time actually goes

138 legs across all local sessions, joined to the type each was spawned as from the
`Agent` tool result:

| reviewer | n | min | median | max |
| --- | --- | --- | --- | --- |
| maintainability-auditor | 12 | 3.7m | 16.3m | 25.2m |
| pr-test-analyzer | 21 | 0.8m | 14.0m | 70.0m |
| code-reviewer | 58 | 0.9m | 12.8m | 60.1m |
| spec-conformance-analyzer | 17 | 2.4m | 7.5m | 63.4m |
| silent-failure-hunter | 21 | 3.5m | 7.1m | 20.4m |
| cleanup | 9 | 0.8m | 4.6m | 9.6m |
| **all legs** | **138** | **0.8m** | **10.3m** | **70.0m** |

Fan-out wall clock (the slowest leg in each group): 0.9m / 15.9m / 43.3m across 32
multi-leg groups.

Which leg sets the clock:

| reviewer | in a group | was slowest | share |
| --- | --- | --- | --- |
| maintainability-auditor | 10 | 8 | 80% |
| code-reviewer | 18 | 12 | 67% |
| pr-test-analyzer | 14 | 9 | 64% |
| spec-conformance-analyzer | 12 | 2 | 17% |
| silent-failure-hunter | 14 | 1 | 7% |
| cleanup | 3 | 0 | 0% |

Legs run in parallel, so skipping one saves wall clock only if it was the slowest.

Three further measurements:

- **Context is not a constraint.** 0 of 154 subagent transcripts ever compacted. The
  main sessions compact 4-6 times each, but those span hours of general work.
- **Work is not duplicated across legs.** Within a fan-out, only 24 distinct repeated
  commands across 13 of 32 groups, all trivial: `mktemp -d`, `git status`, `git diff`.
- **Time splits roughly in half.** Across 29.1 hours of leg wall clock: 13.3 hours in
  command execution, 15.7 hours (54%) model time. `silent-failure-hunter` is the
  outlier at 79% model time and 38 minutes of commands across 21 legs.

### What the findings are

88 findings extracted from 138 leg reports and classified by what it would take to
settle each one. 16 came back as extraction noise — 18% of the sample, against a
manual estimate of roughly 30% made by reading ten at random. The two disagree, so
the extractor is cleaner than it looked by eye:

| class | n | share of real |
| --- | --- | --- |
| behavioral | 52 | 72% |
| mechanical | 15 | 21% |
| convention | 5 | 7% |

Two Nouls rode along in the same request. Of the 72 real findings, **12 (17%)**
scored above 0.7 on "would settling this require running a command", and 4 scored
above 0.7 on "does the text quote output from a command that was actually run".

Only 26% of `code-reviewer` legs read `AGENTS.md` or `CLAUDE.md` at all (15 of 58).
The policies reach them through the agent body, not by re-reading files.

### Prior art

The ecosystem is roughly one week old. One curated list carried 160 link bullets on
2026-09-19, of which 10 sit in its "Start here" and "Recent developments" prose
sections, leaving roughly 150 project entries. Four repositories were read in full.

`jev-review` decomposes review into staged typed judgments and keeps
thresholds in code. Its own README concedes the limitation: "Findings are review
prompts, not proof of a defect."

`jev-belay` is a Claude Code Stop hook with the same plugin structure as ours. Three
transferable designs: a deterministic pre-screen so a call is spent only when code
cannot decide; a hard veto in code that outranks the model, with its own test; and
`OUTCOME_FLOOR = 0.4` on a Choice, because "a four-way choice picked at 0.26 is a
coin toss." It ships with 8 synthetic hand-authored fixtures.

`Canny` is an evidence ledger. Append-only JSONL per session "so parallel hook
processes never clobber each other"; facts not file contents; paths relative to cwd;
state derived by replaying the log; the Jev call itself logged as a third entry type
alongside events and verdicts. Its client caches on a hash of the whole request body,
returns null rather than throwing when the key is absent, and takes an injectable
`fetch` so tests run offline. Its comment states Jev "drifts about 0.05 between runs"
and gates on a 0.1/0.9 dead band.

`jev-pref` turns `AGENTS.md` preferences into a Jev linter that feeds findings back
to coding agents.

Two warnings from the evaluation projects, both read from those projects' own
documentation rather than measured here. `jev-orderby-bench` reports that a DuckDB
extension's default 40-row batching fails a ranking gate that one row per request
passes — **batching degrades answers**. And `reachjalil/jev-tree` states the cap it
exists to work around: "TypeSafe's Jev can only list 255 options in one choice
question", with its own `maxFanout` accepting 2-255.

Sixteen open reproductions are listed. `zhengxuyu/litjev` describes itself as turning
"any off-the-shelf LLM" into a Jev-like decision layer, serving the same
`/v1/systemone` schema; the awesome-jev entry describes it more narrowly as any Qwen
model. Neither was run here. If either holds, the third-party dependency is not
structural.

## Conclusions

**Do not build Jev into `review-cycle`.** Every candidate use was eliminated by
measurement:

- It cannot replace a leg. The three legs that set the clock all need to run
  commands or do structural reasoning. The one that looks like a classifier,
  `silent-failure-hunter`, sets the clock 7% of the time.
- It cannot prune context, because there is no context problem (0 of 154).
- It cannot remove duplicated work, because legs do not duplicate work.
- The repetitive judgment is mostly greppable. 21% of findings are mechanical; only
  7% are the semantic-but-not-executable tier where Jev is the right tool.

One use survives: skipping an iteration when a cycle has converged, worth a median
16 minutes. It depends entirely on a findings ledger that does not exist — and that
ledger, once built, addresses the same problem with exact-match fingerprinting and
no vendor.

Adding a third-party credential, a network path, and a value that drifts 0.110
between identical calls, to a plugin other people run, does not earn its place for
that.

Jev did earn its place as a research instrument: 88 findings classified in about a
minute for $0.002. Total spend across every experiment in this session was under one
cent.

## Implications / actions

- **Cap runaway legs.** `pr-test-analyzer` reaches 70 minutes against a 14-minute
  median and repeatedly exceeds its group's runner-up by 20-30 minutes. The existing
  stall watchdog is wake-driven and never fires on a leg that is slowly working. A
  time budget is the largest wall-clock win available and needs no new dependency.
- **Extend `posttool-slop.sh` to the hook and skill conventions.** It already applies
  the comment policy with regex, offline and fail-open. The same treatment for
  shebangs, `cat`-for-stdin, kill-switch ordering, and exit-2 would catch the
  mechanical 21% before a leg spends model time on it.
- **Build the findings ledger (`cpl-e0e.1`)** using Canny's shape: append-only JSONL,
  facts not contents, state replayed from the log, normalized fingerprints for exact
  duplicate collapse.
- **Only then** measure whether Jev's pairwise judgment beats exact-match plus Opus on
  the ambiguous remainder.
- Report the varlock unquoted-argument defect upstream.
- If any Jev work does happen: one row per request, never batch; a dead band of at
  least ±0.15 on any suppression cut; log every call; fail open in hooks and fail hard
  in measurement harnesses.

## Open questions

- How `code-reviewer`'s 461 minutes of model time divides between policy checking and
  genuine analysis. Transcripts show what ran and how long, not what was being
  thought about.
- The Choice option limit. `reachjalil/jev-tree` states it is 255 per choice question;
  the official docs do not mention it and it was not exercised here. Confirm against
  the API before any design offers a Choice over a list of settled findings.
- Whether the request shape survives OpenRouter, and whether `probabilities` and
  `confidence` come back on that path.
- Whether drift of 0.110 holds for other question shapes, or is specific to the
  three-level Score used here.
- The classification contradicts itself: 72% of findings were called behavioral but
  only 17% (12 of 72) were said to need a command to settle. Those two answers do not sit
  together, which is the documented "structural invariants are not guaranteed"
  failure appearing in our own data.

## Raw data

Harness and results were produced in a session scratchpad and are not committed:
`score.py` (strict scorer, aborts the run on any non-200), `drift.py`, `timing2.py`,
`critpath.py`, `repeats.py`, `where_time_goes.py`, `classify.py`, plus
`pairs.smoke.json` and the classified findings.

That splits the measurements in two. **Reproducible from this repository and the
local transcripts alone**, and independently reproduced during review of this
document: the leg table, the 15-of-58 policy-read figure, the 0-of-154 compaction
count, the per-session compaction counts, the 55-byte literal, and every percentage
and total in both share tables. **Not reproducible without the harness and a
TypeSafe key**: the smoke results, the drift table, and the 88-finding
classification. Their internal arithmetic can be checked from the tables; the
underlying calls cannot be re-run from what ships here.

Measurement discipline used throughout: any call that did not return a well-formed
200 aborted the run and wrote nothing, because an auth failure recorded as a row
reads as model indecision rather than a broken credential. The three failure paths —
missing key, unresolved secret reference, real 401 — were each exercised and each
aborted at exit 3 with no results written.
