# Oak OSS — Claude Code plugins

Curated [Claude Code](https://code.claude.com) plugins published by [Oak OSS](https://oakoss.dev).

## Available plugins

| Plugin | Description |
| --- | --- |
| [`review-cycle`](./plugins/review-cycle) | Automated multi-agent code review cycle with hook-driven gates. Spawns Codex and pr-review-toolkit reviewers in parallel, applies fixes per CLAUDE.md policy, prevents commits on unreviewed changes. |

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

```
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
