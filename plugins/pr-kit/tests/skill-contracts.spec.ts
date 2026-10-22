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
    const ship = section(text, '4. Ship', 'do-epic');
    expect(ship).toContain('plus `as drafts` when the user asked for drafts');
    // Adopting only built layers keeps a shelved, empty layer out of gh-stack's record.
    expect(ship).toContain(
      '**A stack:** once every layer is built, adopt the layers that have commits, bottom first, then ship from the top layer.',
    );
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
    expect(threads).toContain('gh api graphql --paginate --slurp');
    expect(threads).toContain('$endCursor:String');
    expect(threads).toMatch(
      /reviewThreads\(first:100,after:\$endCursor\)\{\s*pageInfo\{hasNextPage endCursor\}/,
    );
  });

  test('a thread with more comments is read to the end', () => {
    expect(followUp).toBeDefined();
    expect(followUp).toContain('gh api graphql --paginate --slurp');
    expect(followUp).toContain('$endCursor:String');
    expect(followUp).toContain('comments(first:50,after:$endCursor)');
  });

  test('an outdated thread can still be located', () => {
    // `line` is null on an outdated comment.
    expect(threads).toContain('originalLine');
  });

  test('outdated but unresolved threads are reported, not skipped', () => {
    expect(text).toContain('Keep a thread that has `isOutdated` true and `isResolved` false.');
    expect(text).toContain('**Possibly stale — verify**');
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
    expect(finish).toContain('All three commands must print nothing.');
    expect(finish).toContain('An exit of 128 or a `fatal:` line means the search did not run');
  });

  test('no Finish fence falls back to git diff --check', () => {
    for (const fence of [...finish.matchAll(/^```\w*\n([\s\S]*?)^```$/gm)].map((m) => m[1])) {
      expect(fence).not.toMatch(/--cached\b.*--check|--check\b.*--cached/);
    }
  });

  test('conflicts without markers are resolved explicitly', () => {
    expect(finish).toContain('Some conflicts leave no markers:');
    expect(finish).toContain(
      'take every path from `git diff --name-only --diff-filter=U` that has no text markers and decide it explicitly',
    );
    expect(finish).toContain('or drop the path with `git rm <path>`.');
    expect(finish).toContain('which during a rebase is the upstream, not your commit.');
    expect(finish).toContain('Name each choice in the report.');
    expect(finish).toContain('A submodule conflict is out of scope:');
  });

  test('a rebase is detected before sides are picked', () => {
    expect(text).toContain(
      'check its first lines for `rebase in progress`, because a rebase swaps the sides',
    );
    expect(text).toContain(
      '| `git rebase <ref>` | `<ref>`, the upstream you are replaying onto | **your own commit** being replayed |',
    );
    expect(text).toContain(
      'During a rebase, `git checkout --theirs` keeps your work and `--ours` keeps the upstream.',
    );
  });
});

