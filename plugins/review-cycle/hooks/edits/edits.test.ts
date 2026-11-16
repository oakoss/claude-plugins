import { describe, expect, test } from 'claude-code/testing';

import {
  bash,
  contextOf,
  denied,
  fakeWorld,
  has,
  legUnderWay,
  ran,
  RECEIPT,
  reviewerChanges,
  say,
  type World,
} from '../fixtures';

describe('the switch in settings files', () => {
  const SETTINGS = '/Users/tester/.claude/settings.json';
  const on_ = JSON.stringify(
    { enabledPlugins: { 'review-cycle@oakoss': true }, theme: 'dark' },
    null,
    2,
  );
  const edit = (old: string, replacement: string) => ({
    tool: 'Edit' as const,
    file_path: SETTINGS,
    old_string: old,
    new_string: replacement,
  });
  test('an edit that disables the plugin is refused', async ($, on) => {
    fakeWorld(on, { files: { [SETTINGS]: on_ } });
    const r = await $.tool.call(
      edit('"review-cycle@oakoss": true', '"review-cycle@oakoss": false'),
    );
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('an edit elsewhere in the file runs', async ($, on) => {
    fakeWorld(on, { files: { [SETTINGS]: on_ } });
    expect(ran(await $.tool.call(edit('"dark"', '"light"')))).toBe(true);
  });
  test('an edit the gate cannot replay is refused when the file holds the switch', async ($, on) => {
    fakeWorld(on, { files: { [SETTINGS]: on_ } });
    expect(denied(await $.tool.call(edit('“dark”', '"light"')), 'only by the user')).toBe(true);
  });
  test('an edit the gate cannot replay is refused when a skipped file names the switch', async ($, on) => {
    // Removing the comment makes the file load, switching review-cycle off.
    const jsonc = '// set by “me”\n{"enabledPlugins":{"review-cycle@oakoss":false}}';
    fakeWorld(on, { files: { [SETTINGS]: jsonc } });
    const r = await $.tool.call(edit('// set by "me"\n', ''));
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('writing pluginConfigs with enabled false is refused', async ($, on) => {
    fakeWorld(on, { files: { [SETTINGS]: on_ } });
    const content = JSON.stringify({
      enabledPlugins: { 'review-cycle@oakoss': true },
      pluginConfigs: { 'review-cycle@oakoss': { options: { enabled: false } } },
    });
    const r = await $.tool.call({ tool: 'Write', file_path: SETTINGS, content });
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('writing an unrelated JSON file runs', async ($, on) => {
    fakeWorld(on);
    const r = await $.tool.call({ tool: 'Write', file_path: '/repo/x.json', content: '{}' });
    expect(ran(r)).toBe(true);
  });
  test('a Bash command that edits the switch is refused', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    const r = await bash(
      $,
      `jq '.enabledPlugins["review-cycle@oakoss"]=false' ${SETTINGS} > t && mv t ${SETTINGS}`,
    );
    expect(denied(r, 'only by the user')).toBe(true);
    expect(denied(await bash($, 'claude plugin disable review-cycle'), 'only by the user')).toBe(
      true,
    );
  });
  test('removing another plugin, or asking for help, is not the switch', async ($, on) => {
    fakeWorld(on);
    expect(ran(await bash($, 'claude plugin uninstall pr-watch@oakoss'))).toBe(true);
    expect(ran(await bash($, 'claude plugin uninstall --help'))).toBe(true);
    expect(denied(await bash($, 'claude plugin uninstall $P'), 'only by the user')).toBe(true);
  });
  test('an edit that creates a settings file is judged by its new text', async ($, on) => {
    fakeWorld(on);
    const r = await $.tool.call({
      ...edit('', '{"enabledPlugins":{"review-cycle@oakoss":false}}'),
      file_path: '/repo/.claude/settings.local.json',
    });
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('an edit the gate cannot replay is refused when it names the switch', async ($, on) => {
    fakeWorld(on, { files: { [SETTINGS]: '{"theme":"dark"}' } });
    const r = await $.tool.call(
      edit('“dark”', '"dark","enabledPlugins":{"review-cycle@oakoss":false}'),
    );
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('the JSON check ignores the extension case', async ($, on) => {
    fakeWorld(on);
    const r = await $.tool.call({
      tool: 'Write',
      file_path: '/Users/tester/.claude/Settings.JSON',
      content: '{"enabledPlugins":{"review-cycle@oakoss":false}}',
    });
    expect(denied(r, 'only by the user')).toBe(true);
  });
  test('Monitor may not run a commit or touch the switch', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    const monitor = (command: string) =>
      $.tool.call({ tool: 'Monitor', description: 'x', timeout_ms: 1000, command });
    expect(denied(await monitor('git commit -am x'), 'Monitor runs commands')).toBe(true);
    expect(denied(await monitor('claude plugin disable review-cycle'), 'Monitor runs')).toBe(true);
    expect(denied(await monitor('gh stack rebase'), 'Monitor runs')).toBe(true);
    expect(ran(await monitor('gh stack view'))).toBe(true);
    expect(ran(await monitor('gh stack rebase --help'))).toBe(true);
    expect(ran(await monitor('tail -f log'))).toBe(true);
    expect(ran(await monitor('claude plugin uninstall --help'))).toBe(true);
  });
  test('a failed read refuses a JSON edit', async ($, on) => {
    fakeWorld(on, { fsFails: true });
    expect(denied(await $.tool.call(edit('a', 'b')), 'could not check')).toBe(true);
  });
});

function captures(w: World): number {
  return w.calls.filter((c) => c.argv.join(' ') === 'git add -A').length;
}

function edits(this: World) {
  this.work['a.ts'] = 'two';
}

describe('a Bash command that changes files', () => {
  test('runs, with a note naming what changed and pointing at Edit and Write', async ($, on) => {
    fakeWorld(on, { shell: edits });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'files changed while this command ran: a.ts.')).toBe(true);
    expect(has(contextOf(r), 'make file changes with Edit or Write')).toBe(true);
  });
  test('gets no note when nothing changed', async ($, on) => {
    fakeWorld(on);
    const r = await bash($, "sed -i '' 's/zzz/y/' a.ts");
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'files changed while this command ran')).toBe(false);
  });
  test('is not measured when it cannot write', async ($, on) => {
    const w = fakeWorld(on, { shell: edits });
    const r = await bash($, 'git status --porcelain');
    expect(captures(w)).toBe(0);
    expect(has(contextOf(r), 'files changed while this command ran')).toBe(false);
  });
  test('is not measured for a reviewer leg, whose writes the gate reports', async ($, on) => {
    const w = fakeWorld(on);
    const id = await legUnderWay($);
    const before = captures(w);
    const r = await bash($, "sed -i '' 's/one/two/' a.ts", { agentId: id });
    expect(has(contextOf(r), 'files changed while this command ran')).toBe(false);
    expect(captures(w) - before).toBeLessThanOrEqual(2);
  });
  test('is not measured in the background, which returns before the command ends', async ($, on) => {
    const w = fakeWorld(on, { shell: edits });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts", { run_in_background: true });
    expect(captures(w)).toBe(0);
    expect(has(contextOf(r), 'files changed while this command ran')).toBe(false);
  });
  test('says so when git fails, and the command still runs', async ($, on) => {
    fakeWorld(on, { shell: edits, fail: (a) => a === 'git add -A' });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'could not check which files this command changed')).toBe(true);
  });
  test('says so when the capture after the command throws', async ($, on) => {
    let adds = 0;
    fakeWorld(on, { shell: edits, reject: (a) => a === 'git add -A' && ++adds === 2 });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(ran(r)).toBe(true);
    expect(adds).toBe(2);
    expect(has(contextOf(r), 'could not check which files this command changed')).toBe(true);
  });
  test('says so when git cannot compare the trees', async ($, on) => {
    fakeWorld(on, { shell: edits, fail: (a) => a.startsWith('git diff-tree') });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(has(contextOf(r), 'git could not compare the trees')).toBe(true);
  });
  test('outside a repository it runs unmeasured, and the gate keeps its notes', async ($, on) => {
    const w = fakeWorld(on, {
      shell: edits,
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
    });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(ran(r)).toBe(true);
    expect(captures(w)).toBe(0);
    expect(has(contextOf(r), 'could not check which files')).toBe(false);
    expect(has(contextOf(r), "could not read the user's shell aliases")).toBe(true);
  });
  test("a runner that throws keeps the gate's own notes", async ($, on) => {
    fakeWorld(on, { shell: edits, reject: (a) => a === 'git add -A' });
    const r = await bash($, "sed -i '' 's/one/two/' a.ts");
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'could not check which files this command changed')).toBe(true);
    expect(has(contextOf(r), 'could not read the user')).toBe(true);
  });
});

