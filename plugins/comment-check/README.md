# comment-check

Flags comment slop in each file the agent writes, right after the Edit or Write, and tells it to fix the comments before it carries on.

## What it does

After every Edit and Write, it scans the file for high-confidence comment slop: section markers, restate-the-code phrasings, hedge prefixes, ticketless TODOs, hedge words and change-history narration. It also checks the comment density of the text just written: 4 or more comment lines making up 30% or more of a code edit. A Write's shebang and leading header comment block are exempt, since a new file's header is not narration. On a hit it adds a directive to the tool result, naming the file and the lines, that tells the agent to fix the comments with a follow-up Edit before continuing.

It never blocks a call: the write has already happened. It scans only files inside a git repository, and when git cannot run, the agent is told the scan was skipped. Prose files (`.md`, `.txt`, …) are skipped, since `#` is a heading there, and comment-carried config formats (`.yml`, `.toml`, …) are exempt from the density check. Files over 1 MiB, binaries, and generated directories such as `node_modules` and `dist` are not scanned.

An edit made through Bash (`sed -i`, a redirect, a script) is not scanned.

## How it works

A hooks module (`hooks/register.ts`) wraps the `Edit` and `Write` tool calls. After the tool runs, it finds the repository with `git rev-parse --show-toplevel`, reads the file, and checks it with the patterns in `hooks/slop.ts`.

## Install

```bash
claude plugin marketplace add oakoss/claude-plugins
claude plugin install comment-check@oakoss
```

## Requirements

Claude Code with mods (2.1.287 or newer) and `git`.
