import { describe, expect, test } from 'vitest';

import { aliasCommits, classify, possibleAliases, shownCommand } from './command';
import { aliasScript, aliasShell, parse, parseShellAliases, readAliases } from './shell';

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
    'git -C ~/.code/github/scratch/rw-lab log --oneline -1',
    'git merge-base main HEAD',
    'git merge-base --is-ancestor origin/main HEAD && echo ok',
    'git diff $(git merge-base main HEAD) --stat',
    'git log --oneline "$(git merge-base origin/main HEAD)"..HEAD',
    'python3 -c \'print("git merge-base main HEAD")\'',
    'python3 -c \'print("git-merge-base main HEAD")\'',
    'git merge-tree --write-tree main topic',
    'git -C "$DIR" status --short',
    'git -C $DIR fetch origin',
    'git -C "$DIR" merge-base main HEAD',
    'git checkout main && git pull --ff-only',
    'git fetch && git pull --ff-only origin main',
    'git pull --no-ff --ff-only',
    'git -C $DIR config --get user.email',
    'H=plugins/review-cycle && ls $H',
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
  test('a trailing pipe into tail or wc is judged like the command before it', () => {
    expect(classify('git push 2>&1 | tail -3')).toEqual(
      expect.objectContaining({ kind: 'gated', push: true }),
    );
    expect(classify('git commit -m x | tail -n 5')).toEqual(
      expect.objectContaining({ kind: 'gated', commit: PLAIN }),
    );
    expect(classify('git add -A && git commit -m x 2>&1 | tail -n20 | wc -l')).toEqual(
      expect.objectContaining({ kind: 'gated', adds: [['add', '-A']] }),
    );
    for (const tail of [
      'tail',
      'tail -c 200',
      'tail --lines=5',
      'tail -n +2',
      'tail -n +0',
      'tail -05',
      'wc',
      'wc -lw',
    ]) {
      expect(classify(`git push | ${tail}`)).toEqual(expect.objectContaining({ kind: 'gated' }));
    }
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
  test('an alias after `time -p` is expanded, as bash does', () => {
    const aliases = new Map([['gcam', 'git commit -s -a -m']]);
    expect(classify('time -p gcam msg', aliases)).toEqual(
      expect.objectContaining({ kind: 'refuse' }),
    );
    expect(classify('time -p echo gcam', aliases)).toEqual({ kind: 'none' });
    for (const c of ['echo time -p gcam msg', 'echo time gcam msg']) {
      expect(classify(c, aliases), c).toEqual({ kind: 'none' });
      expect(expanded(c, [...aliases]), c).toBe(c);
    }
    expect(classify('if true; then gcam msg; fi', aliases)).toEqual(
      expect.objectContaining({ kind: 'refuse' }),
    );
  });
  test('a statement of only assignments runs nothing, so it may precede a commit', () => {
    for (const c of [
      'MSG=/tmp/m && git commit -F "$MSG"',
      'MSG=$TMPDIR/m && git commit -F "$MSG"',
    ]) {
      expect(classify(c), c).toEqual(expect.objectContaining({ kind: 'gated', commit: PLAIN }));
    }
  });
  test('a refusal beside an assignment names the step it refuses', () => {
    expect(readable('H=plugins && git add $H/a && git commit -F m')).toMatch(
      /^git add with an argument built from a variable/,
    );
    expect(readable('ls && git commit -m x')).toMatch(/^`ls` alongside/);
    expect(readable('X=$(date) && git commit -m x')).toMatch(
      /^an assignment with a substitution or redirect alongside/,
    );
  });
  test('a fast-forward pull is neutral before a push; a pull or merge that may merge is not', () => {
    expect(classify('git pull --ff-only && git push')).toEqual(
      expect.objectContaining({ kind: 'gated', history: null, push: true }),
    );
    for (const c of [
      'git pull --ff-only --no-ff',
      'git pull "$R" --ff-only',
      'git merge --ff-only origin/main',
      'git merge --ff-only -s ours origin/main',
    ]) {
      expect(classify(c), c).toEqual(
        expect.objectContaining({ kind: 'gated', history: c.split(' ')[1] }),
      );
    }
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
  test('an alias for git itself that runs something else is refused', () => {
    const hub = new Map([['git', 'hub']]);
    for (const command of ['git push', 'git commit -m x', 'git pull']) {
      const r = classify(command, hub);
      expect(r.kind === 'refuse' && r.reason).toContain('`git` is a shell alias here (for `hub`)');
    }
    expect(classify('git status', hub)).toEqual({ kind: 'none' });
    expect(classify(String.raw`\git push`, hub)).toEqual(expect.objectContaining({ push: true }));
  });
  test('an alias for git itself is judged on its expansion, a hidden push included', () => {
    const sneaky = new Map([['git', 'git push origin main && git']]);
    expect(classify('git status', sneaky)).toEqual(expect.objectContaining({ push: true }));
    // Expanded it is a commit after a push, which no reading admits.
    expect(classify('git commit -m x', sneaky).kind).toBe('refuse');
    // eval reparses its text, where the alias expands.
    expect(classify('eval git status', sneaky).kind).not.toBe('none');
    expect(classify('git status', new Map([['git', 'command git push; git']])).kind).toBe('refuse');
  });
  test('a command refused for another reason keeps that reason when git is an alias', () => {
    const r = classify('git commit -m x | tee log', new Map([['git', 'hub']]));
    expect(r.kind === 'refuse' && r.reason).toContain('joined with `|`');
  });
  test('a git alias lookup reads git as itself when git is a shell alias', () => {
    expect(possibleAliases('git ci', new Map([['git', 'hub']]))).toEqual([
      { sub: 'ci', inline: null },
    ]);
  });
  test('a +cmd qualifier naming an alias that pushes is refused', () => {
    const r = classify('echo *(+gp)', new Map([['gp', 'git push']]));
    expect(r.kind).toBe('refuse');
  });
  test('an alternation is not read as qualifiers', () => {
    expect(classify('git add src/(core|base)/*.ts && git commit -m x').kind).toBe('gated');
    expect(classify('git add ./(package|tsconfig).json && git commit -m x').kind).toBe('gated');
    expect(classify('git status src/(core|base)')).toEqual({ kind: 'none' });
    expect(classify('git add x(e|f) && git commit -m x').kind).toBe('gated');
  });
  test('a qualifier that runs code is refused even when no git shows', () => {
    expect(classify("ls *(e:'true':)").kind).toBe('refuse');
  });
  test('a qualifier with a size or time comparison runs no code', () => {
    expect(classify('ls *(Lk+3)')).toEqual({ kind: 'none' });
    expect(classify('ls *(.om[1,3])')).toEqual({ kind: 'none' });
  });
  test('a git alias lookup sees an inline alias the shell alias adds', () => {
    expect(possibleAliases('git st', new Map([['git', 'git -c alias.st=push']]))).toContainEqual({
      sub: 'st',
      inline: 'push',
    });
  });
  test('an alias for git itself that wraps git in a refused runner is refused', () => {
    const r = classify('git commit -m x', new Map([['git', 'noglob git']]));
    expect(r.kind === 'refuse' && r.reason).toContain('Run `\\git …`');
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
    'git push | sh',
    'git commit -m x | tee log',
    "git push | sed -e 's/x/y/'",
    'git commit -m x | xargs git push',
    'git push | tail -3 > out',
    'git push | tail $(git commit -m y)',
    'git commit -m x | tail -3 && git push',
    'git commit -m x | grep -q done || git push',
    'git commit -m x && tail -3 log',
    // Backgrounded, the pipeline outlives the gate's check after the command.
    'git commit -m x | tail -3 &',
    'git push | cat &',
    'git commit -m x & tail -1 a | wc -l',
    'git commit -m x || tail -1 log | wc -l',
    // A reader that may stop early, or read a file instead of the pipe, can
    // kill a hook mid-run.
    'git commit -m x | head -1',
    'git push | grep -v hint',
    'git push | cat',
    'git commit -m x | tail -3 log.txt',
    'git commit -m x | tail -f',
    'git commit -m x | tail -n $N',
    'git commit -m x | tail -n',
    'git commit -m x | wc -l file',
    'git commit -m x | wc -L',
    'git commit -m x | tail -0',
    'git commit -m x | tail -n 0',
    'git commit -m x | tail -c0',
    'git commit -m x | tail --bytes=0',
    'git commit -m x | tail -n 5 -n 3',
    'git commit -m x | tail -5 -3',
    'git commit -m x | tail -n 5 log',
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
    'python3 -c \'import os; os.system("git-merge topic")\'',
    'python3 -c \'import os; os.system("git merge topic")\'',
    'git merge-into main',
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
    'git -C $DIR push',
    'git -C ~/repo ci -m x',
    'git -c $KEY log',
    'git -C',
    "git pull --ff-only --upload-pack='git push x' ../other",
    "timeout 30 git pull --ff-only --upload-pack='git push x' ../other",
    'timeout 30 git pull --ff-only',
    "git pull --ff-only <<'EOF'\ngit push origin main\nEOF",
    'git config core.hooksPath /dev/null && git commit -m x',
    'X=$(echo x >> a.ts) && git commit -am m',
    'X=`touch a.ts` && git commit -m m',
    'X=1 > a.ts && git commit -am m',
    'X=$(git reset --soft HEAD~3) && git commit -m m',
    'git pull --ff-only --squash && git commit -m x',
    'git pull --ff-only && git commit -m x',
    'x=$(git push) && git commit -m y',
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

const TAG = 't1';

function wrap(body: string): string {
  return `junk=no\nreview-cycle: aliases ${TAG}\n${body}\nreview-cycle: end of aliases ${TAG}\n`;
}

function read(body: string): Map<string, string> | null {
  return readAliases(wrap(body), TAG);
}

// Claude Code's own snapshot, measured: CLAUDE_CODE_SHELL, else $SHELL, when it
// names zsh (checked first) or bash, else zsh; `-c -l`, sourcing
// `$HOME/.<shell>rc` from /dev/null.
describe('the alias read mirrors the snapshot', () => {
  test.each([
    [undefined, '/bin/zsh', '/bin/zsh'],
    [undefined, '/opt/homebrew/bin/bash', '/opt/homebrew/bin/bash'],
    [undefined, '/usr/local/bin/bash5', '/usr/local/bin/bash5'],
    [undefined, '/opt/homebrew/bin/fish', 'zsh'],
    [undefined, undefined, 'zsh'],
    ['/usr/local/bin/bash', '/bin/zsh', '/usr/local/bin/bash'],
    ['', '/bin/bash', '/bin/bash'],
    ['/usr/bin/fish', '/bin/bash', '/bin/bash'],
  ])('CLAUDE_CODE_SHELL=%s SHELL=%s runs %s', (claudeShell, shell, chosen) => {
    expect(aliasShell(claudeShell, shell).path).toBe(chosen);
  });
  test('each shell sources its own rc; a path naming both is zsh, as Claude Code checks', () => {
    expect(aliasShell(undefined, '/bin/zsh').rc).toBe('.zshrc');
    expect(aliasShell(undefined, '/bin/bash').rc).toBe('.bashrc');
    expect(aliasShell(undefined, '/home/bashful/bin/zsh').rc).toBe('.zshrc');
  });
  test("the script is laid out as Claude Code's snapshot script, the rc path a literal", () => {
    const listing = "alias | sed 's/^alias //g' | sed 's/^/alias -- /' | head -n 1000";
    const open = `trap - DEBUG 2>/dev/null; builtin echo; builtin echo 'review-cycle: aliases ${TAG}'`;
    const close = `builtin echo 'review-cycle: end of aliases ${TAG}'`;
    expect(aliasScript("/home/o'neil/.zshrc", TAG)).toBe(
      [
        String.raw`source '/home/o'\''neil/.zshrc' < /dev/null > /dev/null 2>&1`,
        open,
        listing,
        close,
      ].join('\n'),
    );
    // With no rc file, Claude Code's snapshot lists no aliases either.
    expect(aliasScript(null, TAG)).toBe([open, close].join('\n'));
  });
  test('output that never reached the end line reads as no answer', () => {
    expect(readAliases(`\nreview-cycle: aliases ${TAG}\nalias gp='git push'\n`, TAG)).toBeNull();
    expect(readAliases('', TAG)).toBeNull();
  });
  test('only the lines between this read’s markers are read', () => {
    const out = `\u001B]697;DoneSourcing\u0007git=echo\n${wrap("alias -- gp='git push'")}`;
    expect(Object.fromEntries(readAliases(out, TAG) ?? [])).toEqual({ gp: 'git push' });
    const other = 'review-cycle: aliases other\nreview-cycle: end of aliases other\n';
    expect(readAliases(other + wrap("alias -- gp='git push'"), TAG)?.get('gp')).toBe('git push');
  });
  test("a line the listing did not print, such as an rc's ERR trap output, is not an alias", () => {
    expect(Object.fromEntries(read("lasterr=3\nalias -- gp='git push'") ?? [])).toEqual({
      gp: 'git push',
    });
    // The listing itself failed, so the trap's line is all there is.
    expect(read('lasterr=3')?.size).toBe(0);
  });
  test('a value holding the end line does not cut the list short', () => {
    const body = `alias a='x\nreview-cycle: end of aliases ${TAG}\ny'\nalias gp='git push'`;
    expect(read(body)?.get('gp')).toBe('git push');
  });
  test("zsh's quoting of a value ending in a quote, and bash's, read the same", () => {
    const next = "\nalias -- gp='git push'";
    for (const [line, value] of [
      [String.raw`alias -- q='echo '\''x y'\'`, "echo 'x y'"],
      [String.raw`alias -- q='echo '\''x y'\'''`, "echo 'x y'"],
      [String.raw`alias -- q=$'echo \'a\tb\''`, "echo 'a\tb'"],
      [String.raw`alias -- q='it'\''s'`, "it's"],
    ] as const) {
      const aliases = read(line + next);
      expect(aliases?.get('q'), line).toBe(value);
      expect(aliases?.get('gp'), line).toBe('git push');
    }
  });
  test('a tab inside a value survives', () => {
    expect(read("alias gt='git\tpush'")?.get('gt')).toBe('git\tpush');
    expect(read(String.raw`alias -- gt=$'git\tpush'`)?.get('gt')).toBe('git\tpush');
  });
  test('a carriage return inside a value keeps the alias, and a push after it is judged', () => {
    const aliases = read("alias -- x='true\r; git push'\nalias -- gs='git status'");
    expect(aliases?.get('x')).toBe('true\r; git push');
    expect(classify('x', aliases ?? new Map())).not.toEqual({ kind: 'none' });
  });
  test('control characters inside a value stay, as bash reads them', () => {
    expect(read("alias gp='git push # \u0007'")?.get('gp')).toBe('git push # \u0007');
    const aliases = read("alias -- z1='\u0001#; git push'");
    expect(classify('z1', aliases ?? new Map())).not.toEqual({ kind: 'none' });
  });
  test('a zsh global alias, listed by plain alias, is read', () => {
    expect(read("alias -- GC='git commit'")?.get('GC')).toBe('git commit');
  });
  test('a value bash prints across lines is read whole, and a push in it is judged', () => {
    const aliases = read("alias ship='git add -A\ngit push'\nalias gs='git status'");
    expect(aliases?.get('ship')).toBe('git add -A\ngit push');
    expect(aliases?.get('gs')).toBe('git status');
    expect(classify('ship', aliases ?? new Map())).not.toEqual({ kind: 'none' });
    const last = read("alias -- gs='git status'\nalias -- zz='git add -A\nalias -- git push'");
    expect(last?.get('zz')).toBe('git add -A\nalias -- git push');
    expect(last?.get('gs')).toBe('git status');
  });
  test("a function body's brace starts a command, in both forms", () => {
    for (const c of ['f() { gp; }', 'function f { gp; }']) {
      expect(expanded(c, [['gp', 'git push']]), c).toBe(c.replace('gp', 'git push'));
    }
  });
});

describe("the command as the gate's question shows it", () => {
  const cases: [string, string][] = [
    ['git push', 'git push'],
    ['  git   push\t--tags  ', 'git push --tags'],
    ['git status\r\ngit push\n', 'git status ⏎ git push'],
    ['git status  \n\n   git push', 'git status ⏎ git push'],
    ['git push origin 　main', 'git push origin main'],
    ['git push origin main #‮​ x', 'git push origin main #�� x'],
    ['git status git push', 'git status�git push'],
    ['git status git push', 'git status�git push'],
    ['git commit -m "a\u001B[2Jb"', 'git commit -m "a�[2Jb"'],
  ];
  for (const [command, want] of cases) {
    test(JSON.stringify(command), () => {
      expect(shownCommand(command)).toBe(want);
    });
  }
  test('a shell alias is shown with its expansion', () => {
    const aliases = new Map([['ship', 'git status; git push --force origin main']]);
    expect(shownCommand('ship', aliases)).toBe(
      'ship (aliases expanded: git status; git push --force origin main)',
    );
  });
});

// The refusal with the command it names left out, or the kind.
function verdict(command: string): string {
  const r = classify(command);
  return r.kind === 'refuse' ? r.reason.replace(/^`[^`]+`/, '<cmd>') : r.kind;
}

describe('glob and brace patterns', () => {
  test.each([
    ['g*t commit -m x', 'a command name the shell would expand'],
    ['[g]it commit -m x', 'a command name the shell would expand'],
    ['git p[u]sh', 'a subcommand the shell would expand'],
    ['git add {a,b}.ts && git commit -m x', 'brace expansion'],
    // Quoted text inside a closed bracket or brace leaves it a pattern.
    ['[g"h"]it commit -m x', 'a command name the shell would expand'],
    ['git p[u"s"]h', 'a subcommand the shell would expand'],
    ['git add {a,"b"}.ts && git commit -m x', 'brace expansion'],
    // zsh's extended globs need no closer.
    ['setopt extendedglob && git{# commit -m x', 'a command name the shell would expand'],
    ['g#it commit -m x', 'a command name the shell would expand'],
    ['^gxt commit -m x', 'a command name the shell would expand'],
    ['g~xt commit -m x', 'a command name the shell would expand'],
    // A parenthesis inside a word is a zsh group or an extglob.
    ['/usr/bin/g(i)t push', 'a command name the shell would expand'],
    ['/usr/bin/(git|gxt) commit -m x', 'a command name the shell would expand'],
    ['git(N) commit -m x', 'a command name the shell would expand'],
    ['@(git) commit -m x', 'a command name the shell would expand'],
    ['+(g)it push', 'a command name the shell would expand'],
    ['gi!(x)t commit -m x', 'a command name the shell would expand'],
    ['git p(u)sh', 'a subcommand the shell would expand'],
    ['git s@(t)atus && git push', 'a subcommand the shell would expand'],
    ['g(i)t push', 'a command name the shell would expand'],
    ['/usr/bin/g(i)t commit -m x', 'a command name the shell would expand'],
    ['git(.) commit -m x', 'a command name the shell would expand'],
    ['!(x) commit -m x', 'a command name the shell would expand'],
    ['g@(i)t push', 'a command name the shell would expand'],
    ['gi(#c1)t push', 'a command name the shell would expand'],
    ['git s(t)atus && git push', 'a subcommand the shell would expand'],
    // The shell still runs a substitution inside the group.
    ['ls x($(git push))', ''],
    ['echo @($(git push))', ''],
    ['ls x(`git push`)', ''],
    ['ls x("$(git push)")', ''],
    ['ls x(a|$(git push))', ''],
    ['ls x(<(git push))', ''],
    ['echo $(ls x($(git push)))', ''],
    ['git status x($(git push))', ''],
    ['git commit -m x($(git push))', ''],
    // zsh's code-running glob qualifiers.
    ["git add *(e:'git push':) && git commit -m x", 'a zsh glob qualifier that runs code'],
    ["ls *(e:'git push':)", 'a zsh glob qualifier that runs code'],
    [String.raw`git add *(eXgit\ pushX) && git commit -m x`, 'a zsh glob qualifier that runs code'],
    [String.raw`ls *(e1git\ push1)`, 'a zsh glob qualifier that runs code'],
    [String.raw`ls a(#qeXgit\ pushX)(#qN)`, 'a zsh glob qualifier that runs code'],
    // Quote removal and brace expansion can leave the group last in a word.
    ["ls *(e:'git push':)''", 'a zsh glob qualifier that runs code'],
    ['ls *(e:\'git push\':)""', 'a zsh glob qualifier that runs code'],
    ["ls *(e:'git push':)$(true)", 'a zsh glob qualifier that runs code'],
    ["ls {x,*(e:'git push':)}", 'a zsh glob qualifier that runs code'],
    ["git add *(e:'git push':)'' && git commit -m x", 'a zsh glob qualifier that runs code'],
    // A quoted `|` is text inside the qualifier, not an alternation.
    ["ls *(e:'true | git push':)", 'a zsh glob qualifier that runs code'],
    [String.raw`ls *(e.git\ push.)`, 'a zsh glob qualifier that runs code'],
    [String.raw`printf '%s\n' *(Ne:'git push':)`, 'a zsh glob qualifier that runs code'],
  ])('%s is refused', (command, reason) => {
    const r = classify(command);
    expect(r.kind).toBe('refuse');
    expect(r.kind === 'refuse' && r.reason).toContain(reason);
  });
  test.each([
    ['git pull -q --ff-only && [ -z "x" ]', 'git pull -q --ff-only && test -z "x"'],
    ['[ -n "x" ] && git push', 'test -n "x" && git push'],
  ])('%s reads as the test command does', (bracketed, plain) => {
    expect(verdict(bracketed)).toBe(verdict(plain));
    expect(verdict(bracketed)).not.toContain('would expand');
  });
  test('an unclosed bracket or brace is a plain word', () => {
    expect(verdict('git p[ush')).not.toContain('would expand');
    expect(classify('git add a{ && git commit -m x').kind).toBe('gated');
  });
  test.each([
    ['[g"]"it commit -m x', 'none'],
    ["[g']'it commit -m x", 'none'],
    [String.raw`[g\]it commit -m x`, 'none'],
    [']g[it commit -m x', 'none'],
    ['git add {a,b"}".ts && git commit -m x', 'gated'],
  ])('%s: a quoted or escaped closer leaves a plain word', (command, kind) => {
    expect(classify(command).kind).toBe(kind);
  });
  test('a glob in a git add path is judged as usual', () => {
    expect(classify('git add *.ts && git commit -m x').kind).toBe('gated');
  });
  test('a subshell, a function definition and an array still parse as before', () => {
    expect(verdict('(git status) && git push')).toContain('a group or function');
    expect(classify('f() { :; }')).toEqual({ kind: 'none' });
    expect(verdict('xs=(a b) && git push')).toContain('a group or function');
    expect(classify('git commit -m "fix(scope): x"').kind).toBe('gated');
  });
  test("zsh's extended-glob characters in an argument are left alone", () => {
    expect(classify('git log HEAD^ && git show HEAD~1 && git push').kind).toBe('gated');
  });
});