describe('comment slop', () => {
  const FILE = '/repo/f.ts';
  const SLOP = '// ===== HELPERS =====\nconst a = 1;\n';
  const write = ($: any, content = SLOP, file_path = FILE) =>
    $.tool.call({ tool: 'Write', file_path, content });
  test('a Write that creates a file with slop is scanned after it lands', async ($, on) => {
    fakeWorld(on);
    const r = await write($);
    expect(ran(r)).toBe(true);
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
    const r = await write($);
    expect(r).toEqual({ deny: 'denied below' });
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
    expect(w.calls.some((c) => c.argv.join(' ') === 'git -C / rev-parse --show-toplevel')).toBe(
      true,
    );
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
    fakeWorld(on, { fail: (a) => a.startsWith('git -C /repo rev-parse') });
    expect(contextOf(await write($)).join('\n')).toContain('git failed (fatal: injected)');
  });
  test('a git killed without a message names its exit status', async ($, on) => {
    fakeWorld(on, {
      git: (a) => (a.startsWith('git -C /repo rev-parse') ? { exitCode: 137 } : undefined),
    });
    expect(contextOf(await write($)).join('\n')).toContain('git failed (exit 137)');
  });
  test('a file that cannot be read says the scan was skipped', async ($, on) => {
    fakeWorld(on, { readFails: true });
    expect(contextOf(await write($)).join('\n')).toContain('comment-slop scan skipped (');
  });
  test('a relative path is scanned from the working directory', async ($, on) => {
    const w = fakeWorld(on);
    await write($, SLOP, 'f.ts');
    expect(w.calls.some((c) => c.argv.join(' ') === 'git -C . rev-parse --show-toplevel')).toBe(
      true,
    );
  });
});

