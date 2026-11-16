import { describe, expect, test } from 'claude-code/testing';

import { bash, denied, fakeWorld, ran, say } from '../fixtures';

describe('aliases', () => {
  test('an alias that commits is refused', async ($, on) => {
    fakeWorld(on, { aliases: 'alias.ci commit -v\n' });
    await say($, 'commit it');
    expect(denied(await bash($, 'git ci -am x'), '`git ci` is an alias')).toBe(true);
  });
  test('an inline alias that commits is refused', async ($, on) => {
    fakeWorld(on);
    expect(denied(await bash($, 'git -c alias.ci=commit ci -am x'), 'alias')).toBe(true);
  });
  test('a failed alias lookup refuses the call', async ($, on) => {
    fakeWorld(on, { fail: (a) => a.startsWith('git config --get-regexp') });
    expect(denied(await bash($, 'git ci -am x'), 'the gate failed')).toBe(true);
  });
  test('an alias that does not commit runs', async ($, on) => {
    fakeWorld(on, { aliases: 'alias.st status -sb\n' });
    expect(ran(await bash($, 'git st'))).toBe(true);
  });
});

describe('shell aliases', () => {
  test('an alias for git push needs a push request', async ($, on) => {
    fakeWorld(on, {
      shellAliases: "# Snapshot file\nfoo() {\n  x=1\n}\nalias -- gp='git push'\n",
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gp'), "doesn't ask for a push")).toBe(true);
  });
  test("the gate's own read covers the first call, before any snapshot exists", async ($, on) => {
    const w = fakeWorld(on, {
      ownAliases: {
        exitCode: 0,
        stdout:
          "\nreview-cycle: aliases <tag>\nalias gp='git push'\nreview-cycle: end of aliases <tag>\n",
      },
      files: { '/Users/tester/.zshrc': '' },
    });
    const ownReads = () => w.calls.filter((c) => c.argv[1] === '-c' && c.argv[2] === '-l');
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
    // Bounded rather than fixed: how many microtasks the kit spends before the read varies by release.
    for (let i = 0; i < 10_000 && ownReads().length === 0; i++) await Promise.resolve();
    const reads = ownReads();
    expect(reads.map((c) => c.argv.slice(0, 3))).toEqual([['/bin/zsh', '-c', '-l']]);
    await say($, 'fix the parser');
    const r = (await bash($, 'gp')) as { deny?: string; context?: string[] };
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(ownReads()).toHaveLength(1);
    expect(reads[0]?.argv[3]).toContain("source '/Users/tester/.zshrc' < /dev/null");
    expect(reads[0]?.init).toEqual({
      stdin: '',
      timeoutMs: 10_000,
      env: { CLAUDECODE: '1', SHELL: '/bin/zsh', GIT_EDITOR: 'true' },
    });
    const plain = (await bash($, 'ls')) as { context?: string[] };
    expect((plain.context ?? []).some((c) => c.includes('could not read the user'))).toBe(false);
  });
  test("the own read wins over an older session's snapshot on the first call", async ($, on) => {
    fakeWorld(on, {
      ownAliases: {
        exitCode: 0,
        stdout:
          "review-cycle: aliases <tag>\nalias gp='git push'\nreview-cycle: end of aliases <tag>\n",
      },
      shellAliases: "alias -- ll='ls -l'\n",
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gp'), "doesn't ask for a push")).toBe(true);
  });
  test('with no rc file the read sources nothing and lists nothing', async ($, on) => {
    const w = fakeWorld(on, {
      ownAliases: {
        exitCode: 0,
        stdout: 'review-cycle: aliases <tag>\nreview-cycle: end of aliases <tag>\n',
      },
    });
    await bash($, 'ls');
    const script = w.calls.find((c) => c.argv[1] === '-c' && c.argv[2] === '-l')?.argv[3] ?? '';
    expect(script).not.toContain('source');
    expect(script).not.toContain('alias |');
  });
  test('the snapshot fallback reads only its alias lines', async ($, on) => {
    fakeWorld(on, {
      ownAliases: { exitCode: 1, stdout: '' },
      shellAliases: 'gp=git push\n',
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gp'), "doesn't ask for a push")).toBe(false);
  });
  test("markers without this read's tag read as no answer", async ($, on) => {
    fakeWorld(on, {
      ownAliases: {
        exitCode: 0,
        stdout: "review-cycle: aliases x\nalias gp='git push'\nreview-cycle: end of aliases x\n",
      },
    });
    const r = (await bash($, 'ls')) as { context?: string[] };
    expect((r.context ?? []).join(' ')).toContain('the shell stopped before printing its aliases');
  });
  test('a failed own read falls back to the snapshot, and is tried once', async ($, on) => {
    const w = fakeWorld(on, {
      ownAliases: { exitCode: 1, stdout: '' },
      shellAliases: "alias -- gp='git push'\n",
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gp'), "doesn't ask for a push")).toBe(true);
    await bash($, 'ls');
    expect(w.calls.filter((c) => c.argv[1] === '-c' && c.argv[2] === '-l')).toHaveLength(1);
  });
  test('a read that exits 0 but never reaches the end line falls back too', async ($, on) => {
    fakeWorld(on, {
      ownAliases: { exitCode: 0, stdout: '' },
      shellAliases: "alias -- gp='git push'\n",
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gp'), "doesn't ask for a push")).toBe(true);
  });
  test('with both reads failed, the note names both', async ($, on) => {
    fakeWorld(on, { ownAliases: 'throw' });
    const r = (await bash($, 'ls')) as { context?: string[] };
    const note = (r.context ?? []).find((c) => c.includes('could not read the user')) ?? '';
    expect(note).toContain('$.process.run: timed out); no shell snapshot');
  });
  test('a shell that exits nonzero is named with its message', async ($, on) => {
    fakeWorld(on, { ownAliases: { exitCode: 1, stdout: '' } });
    const r = (await bash($, 'ls')) as { context?: string[] };
    expect((r.context ?? []).join(' ')).toContain('(the shell exited 1: zsh: not found)');
  });
  test('a shell that exits nonzero in silence says so', async ($, on) => {
    fakeWorld(on, { ownAliases: { exitCode: 1, stdout: '', stderr: '' } });
    const r = (await bash($, 'ls')) as { context?: string[] };
    expect((r.context ?? []).join(' ')).toContain('(the shell exited 1: no output)');
  });
});
