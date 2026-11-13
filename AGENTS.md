<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:

- Run `npx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# AGENTS.md

Conventions for authoring plugins in this marketplace.

## Task tracking

<!-- tm:start -->
This repo tracks its work in tm. Run `tm guide` for how to work with it.
<!-- tm:end -->

`.config/tm.toml` maps this repository to its tm Workspace, key `CPL`. tm keeps the Workspace on this machine, not in the repository, so a fresh clone restores it with `tm import <export>`, from the exports tm writes under `~/.tm/exports/<workspace>/`. A Workspace restored on a second machine forks from the first until they sync, so stop using tm for it on the first. Issues moved from beads on 2026-11-07: `tm show` still resolves an old id, so `tm show cpl-epc9` opens CPL-418. Beads' history is archived outside the repository, in `~/.tm/beads-archive/claude-plugins`, so no tool here takes this for a beads repository.

Issue references go in the commit footer: `Closes CPL-n` when the commit finishes the Issue, a bare `Refs CPL-n` otherwise. Ship moves a finished Issue to `in_review`, and `tm git scan`, which merge runs, moves it to done once its commit is on main.

### Labels, parents, order and priority

Four facts about an Issue live in four places: labels say what it touches and what it does to a release, a parent says which branch it rides, a `blocks` link says what comes first, and priority says how urgent it is. The scheme follows oakum's `docs/contributing/task-tracking.md`, with one label more because this repository ships several plugins.

- **Labels are `<dimension>:<value>`.** Every Issue carries one `plugin:` label: `plugin:review-cycle`, `plugin:pr-kit`, `plugin:pr-watch`, `plugin:session`, or `plugin:repo` for scripts, tests and CI outside a plugin. Every Issue but an epic or a branch parent also carries one `bump:` label for the bump file it will need: `bump:patch`, `bump:minor`, `bump:major` or `bump:none`. An `area:` label is optional: `area:gate`, `area:consent`, `area:containment`, `area:reviewers`, `area:tests`, `area:perf`, `area:ci`. Label when filing (`tm create --type task --title … --label plugin:review-cycle --label bump:patch`), and re-label when a decision changes the bump. Labels carried over from beads (`beads-type:`, `beads-status:`) are history.
- **A parent is a branch or a finding set.** A branch that carries several Issues gets a parent of type `task`, and `tm list parent:<key>` is its checklist. `epic` is for a finding set or a rollout.
- **A new finding joins the unclaimed parent whose branch already edits its file**; find it with `tm search <path>`, which reads descriptions too. When that branch is in flight, name the parent in the new Issue's description instead.
- **An Issue that claims a cost or a saving says whether it was measured, and how.** An inferred cost is triaged as a question to measure first: `cpl-dkrr` was filed to cut a cost, and measuring showed the cost was elsewhere, so it closed unbuilt.
- **Order is a link** (`tm link <earlier> blocks <later>`). **Priority is urgency**: urgent, now; high, the next branch opened; medium, the next release; low, scheduled; none, may slip. Work waiting on evidence before it is built sits in `triage`, which `tm ready` leaves out.

Views that use these: `tm ready`, `tm list labels:plugin:pr-kit`, `tm list status:todo labels:bump:minor`, and `tm list status:triage`.

## Layout

Every plugin lives under `plugins/<name>/` with the following minimum structure:

```bash
plugins/<name>/
├── .claude-plugin/
│   └── plugin.json          # required: manifest
├── README.md                # required: per-plugin docs
├── LICENSE                  # required: per-plugin license (typically MIT)
├── CHANGELOG.md             # required: Keep-a-Changelog format
└── package.json             # required: private, the version oakum releases
```

Optional component directories at the plugin root:

- `skills/<skill-name>/SKILL.md` — invoked as `/<plugin-name>:<skill-name>`
- `agents/<name>.md` — custom subagents
- `hooks/hooks.json` plus a hooks module (`register.ts`) — event handlers
- `reference/` — optional reference docs, snippets, examples
- `.mcp.json`, `.lsp.json`, `monitors/monitors.json` — server integrations

Do **not** put component directories inside `.claude-plugin/`. Only `plugin.json` goes there.

## Manifest conventions

`tests/manifests.spec.ts` holds every plugin to them: `name` matches the directory; `description` is one sentence and the marketplace entry repeats it; `version` is semver; `author` is `Oak OSS`, `hello@oakoss.dev`, `https://github.com/oakoss` (`oakoss.dev` has mail but no website); `license` is `MIT`; `repository` and `homepage` point at this repository and the plugin's directory; `keywords` is not empty; the required files exist and `.claude-plugin/` holds only `plugin.json`; and `marketplace.json` lists each plugin with `source: "./plugins/<name>"`.

