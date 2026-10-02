import { describe, expect, test } from 'vitest';

import { editNote, editsSkipped, mayWrite, measureEdits } from './edits';

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
    ['a script behind sudo', 'sudo ./fix.sh'],
    ['a script behind doas', 'doas ./fix.sh'],
    ['uv run', 'uv run fix.py'],
    ['osascript', 'osascript fix.scpt'],
    ['expect', 'expect fix.exp'],
    ['mise exec', 'mise exec -- fix'],
    ['a Windows binary', 'python.exe fix.py'],
    ['node behind a package runner', 'pnpm exec node fix.js'],
    ['a script behind if', 'if ./fix.sh; then :; fi'],
    ['a script in a group', '{ ./fix.sh; }'],
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
    ['a dot as an argument', 'git add .'],
    ['a dot as a filter', 'jq . package.json'],
    ['source as a word', 'grep -rn source src'],
    ['expect as a search term', 'rg -n expect src'],
    ['watch as a script name', 'pnpm run watch'],
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

// Snapshots answer in order; an Error stands for a failed one.
function snaps(...trees: (string | Error)[]) {
  let i = 0;
  return () => {
    const t = trees[i++];
    return t instanceof Error ? Promise.reject(t) : Promise.resolve(t ?? '');
  };
}
const run = () => Promise.resolve('ran');
const boom = () => Promise.reject(new Error('boom'));
const rejects = () => Promise.reject(new Error('timed out'));
function diffOf(paths: string[] | null) {
  return () => Promise.resolve(paths);
}

describe('measureEdits', () => {
  test('names what changed between the snapshots', async () => {
    const m = await measureEdits(snaps('a', 'b'), diffOf(['x.ts']), run);
    expect(m).toEqual({ result: 'ran', note: editNote(['x.ts']) });
  });
  test('is quiet when the tree is unchanged, without comparing', async () => {
    let compared = false;
    const diff = () => {
      compared = true;
      return Promise.resolve(['x.ts']);
    };
    expect(await measureEdits(snaps('a', 'a'), diff, run)).toEqual({ result: 'ran', note: null });
    expect(compared).toBe(false);
  });
  test('is quiet when nothing reviewable changed', async () => {
    expect(await measureEdits(snaps('a', 'b'), diffOf([]), run)).toEqual({
      result: 'ran',
      note: null,
    });
  });
  test('still runs the command when the first snapshot fails', async () => {
    let ran = false;
    const m = await measureEdits(snaps(new Error('add failed')), diffOf([]), () => {
      ran = true;
      return run();
    });
    expect(ran).toBe(true);
    expect(m.note).toBe(editsSkipped('add failed'));
  });
  test('says so when the second snapshot fails', async () => {
    const m = await measureEdits(snaps('a', new Error('timed out')), diffOf([]), run);
    expect(m).toEqual({ result: 'ran', note: editsSkipped('timed out') });
  });
  test('says so when the trees cannot be compared', async () => {
    const m = await measureEdits(snaps('a', 'b'), diffOf(null), run);
    expect(m.note).toBe(editsSkipped('git could not compare the trees'));
  });
  test('says so when the comparison rejects', async () => {
    const m = await measureEdits(snaps('a', 'b'), rejects, run);
    expect(m.note).toBe(editsSkipped('timed out'));
  });
  test('snapshots before and after the command, not around it', async () => {
    let ran = false;
    const snapshot = () => Promise.resolve(ran ? 'after' : 'before');
    const seen: string[] = [];
    const diff = (before: string, after: string) => {
      seen.push(before, after);
      return Promise.resolve(['x.ts']);
    };
    await measureEdits(snapshot, diff, () => {
      ran = true;
      return run();
    });
    expect(seen).toEqual(['before', 'after']);
  });
  test('passes a failing command through', async () => {
    await expect(measureEdits(snaps('a', 'b'), diffOf([]), boom)).rejects.toThrow('boom');
  });
});

test('a skipped check says why', () => {
  expect(editsSkipped('git add -A failed: boom')).toBe(
    'review-cycle: could not check which files this command changed (git add -A failed: boom).',
  );
});