describe('ship: what it may do unasked', () => {
  const text = skillText('pr-kit', 'ship');

  test('each write runs alone, and a refusal is reported, not reshaped', () => {
    expect(text).toContain(
      'Run every command that writes, pushes, or closes as its own Bash call.',
    );
    expect(text).toContain('a refusal is never retried in another shape: report it and stop.');
  });

  test('merge, auto-merge, ready and draft wait for the user', () => {
    expect(text).toContain(
      'Nothing here merges, arms auto-merge, or marks a draft ready unless the user asked for that in so many words.',
    );
    expect(text).toContain('Add `--draft` only when the user asked for a draft.');
    expect(text).toContain('When the user asked for auto-merge, arm it after creating');
  });

  test('a gh-stack stack submits every layer, and readies none that is a draft', () => {
    const stack = section(text, 'Stack path', 'ship');
    expect(shellLines).toContain('gh stack view --json');
    expect(shellLines).toContain('gh pr view <number> --json isDraft');
    expect(shellLines).toContain('gh stack submit --auto --open');
    expect(stack).toContain(
      "Leave it off when any layer's pull request is a draft, or when the user asked for drafts.",
    );
    expect(stack).toContain('Merge nothing into a layer');
    expect(stack).toContain(
      'read its output, since a diverged stack prints `Sync aborted` and exits 0',
    );
    expect(stack).toContain('exits 0 even after printing `⚠ failed to create PR for <branch>`');
    expect(stack).toContain("pass the gate's question to the user as written");
    expect(stack).toContain(
      'run `gh stack submit` as its own Bash call with nothing before it, not even a `cd`',
    );
    expect(stack).toContain(
      'offer `gh stack sync`, which rebases the stack onto the trunk and pushes it; run it as its own Bash call with nothing before it',
    );
    expect(stack).toContain('name those layers and ask before pushing');
    expect(stack).toContain('On a no, stop before pushing');
    expect(stack).toContain('return with `git checkout <branch>` whether they pass or fail');
    expect(stack).toContain("so each layer's pull request closes only what that layer finishes");
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
    expect(text).toContain('stop when the current branch is the default branch');
    expect(text).toContain(
      '(`*/version-packages`, `renovate/*`, `dependabot/*`), or the work is a `chore(release)` change.',
    );
    expect(text).toContain(
      "proceed when the owner is the user's own login or `viewerPermission` is `ADMIN` or `MAINTAIN`, and `isFork` is false, since a fork's pull request goes to someone else's project. Otherwise stop before pushing",
    );
    expect(text).toContain('It may be `main`, `master`, or anything else; use what it says.');
  });

  test('the path follows the request and the pull request state', () => {
    expect(text).toContain(
      'the **publish** path on "ship it". On "push it" there is nothing to update, so ask whether to publish.',
    );
    expect(text).toContain('A merged or closed one: stop and ask.');
    expect(text).toContain('Any other failure of `gh pr view`: stop and show it.');
  });

  test('leftover work is reviewed before it is committed, then checked', () => {
    expect(text).toContain(
      'review them before committing: invoke `/review-cycle:review` via the Skill tool',
    );
    expect(text).toContain('otherwise show the user the diff and wait for their OK.');
    expect(text).toContain('Never bypass hooks.');
    expect(text.indexOf('## 2. Commit leftover work')).toBeLessThan(text.indexOf('## 3. Check'));
  });

  test('the branch is brought current by merging, never rebasing', () => {
    expect(text).toContain('by merging, since rebasing a pushed branch would force a force-push');
    expect(shellLines).toContain('git merge origin/<default>');
    expect(text).toContain(
      'offer `/pr-kit:fix-merge-conflicts`, or `git merge --abort` to back out.',
    );
  });

  test('checks gate the ship, and Verification comes from their output', () => {
    expect(text).toContain("Then run the project's full checks");
    expect(text).toContain('Run each check unpiped and read its exit code');
    expect(text).toContain('On any failure, stop and show its output; shipping waits for a fix.');
    expect(text).toContain(
      "the body's Verification section is written from these, not from memory.",
    );
    expect(text).toContain("Verification comes from this run's checks");
  });

  test('only finished items close, and only beads close here', () => {
    expect(text).toContain(
      'a `Refs` item only when this branch completes it, such as the bead the work was started for. Every other `Refs` item stays a `Refs` line, open.',
    );
    expect(text).toContain(
      'Close only beads here, and on the update path only items the publish did not close:',
    );
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

  test('the body follows the repository template, then the reference, without attribution', () => {
    expect(text).toContain('/reference/pr-body.md` and write the title and body by it.');
    expect(text).toContain(
      "read every file or directory the `find` lists; it sets the headings. Fill its headings by the reference's rules and remove its comment prompts.",
    );
    expect(text).toContain('and ask when none clearly fits.');
    // Fenced, because a model runs fenced commands but skipped the same step as a bullet.
    expect(shellLines).toContain(
      "find .github . docs -maxdepth 1 -iname 'pull_request_template*' 2>/dev/null || true",
    );
    expect(shellLines).toContain('gh pr list --state merged --limit 20 --json title');
    expect(text).toContain('run its linter on the title before using it');
    expect(text).toContain('`mcp__review-cycle__ledger`');
    expect(text).toContain("entries dated on or after the branch's first commit");
    expect(text).toContain(
      "**Attribution:** none, unless the repository's template or contribution guide asks for disclosure, or the user does.",
    );
    expect(text).toContain('rewrite the body for the whole branch, not an appended note');
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
    expect(rules).toContain(
      '**Verification:** the checks that ran for this pull request and what they printed. Never a check that was only configured',
    );
    expect(rules).toContain(
      '**Leave out:** review rounds, conversation history, screenshots, and agent attribution.',
    );
    expect(rules).toContain('**Lines:** one line per bullet.');
    expect(rules).toContain(
      "**Closes:** one line per work item the branch finishes, in the tracker's own format",
    );
    expect(rules).toContain('A related item the branch leaves open gets a `Refs` line instead.');
    expect(rules).toContain('or a question stays open');
    expect(rules).toContain("**Title:** the repository's convention");
  });
});

describe('merge: only what was asked, and a stack as one', () => {
  const text = skillText('pr-kit', 'merge');
  const stack = section(text, 'Stack', 'merge');
  const lines = fenceLines(shellFences(text, 'merge')).map((line) => line.trim());
  const stackLines = fenceLines(shellFences(stack, 'merge Stack')).map((line) => line.trim());

  test('each write runs alone, and a refusal is reported, not reshaped', () => {
    expect(text).toContain('Run every command that writes as its own Bash call.');
    expect(text).toContain('a refusal is never retried in another shape');
  });

  test('it merges only on an ask, and adds --auto or --admin only when asked', () => {
    expect(text).toContain('this skill runs only on an explicit ask, never offers a merge itself');
    expect(text).toContain('arms auto-merge (`--auto`) only when the user asked');
    expect(text).toContain('Pass `--admin` only when the user asked for it in so many words.');
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
    expect(text).toContain('the stacks call answers `[]` for a pull request in no stack');
    expect(text).toContain(
      'stop and say why when `state` is not `OPEN`, `isDraft` is true, or `mergeStateStatus` is `BLOCKED`, `BEHIND` or `DIRTY`',
    );
    expect(text).toContain(
      '`UNSTABLE` means a check that is not required failed: name it and ask before merging.',
    );
    expect(text).toContain('would merge it into the layer below, not into the trunk');
    expect(lines).toContain(
      'gh pr list --base <headRefName> --state open --json number,headRefName',
    );
    expect(text).toContain(
      'running the same `gh pr list` for each listed branch until it lists none',
    );
    expect(text).toContain(
      "Merge nothing: name them, and give the user the command to link them, to run in their own terminal: this pull request's number, then each one above it (`! gh stack link <number> <number above>…`)",
    );
    expect(text).toContain(
      'when this stop already named them earlier in the conversation and the user asks again to merge this one, merge it by step 2.',
    );
    expect(stack).toContain('apply its stops to each');
  });

  test('the set is named, and the number is checked against stack numbers', () => {
    expect(stack).toContain('an unmerged one has `merged_at: null`');
    expect(stack).toContain('naming every one ("Merge #41 and #42?"), and end the turn');
    expect(stack).toContain("reads a bare number as a stack's number first");
    expect(stack).toContain('For "merge the stack", pass the stack\'s own `number`');
    expect(stack).toContain('must fail with `HTTP 404`');
    expect(stack).toContain('run `gh stack merge` with no number in their own terminal');
    expect(stack).toContain('where it cannot prompt it merges the whole stack');
    expect(stack).toContain('it takes no `--auto` and no `--admin`');
    expect(stack).toContain('Run it as its own Bash call with nothing before it, not even a `cd`');
  });

  test('a refusal is reported in its own words, and the report says what landed', () => {
    expect(text).toContain('report its words and stop, or ask the question it names');
    expect(text).toContain('`gh pr view <number> --json mergeCommit,mergedAt`');
    expect(text).toContain("is the top pull request of the set, never the stack's number");
    expect(text).toContain('say so rather than report it merged');
  });

  test('sync is offered, not run, and read by its output, not its exit code', () => {
    for (const line of lines) expect(line).not.toMatch(/gh stack sync\b/);
    expect(stack).toContain('offer it rather than run it');
    expect(stack).toContain(
      'When the user agrees, run it as its own Bash call with nothing before it, not even a `cd`',
    );
    expect(stack).toContain(
      'read its output, not its exit code: a diverged stack prints `Sync aborted` and exits 0',
    );
    expect(stack).toContain('so report that');
    expect(stack).toContain(
      "(`gh stack modify`, `gh stack switch`) only from the user's own terminal",
    );
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