## What enforces these rules

A rule here that a check enforces names the check; prose stays only where nothing can. When a mistake repeats, turn its rule into a check whose error names the fix.

| Rule | Enforced by |
| --- | --- |
| Manifest and marketplace conventions | `tests/manifests.spec.ts` (`pnpm test`) |
| `core.hooksPath` stays unset | `tests/hooks-path.spec.ts` (`pnpm test`) |
| No skill or agent names a `disable-model-invocation: true` skill | `tests/skill-references.spec.ts` (`pnpm test`) |
| A bump file for every change under `plugins/<name>/`; unquoted plugin names; an exact oakum pin | `oakum check --strict` (CI `Bump files`) |
| Plugin structure; `$` not passed into an imported function expression | `claude plugin validate --strict` (CI `Plugin manifests`) |
| Conventional commit messages | commitlint (lefthook `commit-msg`) |
| Types of the hooks modules and their specs (not `spec/node/`); lint and format everywhere | lefthook pre-commit, CI |
| Issue labels, parents and priorities; every function calling `$` stays in the registering file (validate passes one passed into an imported function declaration) | prose only |

## Hooks modules

Hooks here are hooks modules: TypeScript that Claude Code runs itself, named in `hooks.json` as `"modules": ["./register.ts"]`. review-cycle's commit gate and comment-slop check are one module. No plugin ships shell hooks. There is no build step and no runtime dependency — a module imports only relative files and `"claude-code"`.

