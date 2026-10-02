import { describe, expect, test } from 'vitest';

import { editNote, editsSkipped, mayWrite } from './edits';

describe('mayWrite', () => {
  const yes: [string, string][] = [
    ['a redirect', 'echo x > src/a.ts'],
    ['a bare redirect', '> a.ts'],
    ['a redirect to a variable', 'echo x > "$OUT"'],
    ['a redirect inside a substitution', 'x=$(echo > g.ts)'],
    ['sed behind if', "if sed -i '' 's/a/b/' a.ts; then :; fi"],
    ['sed behind time', "time sed -i '' 's/a/b/' a.ts"],
    ['sed behind xargs', "git ls-files '*.md' | xargs sed -i '' 's/a/b/'"],
    ['sed by its full path', "/usr/bin/sed -i '' 's/a/b/' a.ts"],
    ['a copy', 'cp /tmp/new.ts src/a.ts'],
    ['a nested shell', 'bash -c "echo x > a.ts"'],
    ['python by version', 'python3.12 fix.py'],
    ['node with attached code', `node -e"require('fs').writeFileSync('a.ts','')"`],
    ['a command it cannot read', 'echo "unterminated'],
    ['a script run by its path', './fix.sh src'],
    ['a script behind an assignment', 'FOO=1 ./fix.sh'],
    ['a script behind time', 'time ./fix.sh'],
    ['a script behind env and its flags', 'env -i FOO=1 ./fix.sh'],
    ['a sourced script', 'source fix.sh'],
    ['a script read with a dot', '. ./fix.sh'],
    ['a TypeScript runner', 'npx tsx fix.ts'],
  ];
  test.each(yes)('measures %s', (_, command) => {
    expect(mayWrite(command)).toBe(true);
  });

  const no: [string, string][] = [
    ['a descriptor redirect', 'make 2>&1'],
    ['/dev/null', 'make > /dev/null'],
    ['a read', 'git status --porcelain'],
    ['a search', 'rg -n foo src'],
    ['a path as an argument', 'cat ./src/a.ts'],
  ];
  test.each(no)('skips %s', (_, command) => {
    expect(mayWrite(command)).toBe(false);
  });

  test('expands aliases first', () => {
    expect(mayWrite('fix a.ts', new Map([['fix', "sed -i ''"]]))).toBe(true);
    expect(mayWrite('fix a.ts')).toBe(false);
  });
});

describe('editNote', () => {
  test('names the files and where the checks run', () => {
    const note = editNote(['src/a.ts', 'b.md']);
    expect(note).toContain('files changed while this command ran: src/a.ts, b.md.');
    expect(note).toContain('If the command made those edits, make file changes with Edit or Write');
  });
  test('counts what it does not list', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.ts`);
    expect(editNote(paths)).toContain('f9.ts and 2 more.');
    expect(editNote(paths)).not.toContain('f10.ts');
  });
});

test('a skipped check says why', () => {
  expect(editsSkipped('git add -A failed: boom')).toBe(
    'review-cycle: could not check which files this command changed (git add -A failed: boom).',
  );
});
