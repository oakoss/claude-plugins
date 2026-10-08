# Oak OSS — Claude Code plugins

Curated [Claude Code](https://code.claude.com) plugins published by [Oak OSS](https://github.com/oakoss).

## Available plugins

| Plugin | Description |
| --- | --- |
| [`review-cycle`](./plugins/review-cycle) | Automated multi-agent code review cycle with hook-driven gates. Spawns its own reviewer subagents in parallel (plus Codex when available), applies fixes per CLAUDE.md policy, prevents commits on unreviewed changes. |
| [`pr-kit`](./plugins/pr-kit) | Pull-request workflow toolkit: summarize review feedback, resolve merge conflicts, make diffs reviewable, and drive CI to green. |
| [`pr-watch`](./plugins/pr-watch) | A line above the prompt for each pull request Claude opens, merges by number, or is asked to watch: its GitHub workflows with a progress bar, then ready to merge, the failing job, or what blocks it. A branch Claude pushes gets a line too, until its checks pass. Claude is told of the same news, and of comments and reviews from others, without being asked. |
| [`prose`](./plugins/prose) | Plain technical prose for Claude: an always-on output style and a cleanup skill that remove AI filler, distilled from the Google developer style guide. |

## Install

Add this marketplace to your Claude Code, then install any plugin from it:

```bash
claude plugin marketplace add oakoss/claude-plugins
claude plugin install review-cycle@oakoss
```

To upgrade later:

```bash
claude plugin update review-cycle@oakoss
```

## Local development

Clone and load a plugin directly without installing:

```bash
git clone https://github.com/oakoss/claude-plugins
cd claude-plugins
claude --plugin-dir ./plugins/review-cycle
```

Use `/reload-plugins` inside Claude Code to pick up edits without restarting.

## Repository layout

```text
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json     # marketplace manifest
└── plugins/
    └── review-cycle/        # the plugin itself
        ├── .claude-plugin/
        │   └── plugin.json
        ├── skills/
        ├── hooks/
        ├── reference/
        ├── CHANGELOG.md
        ├── LICENSE
        └── README.md
```

## Contributing

See [`AGENTS.md`](./AGENTS.md) for plugin authoring conventions used in this marketplace.

## License

MIT — see [`LICENSE`](./LICENSE). Each plugin may have its own license; see the plugin's `LICENSE` file.