- Keep every function that calls `$` in the file that registers the hooks. That is a convention, not something `claude plugin validate` enforces: across an import it follows `$` into a function declaration and passes, and refuses only a function expression (measured on 2.1.300). Pure logic goes in sibling files, which is also what makes it testable. Code that needs a process can live there too if it takes a runner as a parameter: review-cycle's `git.ts` takes a `Git` function, which `register.ts` builds from `$` (`gitOf`). `validate --strict` accepts that. It is a gap the validator does not check, not a documented pattern, so re-check it when Claude Code updates.
- A hook that throws is skipped and the action proceeds. Where proceeding is the harm a hook exists to prevent, catch with `on(…).catch(handler)` and refuse; everywhere else, fail open, and tell the agent in the result's `context` when a check could not run rather than passing silently.
- Claude Code loads mods by default from v2.1.287 and ignores `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, the early-access switch: measured on 2.1.287, `claude plugin test plugins/review-cycle` ran its 223 tests with the variable unset and with it set to `0`. An older build loads no module without that variable, and its `claude plugin test` prints a notice and exits 0 having run nothing, so check that a run reports its tests.
- Pure logic is tested with vitest: `plugins/<name>/spec/<module>.spec.ts`, run by `pnpm test`, which also runs the specs that need Node, prose anchors among them, in each plugin's `spec/node/`. No vitest spec lives in a plugin's `hooks/` or `tests/`: `claude plugin validate` type-checks every file there and cannot resolve `vitest` (measured on 2.1.323, where 2.1.322 passed the same tree; a spec at the plugin root or in `spec/` passes). The module that registers hooks is tested with `claude plugin test plugins/<name>` (`pnpm test:hooks` for review-cycle), which runs only `*.test.ts` and whose kit is the only thing that can raise engine events. That kit runs no real processes: a test answers `process.run` itself with `{ value: { exitCode, stdout, stderr } }`, its options under `e.init`.
- Types come from `types/claude-code/claude-code.d.ts`, copied unedited from `types/claude-code.d.ts` in the folder the `plugin-authoring` skill names when it loads; its first line names the Claude Code version that wrote it. Replace it when Claude Code updates and a module uses something new. `pnpm typecheck` checks against it, `pnpm lint` runs oxlint type-aware, and `pnpm format` is oxfmt.

## Skill conventions

- Set `disable-model-invocation: true` only for skills that bypass a safety gate (e.g. marking state as reviewed without reviewing it) or perform meta-setup the user should explicitly initiate (e.g. writing global config). Local side effects like editing files don't qualify on their own — Claude already edits files freely, and the relevant boundary (commit, push, send) should be enforced by a hook, not by hiding the skill. When disabled, the skill is reachable only via `/<plugin>:<skill>` or a hook's `additionalContext` directive.
- Embed any load-bearing policies (comment rules, deferral criteria, etc.) directly in the skill body. The skill should be self-contained.
- If a policy could also apply outside the skill, provide a standalone snippet in `reference/` that users can copy into their `CLAUDE.md`.
- Keep skill bodies under ~500 lines. Move detailed reference material to supporting files in the skill directory.
- When a skill's prose tells the model to invoke another skill, write it as *invoke `/plugin:skill` via the Skill tool* — naming the tool fires more reliably than a bare slash command in prose. Never instruct model-invocation of a `disable-model-invocation: true` skill.
- A skill or agent change is **done when**: `claude plugin validate ./plugins/<name> --strict` passes; `pnpm test` is green; every factual claim the new prose makes has been verified against the tool or code it describes; a bump file describes the change; and the body is still under the line budget.

## Versioning and changelog

Releases are driven by [oakum](https://github.com/oakoss/oakum) bump files. Each plugin has a private `package.json` as its version anchor; `oakum version` writes that version, the changelog entry, and the declared `extra-files` — `plugin.json` and this repo's `marketplace.json` entry — in one pass. The exact `@oakoss/oakum` devDependency in `package.json` pins the oakum version. oakum reads its version from that pin rather than `tool-version` (ADR-0038), and its writing commands refuse when the running binary differs from it: measured on 0.8.3, `add` against a 0.8.2 pin exits 1 naming the pin to raise. `check --strict` catches a pin that is not an exact version (exit 2) but not a binary that differs from it, so CI's `pnpm exec`, which runs the pinned binary, is what keeps the two aligned. `check --strict` reports what it cannot verify at exit 2, which fails the step. Keep it failing: oakum's docs show a pattern for passing on exit 2, and adopting it here would drop those checks along with it.

There is deliberately no cross-file drift check. The old `sync-plugin-versions.mjs --check` CI job existed because bumpy versioned only `package.json`, leaving the manifests to drift; oakum writes them itself through `extra-files`, so agreement is a property of how they are written rather than something to verify afterwards. Nothing now catches drift introduced by hand or by a bad merge — `oakum check --strict` validates bump files, not manifest agreement.

- Use semver: `0.x.y` while pre-stable, `1.0.0` on first stable release.
- **Every behavioral change ships with a bump file**: `.changeset/<slug>.md` with `<plugin>: patch|minor|major` frontmatter (`pnpm exec oakum add` writes one). The plugin name is unquoted: oakum refuses a quoted unscoped name with `must not be quoted (only scoped npm names are quoted)`. The description is the changelog entry; write it release-notes-grade: what changed, why, and what the user does differently. Do not hand-edit `CHANGELOG.md` for new work. A note that is a heading with nothing under it renders no changelog section at all — `oakum version` consumes the file and the release says nothing about what you wrote. Since oakum 0.4.0 `check --strict` refuses it, naming the file: measured here, exit 1 under `--strict` against exit 0 without it. `version` itself still says nothing when it consumes one, so the gate is the only thing that catches it.
- On push to main with pending bump files, the Release workflow maintains a version PR (`oakum/version-packages`) carrying the version bumps, changelog entries, and synced manifests. **Merging that PR is the release**; `oakum release` then tags it and creates the GitHub releases.
- **The version PR's title is what lands on main, not its commit.** This repository allows squash-merge only and sets `squash_merge_commit_title = PR_TITLE`, so GitHub discards the `chore(release): version packages` subject oakum writes on the branch and uses the PR title instead. oakum 0.3.1 titled that PR `Version Packages`, which landed unconventionally (#55 was renamed by hand before merging). 0.3.2 defaults the title to the version commit's **built-in** message — the schema is explicit that a configured `commit-message` does not change it, which is why setting one was never the remedy and why #55 was misnamed with one already configured. Measured 2026-09-21 on the live branch under 0.3.2: the version commit's subject and PR #62's title are both `chore(release): version packages`, so the default lands conventionally and no rename is needed. Re-check after the first release on 0.4.0, since the workflow rebuilds that PR on every push to main; if it ever regresses, set `title` in `.changeset/_config.toml`, which takes the same `oakum status --json` document the commit message does.
- Direct releases remain valid for hand-cut cases: `pnpm exec oakum version` after writing a bump file does the whole propagation locally.
- Before releasing, run `claude plugin validate ./plugins/<name> --strict` — catches manifest and structure errors the tests don't cover.
- **Any change under `plugins/<name>/` needs a bump file naming that plugin.** There are no exemptions: a README-only or tests-only change still needs one, `<plugin>: none` or empty frontmatter if it should not release — a bare `none` line is refused. `oakum check --strict` decides, in CI's `Bump files` job. That is the only gate: nothing checks locally, so run `pnpm exec oakum check --strict` yourself before pushing if you want the answer sooner. A lefthook `pre-push` command was tried and removed — `oakum check` derives its range from the checked-out HEAD rather than from the refs being pushed, so pushing a branch while standing on `main` examined `main`, found nothing, and exited 0 while the uncovered branch reached the remote. Measured in a clone against a local bare remote.

  A repo-local PreToolUse hook used to enforce a looser version of this rule and was retired. Measured on oakum 0.4.0 against throwaway clones, all three at exit 1: a runtime change with no bump file (`changed with no covering intent`); a hand bump with all three manifests agreeing (`manifest 0.18.2 is above tagged 0.18.1`, plus the coverage error); and manifests disagreeing (the coverage error again). The hook offered a hand bump as an alternative to a bump file and waived docs and tests — both paths oakum refuses, so it was permitting what CI then rejected.

## Dependencies

Rejecting versions published in the last 24 hours is pnpm's own default since v11, so `pnpm-workspace.yaml` declaring `minimumReleaseAge: 1440` restates the window rather than tightening it. Declaring it is still load-bearing, measured on 12.4.2: left implicit, pnpm applies the gate and then waives it — writing a `minimumReleaseAgeExclude` entry into `pnpm-workspace.yaml` itself and exiting 0 (`minimumReleaseAgeStrict: true` stops the auto-write — it refuses instead, or prompts to approve when run interactively). Declared explicitly, it refuses at exit 1 and writes nothing. Declaring it is also what makes the key visible to Renovate, below.

A security patch is typically hours old when its fix PR arrives, so it lands inside that window. Measured on pnpm 12.4.2, an enforced gate takes one of two shapes:

- A manifest pinned to the fresh version fails to resolve: `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, listing each held-back version with its publish time and the cutoff. `--trust-lockfile` does not help — it skips verification, not resolution.
- A range the old version still satisfies exits 0, prints `Lockfile passes supply-chain policies`, and leaves the old version in the lockfile. Nothing names the version it declined.

