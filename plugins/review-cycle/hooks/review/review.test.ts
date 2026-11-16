import { describe, expect, test } from 'claude-code/testing';

import {
  answered,
  fakeStore,
  fakeWorld,
  finishLeg,
  legUnderWay,
  statusOf,
  step,
  USAGE,
} from '../fixtures';
import { sessionDays } from './codex-log';

// The scratch tool's answer in a transcript, as $.session.messages() gives it.
const scratchAnswer = (dir: string) => ({
  role: 'assistant',
  text: '',
  toolUses: [
    { tool_use_id: dir, tool: 'mcp__review-cycle__scratch', input: {}, text: `${dir}\nGive…` },
  ],
});

describe('the scratch directory', () => {
  test('scratch makes one under TMPDIR, and sweep removes it once', async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : a.startsWith('test -e')
            ? { exitCode: 1 }
            : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    const made = (await $.tool.call({ tool: 'mcp__review-cycle__scratch' })) as { result: string };
    expect(made.result).toContain('mktemp -d /tmp/review-cycle.abc123/leg.XXXXXX');
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      { dir: '/tmp/review-cycle.abc123', stopped: 0, removed: true, errors: [] },
    ]);
    expect(w.calls.some((c) => c.argv.join(' ') === 'rm -rf -- /tmp/review-cycle.abc123')).toBe(
      true,
    );
    const again = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(again.result).toBe('No scratch directory to sweep.');
  });
  test('sweep also removes the directories this conversation made before a resume', async ($, on) => {
    const w = fakeWorld(on, {
      messages: [
        scratchAnswer('/tmp/review-cycle.old111'),
        scratchAnswer('/tmp/review-cycle.gone22'),
      ],
      git: (a) => (a === 'test -d /tmp/review-cycle.gone22' ? { exitCode: 1 } : null),
    });
    await ($ as any).session.start({ source: 'startup' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      { dir: '/tmp/review-cycle.old111', stopped: 0, removed: true, errors: [] },
    ]);
    const argvs = w.calls.map((c) => c.argv.join(' '));
    expect(argvs).not.toContain('rm -rf -- /tmp/review-cycle.gone22');
  });
  test('a transcript it cannot read says so, and this session’s own still go', async ($, on) => {
    fakeWorld(on, {
      messages: { deny: 'no transcript' },
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(swept.result).toContain('"dir": "/tmp/review-cycle.abc123"');
    expect(swept.result).toContain(
      'may not all have been looked for: the transcript could not be read',
    );
  });
  test('a directory read from the transcript that something still uses is left, nothing ended', async ($, on) => {
    const w = fakeWorld(on, {
      messages: [scratchAnswer('/tmp/review-cycle.par111')],
      git: (a) => (a.startsWith('pgrep -f /tmp/review-cycle') ? { stdout: '4242\n' } : null),
    });
    await ($ as any).session.start({ source: 'startup' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      {
        dir: '/tmp/review-cycle.par111',
        stopped: 0,
        removed: false,
        errors: ['left: in use by 4242'],
      },
    ]);
    const argvs = w.calls.map((c) => c.argv.join(' '));
    expect(argvs.some((a) => a.startsWith('kill '))).toBe(false);
    expect(argvs).not.toContain('rm -rf -- /tmp/review-cycle.par111');
  });
  test('a directory read back is left while the session that made it runs, and swept after', async ($, on) => {
    let running = true;
    const w = fakeWorld(on, {
      messages: [scratchAnswer('/tmp/review-cycle.par111')],
      git: (a) =>
        a === 'cat /tmp/review-cycle.par111/.owner'
          ? { stdout: '500\tSat Nov  7 14:42:33 2026\n' }
          : a === 'sh -c echo "$PPID"'
            ? { stdout: '600\n' }
            : a === 'env LC_ALL=C TZ=UTC0 ps -o lstart= -p 500'
              ? running
                ? { stdout: 'Sat Nov  7 14:42:33 2026  \n' }
                : { exitCode: 1 }
              : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    const first = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(first.result)).toEqual([
      {
        dir: '/tmp/review-cycle.par111',
        stopped: 0,
        removed: false,
        errors: ['left: made by a session still running (pid 500)'],
      },
    ]);
    expect(w.calls.map((c) => c.argv.join(' '))).not.toContain(
      'rm -rf -- /tmp/review-cycle.par111',
    );
    running = false;
    const after = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(after.result)).toEqual([
      { dir: '/tmp/review-cycle.par111', stopped: 0, removed: true, errors: [] },
    ]);
  });
  test('scratch marks the directory with the process that made it', async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const mark = w.calls.find(
      (c) => c.argv[0] === 'sh' && c.argv.includes('/tmp/review-cycle.abc123'),
    );
    expect(mark?.argv[2]).toContain('"$PPID"');
    expect(mark?.argv[2]).toContain('> "$1/.owner"');
  });
  test("only the scratch tool's answers name a directory to sweep", async ($, on) => {
    const bashAnswer = {
      role: 'assistant',
      text: '',
      toolUses: [{ tool_use_id: 'b', tool: 'Bash', input: {}, text: '/tmp/review-cycle.other9\n' }],
    };
    const w = fakeWorld(on, { messages: [bashAnswer] });
    await ($ as any).session.start({ source: 'startup' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(swept.result).toBe('No scratch directory to sweep.');
    expect(w.calls.map((c) => c.argv.join(' '))).not.toContain(
      'rm -rf -- /tmp/review-cycle.other9',
    );
  });
  test('a transcript read at its limit says older directories may be missed', async ($, on) => {
    const filler = { role: 'user', text: 'x', toolUses: [] };
    fakeWorld(on, { messages: Array.from({ length: 4096 }, () => filler) });
    await ($ as any).session.start({ source: 'startup' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(swept.result).toContain('only the newest 4096 messages were read');
  });
  test('ACLs it cannot clear are reported, and the directory kept', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : a === 'rm -rf -- /tmp/review-cycle.abc123'
            ? { exitCode: 1, stderr: 'rm: …: Permission denied' }
            : a.startsWith('find /tmp/review-cycle.abc123 -type l')
              ? { exitCode: 1, stderr: "chmod: invalid option -- 'N'" }
              : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      {
        dir: '/tmp/review-cycle.abc123',
        stopped: 0,
        removed: false,
        errors: [
          "clearing ACLs failed: chmod: invalid option -- 'N'",
          'rm failed: rm: …: Permission denied',
        ],
      },
    ]);
  });
  test('a directory a deny-delete ACL holds is unlocked, then removed', async ($, on) => {
    // Only these exact commands unlock: links themselves, and directories and
    // single-link files, so nothing outside the directory changes.
    const unlocking = new Set([
      'find /tmp/review-cycle.abc123 -type l -exec chmod -h -N {} +',
      'find /tmp/review-cycle.abc123 ( -type d -o -type f -links 1 ) -exec chmod -N {} +',
    ]);
    const ran = new Set<string>();
    const w = fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('mktemp -d /tmp/review-cycle.'))
          return { stdout: '/tmp/review-cycle.abc123\n' };
        if (unlocking.has(a)) {
          ran.add(a);
          return { stdout: '' };
        }
        if (a === 'rm -rf -- /tmp/review-cycle.abc123' && ran.size < unlocking.size) {
          return { exitCode: 1, stderr: 'rm: …/locked.json: Permission denied' };
        }
        return null;
      },
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      { dir: '/tmp/review-cycle.abc123', stopped: 0, removed: true, errors: [] },
    ]);
    const rms = w.calls.filter((c) => c.argv.join(' ') === 'rm -rf -- /tmp/review-cycle.abc123');
    expect(rms).toHaveLength(2);
  });
  test("sweep removes mbx's build output under the directory before the directory", async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    await $.tool.call({ tool: 'mcp__review-cycle__sweep' });
    const argvs = w.calls.map((c) => c.argv.join(' '));
    const clean = argvs.indexOf('mbx clean --under /tmp/review-cycle.abc123');
    expect(clean).toBeGreaterThan(-1);
    expect(clean).toBeLessThan(argvs.indexOf('rm -rf -- /tmp/review-cycle.abc123'));
  });
  test('without mbx, sweep still removes the directory', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : null,
      reject: (a) => a.startsWith('mbx '),
      rejectWith: 'spawn mbx ENOENT',
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      { dir: '/tmp/review-cycle.abc123', stopped: 0, removed: true, errors: [] },
    ]);
  });
  test('an mbx clean that fails or times out is reported, and the directory still goes', async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : a.startsWith('realpath ')
            ? { stdout: '/private/tmp/review-cycle.abc123\n' }
            : a.startsWith('mbx clean')
              ? { exitCode: 2, stderr: 'boom' }
              : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(swept.result)).toEqual([
      {
        dir: '/tmp/review-cycle.abc123',
        stopped: 0,
        removed: true,
        errors: ['mbx clean failed: boom'],
      },
    ]);
    // mbx records copies under the real path.
    expect(
      w.calls.some(
        (c) => c.argv.join(' ') === 'mbx clean --under /private/tmp/review-cycle.abc123',
      ),
    ).toBe(true);
    w.reject = (a) => a.startsWith('mbx ');
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const slow = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(slow.result)[0].errors).toEqual([
      'mbx clean did not finish: review-cycle: $.process.run: timed out',
    ]);
  });
  test('a TMPDIR with a trailing slash makes a path without a doubled one', async ($, on) => {
    const w = fakeWorld(on, { env: { TMPDIR: '/var/x/' } });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    expect(w.calls.some((c) => c.argv.join(' ') === 'mktemp -d /var/x/review-cycle.XXXXXX')).toBe(
      true,
    );
  });
  test('a sweep that fails keeps the directory, and the next sweep tries it again', async ($, on) => {
    let failing = true;
    fakeWorld(on, {
      git: (a) =>
        a.startsWith('mktemp -d /tmp/review-cycle.')
          ? { stdout: '/tmp/review-cycle.abc123\n' }
          : a.startsWith('test -e')
            ? { exitCode: 1 }
            : null,
      reject: (a) => failing && a.startsWith('lsof'),
    });
    await ($ as any).session.start({ source: 'startup' });
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const first = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(first.result)).toEqual([
      { dir: '/tmp/review-cycle.abc123', stopped: 0, removed: false, errors: [expect.any(String)] },
    ]);
    failing = false;
    const second = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(JSON.parse(second.result)[0]).toMatchObject({ removed: true, errors: [] });
  });
  test('without the sweep tool, scratch makes nothing', async ($, on) => {
    const w = fakeWorld(on, { registerFails: 'sweep' });
    await ($ as any).session.start({ source: 'startup' });
    const made = (await $.tool.call({ tool: 'mcp__review-cycle__scratch' })) as { result: string };
    expect(made.result).toContain('sweep tool is not registered');
    expect(w.calls.some((c) => c.argv[0] === 'mktemp')).toBe(false);
  });
  test('a scratch directory that cannot be made says so, and nothing is swept', async ($, on) => {
    fakeWorld(on, { fail: (a) => a.startsWith('mktemp -d') });
    await ($ as any).session.start({ source: 'startup' });
    const made = (await $.tool.call({ tool: 'mcp__review-cycle__scratch' })) as { result: string };
    expect(made.result).toContain('could not make a scratch directory (fatal: injected)');
    const swept = (await $.tool.call({ tool: 'mcp__review-cycle__sweep' })) as { result: string };
    expect(swept.result).toBe('No scratch directory to sweep.');
  });
});

