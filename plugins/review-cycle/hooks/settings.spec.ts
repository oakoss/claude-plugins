import { describe, expect, test } from 'vitest';

import { applyEdit, bashTouchesGate, touchesGate } from './settings';

const on = JSON.stringify({ enabledPlugins: { 'review-cycle@oakoss': true, 'x@y': true } });

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
  test('text JSON.parse rejects is compared by its switch lines', () => {
    const off = '{"enabledPlugins":{"review-cycle@oakoss":false}}';
    expect(touchesGate(null, `\uFEFF${off}`)).toBe(true);
    expect(touchesGate(null, `// x\n${off}`)).toBe(true);
    expect(touchesGate(null, off.replace('}}', '},}'))).toBe(true);
    expect(touchesGate(`// mine\n${on}`, `// mine\n${on.replace('true', 'false')}`)).toBe(true);
    expect(touchesGate('// notes\n{"theme":1}', '// notes\n{"theme":2}')).toBe(false);
  });
  test('switching hooks off touches it', () => {
    expect(touchesGate('{}', '{"disableAllHooks":true}')).toBe(true);
    expect(touchesGate(null, '// c\n{"disableAllHooks":true}')).toBe(true);
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
  ])('allows %s', (cmd) => expect(bashTouchesGate(cmd)).toBe(false));
  test('falls back to the text check when the command does not parse', () => {
    expect(bashTouchesGate(`echo {} > ~/.claude/settings.json; echo '`)).toBe(true);
    expect(bashTouchesGate(`echo hi; echo '`)).toBe(false);
  });
});
