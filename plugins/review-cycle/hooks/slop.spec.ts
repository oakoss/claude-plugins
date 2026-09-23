import { describe, expect, test } from 'vitest';

import { skipsPath, slopDirective, slopFindings } from './slop';

// A Write of `lines` to `path`: the file is exactly what was written.
function write(path: string, ...lines: string[]): string[] {
  const text = `${lines.join('\n')}\n`;
  return slopFindings({ path, file: text, text, replaced: null });
}

// An Edit that replaced `old` with `text` in a file holding `const a = 1;`.
function edit(text: string, old = 'const a = 1;'): string[] {
  return slopFindings({ path: '/r/f.ts', file: 'const a = 1;\n', text, replaced: old });
}

const joined = (findings: string[]) => findings.join('\n\n');

describe('paths that are never scanned', () => {
  test('silent on a clean code file', () => {
    expect(write('/r/f.ts', 'const a = 1;', 'export function f() {', '  return a;', '}')).toEqual(
      [],
    );
  });
  test('excluded directories, binaries and prose', () => {
    for (const path of ['/r/node_modules/pkg/f.ts', '/r/dist/f.js', '/r/a.png', '/r/pnpm.lock']) {
      expect(skipsPath(path), path).toBe(true);
    }
  });
  test("prose files are skipped entirely (a '# Note:' heading is not slop)", () => {
    expect(
      write(
        '/r/doc.md',
        '# Note: installation',
        'Some text.',
        '## Previously released',
        '# TODO list',
      ),
    ).toEqual([]);
  });
});

describe('pattern checks', () => {
  test('flags section-marker comments', () => {
    expect(joined(write('/r/f.ts', '// ===== HELPERS =====', 'const a = 1;'))).toContain(
      'Section-marker',
    );
  });
  test('flags restate-the-code comments', () => {
    expect(joined(write('/r/f.ts', '// fetches the user record', 'const u = get();'))).toContain(
      'restate-the-code',
    );
  });
  test('flags AI-flavored phrasings', () => {
    expect(joined(write('/r/f.ts', '// Here we set up the listener', 'listen();'))).toContain(
      'AI-flavored',
    );
  });
  test('flags Note:-prefix comments', () => {
    expect(joined(write('/r/f.ts', '// Note: this is called twice', 'f();'))).toContain(
      'Hedge-prefix',
    );
  });
  test('flags ticketless TODOs but not ticketed ones', () => {
    expect(joined(write('/r/f.ts', '// TODO: tighten this later', 'const a = 1;'))).toContain(
      'TODO/FIXME without ticket',
    );
    expect(
      joined(write('/r/g.ts', '// TODO(ABC-123): tighten this later', 'const a = 1;')),
    ).not.toContain('TODO/FIXME without ticket');
    expect(joined(write('/r/h.ts', '// TODO: see ABC-123', 'const a = 1;'))).not.toContain(
      'TODO/FIXME without ticket',
    );
  });
  test('flags hedge words', () => {
    expect(joined(write('/r/f.ts', '// this basically retries', 'r();'))).toContain('Hedge words');
  });
  test('flags history-flavored comments, capitalized included', () => {
    for (const line of [
      '// failing loudly as it did while the value was sensitive',
      '// this field is no longer read by the client',
      '// Previously this used a lock.',
    ]) {
      expect(joined(write('/r/f.ts', line, 'const a = 1;')), line).toContain('History-flavored');
    }
    expect(
      joined(write('/r/i.ts', '// This map is used to store open handles', 'const a = 1;')),
    ).not.toContain('History-flavored');
  });
  test('a finding lists at most three line-numbered matches', () => {
    const findings = joined(
      write('/r/f.ts', ...Array.from({ length: 5 }, (_, i) => `// ===== ${i} =====`)),
    );
    expect(findings).toContain('1:// ===== 0 =====');
    expect(findings).toContain('3:// ===== 2 =====');
    expect(findings).not.toContain('4:// ===== 3 =====');
  });
});