describe('reviewer containment of edits', () => {
  test('a reviewer edits outside the repository, not inside it', async ($, on) => {
    fakeWorld(on);
    const leg = await legUnderWay($);
    const edit = (path: string, agentId?: string) =>
      ($ as any).tool.call({
        tool: 'Edit',
        file_path: path,
        old_string: 'a',
        new_string: 'b',
        ...(agentId ? { agentId } : {}),
      });
    expect(denied(await edit('/repo/a.ts', leg), 'do not edit the repository')).toBe(true);
    const write = await ($ as any).tool.call({
      tool: 'Write',
      file_path: '/repo/new.ts',
      content: 'x',
      agentId: leg,
    });
    expect(denied(write, 'do not edit the repository')).toBe(true);
    const notebook = await ($ as any).tool.call({
      tool: 'NotebookEdit',
      notebook_path: '/repo/n.ipynb',
      new_source: 'x',
      agentId: leg,
    });
    expect(denied(notebook, 'do not edit the repository')).toBe(true);
    expect(ran(await edit('/tmp/copy/a.ts', leg))).toBe(true);
    expect(ran(await edit('/repository/a.ts', leg))).toBe(true);
    expect(ran(await edit('/repo/a.ts'))).toBe(true);
    expect(ran(await edit('/repo/a.ts', 'general-purpose-1'))).toBe(true);
  });
  test('cleanup and finished reviewers edit freely', async ($, on) => {
    fakeWorld(on);
    const cleanup = await legUnderWay($, 'review-cycle:cleanup');
    const edit = (agentId: string) =>
      ($ as any).tool.call({
        tool: 'Edit',
        file_path: '/repo/a.ts',
        old_string: 'a',
        new_string: 'b',
        agentId,
      });
    expect(ran(await edit(cleanup))).toBe(true);
    const leg = await legUnderWay($);
    await $.turn.complete({
      answer: RECEIPT,
      durationMs: 1,
      isAborted: false,
      turnId: 'turn-done',
      agentId: leg,
      reason: 'answer',
    });
    expect(ran(await edit(leg))).toBe(true);
  });
  test('a repository the gate cannot find refuses reviewer edits and keeps its refusals', async ($, on) => {
    fakeWorld(on, { fail: (a) => a.includes('--show-toplevel') });
    const leg = await legUnderWay($);
    const edit = await ($ as any).tool.call({
      tool: 'Edit',
      file_path: '/repo/a.ts',
      old_string: 'a',
      new_string: 'b',
      agentId: leg,
    });
    expect(denied(edit, 'could not find the repository under review')).toBe(true);
    const off = await bash($, 'claude plugin disable review-cycle', { agentId: leg });
    expect(denied(off, 'only by the user')).toBe(true);
    // The gate's own failure handler answers the call; the record says why.
    expect(ran(await bash($, 'ls', { agentId: leg }))).toBe(true);
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: could not check HEAD, the staged content, the working tree, the local git config (git rev-parse failed: fatal: injected) while `ls` ran',
    ]);
  });
});