The second shape is the one to watch: a green security PR whose lockfile never moved. Confirm the lockfile names the patched version before merging it.

Renovate clears the first shape itself. For upgrades flagged `isVulnerabilityAlert` it writes the matching `minimumReleaseAgeExclude` entry into the same PR, commented `# Renovate security update: <name>@<version>`, and skips that step entirely when `minimumReleaseAge` is absent or zero (`lib/modules/manager/npm/artifacts.ts`). Security PRs from anywhere else need the entry added by hand, then removed once 24 hours have passed.

An entry is either a name pattern carrying no version, where globs work, or `<name>@<exact-version>`. Combining the two fails with `Invalid value in minimumReleaseAgeExclude: Name patterns are not allowed with version unions`, and a range is never a version. Prefer the pinned form for a temporary waiver: a glob is version-agnostic, so it never expires and exempts the package indefinitely. Use a glob only where that is the intent — `@oakoss/*` here exempts our own scope permanently, trading the gate for not hand-editing an entry at every release. Packages shipping platform binaries need two entries, because the main package's entry does not cover them and they often sit under a different scope: `oxfmt` here resolves 19 `@oxfmt/binding-*` subpackages, so excluding `oxfmt` alone would leave every one of them gated.

## Testing

Test a plugin in-place during development:

