// Prose anchors for pr-kit's skill bodies. Each contract is prose that a later
// edit could undo without any other check noticing. These check that the text
// is present, not that a model obeys it.
//
// Every extraction throws when it comes back empty, so a renamed heading or a
// moved fence fails here instead of passing with nothing checked.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { expectAnchors, REPO_ROOT, section, skillText } from '../../../tests/skills';

const PR_KIT = path.join(REPO_ROOT, 'plugins/pr-kit');

function prKitSkills(): string[] {
  const names = readdirSync(path.join(PR_KIT, 'skills')).toSorted();
  if (names.length < 4) {
    throw new Error(`found only ${names.length} pr-kit skills (expected at least 4)`);
  }
  return names;
}

function shellFences(text: string, label: string): string[] {
  const fences = [...text.matchAll(/^```(?:bash|sh|shell|zsh)\n([\s\S]*?)^```$/gm)].map(
    (m) => m[1],
  );
  if (fences.length === 0) throw new Error(`${label}: no shell fences found`);
  return fences;
}

function fenceLines(fences: string[]): string[] {
  return fences.flatMap((f) => f.split('\n')).map((line) => line.trimEnd());
}

function prose(text: string): string {
  return text.replaceAll(/^```[\s\S]*?^```$/gm, '');
}

function jsonFields(fences: string[]): Set<string> {
  const fields = [...fences.join('\n').matchAll(/--json ([\w,]+)/g)].flatMap((m) =>
    m[1].split(','),
  );
  return new Set(fields);
}

function atLeast<T>(items: T[], min: number, what: string): T[] {
  if (items.length < min) {
    throw new Error(`found only ${items.length} ${what} (expected at least ${min})`);
  }
  return items;
}

