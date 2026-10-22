import { describe, expect, test } from 'vitest';

import { applyEdit, bashTouchesGate, marketplaceOf, namesSwitch, touchesGate } from './settings';

const on = JSON.stringify({ enabledPlugins: { 'review-cycle@oakoss': true, 'x@y': true } });

// The rung on a line of its own, behind a comment, as a hand-edited file holds it.
const jsonc = (rung: string) =>
  `// mine\n{\n  "pluginConfigs": {\n    "review-cycle": {\n      "options": {\n        /* loose */ "stopBefore": "${rung}",\n      },\n    },\n  },\n  "url": "http://x//y,}",\n}\n`;

describe('touchesGate', () => {
  test('disabling, removing or reconfiguring the plugin touches it', () => {
    expect(
      touchesGate(on, on.replace('"review-cycle@oakoss":true', '"review-cycle@oakoss":false')),
    ).toBe(true);
    expect(touchesGate(on, JSON.stringify({ enabledPlugins: { 'x@y': true } }))).toBe(true);
    expect(touchesGate(on, JSON.stringify({ enabledPlugins: null }))).toBe(true);
    expect(
      touchesGate(
        null,
        JSON.stringify({
          pluginConfigs: { 'review-cycle@inline': { options: { enabled: false } } },
        }),
      ),
    ).toBe(true);
  });
  test('other plugins and keys do not', () => {
    expect(touchesGate(on, on.replace('"x@y":true', '"x@y":false'))).toBe(false);
    expect(touchesGate(on, JSON.stringify({ ...JSON.parse(on), theme: 'dark' }))).toBe(false);
    expect(touchesGate(null, '{}')).toBe(false);
    expect(touchesGate(null, '[1]')).toBe(false);
  });
  // Claude Code skips a settings file that is not a strict JSON object, so a
  // file with comments or a trailing comma switches nothing until it is one.
  test('making a file strict JSON, or no longer strict, touches it when it holds a switch', () => {
    const strict = JSON.stringify({
      pluginConfigs: { 'review-cycle': { options: { stopBefore: 'never stop' } } },
    });
    expect(touchesGate(jsonc('never stop'), strict)).toBe(true);
    expect(touchesGate(strict, jsonc('never stop'))).toBe(true);
    expect(touchesGate(on, `// mine\n${on}`)).toBe(true);
    expect(touchesGate(on, on.replace('}}', '},}'))).toBe(true);
    expect(touchesGate('{"theme":1', '{"theme":1}')).toBe(false);
  });
  test('a file Claude Code skips switches nothing, however it changes', () => {
    expect(touchesGate(jsonc('push'), jsonc('never stop'))).toBe(false);
    expect(touchesGate(null, `// x\n{"enabledPlugins":{"review-cycle@oakoss":false}}`)).toBe(false);
    expect(touchesGate(`// mine\n${on}`, `// mine\n${on.replace('true', 'false')}`)).toBe(false);
  });
  test('a byte-order mark does not hide the switch', () => {
    expect(touchesGate(null, '\uFEFF{"enabledPlugins":{"review-cycle@oakoss":false}}')).toBe(true);
    expect(touchesGate(on, `\uFEFF${on}`)).toBe(false);
  });
  test('JSON that is not an object is no settings file', () => {
    const corpus = JSON.stringify([
      { offer: 'Set "enabledPlugins":{"review-cycle@oakoss":false}?', may: [] },
    ]);
    expect(touchesGate(null, corpus)).toBe(false);
    expect(touchesGate(corpus, corpus.replace('may', 'missed'))).toBe(false);
    expect(touchesGate(on, '[]')).toBe(true);
    expect(touchesGate(on, 'null')).toBe(true);
    expect(touchesGate(null, 'null')).toBe(false);
  });
  test('switching hooks off touches it', () => {
    expect(touchesGate('{}', '{"disableAllHooks":true}')).toBe(true);
    expect(touchesGate(null, '\uFEFF{"disableAllHooks":true}')).toBe(true);
    // Claude Code ignores this from v2.1.287, when mods went on by default.
    expect(touchesGate('{}', '{"env":{"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS":"0"}}')).toBe(false);
    expect(touchesGate('// c\n{}', '// c\n{"env":{"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS":"0"}}')).toBe(
      false,
    );
    expect(touchesGate('{"env":{"A":"1"}}', '{"env":{"A":"2"}}')).toBe(false);
    expect(touchesGate('{}', '{"env":{"A":"1"}}')).toBe(false);
    expect(touchesGate(null, '{"env":{"browser":true}}')).toBe(false);
  });
  test('breaking a file that holds the switch touches it', () => {
    expect(touchesGate(on, '{')).toBe(true);
    expect(touchesGate('{"a":1}', '{')).toBe(false);
    expect(touchesGate('not json', on)).toBe(true);
    expect(touchesGate('not json', 'still not json')).toBe(false);
    expect(touchesGate('{"enabledPlugins":', '{"enabledPlugins":{"review-cycle":')).toBe(false);
  });
});