// A count event as `grep -oE` prints it from a codex-cli 0.164.0 rollout.
const rolloutUsage = (input: number, output: number) =>
  `"type":"token_count","info":{"total_token_usage":{"input_tokens":${input},"cached_input_tokens":${input - 10},"cache_write_input_tokens":0,"output_tokens":${output},"reasoning_output_tokens":1,"total_tokens":${input + output}}`;
const SESSION = '01a17142-615a-7521-991d-b512b86d3b59';

describe('the Codex command log', () => {
  const E = String.fromCodePoint(27);
  const [BANNER, ...RUN] = [
    'OpenAI Codex v0.162.1',
    `${E}[35m${E}[3mexec${E}[0m${E}[0m`,
    `${E}[1m/bin/zsh -lc 'pnpm test'${E}[0m in /repo`,
    `${E}[31m exited 1 in 147ms:${E}[0m`,
    'failed to load config',
  ];
  const LOG = [BANNER, ...RUN].join('\n');
  const SESSION_LOG = [BANNER, `session id: ${SESSION}`, ...RUN].join('\n');
  test('codex_log lists the commands in a Codex output file', async ($, on) => {
    fakeWorld(on, { files: { '/tmp/codex.out': LOG } });
    await ($ as any).session.start({ source: 'startup' });
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: '/tmp/codex.out',
    } as any)) as { result: string };
    expect(JSON.parse(r.result)).toEqual({
      commands: [
        {
          command: "/bin/zsh -lc 'pnpm test'",
          cwd: '/repo',
          status: 'exited',
          exitCode: 1,
          durationMs: 147,
          guessed: false,
          masked: false,
          firstOutputLine: 'failed to load config',
          lastOutputLine: 'failed to load config',
        },
      ],
      tokens: { sessionId: null, unavailable: 'the log names no session id' },
    });
  });
  // A log naming SESSION, whose one child session finished with 100 + 5 tokens
  // under <home>/sessions.
  const tokensWith = async ($: any, on: any, env: Record<string, string>, home: string) => {
    const dir = `${home}/sessions/${sessionDays(SESSION)[0]}`;
    const child = `${dir}/rollout-2026-10-24T23-12-18-01a17142-6246-7073-970e-3dfdb1c5d68a.jsonl`;
    const w = fakeWorld(on, {
      env,
      files: { '/tmp/codex.out': SESSION_LOG, [dir]: '' },
      git: (a: string) => {
        if (a.includes(`"parent_thread_id":"${SESSION}"`)) return { stdout: `${child}\n` };
        if (a.startsWith('grep -oE') && a.endsWith(child)) {
          return {
            stdout: `${rolloutUsage(10, 1)}\n${rolloutUsage(100, 5)}\n"type":"task_complete"\n`,
          };
        }
        return null;
      },
    });
    await $.session.start({ source: 'startup' });
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: '/tmp/codex.out',
    })) as {
      result: string;
    };
    const search = w.calls.find((c) => c.argv[1] === '-rlF');
    return { tokens: JSON.parse(r.result).tokens, search, dir, w };
  };
  test("codex_log sums the token totals of the review's sessions under CODEX_HOME", async ($, on) => {
    const { tokens, search, dir } = await tokensWith($, on, { CODEX_HOME: '/codex' }, '/codex');
    expect(tokens).toEqual({
      sessionId: SESSION,
      sessions: 1,
      input: 100,
      cachedInput: 90,
      output: 5,
      reasoningOutput: 1,
      total: 105,
    });
    expect(search?.argv).toEqual([
      'grep',
      '-rlF',
      '--include=rollout-*.jsonl',
      '-e',
      `"parent_thread_id":"${SESSION}"`,
      dir,
    ]);
    // A search over a large sessions tree must not hold the tool open.
    expect(search?.init).toMatchObject({ stdin: '', timeoutMs: 30_000 });
  });
  test('codex_log reads ~/.codex when CODEX_HOME is unset', async ($, on) => {
    const { tokens, search } = await tokensWith($, on, {}, '/Users/tester/.codex');
    expect(tokens.total).toBe(105);
    expect(search?.argv.at(-1)).toMatch(/^\/Users\/tester\/\.codex\/sessions\//);
  });
  test('codex_log reads ~/.codex when CODEX_HOME is empty, as Codex does', async ($, on) => {
    const { tokens, search } = await tokensWith($, on, { CODEX_HOME: '' }, '/Users/tester/.codex');
    expect(tokens.total).toBe(105);
    expect(search?.argv.at(-1)).toMatch(/^\/Users\/tester\/\.codex\/sessions\//);
  });
  test('codex_log says so when neither CODEX_HOME nor HOME is set', async ($, on) => {
    const { tokens, search } = await tokensWith($, on, { HOME: '' }, '/nowhere');
    expect(tokens).toEqual({
      sessionId: SESSION,
      unavailable: 'neither CODEX_HOME nor HOME is set',
    });
    expect(search).toBe(undefined);
  });
  test('codex_log keeps the commands when the token lookup throws', async ($, on) => {
    fakeWorld(on, {
      env: { CODEX_HOME: '/codex' },
      files: {
        '/tmp/codex.out': SESSION_LOG,
        [`/codex/sessions/${sessionDays(SESSION)[0]}`]: '',
      },
      reject: (a: string) => a.startsWith('grep'),
      rejectWith: 'timed out after 30000ms',
    });
    await ($ as any).session.start({ source: 'startup' });
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: '/tmp/codex.out',
    } as any)) as { result: string };
    const answer = JSON.parse(r.result);
    expect(answer.commands).toHaveLength(1);
    expect(answer.tokens.sessionId).toBe(SESSION);
    expect(answer.tokens.unavailable).toContain('timed out');
  });
  test('codex_log refuses a file that is not a Codex log, rather than list nothing', async ($, on) => {
    // Command-shaped lines without the banner are still refused.
    fakeWorld(on, { files: { '/tmp/other.out': LOG.split('\n').slice(1).join('\n') } });
    await ($ as any).session.start({ source: 'startup' });
    const r = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: '/tmp/other.out',
    } as any)) as { result: string };
    expect(r.result).toBe(
      'review-cycle codex_log: /tmp/other.out is not a codex review log (no `OpenAI Codex v` banner).',
    );
  });
  test('codex_log says so when the file is missing or the path is relative', async ($, on) => {
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    const missing = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: '/tmp/none.out',
    } as any)) as { result: string };
    expect(missing.result).toBe('review-cycle codex_log: no file at /tmp/none.out.');
    const relative = (await $.tool.call({
      tool: 'mcp__review-cycle__codex_log',
      path: 'codex.out',
    } as any)) as { result: string };
    expect(relative.result).toContain('must be an absolute path');
  });
});

