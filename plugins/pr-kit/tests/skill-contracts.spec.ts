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
