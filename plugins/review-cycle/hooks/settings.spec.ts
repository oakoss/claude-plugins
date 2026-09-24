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
    expect(touchesGate('{}', '{"env":{"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS":"0"}}')).toBe(true);
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
    `jq '.enabledPlugins' ~/.claude/settings.json > /tmp/s`,
    'claude plugin disable review-cycle@oakoss',
    'claude plugins uninstall review-cycle',
    'claude plugin remove review-cycle',
    'claude plugin disable --scope user review-cycle@oakoss',
    'claude plugin marketplace remove oakoss',
    'claude plugin market rm oakoss',
    `sed -i '' s/true/false/ ~/.claude/settings.json`,
    `sed -i '' 's/true/false/' ~/.claude/settings*.json`,
    'echo {} > ~/.claude/settings.json',
    'mv /tmp/x .claude/settings.local.json',
    `f=~/.claude/settings; jq . $f.json > /tmp/s && cat /tmp/s > $f.json`,
    `python3 -c "open('/Users/x/.claude/settings.json','w')"`,
    'echo {} > ~/.CLAUDE/SETTINGS.JSON',
    'echo {} > "$CLAUDE_CONFIG_DIR/settings.json"',
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
    'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/review-cycle',
    'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/review-cycle > out.log',
    `python3 - <<'EOF'\nopen('notes.md','w').write('set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS')\nEOF`,
    `grep -n enabledPlugins README.md > /tmp/hits`,
    'pnpm test:hooks > out.log',
  ])('allows %s', (cmd) => expect(bashTouchesGate(cmd)).toBe(false));
});