// A tool call's row as the transcript draws it.
const row = (tool: string, input: unknown) => ({
  tool_use_id: tool,
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
});

const summarize = async ($: any, text: string) =>
  ((await $.tool.call({ tool: 'mcp__review-cycle__summary', text })) as { result: string }).result;
const cycleKeys = (store: Map<string, unknown>) =>
  [...store.keys()].filter((k) => k.startsWith('cycles:'));

describe('the summary tool', () => {
  const BLOCK = 'Review cycle complete.\n\nTier: light\nFinal state: clean';
  test('is registered at session start, and answers with the summary it was given', async ($, on) => {
    fakeStore(on);
    const w = fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    expect(w.registered).toContain('summary');
    expect(await summarize($, FULL)).toBe(FULL);
  });
  test('draws its own call as a line count, and every other call as it was', async ($, on) => {
    fakeWorld(on);
    const drawn: any[] = [];
    on('ui.render', { component: 'ToolUse' }, (($$: any, e: any) => {
      drawn.push(e.props);
      const { Text } = $$.ui.resolve(e);
      return h(Text, {}, 'row');
    }) as any);
    for (const props of [
      row('mcp__review-cycle__summary', { text: BLOCK }),
      row('Bash', { command: 'ls' }),
      row('mcp__review-cycle__summaryx', { text: BLOCK }),
    ]) {
      await ($ as any).ui.mount({
        plugin: 'review-cycle',
        surface: 'terminal',
        component: 'ToolUse',
        props,
      });
    }
    expect(drawn.map((p) => p.input)).toEqual([{ lines: 4 }, { command: 'ls' }, { text: BLOCK }]);
  });
  test("keeps what the block says, and the status tool totals the repository's cycles", async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    const block = [
      'Review cycle complete.',
      '',
      'Tier: full',
      'Iterations: 2 (converged)',
      "Convergence: iteration 2: 1 of 2 from this cycle's fixes",
      'Cost: iteration 1: 12 min wall-clock, 5 legs, 253086 subagent tokens, 1812691 Codex tokens, iteration 2: 3 min wall-clock, 1 leg, 36458 subagent tokens',
      'Findings fixed inline: 2',
      '  - a.ts:1 — misses the empty case (code-reviewer, above)',
      '  - a.spec.ts — no test for it (pr-test-analyzer, below)',
      '',
      'Findings deferred: 0',
    ].join('\n');
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__summary', text: block } as any)) as {
      result: string;
    };
    expect(r.result).toBe(block);
    expect([...store.keys()].some((k) => k.startsWith('cycles:'))).toBe(true);
    const status = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(status.cycles).toMatchObject({
      cycles: 1,
      meanIterations: 2,
      fixedCount: 2,
      fixed: { above: 1, below: 1, unknown: 0 },
      later: 2,
      selfCaused: 1,
    });
    expect(status.cycles.byLeg['pr-test-analyzer'].fixed.below).toBe(1);
    const spent = { minutes: 15, legs: 6, subagentTokens: 289_544, codexTokens: 1_812_691 };
    const none = { steps: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    expect(status.cycles.cost).toEqual({ cycles: 1, partial: 0, ...spent, ...none });
    expect(status.cycles.recent).toMatchObject([
      { tier: 'full', iterations: 2, fixed: 2, deferred: 0, cost: { ...spent, isPartial: false } },
    ]);
  });
  const FULL = `${BLOCK}\nIterations: 1 (converged)\nConvergence: iteration 1 only\nFindings fixed inline: 0\nFindings deferred: 0`;
  test('keeps two cycles summarized at once as two', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    await Promise.all([summarize($, FULL), summarize($, FULL)]);
    expect(cycleKeys(store)).toHaveLength(2);
  });
  test("counts the finished legs' own spend, and leaves the next cycle only its own", async ($, on) => {
    fakeStore(on);
    fakeWorld(on);
    on('turn.step', answered(USAGE));
    await ($ as any).session.start({ source: 'startup' });
    const id = await legUnderWay($);
    await step($, id);
    await finishLeg($, id, false);
    const costed = `${FULL}\nCost: iteration 1: 2 min wall-clock, 1 leg`;
    await summarize($, costed);
    const first = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(first.cycles.recent.at(-1).cost).toMatchObject({
      minutes: 2,
      legs: 1,
      steps: 1,
      input: 2,
      cacheRead: 40_000,
      codexTokens: null,
    });
    expect(first.legSpend).toEqual([]);
    await summarize($, costed);
    const second = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(second.cycles.recent.at(-1).cost).toMatchObject({ minutes: 2, steps: null });
  });
  test('counts a finished leg once when two summaries run together', async ($, on) => {
    fakeStore(on);
    fakeWorld(on);
    on('turn.step', answered(USAGE));
    await ($ as any).session.start({ source: 'startup' });
    const id = await legUnderWay($);
    await step($, id);
    await finishLeg($, id, false);
    await Promise.all([summarize($, FULL), summarize($, FULL)]);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cycles.cost.steps).toBe(1);
  });
  test('keeps no block without an Iterations line, and counts a partly read one as incomplete', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    expect(await summarize($, BLOCK)).toBe(
      `${BLOCK}\n\nreview-cycle did not keep this cycle for its rollup: the block has no \`Iterations:\` line.`,
    );
    expect(cycleKeys(store)).toHaveLength(0);
    const partial = `${BLOCK}\nIterations: 2 (converged)\nFindings fixed inline: 0\nFindings deferred: 0`;
    expect(await summarize($, partial)).toBe(partial);
    expect(cycleKeys(store)).toHaveLength(1);
    const status = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect([status.cycles.cycles, status.cycles.incomplete]).toEqual([1, 1]);
  });
  test('says it kept nothing outside a repository', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, {
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
    });
    await ($ as any).session.start({ source: 'startup' });
    expect(await summarize($, FULL)).toBe(
      `${FULL}\n\nreview-cycle did not keep this cycle for its rollup: not in a git repository.`,
    );
    expect(cycleKeys(store)).toHaveLength(0);
  });
  test('keeps a cycle whose commit it could not read, without one', async ($, on) => {
    const store = fakeStore(on);
    fakeWorld(on, { fail: (a) => a.includes('HEAD^{commit}') });
    await ($ as any).session.start({ source: 'startup' });
    expect(await summarize($, FULL)).toBe(FULL);
    const [key] = cycleKeys(store);
    expect((store.get(key ?? '') as { head: unknown }).head).toBeNull();
  });
  test('the status tool says why it could not read the cycles', async ($, on) => {
    fakeStore(on, { readFails: 'EIO' });
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    expect(await summarize($, FULL)).toBe(FULL);
    const status = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(status.cycles).toBeNull();
    expect(status.cyclesError).toContain('EIO');
    expect(status.worktreeTree).toEqual(expect.any(String));
  });
  test('still answers with the block when the store refuses it, saying why', async ($, on) => {
    fakeStore(on, { refuse: 'disk full' });
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    const r = await summarize($, FULL);
    expect(r.startsWith(`${FULL}\n\nreview-cycle may not have kept this cycle`)).toBe(true);
    expect(r).toContain('disk full');
  });
  test('says so when it is given no summary', async ($, on) => {
    fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__summary' } as any)) as {
      result: string;
    };
    expect(r.result).toBe('review-cycle summary: `text` is empty.');
  });
});
