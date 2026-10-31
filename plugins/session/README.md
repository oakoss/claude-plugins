# session

Titles each Claude Code session after the git branch it works on.

## What it does

When you send a message, or a session starts, on a branch other than the default, the session is titled with the branch's name past its first `/`: `fix/force-choice-gaps` becomes `force-choice-gaps`. Claude Code shows that title on the prompt bar and as the terminal's title, which a terminal like Rex shows as the tab's name, and it names the session in `/resume`. Check out another branch and the next message retitles the session.

A name you give the session wins. A title from `/rename`, `/branch <name>` or `--name` stays: the plugin keeps the last title it set for each session, and changes the title only while it is still that one, after a `claude --resume` too. The one name it cannot tell from its own is that same text, so a `/rename` to exactly the title it set last is replaced at the next branch change. On the default branch, or a detached HEAD, it leaves the title as it is, so a session that only asks questions keeps Claude Code's own.

To keep one session per piece of work, `/rename` the session you are leaving and `/branch <name>` into the next: both stay in `/resume`.

## How it works

A hooks module (`hooks/register.ts`) answers the `SessionStart` and `UserPromptSubmit` hooks with a `sessionTitle`, which Claude Code applies as `/rename` does. It reads the branch with `git branch --show-current` and the default with `git symbolic-ref refs/remotes/origin/HEAD`. When the clone never recorded one, `init.defaultBranch`, `main` and `master` all count as the default, so a repository whose default is another name, created locally or cloned under another remote name, has it titled until `git config init.defaultBranch <name>` names it in that repository. The plugin's store keeps the last title it set for each of the newest 200 sessions. When git or the store fails, the title stays as it is.

## Install

```bash
claude plugin marketplace add oakoss/claude-plugins
claude plugin install session@oakoss
```

## Requirements

Claude Code with mods (2.1.287 or newer) and `git`.