describe('namesSwitch', () => {
  test.each([
    ['"enabledPlugins":{', true],
    ['"review-cycle@oakoss": false', true],
    ['"pluginConfigs"', true],
    ['"disableAllHooks": true', true],
    ['"theme": "dark"', false],
    ['review-cycle without quotes', false],
    ['"x":"see review-cycle docs"', false],
    ['"review-cycle', false],
  ])('%j → %s', (text, named) => {
    expect(namesSwitch(text)).toBe(named);
  });
});

describe('applyEdit', () => {
  test('replaces the first or every occurrence', () => {
    expect(applyEdit('a a', 'a', 'b', false)).toBe('b a');
    expect(applyEdit('a a', 'a', 'b', true)).toBe('b b');
    expect(applyEdit('a', 'a', '$&$&', false)).toBe('$&$&');
    expect(applyEdit('a', 'z', 'b', false)).toBe(null);
  });
});

describe('bashTouchesGate', () => {
  test.each([
    'claude plugin disable review-cycle@oakoss',
    'claude plugins uninstall review-cycle',
    'claude plugin remove review-cycle',
    'claude plugin disable --scope user review-cycle@oakoss',
    'claude plugin marketplace remove oakoss',
    'claude plugin market rm oakoss',
    'claude plugin disable "review-cycle@oakoss"',
    'bash -c "claude plugin disable review-cycle@oakoss"',
    `python3 -c "import pathlib; (pathlib.Path.home() / '.claude' / 'settings.json').write_text('{}')"`,
    `node -e "require('fs').writeFileSync(require('path').join(require('os').homedir(), '.claude', 'settings.json'), '{}')"`,
    `cd ~/.claude && sed -i '' 's/true/false/' settings.json`,
    `echo {} > "\${CLAUDE_CONFIG_DIR}/settings.json"`,
    'echo {} > ~/.claude/managed-settings.json',
    `sed -i '' 's/true/false/' ~/.claude/{settings,settings.local}.json`,
    'rm ~/.claude/settings.*.json',
    'node -e "fs.writeFileSync(path.join(os.homedir(), `.claude`, `settings.json`), `{}`)"',
    `sed -i '' s/true/false/ ~/.claude/settings.json`,
    `sed -i '' 's/true/false/' ~/.claude/settings*.json`,
    'echo {} > ~/.claude/settings.json',
    'mv /tmp/x .claude/settings.local.json',
    `f=~/.claude/settings; jq . $f.json > /tmp/s && cat /tmp/s > $f.json`,
    `python3 -c "open('/Users/x/.claude/settings.json','w')"`,
    `tsx -e "require('fs').writeFileSync('/Users/x/.claude/settings.json', '{}')"`,
    `lua -e "io.open('/Users/x/.claude/settings.json','w'):write('{}')"`,
    `sh -c "lua -e 'io.open([[/Users/x/.claude/settings.json]], [[w]])'"`,
    'echo {} > ~/.CLAUDE/SETTINGS.JSON',
    'echo {} > "$CLAUDE_CONFIG_DIR/settings.json"',
    'echo {} | tee ~/.claude/settings.json',
    'cat x >> ~/.claude/settings.local.json',
    'dd of=~/.claude/settings.json if=/tmp/s',
    `perl -pi -e 's/true/false/' .claude/settings.json`,
    'jq . /tmp/s > "$(pwd)/.claude/settings.json"',
    `python3 - <<'EOF'\nopen('/Users/x/.claude/settings.json','w')\nEOF`,
    'echo "$(claude plugin disable review-cycle@oakoss)"',
    'sudo claude plugin disable review-cycle@oakoss',
    'claude --debug plugin disable review-cycle',
    // Measured bypasses of a check that resolved each path on its own.
    '> ~/.claude/settings.json',
    'cp /tmp/settings.json ~/.claude/',
    'mv /tmp/settings.json ~/.claude',
    'ln -s ~/dotfiles/settings.json ~/.claude/',
    'cp -t ~/.claude settings.json',
    'cp /tmp/x ~/.claude/settings.json',
    `for f in ~/.claude/settings*.json; do jq '.x=1' "$f" | sponge "$f"; done`,
    `find ~/.claude -name 'settings*.json' -exec sed -i '' 's/a/b/' {} +`,
    `ls ~/.claude/settings*.json | xargs sed -i '' 's/a/b/'`,
    `pushd ~/.claude && echo '{}' > settings.json && popd`,
    'C=~/.claude && cd $C && echo {} > settings.json',
    `cd -- ~/.claude && sed -i '' 's/a/b/' settings.json`,
    `F=~/.claude/settings.json; echo {} > "\${F}"`,
    'echo {} &> ~/.claude/settings.json',
    'echo {} >| ~/.claude/settings.json',
    'echo {} >& ~/.claude/settings.json',
    'sh -c "echo {} > ~/.claude/settings.json"',
    'eval "echo {} > ~/.claude/settings.json"',
    `bash <<'EOF'\necho {} > ~/.claude/settings.json\nEOF`,
    `deno eval "Deno.writeTextFileSync('/Users/x/.claude/settings.json', '{}')"`,
    `python3.12 -c "open('/Users/x/.claude/settings.json','w')"`,
    `sed --in-place 's/a/b/' ~/.claude/settings.json`,
    `ruby -i -pe 'gsub(/a/, "b")' ~/.claude/settings.json`,
    '/bin/rm ~/.claude/settings.json',
    'truncate -s 0 ~/.claude/settings.json',
    'install -m 600 /tmp/s ~/.claude/settings.json',
    'npx @anthropic-ai/claude-code plugin disable review-cycle',
    'npx @anthropic-ai/claude-code@latest plugin disable review-cycle',
    'claude.exe plugin disable review-cycle',
    'rsync /tmp/s.json ~/.claude/settings.json',
    `perl -0pi -e 's/a/b/' ~/.claude/settings.json`,
    'ksh -c "echo {} > ~/.claude/settings.json"',
    'su -c "echo {} > ~/.claude/settings.json"',
    'sudo -s "echo {} > ~/.claude/settings.json"',
    'sudo bash -c "echo {} > ~/.claude/settings.json"',
    'zsh -c "echo {} > ~/.claude/settings.json"',
    `sed -i.bak 's/a/b/' ~/.claude/settings.json`,
    'claude --settings /tmp/s.json plugin disable review-cycle',
    'echo `> ~/.claude/settings.json`',
    'cp.exe /tmp/s ~/.claude/settings.json',
    'bash.exe -c "echo {} > ~/.claude/settings.json"',
    'sudo -iu root "echo {} > ~/.claude/settings.json"',
    'sudo -is "cp /tmp/s ~/.claude/settings.json"',
    'sudo --shell "cp /tmp/s ~/.claude/settings.json"',
    `watch -n 1 'cp /tmp/s ~/.claude/settings.json'`,
    `env -S 'cp /tmp/s ~/.claude/settings.json'`,
    'claude -p "/plugin disable review-cycle"',
    // Reading settings into another file is refused too: the settings path is
    // read from the whole text, not resolved per write.
    `jq '.enabledPlugins' ~/.claude/settings.json > /tmp/s`,
    // A `claude` command still writes through its redirects, and a writer
    // beside it is still a writer.
    'claude plugin install x@y > ~/.claude/settings.json',
    'CLAUDE_CONFIG_DIR=/x/claude claude plugin install x@y && cp /tmp/s /x/claude/settings.json',
    'sudo cp /tmp/s ~/.claude/settings.json',
  ])('refuses %s', (cmd) => expect(bashTouchesGate(cmd)).toBe(true));
  test.each([
    'cat ~/.claude/settings.json',
    'grep theme ~/.claude/settings.json 2>&1',
    'rg -n pluginConfigs plugins/',
    'grep -rn enabledPlugins docs',
    'cp .vscode/settings.json /tmp/backup.json',
    'jq . .vscode/settings.json > /dev/null',
    'jq .plugins .claude-plugin/marketplace.json > out.json',
    'claude plugin validate ./plugins/review-cycle',
    'claude --plugin-dir ./plugins/review-cycle -p "remove the dead code"',
    'claude plugin test plugins/review-cycle-rm',
    'claude plugin install rm-helper@x',
    'claude plugin marketplace list',
    'cp plugins/review-cycle/.claude-plugin/plugin.json plugins/review-cycle/hooks/settings.ts /tmp/copy/',
    'cp .claude-plugin/plugin.json /tmp/copy/ && jq . .vscode/settings.json > /tmp/copy/editor.json',
    'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/review-cycle',
    'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/review-cycle > out.log',
    `python3 - <<'EOF'\nopen('notes.md','w').write('set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS')\nEOF`,
    `grep -n enabledPlugins README.md > /tmp/hits`,
    'pnpm test:hooks > out.log',
    'echo hi > ~/.claude/notes.md',
    'sed -n 1,5p ~/.claude/settings.json',
    'jq . < ~/.claude/settings.json',
    'cat ~/.claude/settings.json 2>/dev/null',
    'grep -i theme ~/.claude/settings.json',
    'ls ~/.claude/settings*.json &>/dev/null || echo none',
    'sudo tee /etc/hosts < /tmp/h',
    'cp /tmp/a.md ~/.claude/agents/a.md',
    // Quoted prose that names a settings path, a writer or a plugin subcommand
    // writes nothing; each of these was refused by the earlier text check.
    'bd create "x" --description "reads .claude/settings.local.json for review-cycle@<marketplace>"',
    'bd create "x" --description "WRITES lists cp, mv and tee; the path is .claude/settings.json"',
    'bd create "x" --description "keep the claude plugin disable refusal"',
    'git commit -m "docs: say why cp > .claude/settings.json is refused"',
    'echo "claude plugin uninstall is refused" > notes.md',
    'npm plugin remove foo',
    // A reviewer leg's test install, checked in the same command.
    'cd /x && CLAUDE_CONFIG_DIR=/x/claude claude plugin install pr-kit@oakoss --scope local && cat /x/.claude/settings.local.json',
    'CLAUDE_CONFIG_DIR=/x/claude claude plugin install pr-kit@oakoss; ls /x/claude/settings.json',
  ])('allows %s', (cmd) => expect(bashTouchesGate(cmd)).toBe(false));
  describe('removing a plugin', () => {
    test.each([
      ['claude plugin uninstall review-cycle@oakoss', 'oakoss'],
      ['claude plugin disable review-cycle', 'oakoss'],
      ['claude plugin uninstall review-cycle@elsewhere', 'oakoss'],
      ['claude plugin uninstall pr-watch@oakoss review-cycle@oakoss', 'oakoss'],
      ['claude plugin marketplace remove oakoss', 'oakoss'],
      ['claude plugin marketplace remove oakoss', null],
      ['claude plugin marketplace remove other', null],
      ['claude plugin uninstall $P', 'oakoss'],
      ['claude plugin uninstall review-*', 'oakoss'],
      ['claude plugin uninstall', 'oakoss'],
      ['claude plugin uninstall --scope user', 'oakoss'],
      ['claude plugin uninstall -s user', 'oakoss'],
      ['claude plugin disable Review-Cycle@oakoss', 'oakoss'],
      ['claude plugin marketplace remove OAKOSS', 'oakoss'],
      ['claude plugin disable --all pr-kit', 'oakoss'],
      ['claude plugin uninstall review-cycle -- --help', 'oakoss'],
      ['claude plugin uninstall -- review-cycle', 'oakoss'],
    ] as const)('refuses %s (installed from %s)', (cmd, market) =>
      expect(bashTouchesGate(cmd, market)).toBe(true),
    );
    test.each([
      ['claude plugin uninstall pr-watch@oakoss', 'oakoss'],
      ['claude plugin disable --scope user pr-kit', 'oakoss'],
      ['claude plugin uninstall review-cycle-extra@x', 'oakoss'],
      ['claude plugin marketplace remove other', 'oakoss'],
      ['claude plugin uninstall --help', 'oakoss'],
      ['claude plugin uninstall --help 2>&1 | head -20', null],
      ['claude plugin marketplace remove -h', null],
      ['claude plugin disable review-cycle --help', 'oakoss'],
      ['claude plugin uninstall prose@oakoss', 'oakoss'],
      ['claude plugin disable -s user pr-kit', 'oakoss'],
      ['claude plugin uninstall my-review-cycle@x', 'oakoss'],
    ] as const)('allows %s (installed from %s)', (cmd, market) =>
      expect(bashTouchesGate(cmd, market)).toBe(false),
    );
    test('reads the command through the shell aliases', () => {
      const aliases = new Map([['cpu', 'claude plugin uninstall']]);
      expect(bashTouchesGate('cpu review-cycle', 'oakoss', aliases)).toBe(true);
      expect(bashTouchesGate('cpu pr-kit', 'oakoss', aliases)).toBe(false);
    });
    test('an alias renaming a command the check knows still refuses', () => {
      const sed = new Map([['sed', 'gsed']]);
      expect(bashTouchesGate(`sed -i 's/a/b/' ~/.claude/settings.json`, 'oakoss', sed)).toBe(true);
      const claude = new Map([['claude', 'happy']]);
      expect(bashTouchesGate('claude plugin uninstall review-cycle', 'oakoss', claude)).toBe(true);
    });
    test('--help wins wherever it falls', () => {
      expect(bashTouchesGate('claude plugin disable --all --help', 'oakoss')).toBe(false);
      expect(bashTouchesGate('claude plugin disable --help --all', 'oakoss')).toBe(false);
    });
  });
  test.each([
    ['/Users/x/.claude/plugins/cache/oakoss/review-cycle/0.32.0', 'oakoss'],
    ['/Users/x/.claude/plugins/cache/my-fork/review-cycle/1.0.0/', 'my-fork'],
    ['/Users/x/code/claude-plugins/plugins/review-cycle', null],
    ['/Users/x/.claude/plugins/cache/oakoss/pr-kit/0.2.1', null],
    ['/Users/x/.claude/plugins/cache/oakoss/review-cycle/0.32.0/hooks', null],
  ])('marketplaceOf(%j) is %j', (root, market) => expect(marketplaceOf(root)).toBe(market));
  test('falls back to the text check when the command does not parse', () => {
    expect(bashTouchesGate(`echo {} > ~/.claude/settings.json; echo '`)).toBe(true);
    expect(bashTouchesGate(`echo hi; echo '`)).toBe(false);
  });
});