describe('make-pr-easy-to-review: the tree guard', () => {
  const text = skillText('pr-kit', 'make-pr-easy-to-review');
  const lines = fenceLines(shellFences(text, 'make-pr-easy-to-review'));

  test('no fence compares two command substitutions directly', () => {
    // `"$(git …)" = "$(git …)"` passes when git fails and both sides are empty.
    for (const line of lines) {
      expect(line).not.toMatch(/"?\$\([^)]*\)"?\s*(?:!=|==?)\s*"?\$\(/);
    }
  });

  test('TREES MATCH prints only after the comparison passes', () => {
    expect(lines).toContain('[ -n "$o" ] && [ "$o" = "$h" ] && echo "TREES MATCH $o"');
    expect(text).toContain('Do not push unless you see the literal line `TREES MATCH <sha>`.');
  });

  test('every capture resolves with --verify', () => {
    const captures = atLeast(
      lines.filter((line) => line.includes('git update-ref refs/pr-kit/original-')),
      4,
      'capture lines',
    );
    for (const line of captures) expect(line, line).toContain('rev-parse --verify');
  });

  test('each step of the capture and verify chains is joined with &&', () => {
    // A failed fetch or first update-ref that does not stop the chain leaves a
    // stale baseline for the tree comparison.
    const steps = atLeast(
      lines.filter((line) =>
        /^(git fetch |git update-ref refs\/pr-kit\/original-head |[oh]=\$\()/.test(line),
      ),
      6,
      'chained steps',
    );
    for (const line of steps) expect(line, line).toMatch(/&&$/);
  });
});

describe('fix-ci: the round cap', () => {
  const text = skillText('pr-kit', 'fix-ci');

  test('Guardrails and Do NOT state the same numeric cap', () => {
    expect(section(text, 'Guardrails', 'fix-ci')).toContain(
      '**Stop after three rounds, or two on the same check, whichever comes first.**',
    );
    expect(section(text, 'Do NOT', 'fix-ci')).toContain(
      'Do NOT exceed three rounds, or two on the same check',
    );
  });
});

// review-cycle's consent spec pins that a yes to this exact question grants the
// push; a reworded question can stop granting it.
describe('fix-ci: the push question', () => {
  test('asks the question review-cycle reads as a push request', () => {
    expect(skillText('pr-kit', 'fix-ci')).toContain(
      'end your answer with this question, word for word and unquoted: Should I commit and push the fixes?',
    );
  });
  test('a job that may push does not stop to ask', () => {
    expect(skillText('pr-kit', 'fix-ci')).toContain(
      'Skip the question when the `mcp__review-cycle__status` tool reports `mayPush` true, as under a job started with "do epic <id>"',
    );
  });
});

// Nobody answers mid-run, so each of these is what keeps a job from stopping,
// guessing, or doing what only the user may.
describe('do-epic: a job runs to its report', () => {
  const text = skillText('pr-kit', 'do-epic');

  test('it starts only on the job the gate started', () => {
    expectAnchors(section(text, '1. Confirm the job', 'do-epic'), 'do-epic confirm', [
      ['`stopBefore.mandate.epic` must name the epic the user asked for.', 'the mandate check'],
      ['Stop, and ask the user to type `do epic <id>` on its own', 'no job stops'],
      ['nothing reviews or gates the job. Stop and say so.', 'no gate stops'],
    ]);
  });
  test('the plan sees every bead and records itself before anything is built', () => {
    expectAnchors(section(text, '2. Plan', 'do-epic'), 'do-epic plan', [
      ['--status open,in_progress,blocked --limit 0 --json', 'no 50-bead cutoff'],
      ['bd dep list <ids…> --type blocks --json', 'only blocking dependencies order'],
      [
        "Done when every bead in scope is in exactly one branch, every branch is a lane or one layer of one stack, and the plan is in the epic's notes.",
        'completion',
      ],
    ]);
  });
  test('branches build one after another, and stop when the job ends', () => {
    const build = section(text, '3. Build each branch', 'do-epic');
    expectAnchors(build, 'do-epic build', [
      [
        'Build lanes one after another, then each stack bottom up, all in this checkout',
        'sequential lanes',
      ],
      [
        'when the mandate is gone, the user ended the job, so stop building and go to the report',
        'job end',
      ],
      ['git stash push --include-untracked -m "do-epic <id>: <why>"', 'shelve keeps the work'],
      ['Every bead that depends on a shelved bead is shelved too', 'dependents shelve'],
      [
        '**A refusal stops the branch.** When the gate refuses a command, the job does not reshape it',
        'refusals are not reshaped',
      ],
    ]);
  });
  test('a stack ships from its top and fixes CI from its bottom, each on its own branch', () => {
    expectAnchors(section(text, '4. Ship', 'do-epic'), 'do-epic ship', [
      ['plus `as drafts` when the user asked for drafts', 'drafts on request'],
      // Adopting only built layers keeps a shelved, empty layer out of gh-stack's record.
      [
        '**A stack:** once every layer is built, adopt the layers that have commits, bottom first, then ship from the top layer.',
        'adopt built layers',
      ],
    ]);
    expect(section(text, '3. Build each branch', 'do-epic')).toContain(
      'The stack itself is made at Ship, from the layers that have commits.',
    );
    expectAnchors(section(text, '5. Get CI green', 'do-epic'), 'do-epic CI', [
      ['bottom layer first in a stack, check out its branch', 'order and branch'],
      ['git switch <headRefName>', 'the checkout'],
    ]);
  });
  test('fix-ci pushes a stack layer through gh stack', () => {
    expect(skillText('pr-kit', 'fix-ci')).toContain(
      'On a layer of a github/gh-stack stack (`gh stack view --json` lists the branch), push with `gh stack push` instead, after `gh stack rebase --upstack` when layers sit above it, each as its own command with nothing before it, not even a `cd`',
    );
  });
  test('the report carries every outcome', () => {
    expectAnchors(section(text, '6. Report', 'do-epic'), 'do-epic report', [
      ['Not shipped:', 'ship failures'],
      ['Shelved:', 'shelved beads'],
      ['Left out of scope:', 'out-of-scope beads'],
      ['Deferred findings and questions:', 'ledger'],
      ['Refusals:', 'refusals'],
      ['Review rounds: <per commit', 'rounds'],
    ]);
  });
  test('it never merges or asks', () => {
    expectAnchors(section(text, 'Do NOT', 'do-epic'), 'do-epic never', [
      [
        'Do NOT merge, arm auto-merge, mark a draft ready, release, push to the default branch, or force push without a lease.',
        'user-only steps',
      ],
      ['Do NOT stop to ask mid-run. A question goes in the report.', 'no mid-run asks'],
      ['Do NOT work on a bead outside the epic', 'epic scope'],
      ['never `git checkout --` or `git reset --hard`', 'shelved work kept'],
    ]);
  });
});

describe('get-pr-comments: nothing open is dropped', () => {
  const text = skillText('pr-kit', 'get-pr-comments');
  const fences = shellFences(text, 'get-pr-comments');
  const threads = fences.find((f) => f.includes('reviewThreads'));
  const followUp = fences.find((f) => f.includes('PullRequestReviewThread'));

  test('the thread query pages the thread list', () => {
    // gh's --paginate needs an $endCursor variable fed back into `after`.
    expect(threads).toBeDefined();
    expectAnchors(threads ?? '', 'get-pr-comments threads', [
      ['gh api graphql --paginate --slurp', 'paginated query'],
      ['$endCursor:String', 'cursor variable'],
    ]);
    expect(threads).toMatch(
      /reviewThreads\(first:100,after:\$endCursor\)\{\s*pageInfo\{hasNextPage endCursor\}/,
    );
  });

  test('a thread with more comments is read to the end', () => {
    expect(followUp).toBeDefined();
    expectAnchors(followUp ?? '', 'get-pr-comments follow-up', [
      ['gh api graphql --paginate --slurp', 'paginated query'],
      ['$endCursor:String', 'cursor variable'],
      ['comments(first:50,after:$endCursor)', 'comments paged'],
    ]);
  });

  test('an outdated thread can still be located', () => {
    // `line` is null on an outdated comment.
    expect(threads).toContain('originalLine');
  });

  test('outdated but unresolved threads are reported, not skipped', () => {
    expectAnchors(text, 'get-pr-comments outdated', [
      ['Keep a thread that has `isOutdated` true and `isResolved` false.', 'outdated kept'],
      ['**Possibly stale — verify**', 'stale group'],
    ]);
    expect(section(text, 'Output', 'get-pr-comments')).toContain('Possibly stale — verify (N):');
    const outdated = atLeast(
      prose(text)
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => /outdated/i.test(sentence)),
      2,
      'sentences about outdated threads',
    );
    for (const sentence of outdated) {
      expect(sentence, sentence).not.toMatch(/\b(skip|drop|ignore|omit|exclude)/i);
    }
  });
});

describe('fix-merge-conflicts: markers and sides', () => {
  const text = skillText('pr-kit', 'fix-merge-conflicts');
  const finish = section(text, 'Finish', 'fix-merge-conflicts');
  const lines = fenceLines(shellFences(finish, 'fix-merge-conflicts Finish'));
  const markers = String.raw`-nE '^(<{7,}|\|{7,}|>{7,})( |$)|^={7,}$' -- ':/'`;

  test('the marker check covers the working tree, the index, and the whole repository', () => {
    for (const command of [
      'git diff --name-only --diff-filter=U',
      `git grep ${markers}`,
      `git grep --cached ${markers}`,
    ]) {
      expect(
        lines.some((line) => line.startsWith(command)),
        command,
      ).toBe(true);
    }
    expectAnchors(finish, 'fix-merge-conflicts markers', [
      ['All three commands must print nothing.', 'empty output'],
      ['An exit of 128 or a `fatal:` line means the search did not run', 'failed search'],
    ]);
  });

  test('no Finish fence falls back to git diff --check', () => {
    for (const fence of [...finish.matchAll(/^```\w*\n([\s\S]*?)^```$/gm)].map((m) => m[1])) {
      expect(fence).not.toMatch(/--cached\b.*--check|--check\b.*--cached/);
    }
  });

  test('conflicts without markers are resolved explicitly', () => {
    expectAnchors(finish, 'fix-merge-conflicts no markers', [
      ['Some conflicts leave no markers:', 'markerless conflicts'],
      [
        'take every path from `git diff --name-only --diff-filter=U` that has no text markers and decide it explicitly',
        'explicit decision',
      ],
      ['or drop the path with `git rm <path>`.', 'drop option'],
      ['which during a rebase is the upstream, not your commit.', 'rebase sides'],
      ['Name each choice in the report.', 'choices reported'],
      ['A submodule conflict is out of scope:', 'submodules out of scope'],
    ]);
  });

  test('a rebase is detected before sides are picked', () => {
    expectAnchors(text, 'fix-merge-conflicts rebase', [
      [
        'check its first lines for `rebase in progress`, because a rebase swaps the sides',
        'rebase detected',
      ],
      [
        '| `git rebase <ref>` | `<ref>`, the upstream you are replaying onto | **your own commit** being replayed |',
        'sides table',
      ],
      [
        'During a rebase, `git checkout --theirs` keeps your work and `--ours` keeps the upstream.',
        'swapped checkout',
      ],
    ]);
  });
});

describe('ship: what it may do unasked', () => {
  const text = skillText('pr-kit', 'ship');

  test('each write runs alone, and a refusal is reported, not reshaped', () => {
    expectAnchors(text, 'ship writes', [
      [
        'Run every command that writes, pushes, or closes as its own Bash call.',
        'one write per call',
      ],
      ['a refusal is never retried in another shape: report it and stop.', 'refusals not reshaped'],
    ]);
  });

  test('merge, auto-merge, ready and draft wait for the user', () => {
    expectAnchors(text, 'ship asks', [
      [
        'Nothing here merges, arms auto-merge, or marks a draft ready unless the user asked for that in so many words.',
        'no unasked merge',
      ],
      ['Add `--draft` only when the user asked for a draft.', 'drafts on request'],
      ['When the user asked for auto-merge, arm it after creating', 'auto-merge on request'],
    ]);
  });

  test('a gh-stack stack submits every layer, and readies none that is a draft', () => {
    const stack = section(text, 'Stack path', 'ship');
    expect(shellLines).toContain('gh stack view --json');
    expect(shellLines).toContain('gh pr view <number> --json isDraft');
    expect(shellLines).toContain('gh stack submit --auto --open');
    expectAnchors(stack, 'ship stack', [
      [
        "Leave it off when any layer's pull request is a draft, or when the user asked for drafts.",
        'no --open on drafts',
      ],
      ['Merge nothing into a layer', 'no merge into layers'],
      [
        'read its output, since a diverged stack prints `Sync aborted` and exits 0',
        'sync read by output',
      ],
      ['exits 0 even after printing `⚠ failed to create PR for <branch>`', 'submit read by output'],
      ["pass the gate's question to the user as written", 'gate question passed on'],
      [
        'run `gh stack submit` as its own Bash call with nothing before it, not even a `cd`',
        'submit runs alone',
      ],
      [
        'offer `gh stack sync`, which rebases the stack onto the trunk and pushes it; run it as its own Bash call with nothing before it',
        'sync offered',
      ],
      ['name those layers and ask before pushing', 'ask before pushing'],
      ['On a no, stop before pushing', 'stop on no'],
      ['return with `git checkout <branch>` whether they pass or fail', 'return to branch'],
      ["so each layer's pull request closes only what that layer finishes", 'per-layer closes'],
    ]);
    expect(text).toContain('one of its `branches` has `isCurrent: true`');
  });

  // Every fence of any tag or indent, plus inline code, so an unasked step
  // cannot hide outside a bash fence.
  const anyFenceLines = [...text.matchAll(/^[ \t]*```[\w-]*\n([\s\S]*?)^[ \t]*```$/gm)]
    .flatMap((m) => m[1].split('\n'))
    .map((line) => line.trim());
  const inlineCode = [...prose(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const shellLines = fenceLines(shellFences(text, 'ship')).map((line) => line.trim());

  test('no command merges, readies, forces, rebases, skips hooks or closes an issue', () => {
    const forbidden =
      /gh pr (merge|ready)\b|gh stack merge\b|gh issue close\b|--auto\b|--open\b|--no-verify\b|--force\b|(?<!no-)\brebase\b/;
    // gh-stack's `submit --auto` generates titles, `--open` is guarded by its
    // draft rule, and the rebases are only offered.
    const stacked =
      /^(gh stack submit --auto( --open)?|gh stack rebase (--no-trunk|--continue|--abort)|--open)$/;
    for (const line of [...anyFenceLines, ...inlineCode]) {
      if (!stacked.test(line)) expect(line).not.toMatch(forbidden);
    }
    for (const line of anyFenceLines) expect(line).not.toMatch(/--draft\b/);
  });

  test('it pushes the branch, never the default branch', () => {
    const pushes = [...anyFenceLines, ...inlineCode].filter((l) => /\bgit push\b/.test(l));
    expect(pushes).toEqual(['git push -u origin <branch>']);
  });

  test('every body goes through a file, on both paths', () => {
    const writes = anyFenceLines.filter(
      (l) => /^gh pr create\b/.test(l) || (/^gh pr edit\b/.test(l) && l.includes('--body')),
    );
    expect(writes.some((l) => l.startsWith('gh pr create'))).toBe(true);
    expect(writes.some((l) => l.startsWith('gh pr edit'))).toBe(true);
    for (const line of writes) expect(line).toContain('--body-file <file>');
  });

  test('orientation fetches every field the stops read', () => {
    const fields = jsonFields(shellFences(text, 'ship'));
    for (const field of ['owner', 'viewerPermission', 'defaultBranchRef', 'isFork', 'state']) {
      expect(fields.has(field), field).toBe(true);
    }
  });

  test('it stops on branches and repositories that are not its to ship', () => {
    expectAnchors(text, 'ship stops', [
      ['stop when the current branch is the default branch', 'default branch'],
      [
        '(`*/version-packages`, `renovate/*`, `dependabot/*`), or the work is a `chore(release)` change.',
        'bot and release branches',
      ],
      [
        "proceed when the owner is the user's own login or `viewerPermission` is `ADMIN` or `MAINTAIN`, and `isFork` is false, since a fork's pull request goes to someone else's project. Otherwise stop before pushing",
        'ownership and forks',
      ],
      [
        'It may be `main`, `master`, or anything else; use what it says.',
        'default read, not assumed',
      ],
    ]);
  });

  test('the path follows the request and the pull request state', () => {
    expectAnchors(text, 'ship path', [
      [
        'the **publish** path on "ship it". On "push it" there is nothing to update, so ask whether to publish.',
        'publish on ship it',
      ],
      ['gh pr view --json number,url,state,isDraft,title,body,headRefOid,closedAt', 'pr fields'],
      ['A merged or closed one: stop and ask, unless the name was reused', 'closed pr stops'],
      ['the branch is no stack layer', 'stack layers excluded'],
      [
        '`git merge-base --is-ancestor <headRefOid> HEAD` exits other than 0 (1, or 128 when that commit is not here)',
        'reuse by ancestry',
      ],
      ["was authored after the pull request's `closedAt`", 'reuse by date'],
      [
        '`gh pr list --head <name> --state all` lists no pull request for, and use it as `<branch>` from here on',
        'fresh name',
      ],
      ['Say so in the report, and go on as for no pull request found', 'rename reported'],
      ['on "push it", ask whether to publish before renaming.', 'push it asks'],
      ['Any other failure of `gh pr view`: stop and show it.', 'other failures stop'],
    ]);
  });

  test('leftover work is reviewed before it is committed, then checked', () => {
    expectAnchors(text, 'ship leftover', [
      [
        'review them before committing: invoke `/review-cycle:review` via the Skill tool',
        'review first',
      ],
      ['otherwise show the user the diff and wait for their OK.', 'user OK fallback'],
      ['Never bypass hooks.', 'hooks kept'],
    ]);
    expect(text.indexOf('## 2. Commit leftover work')).toBeLessThan(text.indexOf('## 3. Check'));
  });

  test('the branch is brought current by merging, never rebasing', () => {
    expectAnchors(text, 'ship current', [
      ['by merging, since rebasing a pushed branch would force a force-push', 'merge, not rebase'],
      [
        'offer `/pr-kit:fix-merge-conflicts`, or `git merge --abort` to back out.',
        'conflicts offered',
      ],
    ]);
    expect(shellLines).toContain('git merge origin/<default>');
  });

  test('checks gate the ship, and Verification comes from their output', () => {
    expectAnchors(text, 'ship checks', [
      ["Then run the project's full checks", 'full checks'],
      ['Run each check unpiped and read its exit code', 'exit codes read'],
      ['On any failure, stop and show its output; shipping waits for a fix.', 'failure stops'],
      [
        "the body's Verification section is written from these, not from memory.",
        'verification from output',
      ],
      ["Verification comes from step 3's checks", 'verification source'],
    ]);
  });

  test('a full run already seen on the same tree is reused, and nothing else is', () => {
    expectAnchors(text, 'ship reuse', [
      [
        'skip the run only when this conversation saw the same full set of checks pass on the tree now at HEAD, and the merge above brought nothing in.',
        'same full run',
      ],
      [
        'The tree is the same when `git status --porcelain` is empty and `git rev-parse HEAD^{tree}` prints the tree recorded when that run passed',
        'tree comparison',
      ],
      [
        'A partial run, a run on another tree, or one whose tree was not recorded counts as none.',
        'partial runs excluded',
      ],
      ['Verification then quotes that run and says it was reused.', 'reuse reported'],
      ['On the stack path nothing is reused', 'no reuse on stacks'],
      ['is named in Verification as left to CI.', 'left to CI'],
    ]);
  });

  test('only finished items close, and only beads close here', () => {
    expectAnchors(text, 'ship closes', [
      [
        'a `Refs` item only when this branch completes it, such as the bead the work was started for. Every other `Refs` item stays a `Refs` line, open.',
        'finished items only',
      ],
      [
        'Close only beads here, and on the update path only items the publish did not close:',
        'only beads',
      ],
    ]);
    expect([...anyFenceLines, ...inlineCode].filter((l) => /\bclose\b/.test(l))).toEqual([
      'bd close <id> --reason "<one line: what shipped>"',
    ]);
  });

  test('the task graph is pushed only when a remote exists', () => {
    expect(text).toMatch(/bd dolt remote list\nbd dolt push/);
    expect(text).toContain(
      'When `bd dolt remote list` lists nothing, skip the push and say so in the report',
    );
  });

  test('the branch is pushed before any item is closed', () => {
    expect(text).toMatch(/## 4\. Push[\s\S]*## 5\. Close finished tracker items/);
    expect(text).toContain('A refused push ends the ship here, before any item is closed.');
    expect(text).not.toContain('reopen');
  });

  test('an update with nothing to push still rewrites the body', () => {
    expectAnchors(text, 'ship no push', [
      [
        "when `git rev-parse HEAD` prints the pull request's head, read again now with `gh pr view <number> --json headRefOid --jq .headRefOid`, there is nothing to push: skip the push and go on, so the body is still rewritten from the branch.",
        'skip push, keep body',
      ],
      ['a branch behind its pull request included, pushes', 'behind still pushes'],
    ]);
  });

  test('the body follows the repository template, then the reference, without attribution', () => {
    expectAnchors(text, 'ship body', [
      ['/reference/pr-body.md` and write the title and body by it.', 'reference read'],
      [
        "read every file or directory the `find` lists; it sets the headings. Fill its headings by the reference's rules and remove its comment prompts.",
        'template headings',
      ],
      ['and ask when none clearly fits.', 'ask on unclear template'],
      ['run its linter on the title before using it', 'title linted'],
      ['`mcp__review-cycle__ledger`', 'ledger read'],
      ["entries dated on or after the branch's first commit", 'branch entries only'],
      [
        "**Attribution:** none, unless the repository's template or contribution guide asks for disclosure, or the user does.",
        'no attribution',
      ],
      ['rewrite the body for the whole branch, not an appended note', 'whole-branch body'],
    ]);
    // Fenced, because a model runs fenced commands but skipped the same step as a bullet.
    expect(shellLines).toContain(
      "find .github . docs -maxdepth 1 -iname 'pull_request_template*' 2>/dev/null || true",
    );
    expect(shellLines).toContain('gh pr list --state merged --limit 20 --json title');
  });

  test('the description names the phrases that ship', () => {
    const front = text.split('\n---\n', 1)[0];
    for (const phrase of ['"ship it"', '"let\'s ship"', '"ship"', '"push it"']) {
      expect(front).toContain(phrase);
    }
    // Loaded with every session's skill list, so it states the order the body runs.
    expect(front).toContain("pushes, closes the branch's finished tracker items");
  });
});

describe('ship: the pull request body reference', () => {
  const body = readFileSync(path.join(PR_KIT, 'reference', 'pr-body.md'), 'utf8');
  const rules = section(body, 'Rules', 'pr-body.md');
  // The template's own fenced headings would end section() early.
  const template = body.slice(body.indexOf('\n## Template\n'), body.indexOf('\n## Rules\n'));

  test('a repository template takes priority', () => {
    expect(body).toContain("A repository's own `PULL_REQUEST_TEMPLATE.md` takes priority");
  });

  test('the template carries the sections a reader relies on', () => {
    for (const heading of ['## Changes', '## Verification', '## Known issues', 'Closes <id>']) {
      expect(template).toContain(heading);
    }
  });

  test('the rules that keep the squash commit honest and short', () => {
    expectAnchors(rules, 'pr-body rules', [
      [
        '**Verification:** the checks that ran for this pull request and what they printed. Never a check that was only configured',
        'verification ran',
      ],
      [
        '**Leave out:** review rounds, conversation history, screenshots, and agent attribution.',
        'leave out',
      ],
      ['**Lines:** one line per bullet.', 'one line per bullet'],
      [
        "**Closes:** one line per work item the branch finishes, in the tracker's own format",
        'closes finished items',
      ],
      ['A related item the branch leaves open gets a `Refs` line instead.', 'refs for open items'],
      ['or a question stays open', 'open questions'],
      ["**Title:** the repository's convention", 'title convention'],
    ]);
  });
});

describe('merge: only what was asked, and a stack as one', () => {
  const text = skillText('pr-kit', 'merge');
  const stack = section(text, 'Stack', 'merge');
  const lines = fenceLines(shellFences(text, 'merge')).map((line) => line.trim());
  const stackLines = fenceLines(shellFences(stack, 'merge Stack')).map((line) => line.trim());

  test('each write runs alone, and a refusal is reported, not reshaped', () => {
    expectAnchors(text, 'merge writes', [
      ['Run every command that writes as its own Bash call.', 'one write per call'],
      ['a refusal is never retried in another shape', 'refusals not reshaped'],
    ]);
  });

  test('after a merge it watches the release pull request, and never offers its merge', () => {
    expectAnchors(text, 'merge release watch', [
      [
        "When pr-watch's watch tool exists and the repository has an open release pull request",
        'watch condition',
      ],
      ['`gh pr list --state open --json number,headRefName`', 'open pr list'],
      [
        'is `version-packages`, ends in `/version-packages`, or starts with `changeset-release/`',
        'release branch names',
      ],
      ['call the tool on it without `wake`', 'no wake'],
      [
        "Never offer or run its merge: merging it is the release, and stays the user's ask.",
        'release merge is user-only',
      ],
    ]);
  });

  test('the question a refusal names lists pull requests by number, with no notes', () => {
    expect(text).toContain('Name each pull request in that question by its number alone');
  });

  test('it merges only on an ask, and adds --auto or --admin only when asked', () => {
    expectAnchors(text, 'merge asks', [
      ['this skill runs only on an explicit ask, never offers a merge itself', 'explicit ask'],
      ['arms auto-merge (`--auto`) only when the user asked', 'auto on request'],
      ['Pass `--admin` only when the user asked for it in so many words.', 'admin on request'],
    ]);
    for (const line of lines) expect(line).not.toMatch(/--auto\b|--admin\b/);
  });

  test('a stack layer merges with gh stack merge, never gh pr merge', () => {
    expect(text).toContain('Any stack it lists makes this a stack merge');
    expect(stackLines).toContain('gh stack merge <number> --yes --<method>');
    for (const line of stackLines) expect(line).not.toMatch(/gh pr merge\b/);
    expect(lines.filter((line) => /gh (pr|stack) merge\b/.test(line))).toEqual([
      'gh pr merge <number> --<method> --delete-branch',
      'gh stack merge <number> --yes --<method>',
    ]);
  });

  test('a pull request merges only when it is ready, and a stack only when every layer is', () => {
    expect(lines).toContain(
      'gh pr view <number> --json number,state,isDraft,mergeStateStatus,baseRefName,headRefName,url',
    );
    expect(lines).toContain("gh api -X GET 'repos/{owner}/{repo}/stacks' -f pull_request=<number>");
    expectAnchors(text, 'merge ready', [
      ['the stacks call answers `[]` for a pull request in no stack', 'no-stack answer'],
      [
        'stop and say why when `state` is not `OPEN`, `isDraft` is true, or `mergeStateStatus` is `BLOCKED`, `BEHIND` or `DIRTY`',
        'state stops',
      ],
      [
        '`UNSTABLE` means a check has not passed: one that failed, or one still running.',
        'unstable meaning',
      ],
      ['`gh pr checks <number> --json name,bucket`', 'all checks read'],
      ['`gh pr checks <number> --required --json name,bucket`', 'required checks read'],
      ['Ignore `pass` and `skipping`.', 'passing ignored'],
      ['When any is `fail` or `cancel`, name it and ask before merging.', 'failures ask'],
      [
        'When the others are `pending`, at least one check is required and every required check is `pass` or `skipping`, merge, and name the pending ones in the report as still running',
        'pending non-required merge',
      ],
      [
        'when none is required the second exits 1 with `no required checks reported`, which means no check is required',
        'no required checks exit',
      ],
      [
        'When no check is required, or a required one is pending, name the pending ones and ask.',
        'pending required asks',
      ],
      ['would merge it into the layer below, not into the trunk', 'unlinked layer'],
      [
        'running the same `gh pr list` for each listed branch until it lists none',
        'layers walked up',
      ],
      [
        "Merge nothing: name them, and give the user the command to link them, to run in their own terminal: this pull request's number, then each one above it (`! gh stack link <number> <number above>…`)",
        'link command given',
      ],
      [
        'when this stop already named them earlier in the conversation and the user asks again to merge this one, merge it by step 2.',
        'repeat ask merges',
      ],
    ]);
    expect(lines).toContain(
      'gh pr list --base <headRefName> --state open --json number,headRefName',
    );
    expect(stack).toContain('apply its stops to each');
  });

  test('the set is named, and the number is checked against stack numbers', () => {
    expectAnchors(stack, 'merge stack set', [
      ['an unmerged one has `merged_at: null`', 'unmerged layers'],
      ['naming every one ("Merge #41 and #42?"), and end the turn', 'set named'],
      ["reads a bare number as a stack's number first", 'stack number first'],
      ['For "merge the stack", pass the stack\'s own `number`', 'stack number passed'],
      ['must fail with `HTTP 404`', 'number check'],
      ['run `gh stack merge` with no number in their own terminal', 'no-number merge'],
      ['where it cannot prompt it merges the whole stack', 'whole stack'],
      ['it takes no `--auto` and no `--admin`', 'no auto or admin'],
      ['Run it as its own Bash call with nothing before it, not even a `cd`', 'runs alone'],
    ]);
  });

  test('a refusal is reported in its own words, and the report says what landed', () => {
    expectAnchors(text, 'merge report', [
      ['report its words and stop, or ask the question it names', 'refusal words'],
      ['`gh pr view <number> --json mergeCommit,mergedAt`', 'landed check'],
      ["is the top pull request of the set, never the stack's number", 'top pull request'],
      ['say so rather than report it merged', 'no false merged'],
    ]);
  });

  test('sync is offered, not run, and read by its output, not its exit code', () => {
    for (const line of lines) expect(line).not.toMatch(/gh stack sync\b/);
    expectAnchors(stack, 'merge sync', [
      ['offer it rather than run it', 'offered'],
      [
        'When the user agrees, run it as its own Bash call with nothing before it, not even a `cd`',
        'runs alone',
      ],
      [
        'read its output, not its exit code: a diverged stack prints `Sync aborted` and exits 0',
        'read by output',
      ],
      ['so report that', 'reported'],
      [
        "(`gh stack modify`, `gh stack switch`) only from the user's own terminal",
        'user-terminal commands',
      ],
    ]);
  });

  test("the method is the repository's, asked when it allows several", () => {
    expect(lines).toContain(
      'gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge,defaultBranchRef',
    );
    expect(text).toContain('When several are allowed and the user named none, ask once which.');
  });
});

describe('every skill', () => {
  test('every <field> placeholder is fetched by a --json query in the same skill', () => {
    // A camelCase placeholder is a gh JSON field; filling one the skill never
    // fetched means the model invents the value.
    let checked = 0;
    for (const skill of prKitSkills()) {
      const text = skillText('pr-kit', skill);
      const fields = jsonFields(shellFences(text, skill));
      for (const [, name] of text.matchAll(/<([a-z]+[A-Z]\w*)(?:\.\w+)?>/g)) {
        checked += 1;
        expect(fields.has(name), `${skill}: <${name}> is never fetched`).toBe(true);
      }
    }
    expect(checked, 'field placeholders found').toBeGreaterThan(0);
  });

  test("the README's gh claim matches the skills that call gh", () => {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    const skills = prKitSkills();
    const withGh = skills.filter((skill) =>
      shellFences(skillText('pr-kit', skill), skill).some((f) => /^\s*gh /m.test(f)),
    );
    const requirement = readFileSync(path.join(PR_KIT, 'README.md'), 'utf8')
      .split('\n')
      .find((line) => line.includes('**GitHub CLI (`gh`)**'));
    expect(requirement).toBeDefined();
    expect(requirement).toContain(`${words[withGh.length]} of the ${words[skills.length]} skills`);
    for (const skill of skills) {
      const local = `\`${skill}\` is purely local`;
      if (withGh.includes(skill)) expect(requirement).not.toContain(local);
      else expect(requirement).toContain(local);
    }
  });
});