describe('every pattern alternative', () => {
  test.each([
    ['// FIXME: later', 'TODO/FIXME without ticket'],
    ['// HACK around it', 'TODO/FIXME without ticket'],
    ['# XXX: revisit', 'TODO/FIXME without ticket'],
    ['-- TODO: sql side', 'TODO/FIXME without ticket'],
    ['// Important: ordering matters', 'Hedge-prefix'],
    ['// NB: cached', 'Hedge-prefix'],
    ['# FYI: slow', 'Hedge-prefix'],
    ['// then just retry', 'Hedge words'],
    ['// this is simply a map', 'Hedge words'],
    ['// returns the user id', 'restate-the-code'],
    ['// This function does the parsing', 'AI-flavored'],
    ['# ===== SECTION =====', 'Section-marker'],
    ['-- === queries ===', 'Section-marker'],
    ['/* === block === */', 'Section-marker'],
  ])('%s', (line, label) => {
    expect(joined(write('/r/f.ts', line, 'const a = 1;'))).toContain(label);
  });
  test.each([
    '// TODO(#123): tracked',
    '// TODO: see https://x.test/1',
    '// FIXME ABC-12 tracked',
    '// == not three',
    '--i;',
  ])('%s is not flagged', (line) => {
    expect(write('/r/f.ts', line, 'const a = 1;')).toEqual([]);
  });
});

