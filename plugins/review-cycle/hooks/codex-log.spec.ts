import { describe, expect, test } from 'vitest';

import { readCodexLog } from './codex-log';

// The shapes codex-cli 0.162.1 writes when its output goes to a file, colored
// when FORCE_COLOR is set.
const E = String.fromCodePoint(27);
const BANNER = 'OpenAI Codex v0.162.1';
const exec = `${E}[35m${E}[3mexec${E}[0m${E}[0m`;
const cmd = (c: string, cwd = '/repo') => `${E}[1m${c}${E}[0m in ${cwd}`;
const ok = (ms: number) => `${E}[32m succeeded in ${ms}ms:${E}[0m`;
const exited = (code: number, ms: number) => `${E}[31m exited ${code} in ${ms}ms:${E}[0m`;
const codex = `${E}[35m${E}[3mcodex${E}[0m${E}[0m`;

const log = (...lines: string[]) => [BANNER, ...lines].join('\n');
const strip = (s: string) => s.replaceAll(new RegExp(`${E}\\[[0-9;]*m`, 'g'), '');
const brief = (s: string) =>
  readCodexLog(s).commands.map((c) => [c.command, c.status, c.exitCode, c.guessed]);
const unguessed = (s: string) =>
  readCodexLog(s).commands.map((c) => ({ ...c, guessed: undefined }));

