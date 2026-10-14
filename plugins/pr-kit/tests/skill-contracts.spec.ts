// Prose anchors for pr-kit's skill bodies. Each contract is prose that a later
// edit could undo without any other check noticing. These check that the text
// is present, not that a model obeys it.
//
// Every extraction throws when it comes back empty, so a renamed heading or a
// moved fence fails here instead of passing with nothing checked.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const PLUGINS = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PR_KIT = path.join(PLUGINS, 'pr-kit');

function skillText(plugin: string, skill: string): string {
  return readFileSync(path.join(PLUGINS, plugin, 'skills', skill, 'SKILL.md'), 'utf8');
}

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

function section(text: string, heading: string, label: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`${label}: no "## ${heading}" section`);
  const body = text.slice(start + heading.length + 5);
  const end = body.indexOf('\n## ');
  return end === -1 ? body : body.slice(0, end);
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

  // Every fence of any tag or indent, plus inline code, so an unasked step
  // cannot hide outside a bash fence.
  const anyFenceLines = [...text.matchAll(/^[ \t]*```[\w-]*\n([\s\S]*?)^[ \t]*```$/gm)]
    .flatMap((m) => m[1].split('\n'))
    .map((line) => line.trim());
  const inlineCode = [...prose(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const shellLines = fenceLines(shellFences(text, 'ship')).map((line) => line.trim());

  test('no command merges, readies, forces, rebases, skips hooks or closes an issue', () => {
    const forbidden =
      /gh pr (merge|ready)\b|gh issue close\b|--auto\b|--no-verify\b|--force\b|(?<!no-)\brebase\b/;
    for (const line of [...anyFenceLines, ...inlineCode]) expect(line).not.toMatch(forbidden);
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
    expect(text).toContain("Read each check's exit code.");
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
    expect(text).toContain('When a push was refused after items were closed, name those items');
  });

  test('the body follows the repository template, then the reference, without attribution', () => {
    expect(text).toContain('/reference/pr-body.md` and write the title and body by it.');
    expect(text).toContain(
      "sets the headings. Fill its headings by the reference's rules and remove its comment prompts.",
    );
    expect(text).toContain('and ask when none clearly fits.');
    expect(text).toContain('read the last 20 merged titles');
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

describe('every skill', () => {
  test('no skill tells the model to invoke a disable-model-invocation skill', () => {
    let resolved = 0;
    for (const skill of prKitSkills()) {
      const text = skillText('pr-kit', skill);
      for (const [ref, plugin, target] of text.matchAll(
        /(?<![\w/.])\/([a-z][a-z-]*):([a-z][a-z-]*)\b/g,
      )) {
        // A plugin outside this repository cannot be checked; one inside it
        // must hold the skill, so a misspelled reference fails on the read.
        if (!existsSync(path.join(PLUGINS, plugin))) continue;
        const front = skillText(plugin, target).split('\n---\n', 1)[0];
        resolved += 1;
        expect(front, `${skill} → ${ref}`).not.toMatch(
          /^disable-model-invocation:\s*["']?true["']?\s*(?:#.*)?$/m,
        );
      }
    }
    expect(resolved, 'skill references resolved in this repository').toBeGreaterThan(0);
  });

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
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
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
