import { describe, expect, test } from 'vitest';

import { aliasCommits, classify, possibleAliases } from './command';
import { parse, parseShellAliases } from './shell';

const HEREDOC_MESSAGE = `git commit -m "$(cat <<'EOF'
feat(x): add a thing

Some body text that mentions git push and ) and "quotes".
EOF
)"`;

const PLAIN = { all: false, amend: false, dryRun: false, config: [] };

function expanded(cmd: string, table: [string, string][]): string {
  const parsed = parse(cmd, new Map(table));
  return 'error' in parsed ? parsed.error : parsed.text;
}

function readable(cmd: string): string {
  const r = classify(cmd);
  return r.kind === 'refuse' ? r.reason : r.kind;
}

describe('passes commands that do not commit or push', () => {
  const none = [
    'ls -la',
    'git status',
    'git log --oneline -5',
    "grep -rn 'git commit' .",
    String.raw`printf 'git commit\n'`,
    'echo "run git commit when ready"',
    "cat > notes.md <<'EOF'\ngit commit -m x\ngit push\nEOF",
    'rg commit src/',
    'git diff HEAD -- src',
    '# git commit\nls',
    'npm test 2>&1 | tail -5',
    'git ls-files | xargs grep -n "git push"',
    'timeout 30 grep -rn "git commit" docs',
    'bd create "Fix it" --description "then git commit and git push"',
    'gh pr create --title x --body "Run git push after review"',
    `files=(a b c); echo \${files[@]}`,
    'diff <(ls a) <(ls b)',
    'f() { echo hi; }; f',
    '[[ $x =~ ^(a|b)$ ]] && echo y',
    'echo hi > >(cat)',
    'echo $((1 + 2))',
    `echo \${HOME:-/tmp}`,
    'git log --grep="commit"',
    'git add -A && pnpm exec lefthook run pre-commit',
    'git status && npx lefthook run pre-commit --all-files',
    "git diff -- plugins/pr-kit/skills/fix-merge-conflicts/SKILL.md | sed -n '1,40p'",
    'git checkout -b fix/merge-conflicts && pnpm install',
    "sed -n '1,30p' .git/hooks/pre-commit",
    "rg -n 'git push' docs | awk -F: '{print $1}' | sort -u",
    'for f in $(git diff --name-only); do case $f in *.md) echo doc;; esac; done',
    'GIT_PAGER=cat git log --grep=push -3',
    'GIT_TERMINAL_PROMPT=0 git status',
    `cd "$(git rev-parse --show-toplevel)" && codex review --uncommitted -c "developer_instructions=\\"do not git commit or git push\\""`,
    'rg git commit README.md',
    'echo git push',
    "sed -n '/git push/p' README.md",
    "sed -i '' 's/git commit -m/git commit -sm/' SKILL.md",
    "awk '/git push/' README.md",
    "pnpm test -- -t 'refuses git commit'",
    'pnpm exec vitest run -t "git push"',
    'cd "$(git rev-parse --show-toplevel)" && rg -n \'commit\' plugins',
    '"$(git rev-parse --show-toplevel)/bin/run-bats" tests/commit-gate.bats',
    'git status\r\n',
  ];
  for (const c of none) {
    test(JSON.stringify(c), () => {
      expect(classify(c)).toEqual({ kind: 'none' });
    });
  }
});

