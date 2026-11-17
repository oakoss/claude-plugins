import { describe, expect, test } from 'claude-code/testing';

type Run = { exitCode: number; stdout?: string; stderr?: string };

type World = {
  files: Record<string, string>;
  calls: string[];
  // git's answer for an argv, by its joined text; unset answers /repo.
  git?: (argv: string) => Run | undefined;
  // The engine refuses to start git.
  gitRejects?: boolean;
  readFails?: boolean;
  statKind?: string;
  // What the tool below returns, given the files after it wrote.
  tool?: (path: string, files: Record<string, string>) => object | null;
};

const pathOf = (e: { path?: string } | string) => (typeof e === 'string' ? e : (e.path ?? ''));

function fakeWorld(on: any, setup: Partial<World> = {}): World {
  const w: World = { files: {}, calls: [], ...setup };
  on('process.run', ($: unknown, e: { argv: string[] }) => {
    const argv = e.argv.join(' ');
    w.calls.push(argv);
    if (w.gitRejects) return { deny: 'fatal: injected' };
    const own = w.git?.(argv) ?? { exitCode: 0, stdout: '/repo\n' };
    return { value: { stdout: '', stderr: '', isStdoutTruncated: false, ...own } };
  });
  on('fs.exists', ($: unknown, e: { path?: string } | string) => ({
    value: w.files[pathOf(e)] !== undefined,
  }));
  on('fs.stat', ($: unknown, e: { path?: string } | string) => {
    const text = w.files[pathOf(e)];
    if (text === undefined) return { deny: 'ENOENT' };
    const size = new TextEncoder().encode(text).length;
    return { value: { kind: w.statKind ?? 'file', size, mtimeMs: 0 } };
  });
  on('fs.read', ($: unknown, e: { path?: string } | string) => {
    const text = w.files[pathOf(e)];
    if (w.readFails || text === undefined) return { deny: 'EIO' };
    return { value: text };
  });
  on(
    'tool.call',
    (
      $: unknown,
      e: {
        tool: string;
        file_path: string;
        content?: string;
        old_string?: string;
        new_string?: string;
      },
    ) => {
      const path = e.file_path;
      w.files[path] =
        e.tool === 'Write'
          ? (e.content ?? '')
          : (w.files[path] ?? '').replace(e.old_string ?? '', () => e.new_string ?? '');
      return w.tool?.(path, w.files) ?? { result: { filePath: path } };
    },
  );
  return w;
}

const contextOf = (r: unknown): string[] => (r as { context?: string[] }).context ?? [];

const FILE = '/repo/f.ts';
const SLOP = '// ===== HELPERS =====\nconst a = 1;\n';
const write = ($: any, content = SLOP, file_path = FILE) =>
  $.tool.call({ tool: 'Write', file_path, content });

describe('comment slop', () => {
  test('a Write that creates a file with slop is scanned after it lands', async ($, on) => {
    fakeWorld(on);
    const r = await write($);
    expect('result' in r).toBe(true);
    expect(contextOf(r).join('\n')).toContain('comment-check: comment slop detected in /repo/f.ts');
    expect(contextOf(r).join('\n')).toContain('Section-marker');
  });
  test('an Edit is judged by the file it leaves and its new_string, as an edit', async ($, on) => {
    fakeWorld(on, { files: { [FILE]: 'const a = 1;\n' } });
    const r = await $.tool.call({
      tool: 'Edit' as const,
      file_path: FILE,
      old_string: 'const a = 1;',
      new_string:
        '// alpha\n// beta\n// gamma\n// delta\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;',
    });
    expect(contextOf(r).join('\n')).toContain('4 of 8');
  });
  test('a clean file adds nothing', async ($, on) => {
    fakeWorld(on);
    expect(contextOf(await write($, 'const a = 1;\n'))).toEqual([]);
  });
  test('a prose file is not scanned, nor is git run for it', async ($, on) => {
    const w = fakeWorld(on);
    expect(contextOf(await write($, '# Note: heading\n', '/repo/README.md'))).toEqual([]);
    expect(w.calls).toEqual([]);
  });
  test('a call the tool failed is not scanned', async ($, on) => {
    fakeWorld(on, { tool: () => ({ result: { error: 'not found' }, isError: true }) });
    expect(contextOf(await write($))).toEqual([]);
  });
  test('context the tool already carried is kept', async ($, on) => {
    fakeWorld(on, { tool: (path) => ({ result: { filePath: path }, context: ['from below'] }) });
    const context = contextOf(await write($));
    expect(context[0]).toBe('from below');
    expect(context.join('\n')).toContain('Section-marker');
  });
  test('a file over 1 MiB is not scanned, counted in bytes', async ($, on) => {
    fakeWorld(on);
    expect(contextOf(await write($, `${SLOP}${'x'.repeat(1_048_577)}`))).toEqual([]);
    // Under 1 MiB of characters, over 1 MiB of UTF-8 bytes.
    expect(contextOf(await write($, `${SLOP}${'€'.repeat(400_000)}`))).toEqual([]);
  });
  test('a refused call is passed through unscanned', async ($, on) => {
    fakeWorld(on, { files: { [FILE]: SLOP }, tool: () => ({ deny: 'denied below' }) });
    expect(await write($)).toEqual({ deny: 'denied below' });
  });
  test('a file gone after the write is silently not scanned', async ($, on) => {
    fakeWorld(on, {
      tool: (path, files) => {
        delete files[path];
        return null;
      },
    });
    expect(contextOf(await write($))).toEqual([]);
  });
  test('a path that is not a regular file is not read', async ($, on) => {
    fakeWorld(on, { statKind: 'dir' });
    expect(contextOf(await write($))).toEqual([]);
  });
  test('a file at the filesystem root is scanned from /', async ($, on) => {
    const w = fakeWorld(on);
    await write($, SLOP, '/f.ts');
    expect(w.calls).toContain('git -C / rev-parse --show-toplevel');
  });
  test('a relative path is scanned from the working directory', async ($, on) => {
    const w = fakeWorld(on);
    await write($, SLOP, 'f.ts');
    expect(w.calls).toContain('git -C . rev-parse --show-toplevel');
  });
  test('a file outside any repository is not scanned', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.startsWith('git -C /tmp ')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : undefined,
    });
    expect(contextOf(await write($, SLOP, '/tmp/f.ts'))).toEqual([]);
  });
  test('a git that fails says the scan was skipped, naming why', async ($, on) => {
    fakeWorld(on, { git: () => ({ exitCode: 128, stderr: 'fatal: injected\nmore' }) });
    expect(contextOf(await write($)).join('\n')).toContain(
      'comment-check: git failed (fatal: injected); comment-slop scan skipped.',
    );
  });
  test('a git killed without a message names its exit status', async ($, on) => {
    fakeWorld(on, { git: () => ({ exitCode: 137 }) });
    expect(contextOf(await write($)).join('\n')).toContain('git failed (exit 137)');
  });
  test('a git that cannot start says the scan was skipped', async ($, on) => {
    fakeWorld(on, { gitRejects: true });
    expect(contextOf(await write($)).join('\n')).toContain('comment-slop scan skipped (');
  });
  test('a file that cannot be read says the scan was skipped', async ($, on) => {
    fakeWorld(on, { readFails: true });
    expect(contextOf(await write($)).join('\n')).toContain('comment-slop scan skipped (');
  });
});