describe('readCodexLog', () => {
  test('reads each command with its status, exit code, time and output lines', () => {
    const { recognized, commands } = readCodexLog(
      log(
        exec,
        cmd("/bin/zsh -lc 'pnpm test'"),
        exited(1, 147),
        'mise WARN cache',
        'Error: EPERM',
        exec,
        cmd("/bin/zsh -lc 'pnpm typecheck'"),
        ok(2400),
        '',
        '$ tsc -p .',
        codex,
        'Overall verdict: clean',
      ),
    );
    expect(recognized).toBe(true);
    expect(commands).toEqual([
      {
        command: "/bin/zsh -lc 'pnpm test'",
        cwd: '/repo',
        status: 'exited',
        exitCode: 1,
        durationMs: 147,
        guessed: false,
        firstOutputLine: 'mise WARN cache',
        lastOutputLine: 'Error: EPERM',
      },
      {
        command: "/bin/zsh -lc 'pnpm typecheck'",
        cwd: '/repo',
        status: 'succeeded',
        exitCode: 0,
        durationMs: 2400,
        guessed: false,
        firstOutputLine: '$ tsc -p .',
        lastOutputLine: '$ tsc -p .',
      },
    ]);
  });

  test('statuses for overlapping commands are guessed, the last one left included', () => {
    const lines = [
      exec,
      cmd('a'),
      exec,
      cmd('b'),
      exec,
      cmd('c'),
      ok(3),
      'c output',
      exited(130, 31_093),
      'a output',
      ok(5),
    ];
    expect(brief(log(...lines))).toEqual([
      ['a', 'exited', 130, true],
      ['b', 'succeeded', 0, true],
      ['c', 'succeeded', 0, true],
    ]);
  });

  test('a finished command leaves the open set, so a late status skips it', () => {
    const lines = [
      exec,
      cmd('a'),
      ok(1),
      exec,
      cmd('b'),
      exec,
      cmd('c'),
      ok(2),
      exited(2, 9),
      exec,
      cmd('d'),
      ok(3),
    ];
    expect(brief(log(...lines))).toEqual([
      ['a', 'succeeded', 0, false],
      ['b', 'exited', 2, true],
      ['c', 'succeeded', 0, true],
      ['d', 'succeeded', 0, false],
    ]);
  });

  test('the cwd splits off at the last ` in /`, so a command may hold one', () => {
    const { commands } = readCodexLog(log(exec, cmd('for f in /tmp/x; do :; done'), ok(1)));
    expect(commands[0]).toMatchObject({ command: 'for f in /tmp/x; do :; done', cwd: '/repo' });
  });

  test('a command the log never finishes is unfinished, even one cut after exec', () => {
    expect(brief(log(exec, cmd('hangs'), codex, 'verdict'))).toEqual([
      ['hangs', 'unfinished', null, false],
    ]);
    expect(brief(log(exec, cmd('a'), ok(1), exec))).toEqual([
      ['a', 'succeeded', 0, false],
      ['', 'unfinished', null, false],
    ]);
  });

  test('a header cut short ends at the next command', () => {
    expect(brief(log(exec, `${E}[1mtruncated`, exec, cmd('next'), ok(1)))).toEqual([
      ['truncated', 'unfinished', null, false],
      ['next', 'succeeded', 0, true],
    ]);
  });

  test('a status read while a never-finished command was open is a guess', () => {
    const lines = [exec, cmd('cat README.md'), exec, cmd('pnpm test'), ok(3), '# Project', codex];
    expect(brief(log(...lines))).toEqual([
      ['cat README.md', 'unfinished', null, false],
      ['pnpm test', 'succeeded', 0, true],
    ]);
  });

  test('a multi-line command keeps an ` in /` on its first line; the reset marks the cwd', () => {
    const { commands } = readCodexLog(
      log(
        exec,
        `${E}[1m/bin/zsh -lc 'for d in /repo/a /repo/b; do`,
        '  (cd "$d" && pnpm test)',
        `done'${E}[0m in /repo`,
        exited(1, 9),
      ),
    );
    expect(commands[0]).toMatchObject({
      command: '/bin/zsh -lc \'for d in /repo/a /repo/b; do\n  (cd "$d" && pnpm test)\ndone\'',
      cwd: '/repo',
      status: 'exited',
    });
  });

  // The shape of a real refusal: colored, and the command escaped twice.
  const tick = '`';
  const dollar = '$';
  const refusal = String.raw`${E}[2m2026-10-16T03:42:17.257829Z${E}[0m ${E}[31mERROR${E}[0m codex_core::tools::router: error=exec_command failed: CreateProcess { message: "Rejected(\"${tick}/bin/zsh -lc 'rm -rf \\\"${dollar}{D}\\\"; pnpm test'${tick} rejected by policy\")" }`;
  const refused = `/bin/zsh -lc 'rm -rf "${dollar}{D}"; pnpm test'`;

  test('a command Codex refuses to run is listed as rejected, unescaped', () => {
    const { commands } = readCodexLog(log(exec, cmd('a'), ok(1), refusal, codex));
    expect(commands[1]).toMatchObject({
      command: refused,
      status: 'rejected',
      exitCode: null,
      guessed: false,
    });
  });

  test('a refusal in a log without color is a guess, since output could hold one', () => {
    const { commands } = readCodexLog(strip(log(exec, cmd('a'), ok(1), refusal, codex)));
    expect(commands[1]).toMatchObject({ command: refused, status: 'rejected', guessed: true });
  });

  test('with color, a plain refusal in a command output is output, not a refusal', () => {
    const { commands } = readCodexLog(
      log(exec, cmd('sed -n 1870p x.out'), ok(1), strip(refusal), 'tail'),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.lastOutputLine).toBe('tail');
  });

  test('without color, a refusal quoted after a path prefix is output, not a refusal', () => {
    const { commands } = readCodexLog(
      strip(log(exec, cmd('rg Rejected logs/'), ok(1), `logs/x.out:1870:${refusal}`, 'tail')),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.lastOutputLine).toBe('tail');
  });

  test('a command spanning lines keeps them, and its cwd comes from the last', () => {
    const { commands } = readCodexLog(
      log(exec, `${E}[1mcat <<'EOF'`, 'body', `EOF${E}[0m in /work dir`, ok(1)),
    );
    expect(commands[0]).toMatchObject({ command: "cat <<'EOF'\nbody\nEOF", cwd: '/work dir' });
  });

  test('with color, plain text in output is never a marker', () => {
    const lines = [
      exec,
      cmd('a'),
      exec,
      cmd('b'),
      ok(1),
      'exec',
      'x in /tmp',
      ' exited 1 in 5ms:',
      ' succeeded in 2ms:',
    ];
    expect(brief(log(...lines))).toEqual([
      ['a', 'unfinished', null, false],
      ['b', 'succeeded', 0, true],
    ]);
    expect(readCodexLog(log(...lines)).commands[1]?.lastOutputLine).toBe('succeeded in 2ms:');
  });

  test("Codex's own colored lines end a command's output", () => {
    const { commands } = readCodexLog(
      log(exec, cmd('bash -n x.sh'), ok(1), `${E}[2mmcp: node_repl started${E}[0m`, codex, 'No.'),
    );
    expect(commands[0]).toMatchObject({ firstOutputLine: '', lastOutputLine: '' });
  });

  test('a log without color reads the same, every status guessed', () => {
    const lines = [exec, cmd('a'), exited(1, 3), 'boom', exec, cmd('b'), ok(4), 'fine', codex];
    expect(unguessed(strip(log(...lines)))).toEqual(unguessed(log(...lines)));
    expect(brief(strip(log(...lines)))).toEqual([
      ['a', 'exited', 1, true],
      ['b', 'succeeded', 0, true],
    ]);
  });

  test("without color, Codex's own notes and errors end a command's output", () => {
    const { commands } = readCodexLog(
      strip(
        log(
          exec,
          cmd('pnpm test'),
          exited(1, 3),
          'FAIL a.spec.ts',
          'mcp: node_repl/js (completed)',
          '2026-10-16T02:36:17.182158Z ERROR codex_core::session: failed to record',
          'ERROR: unexpected status 401',
        ),
      ),
    );
    expect(commands[0]).toMatchObject({ lastOutputLine: 'FAIL a.spec.ts' });
  });

  test('colored output under plain markers keeps the log plain', () => {
    const { commands } = readCodexLog(
      strip(log(exec, cmd('pnpm test'), ok(3))).replace('in 3ms:', `in 3ms:\n${E}[32mPASS${E}[0m`),
    );
    expect(commands).toMatchObject([
      { status: 'succeeded', guessed: true, firstOutputLine: 'PASS' },
    ]);
  });

  test('Windows line endings read the same', () => {
    const lines = [exec, cmd('a'), exited(1, 3), 'boom'];
    expect(readCodexLog(log(...lines).replaceAll('\n', '\r\n'))).toEqual(
      readCodexLog(log(...lines)),
    );
  });

  test('exit 0 is a success, seconds become milliseconds, long lines are clipped', () => {
    const long = 'x'.repeat(250);
    const { commands } = readCodexLog(
      log(exec, cmd('a'), `${E}[31m exited 0 in 1.5s:${E}[0m`, long),
    );
    expect(commands[0]).toMatchObject({ status: 'succeeded', exitCode: 0, durationMs: 1500 });
    expect(commands[0]?.firstOutputLine).toBe(`${'x'.repeat(199)}…`);
  });

  test('text without the banner is not recognized; an empty Codex run lists nothing', () => {
    expect(readCodexLog('')).toEqual({ recognized: false, commands: [] });
    expect(readCodexLog('Error: unauthorized').recognized).toBe(false);
    expect(readCodexLog(log(codex, 'No findings.'))).toEqual({ recognized: true, commands: [] });
  });
});