describe('gates the accepted shapes', () => {
  test('lone commit', () => {
    expect(classify("git commit -m 'feat: x'")).toEqual({
      kind: 'gated',
      dir: '.',
      adds: [],
      commit: PLAIN,
      history: null,
      push: false,
    });
  });
  test('add chained before commit', () => {
    expect(classify('git add -A && git commit -m x')).toEqual({
      kind: 'gated',
      dir: '.',
      adds: [['add', '-A']],
      commit: PLAIN,
      history: null,
      push: false,
    });
  });
  test('several adds, config options kept for replay', () => {
    const r = classify(
      "git add src/a.ts 'src/b c.ts' && git -c core.quotepath=off add -u && git commit -m x",
    );
    expect(r).toEqual(
      expect.objectContaining({
        adds: [
          ['add', 'src/a.ts', 'src/b c.ts'],
          ['-c', 'core.quotepath=off', 'add', '-u'],
        ],
      }),
    );
  });
  test('heredoc message through a substitution', () => {
    expect(classify(HEREDOC_MESSAGE)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test('-F - with a heredoc on stdin', () => {
    expect(classify("git commit -F - <<'EOF'\nmsg; git push\nEOF")).toEqual(
      expect.objectContaining({ kind: 'gated', push: false }),
    );
  });
  test('-am and --all stage tracked changes', () => {
    const all = { all: true, amend: false, dryRun: false, config: [] };
    expect(classify("git commit -am 'x'")).toEqual(expect.objectContaining({ commit: all }));
    expect(classify('git commit --all -m x')).toEqual(expect.objectContaining({ commit: all }));
  });
  test('--amend --no-edit', () => {
    expect(classify('git commit --amend --no-edit')).toEqual(
      expect.objectContaining({ commit: { ...PLAIN, amend: true } }),
    );
  });
  test('--dry-run', () => {
    expect(classify('git commit --dry-run')).toEqual(
      expect.objectContaining({ commit: { ...PLAIN, dryRun: true } }),
    );
  });
  test('read-only git around the commit', () => {
    expect(
      classify('git status && git add -A && git commit -m x && git log -1 --format=%G?'),
    ).toEqual(expect.objectContaining({ kind: 'gated' }));
  });
  test('commit then push', () => {
    expect(classify('git commit -m x && git push')).toEqual(
      expect.objectContaining({ kind: 'gated', push: true }),
    );
  });
  test('push alone', () => {
    expect(classify('git push -u origin HEAD')).toEqual({
      kind: 'gated',
      dir: '.',
      adds: [],
      commit: null,
      history: null,
      push: true,
    });
  });
  test('commands that commit from history', () => {
    for (const sub of ['merge', 'cherry-pick', 'revert', 'pull', 'rebase']) {
      expect(classify(`git ${sub} x`)).toEqual(
        expect.objectContaining({ kind: 'gated', commit: null, history: sub }),
      );
    }
  });
  test('cherry-pick -x is a history command, not an exec', () => {
    expect(classify('git cherry-pick -x abc123')).toEqual(
      expect.objectContaining({ kind: 'gated', history: 'cherry-pick' }),
    );
  });
  test('a git-<sub> binary counts as the subcommand', () => {
    expect(classify('/usr/lib/git-core/git-commit -m x')).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test('leading cd and -C resolve the directory', () => {
    expect(classify('cd plugins && git -C review-cycle commit -m x')).toEqual(
      expect.objectContaining({ dir: 'plugins/review-cycle' }),
    );
    expect(classify('git -C /tmp/fixture commit -m x')).toEqual(
      expect.objectContaining({ dir: '/tmp/fixture' }),
    );
    expect(classify('git -C/tmp/fixture commit -m x')).toEqual(
      expect.objectContaining({ dir: '/tmp/fixture' }),
    );
  });
  test("the commit's own -c options are kept for -a staging", () => {
    expect(classify("git -c filter.x.clean='sed s/a/b/' commit -am x")).toEqual(
      expect.objectContaining({
        commit: { ...PLAIN, all: true, config: ['-c', 'filter.x.clean=sed s/a/b/'] },
      }),
    );
  });
  test('shell aliases are expanded and judged like the command they stand for', () => {
    const aliases = new Map([
      ['gcam', 'git commit -s -a -m'],
      ['gp', 'git push'],
      ['g', 'git'],
    ]);
    expect(classify('gcam "feat: x"', aliases)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: { ...PLAIN, all: true } }),
    );
    expect(classify('gp', aliases)).toEqual(expect.objectContaining({ kind: 'gated', push: true }));
    expect(classify('g commit -m x', aliases)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test('everyday steps before the commit or push are allowed', () => {
    expect(classify('git checkout -b feat/x && git push -u origin feat/x')).toEqual(
      expect.objectContaining({ kind: 'gated', commit: null, history: null, push: true }),
    );
    expect(classify('git fetch origin && git rebase origin/main')).toEqual(
      expect.objectContaining({ kind: 'gated', history: 'rebase' }),
    );
    expect(classify('git stash && git pull --rebase')).toEqual(
      expect.objectContaining({ kind: 'gated', history: 'pull' }),
    );
  });
  test('an alias of several commands is judged like the commands it stands for', () => {
    const aliases = new Map([
      ['GpA', 'git push --all && git push --tags --no-verify'],
      ['Gpc', 'git push --set-upstream origin "$(git-branch-current 2>/dev/null)"'],
      ['gp', 'git push'],
      ['gpp', 'gp && git pr'],
      ['gacp', 'git add -A && git commit -m wip && git push'],
      ['ll', 'ls -l && echo done'],
      ['sq', "sh -c 'git commit -m x'"],
    ]);
    for (const name of ['GpA', 'gpp', 'sq']) expect(classify(name, aliases).kind).toBe('refuse');
    expect(classify('Gpc', aliases)).toEqual(
      expect.objectContaining({ kind: 'gated', push: true }),
    );
    expect(classify('gacp', aliases)).toEqual(
      expect.objectContaining({ kind: 'gated', adds: [['add', '-A']], commit: PLAIN, push: true }),
    );
    expect(classify('ll', aliases)).toEqual({ kind: 'none' });
    expect(classify('echo gp', aliases)).toEqual({ kind: 'none' });
    expect(classify("'gp'", aliases)).toEqual({ kind: 'none' });
    expect(classify(String.raw`\gp`, aliases)).toEqual({ kind: 'none' });
    const chained = new Map([
      ['a', 'arch -arm64 '],
      ['g', 'git commit'],
    ]);
    expect(classify('a g -m x', chained).kind).toBe('refuse');
    const deep = new Map([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'git commit -m x'],
    ]);
    expect(classify('a', deep)).toEqual(expect.objectContaining({ kind: 'gated', commit: PLAIN }));
    expect(classify('if a; then echo; fi', deep).kind).toBe('refuse');
    expect(classify('x=$(a)', deep).kind).toBe('refuse');
    const loop = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(classify('a', loop)).toEqual({ kind: 'none' });
  });
  test('an alias the reader does not expand still counts when it commits or pushes', () => {
    const aliases = new Map([
      ['gc', 'git commit -m wip'],
      ['gp', 'git push'],
      ['n', 'nice '],
      ['g', 'git'],
      ['gp2', 'g push'],
    ]);
    for (const cmd of [
      'case a in a) gc;; esac',
      'case 1 in 1) gp;; esac',
      'f() { gc; }; f',
      'function g { gc; }; g',
      'eval gc',
      "eval 'true; gc'",
      'g\\\np',
      'n gp2',
      'x=$(case a in a) echo;; esac); gp',
    ]) {
      expect(classify(cmd, aliases).kind, cmd).not.toBe('none');
    }
    expect(classify('echo gp', aliases)).toEqual({ kind: 'none' });
    expect(classify('git log gp', aliases)).toEqual({ kind: 'none' });
  });
  test('git given its subcommand at run time is refused', () => {
    for (const cmd of [
      'echo push | xargs git',
      "echo 'commit -m x' | xargs -n3 git",
      "printf 'git commit -m x' | xargs -I{} sh -c '{}'",
    ]) {
      expect(classify(cmd).kind, cmd).toBe('refuse');
    }
    expect(classify('git ls-files | xargs grep -n TODO')).toEqual({ kind: 'none' });
    const aliases = new Map([['g', 'git']]);
    expect(classify('case x in a) g push;; esac', aliases).kind).toBe('refuse');
    expect(classify('repeat 1 g push', aliases).kind).toBe('refuse');
  });
  test('an alias that refers to itself expands once', () => {
    const aliases = new Map([['cp', 'cp -i']]);
    const parsed = parse('cp -R a b', aliases);
    expect('text' in parsed && parsed.text).toBe('cp -i -R a b');
  });
  test('alias expansion follows bash across nested values', () => {
    // The name stays suppressed inside its own value after an inner value grows.
    expect(
      expanded('a', [
        ['a', 'b a'],
        ['b', 'true;'],
      ]),
    ).toBe('true; a');
    // A trailing blank marks the word after the whole value, not inside it.
    expect(
      expanded('a gp', [
        ['a', 'b '],
        ['b', 'env X'],
        ['gp', 'git push'],
      ]),
    ).toBe('env X  git push');
    // A case arm and a function body start commands.
    expect(expanded('case a in a) gp;; esac', [['gp', 'git push']])).toBe(
      'case a in a) git push;; esac',
    );
    expect(expanded('f() { gp; }', [['gp', 'git push']])).toBe('f() { git push; }');
    // Only the first word of a value is re-tested wherever it stands.
    expect(
      expanded('e gp', [
        ['e', 'echo'],
        ['gp', 'git push'],
      ]),
    ).toBe('echo gp');
    const nv = new Map([
      ['nv', 'git -c x=y '],
      ['ci', 'commit'],
    ]);
    expect(classify('nv ci -m x', nv)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: { ...PLAIN, config: ['-c', 'x=y'] } }),
    );
  });
  test('a lone git alias definition runs', () => {
    expect(classify('git config alias.ci commit')).toEqual({ kind: 'none' });
  });
  test('a command that cannot be read is refused when it names git', () => {
    const aliases = new Map([['gp', 'git push']]);
    // Unterminated quote, so the reader fails; the shell joins `g\<newline>it`.
    expect(classify('g\\\nit push "', aliases).kind).toBe('refuse');
    expect(classify('echo ); g\\\np', aliases).kind).toBe('refuse');
  });
  test('the reader survives what used to break it', () => {
    expect(readable(`echo \${x:-"}"} && git push`)).not.toContain('could not be read');
    expect(readable('(echo case) && git push')).not.toContain('could not be read');
    const many = new Map([['l', 'ls']]);
    const long = `${Array.from({ length: 150 }, () => 'l').join('; ')}; git status`;
    expect(classify(long, many)).toEqual({ kind: 'none' });
  });
  test('an alias as a plain argument is data', () => {
    const aliases = new Map([
      ['gp', 'git push'],
      ['gc', 'git commit -m x'],
    ]);
    for (const cmd of ['ls gp', 'which gp', 'mkdir -p gp', 'pnpm test gc']) {
      expect(classify(cmd, aliases), cmd).toEqual({ kind: 'none' });
    }
  });
  test("a shell's -c script is judged as a command", () => {
    const aliases = new Map([['gp', 'git push']]);
    expect(classify('sh -c \'g"i"t push\'').kind).toBe('refuse');
    expect(classify("bash -c 'gp'", aliases).kind).toBe('refuse');
    expect(classify("bash -c 'ls -la'")).toEqual({ kind: 'none' });
  });
  test('an alias for git itself is still git', () => {
    const aliases = new Map([['git', 'hub']]);
    expect(classify('git push', aliases)).toEqual(expect.objectContaining({ push: true }));
  });
  test('an alias after a part that cannot be read still counts', () => {
    const aliases = new Map([['gp', 'git push']]);
    expect(classify('echo ); gp', aliases).kind).toBe('refuse');
    expect(classify('echo ); ls', aliases)).toEqual({ kind: 'none' });
  });
  test('a case inside a substitution keeps its own patterns', () => {
    const r = classify('case x in a) y=$(echo hi);; esac && git push');
    expect(r.kind === 'refuse' ? r.reason : '').not.toContain('could not be read');
    expect(classify('case x in a) y=$(git push);; esac').kind).toBe('refuse');
  });
  test('read-only commands that name git push in their arguments run', () => {
    for (const cmd of [
      'fd "git push" .',
      'awk "/git push/" .',
      'git grep -n "git push"',
      'git config --get alias.ci && git commit -m x',
    ]) {
      expect(classify(cmd).kind, cmd).not.toBe('refuse');
    }
  });
  test('a wrapper around an interpreter is looked through', () => {
    for (const cmd of [
      "timeout 5 bash -c 'git commit -m x'",
      "nice -n 5 xargs sh -c 'git push'",
      'caffeinate -i bash <<EOF\ngit push\nEOF',
      'stdbuf -o0 env FOO=1 python3 -c \'import os; os.system("git commit -m x")\'',
    ]) {
      expect(classify(cmd).kind).toBe('refuse');
    }
    expect(classify('timeout 30 grep -rn "git commit" docs')).toEqual({ kind: 'none' });
  });
  test("bash's $'…' quoting is decoded before the subcommand is read", () => {
    expect(classify(String.raw`git $'co\x6dmit' -m x`)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test('an alias that refers to itself runs once, as in bash', () => {
    const aliases = new Map([
      ['cp', 'cp -i'],
      ['grep', 'grep --color=auto'],
      ['git', 'git --no-pager'],
    ]);
    expect(classify('cp -R src /tmp/x && grep -rn L3 src', aliases)).toEqual({ kind: 'none' });
    expect(classify('git commit -m x', aliases)).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test("zsh's =git resolves to git", () => {
    expect(classify('=git push')).toEqual(expect.objectContaining({ kind: 'gated', push: true }));
  });
  test('git options that take a value do not hide the subcommand', () => {
    expect(classify('git --attr-source HEAD commit -m x')).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
  });
  test('author identity variables', () => {
    expect(classify('GIT_AUTHOR_DATE=now git commit -m x')).toEqual(
      expect.objectContaining({ kind: 'gated' }),
    );
  });
  test('line continuations', () => {
    expect(classify('git commit \\\n  -m x')).toEqual(expect.objectContaining({ kind: 'gated' }));
  });
  test('redirects on the commit', () => {
    expect(classify('git commit -m x 2>&1 >/dev/null')).toEqual(
      expect.objectContaining({ kind: 'gated' }),
    );
  });
});

describe('refuses every other shape that commits or pushes', () => {
  const refuse = [
    "bash -c 'git commit -m x'",
    'sh -c "git add -A && git commit -m x"',
    "FOO=1 bash -c 'git commit -m x'",
    "eval 'git commit -m x'",
    'echo x | git commit -F -',
    'git commit -m x || true',
    'git commit -m x &',
    '(git commit -m x)',
    'npm test && git commit -m x',
    'git commit -m x src/a.ts',
    'git commit -m x -- src/a.ts',
    'git commit -o -m x src/a.ts',
    'git commit -p',
    'git commit --patch',
    'git commit --pathspec-from-file=list',
    'git add -p && git commit -m x',
    'git add -Ap && git commit -m x',
    'git add $FILES && git commit -m x',
    'git commit -m x && git add -A',
    'GIT_INDEX_FILE=/tmp/i git commit -m x',
    'GIT_DIR=/tmp/other/.git git commit -m x',
    'git --git-dir=/tmp/other/.git commit -m x',
    'git reset --soft HEAD~1 && git commit -m x',
    'x=$(git commit -m x)',
    'git commit -m "$(git add -A)"',
    'echo `git push`',
    'if git commit -m x; then echo ok; fi',
    'xargs git commit -m x < list',
    '$GIT commit -m x',
    'ACTION=commit; git $ACTION -m x',
    'git -C $DIR commit -m x',
    'cd $DIR && git commit -m x',
    'cd "$(git rev-parse --show-toplevel)" && git commit -m x',
    "git commit -m 'unterminated",
    'git commit -m x; git commit -m y',
    'env git commit -m x',
    'timeout 10 git push',
    'cat <<EOF\n$(git commit -m x)\nEOF',
    `echo \${x:-$(git commit -m y)}`,
    'echo $(( $(git commit -qm x >/dev/null; echo 1) ))',
    "bash <<'EOF'\ngit commit -m x\nEOF",
    "echo 'git commit -m x' | sh",
    "echo 'git push' | sh",
    'python3 -c \'import os; os.system("git commit -m x")\'',
    String.raw`find . -name x -exec git commit -m x \;`,
    "git submodule foreach 'git commit -am x'",
    'git merge x && git commit -m y',
    'noglob git push',
    'nocorrect git commit -m x',
    '/usr/bin/gi? push',
    'git {push,--dry-run}',
    'gtimeout 60 git push',
    'arch -arm64 git commit -m x',
    'flock /tmp/l git push',
    "env -S 'git commit -m x'",
    'git subtree push --prefix dist origin gh-pages',
    'git send-pack origin HEAD:refs/heads/main',
    'h=$(git commit-tree HEAD^{tree} -m x); git update-ref refs/heads/main $h',
    'git fast-import < stream',
    '{ git commit -m x; }',
    'git commit --ame --no-edit',
    'git commit --pathspec-fr=list -m x',
    'git add src/{a,b}.ts && git commit -m x',
    `GIT_SSH_COMMAND="sh -c 'git commit --allow-empty -m x'" git push`,
    "GIT_EDITOR='sh -c x' git commit",
    'arch -arm64 git -c user.name=x commit -m x',
    'flock /tmp/l git --attr-source HEAD push',
    'git config alias.ci commit && git ci -m x',
    "sed 's/x/git push/e' f",
    'awk \'BEGIN { system("git push") }\'',
    "pnpm exec sh -c 'git commit -m x'",
    "npx sh -c 'git push'",
    'git rm --cached foo && git commit -m x',
    'git mv a b && git commit -m x',
    'git add a; git commit -m x',
    'git add a\ngit commit -m x',
    'git merge --continue',
    'git rebase --exec "git commit --amend --no-edit" HEAD~3',
    'git rebase -x "make test" main',
    'git rebase --continue',
    'git am < patch.mbox',
    'git stash pop --index && git commit -m x',
    'git checkout other -- a.ts && git commit -m x',
    'GIT_EDITOR=/tmp/restage git commit',
    'G=git; arch -arm64 "$G" commit -m x',
    'cat <<EOF\n`git commit -m x`\nEOF',
    String.raw`echo ${'$'}{x:-${'`'}git push${'`'}}`,
    'git commit -mfoo src/a.ts',
    'git commit --message=foo src/a.ts',
    'git --work-tree=/tmp/w commit -m x',
    'git --namespace=x push',
    'git add --pathspec-from-file=list && git commit -m x',
    'git -C $DIR merge topic',
    'git -C a add x && git commit -m y',
  ];
  for (const c of refuse) {
    test(JSON.stringify(c), () => {
      expect(classify(c).kind).toBe('refuse');
    });
  }
});

describe('aliases', () => {
  test('finds subcommands that may be aliases, nested ones included', () => {
    expect(possibleAliases('git -c alias.ci=commit ci -am x')).toEqual([
      { sub: 'ci', inline: 'commit' },
    ]);
    expect(possibleAliases('git st && git log')).toEqual([{ sub: 'st', inline: null }]);
    expect(possibleAliases('x=$(git ci -m x)')).toEqual([{ sub: 'ci', inline: null }]);
    expect(possibleAliases('git status')).toEqual([]);
    expect(possibleAliases('if git pu; then :; fi')).toEqual([{ sub: 'pu', inline: null }]);
    expect(possibleAliases('{ git ci -m x; }')).toEqual([{ sub: 'ci', inline: null }]);
  });
  test('expansions that commit or push', () => {
    const table: Record<string, string> = {
      ci: 'commit -v',
      pf: 'push --force-with-lease',
      sh: '!git add -A && git commit',
      cm: 'ci',
      chain: 'cm',
      opt: '-c user.name=z commit',
      pager: '-p commit',
      mg: 'merge --no-ff',
      st: 'status -sb',
      lg: 'log --grep=commit',
    };
    const lookup = (name: string) => table[name] ?? null;
    table.shmerge = '!git merge topic';
    table.sub = '-C sub commit';
    table.attr = '--attr-source HEAD commit';
    table.escaped = String.raw`!git co\mmit -m x`;
    for (const yes of [
      'ci',
      'pf',
      'sh',
      'cm',
      'chain',
      'opt',
      'pager',
      'mg',
      'shmerge',
      'sub',
      'attr',
      'escaped',
    ]) {
      expect(aliasCommits(yes, lookup)).toBe(true);
    }
    for (const no of ['st', 'lg', 'missing']) {
      expect(aliasCommits(no, lookup)).toBe(false);
    }
  });
  test('a shell alias is judged by what its script runs', () => {
    const table: Record<string, string> = {
      ansi: String.raw`!git $'co\x6dmit' -m x`,
      bare: '!git',
      fwd: '!f() { git "$@"; }; f',
      piped: '!echo "$@" | xargs git',
      viaExec: '!exec git',
      viaCommand: '!command git',
      viaCd: '!cd sub && exec git',
      inline: '!git -c alias.z=commit z',
      quoted: '"commit"',
      plumbing: 'commit-tree',
      evalArgs: '!f() { eval "$@"; }; f',
      wrapped: "!timeout 5 sh -c 'git push'",
      say: '!echo commit',
      lg: '!git log --oneline | head',
    };
    const lookup = (name: string) => table[name] ?? null;
    for (const yes of [
      'ansi',
      'bare',
      'fwd',
      'piped',
      'wrapped',
      'viaExec',
      'viaCommand',
      'viaCd',
      'inline',
      'quoted',
      'plumbing',
      'evalArgs',
    ])
      expect(aliasCommits(yes, lookup)).toBe(true);
    for (const no of ['say', 'lg']) expect(aliasCommits(no, lookup)).toBe(false);
  });
  test('a chain of aliases is followed to its end', () => {
    const table: Record<string, string> = { s1: 's2', s2: 's3', s3: 's4', s4: 'status -sb' };
    expect(aliasCommits('s1', (name) => table[name] ?? null)).toBe(false);
  });
  test('a loop of aliases counts as committing', () => {
    const table: Record<string, string> = { a: 'b', b: 'a' };
    expect(aliasCommits('a', (name) => table[name] ?? null)).toBe(true);
  });
});

describe('shell aliases', () => {
  test("decodes zsh's $'…' values", () => {
    expect(parseShellAliases(String.raw`alias -- wip=$'git add -A\ngit push'`).get('wip')).toBe(
      'git add -A\ngit push',
    );
  });
  test('reads zsh and bash alias listings', () => {
    const zsh = [
      `\u001B]697;DoneSourcing\u0007'G?'='git-alias-lookup /tmp/x'`,
      'g=git',
      "gcam='git commit -s -a -m'",
      String.raw`say='echo it'\''s'`,
    ].join('\n');
    const bash = "alias gp='git push'\nalias ll='ls -l'";
    expect(Object.fromEntries(parseShellAliases(zsh))).toEqual({
      'G?': 'git-alias-lookup /tmp/x',
      g: 'git',
      gcam: 'git commit -s -a -m',
      say: "echo it's",
    });
    expect(Object.fromEntries(parseShellAliases(bash))).toEqual({ gp: 'git push', ll: 'ls -l' });
    const snapshot =
      "# Snapshot file\nunalias -a\nfoo () {\n\tlocal x=1\n}\nalias -- gcam='git commit -s -a -m'\nalias -- g=git\n";
    expect(Object.fromEntries(parseShellAliases(snapshot))).toEqual({
      gcam: 'git commit -s -a -m',
      g: 'git',
    });
  });
});