```bash
claude --plugin-dir ./plugins/<name>
```

Use `/reload-plugins` to pick up edits without restarting the session; saving a hooks module reloads it on its own.

To have every session in this repository run the working tree's plugins, set `CLAUDE_CODE_PLUGIN_DIRS` while the shell is here, for example in a gitignored `mise.local.toml` at the root:

```toml
[env]
CLAUDE_CODE_PLUGIN_DIRS = "{{config_root}}/plugins/pr-kit:{{config_root}}/plugins/pr-watch:{{config_root}}/plugins/review-cycle:{{config_root}}/plugins/session"
```

The working tree's copies load beside the released installs, not instead of them: `claude plugin list` shows each plugin twice, once installed as `<name>@oakoss` and once as a session-only `<name>@inline`, so two review-cycle commit gates run and the released one can refuse what the working tree's allows. Switch the released copies off for this checkout in the gitignored `.claude/settings.local.json`:

```json
{
  "enabledPlugins": {
    "pr-kit@oakoss": false,
    "pr-watch@oakoss": false,
    "review-cycle@oakoss": false,
    "session@oakoss": false
  }
}
```

Measured on 2.1.309: with both set, `claude plugin list` shows each `@oakoss` install `✘ disabled` and each `@inline` copy `✔ loaded`, and a session already running stopped applying the released gate without a restart: `claude plugin uninstall --help`, which released 0.32.0 refused, ran.

With both set, an edit to a hooks module takes effect in the session that made it, so a change to the commit gate or the consent reader judges that session's own next commit and push. `CLAUDE_CODE_PLUGIN_DIRS= claude` then starts a session with none of these plugins; to run the released ones, remove the overrides too.

```bash
pnpm test          # vitest: modules' pure logic and prose anchors
pnpm test:hooks    # claude plugin test: the modules' hooks
pnpm typecheck && pnpm lint && pnpm format:check
```

review-cycle's consent reader (`hooks/exact.ts`) reads a closed vocabulary exactly: each request is one whole-message pattern in its `CLAUSES` table, and each question a yes may answer is one in `QUESTIONS`, which `offers.ts` writes. A message outside both grants nothing, and the refusal hands the agent the question to ask. Adding a phrasing is a decision about the vocabulary, not a fix: add its row to the table and its case to `spec/exact.spec.ts`, including a neighbour that must still grant nothing. A question added to `offers.ts` needs its pattern in `QUESTIONS`; `exact.spec.ts` fails for an offer step with no sample.

The labeled corpus (`hooks/consent.corpus.json`) holds loose phrasings and the steps each may grant, and `spec/consent.corpus.spec.ts` holds the reader to one thing: a row grants no step outside its `may`. A new row is `{ "prompt", "offer"?, "may" }`; the misses skill adds the rows the user labels.

Prose anchors (`plugins/<name>/spec/node/*.spec.ts`) pin wording that skills and agents load as instructions, where nothing else would notice it going missing. Write each against a mutation: remove the phrase it anchors and confirm the test fails. Read a skill and cut a section with `tests/skills.ts` (`skillText`, `section`, `expectAnchors`); its extractions throw on a missing heading rather than return nothing to check.