describe('comment density', () => {
  // Neutral wording, so no pattern check fires alongside.
  test('fires on interleaved narration after the first code line (Write)', () => {
    const findings = joined(
      write(
        '/r/f.ts',
        'const a = 1;',
        '// alpha beta',
        'const b = 2;',
        '// gamma delta',
        'const c = 3;',
        'const d = 4;',
        '// epsilon zeta',
        'const e = 5;',
        'const g = 6;',
        '// eta theta',
        'const h = 7;',
        'const i = 8;',
      ),
    );
    expect(findings).toContain('High comment density');
    expect(findings).toContain('4 of 12');
  });
  test('a leading header comment block on a Write does not trigger density', () => {
    expect(
      write(
        '/r/f.ts',
        '// module overview alpha',
        '// beta gamma constraints',
        '// delta epsilon',
        '// zeta eta',
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        'const d = 4;',
      ),
    ).toEqual([]);
  });
  // A code line first, so the Write header exemption leaves the counts intact.
  test.each([
    ['3 comments of 6 (50%) is below the line floor', 3, 3, false],
    ['4 comments of 13 (30%) fires', 4, 9, true],
    ['4 comments of 14 (28%) is below the ratio floor', 4, 10, false],
  ])('%s', (_, comments, code, fires) => {
    const lines = ['const first = 0;'];
    for (let i = 1; i < code; i++) lines.push(`const v${i} = ${i};`);
    for (let i = 0; i < comments; i++) lines.push(`// note ${i}`);
    expect(joined(write('/r/f.ts', ...lines)).includes('High comment density')).toBe(fires);
  });
  const MIXED =
    '// alpha\n// beta\n// gamma\n// delta\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;';
  test("reads the Edit's new_string, not the file", () => {
    const findings = joined(edit(MIXED, ''));
    expect(findings).toContain('High comment density');
    expect(findings).toContain('4 of 8');
  });
  test('skips an edit that replaces a pure comment block', () => {
    expect(
      edit(
        '// tightened WHY line one\n// tightened WHY line two\n// tightened WHY line three\n// tightened WHY line four',
        '// one long changelog-style comment\n// spanning several lines\n// that a prior fire asked to tighten',
      ),
    ).toEqual([]);
  });
  test('still fires when the replaced text contains code', () => {
    expect(joined(edit(MIXED, 'const a = 1;\n// old note'))).toContain('4 of 8');
  });
  test('the skip survives a whitespace-only line inside the replaced block', () => {
    expect(
      edit('// new one\n// new two\n// new three\n// new four', '// para one\n   \n// para two'),
    ).toEqual([]);
  });
  test('a one-line comment anchor does not suppress density on a large mixed block', () => {
    expect(joined(edit(MIXED, '// old note'))).toContain('4 of 8');
  });
  test('an empty old_string on an Edit leaves density active', () => {
    expect(joined(edit('// alpha\n// beta\n// gamma\n// delta\n// epsilon', ''))).toContain(
      '5 of 5',
    );
  });
  test('fires when code is replaced by an all-comment block', () => {
    expect(
      joined(
        edit('// alpha\n// beta\n// gamma\n// delta\n// epsilon', 'const a = 1;\nconst b = 2;'),
      ),
    ).toContain('High comment density');
  });
  test('the skip survives a whitespace-only line in the written block', () => {
    expect(edit('// new one\n// new two\n   \n// new three\n// new four', '// old note')).toEqual(
      [],
    );
  });
  test('pointer dereferences are not comments', () => {
    expect(
      write(
        '/r/f.c',
        '*p = 1;',
        '*q = 2;',
        '*r = 3;',
        '*s = 4;',
        'int a = 1;',
        'int b = 2;',
        'int c = 3;',
        'int d = 4;',
      ),
    ).toEqual([]);
  });
  test('block-comment continuation lines count when not a leading header', () => {
    const findings = joined(
      write(
        '/r/f.c',
        'int x;',
        '/* doc',
        ' * alpha',
        ' * beta',
        ' */',
        'int a;',
        'int b;',
        'int c;',
      ),
    );
    expect(findings).toContain('High comment density');
    expect(findings).toContain('4 of 8');
  });
  test('hash comments count; the shebang does not', () => {
    const findings = joined(
      write(
        '/r/f.sh',
        '#!/bin/sh',
        'cmd0',
        '# alpha',
        '# beta',
        '# gamma',
        '# delta',
        'cmd1',
        'cmd2',
        'cmd3',
      ),
    );
    expect(findings).toContain('4 of 8');
  });
  test('the header exemption strips comments only, never preprocessor directives', () => {
    const includes = ['a', 'b', 'c', 'd', 'e', 'f'].map((h) => `#include <${h}.h>`);
    const code = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((v) => `int ${v};`);
    expect(
      write('/r/f2.c', ...includes, '// alpha', '// beta', '// gamma', '// delta', ...code),
    ).toEqual([]);
  });
  test('preprocessor directives and Rust attributes are not comments', () => {
    expect(
      write(
        '/r/f.c',
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <string.h>',
        '#include <math.h>',
        'int main(void) {',
        '  return 0;',
        '}',
      ),
    ).toEqual([]);
    expect(
      write(
        '/r/g.rs',
        '#[derive(Debug)]',
        '#[serde(rename_all = "camelCase")]',
        '#[derive(Clone)]',
        '#[allow(dead_code)]',
        'struct S {',
        '  a: u32,',
        '}',
      ),
    ).toEqual([]);
  });
  // An Edit has no header exemption, so these rest on what counts as a comment.
  test('directives, attributes and dereferences in an edit are not comments', () => {
    for (const text of [
      '#include <a.h>\n#include <b.h>\n#include <c.h>\n#include <d.h>\nint a;\nint b;',
      '#[derive(Debug)]\n#[derive(Clone)]\n#[allow(dead_code)]\n#[inline]\nstruct S;\nfn f() {}',
      '*p = 1;\n*q = 2;\n*r = 3;\n*s = 4;\nint a;\nint b;',
    ]) {
      expect(edit(text, ''), text).toEqual([]);
    }
  });
  test('code replaced by comments is not comment-editing, whatever the old comments', () => {
    expect(
      joined(edit('// alpha\n// beta\n// gamma\n// delta\n// epsilon', 'const a = 1;\n// note')),
    ).toContain('5 of 5');
  });
  test('a comment-heavy edit to a config file is exempt', () => {
    expect(
      slopFindings({
        path: '/r/conf.yml',
        file: 'key: 1\n',
        text: '# alpha\n# beta\n# gamma\n# delta\nkey: 1',
        replaced: 'key: 1',
      }),
    ).toEqual([]);
  });
  test('comment-carried config formats are exempt (yaml)', () => {
    expect(
      write('/r/conf.yml', '# alpha', '# beta', '# gamma', '# delta', 'key: 1', 'other: 2'),
    ).toEqual([]);
  });
});

test('the directive names the file, tells the agent to fix it now, and lists the findings', () => {
  const directive = slopDirective('/r/f.ts', [
    'Section-marker comments (per policy: avoid):\n1:// ===',
  ]);
  expect(directive).toContain('/r/f.ts');
  expect(directive).toContain('Fix it NOW');
  expect(directive).toContain('1:// ===');
});
