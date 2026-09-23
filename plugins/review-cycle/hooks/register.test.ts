import { describe, expect, test } from 'claude-code/testing';

// A scripted git: trees are maps of path to content, the working tree is
// `world.work`, and HEAD points at a commit whose tree is `world.commits[head]`.
// write-tree names the working tree by its content, so an edit made between
// two events yields a different tree, as it would in git.
type World = {
  work: Record<string, string>;
  head: string;
  commits: Record<string, Record<string, string>>;
  trees: Map<string, Record<string, string>>;
  calls: { argv: string[]; env?: Record<string, string> }[];
  aliases: string;
  fail: (argv: string) => boolean;
  toplevel?: (argv: string) => string | undefined;
  // Runs as the Bash tool itself, after the gate let the command through.
  shell?: (command: string) => void;
  // The Claude Code shell snapshot's contents; absent means no snapshot yet.
  shellAliases?: string;
  // Each commit's parent, when it has one.
  parents?: Record<string, string>;
  // What the user picks in the question dialog, keyed by question.
  dialog?: Record<string, string>;
  // Files outside the repository, by absolute path.
  files?: Record<string, string>;
  // Makes every fs.exists call reject.
  fsFails?: boolean;
};

function globRegex(g: string): RegExp {
  const body = g
    .replaceAll('.', String.raw`\.`)
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${body}$`);
}

// `specs` is a pathspec list as the gate passes it: `.`, `:(exclude,glob)`
// patterns, or literal paths.
function selects(specs: string[], path: string): boolean {
  const excluded = specs
    .filter((x) => x.startsWith(':(exclude,glob)'))
    .some((x) => globRegex(x.slice(':(exclude,glob)'.length)).test(path));
  if (excluded) return false;
  return specs.includes('.') || specs.includes(path);
}

function treeId(w: World, files: Record<string, string>): string {
  const key = JSON.stringify(Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b)));
  for (const [id, t] of w.trees) {
    if (JSON.stringify(Object.entries(t).toSorted(([a], [b]) => a.localeCompare(b))) === key)
      return id;
  }
  const id = (w.trees.size + 1).toString(16).padStart(40, 'e');
  w.trees.set(id, { ...files });
  return id;
}

function ok(stdout = '') {
  return { value: { exitCode: 0, stdout, stderr: '' } };
}

function fakeWorld(on: any, setup: Partial<World> = {}): World {
  const w: World = {
    work: { 'a.ts': 'one' },
    head: 'c'.repeat(40),
    commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' } },
    trees: new Map(),
    calls: [],
    aliases: '',
    fail: () => false,
    ...setup,
  };
  const filesOf = (ref: string) => w.trees.get(ref) ?? w.commits[ref] ?? {};
  on(
    'process.run',
    ($: unknown, e: { argv: string[]; init?: { env?: Record<string, string> } }) => {
      w.calls.push({ argv: e.argv, env: e.init?.env });
      const a = e.argv.join(' ');
      if (w.fail(a)) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: injected' } };
      const top = w.toplevel?.(a);
      if (top !== undefined) return ok(top);
      if (a.includes('--show-toplevel')) return ok('/repo\n/repo/.git\n');
      if (a.includes('--verify -q HEAD^{tree}')) {
        return ok(`${treeId(w, w.commits[w.head] ?? {})}\n`);
      }
      if (a.includes('--verify -q HEAD^')) {
        const parent = w.parents?.[w.head];
        return parent ? ok(`${parent}\n`) : { value: { exitCode: 1, stdout: '', stderr: '' } };
      }
      if (a.includes('--verify -q HEAD')) return ok(`${w.head}\n`);
      const tree = /rev-parse (\S+)\^\{tree\}/.exec(a);
      if (tree) return ok(`${treeId(w, w.commits[tree[1] ?? ''] ?? {})}\n`);
      if (a === 'mktemp') return ok('/tmp/scratch-index\n');
      if (a.includes('--git-path index')) return ok('/repo/.git/index\n');
      if (a.includes('write-tree')) return ok(`${treeId(w, w.work)}\n`);
      const show = /^git show (\S+):(\S+)$/.exec(a);
      if (show) {
        const text = filesOf(show[1] ?? '')[show[2] ?? ''];
        return text === undefined
          ? { value: { exitCode: 128, stdout: '', stderr: 'no' } }
          : ok(text);
      }
      if (a.startsWith('git config --get-regexp')) {
        return w.aliases ? ok(w.aliases) : { value: { exitCode: 1, stdout: '', stderr: '' } };
      }
      const diff = /diff-tree -r -z --no-renames --name-only (\S+) (\S+) -- (.*)$/.exec(a);
      if (diff) {
        const from = filesOf(diff[1] ?? '');
        const to = filesOf(diff[2] ?? '');
        const specs = (diff[3] ?? '').split(' ');
        const changed = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(
          (p) => from[p] !== to[p] && selects(specs, p),
        );
        return ok(changed.map((p) => `${p}\0`).join(''));
      }
      return ok();
    },
  );
  on('session.cwd', () => ({ value: '/repo' }));
  on('env.get', ($: unknown, e: { name?: string }) => ({
    value: ({ SHELL: '/bin/zsh', HOME: '/Users/tester' } as Record<string, string>)[e.name ?? ''],
  }));
  on('fs.list', () => ({
    value:
      w.shellAliases === undefined
        ? []
        : [
            { name: 'snapshot-bash-1790000000000-old.sh', kind: 'file', size: 1 },
            { name: 'snapshot-zsh-1790000000001-new.sh', kind: 'file', size: 1 },
          ],
  }));
  on('fs.read', ($: unknown, e: { path?: string } | string) => {
    const path = typeof e === 'string' ? e : (e.path ?? '');
    if (w.files?.[path] !== undefined) return { value: w.files[path] };
    return path.endsWith('snapshot-zsh-1790000000001-new.sh')
      ? { value: w.shellAliases ?? '' }
      : { deny: 'ENOENT' };
  });
  on('fs.exists', ($: unknown, e: { path?: string } | string) => {
    if (w.fsFails) return { deny: 'EACCES' };
    const path = typeof e === 'string' ? e : (e.path ?? '');
    return { value: w.files?.[path] !== undefined };
  });
  on('tool.register', ($: unknown, e: { name: string }) => ({
    value: { tool: `mcp__review-cycle__${e.name}` },
  }));
  on('tool.call', ($: unknown, e: { tool: string; command?: string }) => {
    if (e.tool === 'AskUserQuestion') {
      return { result: { questions: [], answers: w.dialog ?? {}, annotations: {} } };
    }
    w.shell?.(e.command ?? '');
    return { result: { stdout: `ran ${e.command ?? ''}`, stderr: '', interrupted: false } };
  });
  on('prompt.submit', ($: unknown, e: { text: string }) => ({ text: e.text }));
  on('agent.spawn', ($: unknown, e: { tool_use_id: string }) => ({
    model: 'test',
    agentId: `leg-${e.tool_use_id}`,
  }));
  on('session.start', () => ({ cwd: '/repo' }));
  on('turn.complete', ($: unknown, e: { answer: string }) => ({ text: e.answer }));
  on('config.set', ($: unknown, e: { value: unknown }) => ({ value: e.value }));
  return w;
}

const RECEIPT = 'execution: npm test - ok\nattempted-but-failed: none\n\nNo findings.';

async function say($: any, text: string, kind = 'composer') {
  await $.prompt.submit({ text, origin: { kind }, wait: false });
}

let spawns = 0;

// Spawns a leg and completes it; `during` runs while the leg is running.
async function review(
  $: any,
  opts: {
    type?: string;
    answer?: string;
    parentAgentId?: string;
    cwd?: string;
    during?: () => void;
  } = {},
) {
  spawns++;
  const id = `t${spawns}`;
  const r = await $.agent.spawn({
    tool_use_id: id,
    subagentType: opts.type ?? 'review-cycle:code-reviewer',
    prompt: 'review',
    description: 'review',
    background: true,
    ...(opts.parentAgentId ? { parentAgentId: opts.parentAgentId } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  opts.during?.();
  await $.turn.complete({
    answer: opts.answer ?? RECEIPT,
    durationMs: 1,
    isAborted: false,
    turnId: `turn-${id}`,
    agentId: r.agentId,
    reason: 'answer',
  });
}

async function bash($: any, command: string, extra: Record<string, unknown> = {}) {
  return $.tool.call({ tool: 'Bash', command, ...extra });
}

function ran(r: unknown): boolean {
  return typeof r === 'object' && r !== null && 'result' in r;
}

function denied(r: unknown, text: string): boolean {
  return (
    typeof r === 'object' &&
    r !== null &&
    'deny' in r &&
    typeof r.deny === 'string' &&
    r.deny.includes(text)
  );
}

describe('commands that neither commit nor push', () => {
  test('pass', async ($, on) => {
    fakeWorld(on);
    expect(ran(await bash($, 'ls'))).toBe(true);
  });
  test('a commit hidden in a shell is refused', async ($, on) => {
    fakeWorld(on);
    expect(denied(await bash($, "bash -c 'git commit -m x'"), 'run')).toBe(true);
  });
});

describe('asked for?', () => {
  test('a commit the user did not ask for is refused', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git commit -m x'), "doesn't ask for a commit")).toBe(true);
  });
  test('a request from a peer session grants nothing', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it', 'peer');
    expect(denied(await bash($, 'git commit -m x'), "doesn't ask for a commit")).toBe(true);
  });
  test('a commit request does not grant a push', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
  });
  test('a push the user asked for goes through', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a merge needs a commit request, and no review', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git merge topic'), "doesn't ask for a commit")).toBe(true);
    await say($, 'commit it');
    expect(ran(await bash($, 'git merge topic'))).toBe(true);
  });
});

describe('reviewed?', () => {
  test('a commit no reviewer saw is refused, judged on a scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'commit it');
    const r = await bash($, 'git add -A && git commit -m x');
    expect(denied(r, 'never reviewed: a.ts')).toBe(true);
    const add = w.calls.find((c) => c.argv.join(' ') === 'git -C . add -A');
    expect(add?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('commit -a replays add -u on the scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'commit it');
    await bash($, 'git commit -am x');
    const update = w.calls.find((c) => c.argv.join(' ') === 'git add -u');
    expect(update?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('a reviewed, asked-for commit goes through', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
  test('an edit after the review is refused as edited after review', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    w.work = { 'a.ts': 'two' };
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'edited after the last review: a.ts')).toBe(true);
  });
  test('an edit while the reviewer ran is not covered', async ($, on) => {
    const w = fakeWorld(on);
    await review($, {
      during: () => {
        w.work = { 'a.ts': 'two' };
      },
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'a.ts')).toBe(true);
  });
  const notReviews: [string, Parameters<typeof review>[1]][] = [
    ['cleanup', { type: 'review-cycle:cleanup' }],
    ['a leg with no receipt', { answer: 'Looks fine.' }],
    ['a leg spawned by another leg', { parentAgentId: 'leg-x' }],
    ['a leg working outside the repository', { cwd: '/tmp/elsewhere' }],
    ['another plugin', { type: 'pr-review-toolkit:code-reviewer' }],
  ];
  for (const [name, opts] of notReviews) {
    test(`${name} does not count as a review`, async ($, on) => {
      fakeWorld(on);
      await review($, opts);
      await say($, 'commit it');
      expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
    });
  }
  test('legs review-pr spawns do not count', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await review($);
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test('a spawn whose tree could not be read does not count', async ($, on) => {
    let spawning = true;
    fakeWorld(on, { fail: (a) => spawning && a === 'mktemp' });
    const r = await ($ as any).agent.spawn({
      tool_use_id: 'x',
      subagentType: 'review-cycle:code-reviewer',
      prompt: 'review',
      description: 'review',
      background: true,
    });
    spawning = false;
    await $.turn.complete({
      answer: RECEIPT,
      durationMs: 1,
      isAborted: false,
      turnId: 'turn-x',
      agentId: r.agentId,
      reason: 'answer',
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test('a reviewed tree git cannot diff covers nothing', async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a.includes('--literal-pathspecs') });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'a.ts')).toBe(true);
  });
});

describe('where the commit lands', () => {
  test("a subagent's commit is refused", async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    const r = await bash($, 'git commit -m x', { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit')).toBe(true);
  });
  test('a commit in another repository is not this gate', async ($, on) => {
    fakeWorld(on, {
      toplevel: (a) =>
        a.startsWith('git -C /tmp/fixture rev-parse')
          ? '/tmp/fixture\n/tmp/fixture/.git\n'
          : undefined,
    });
    expect(ran(await bash($, 'git -C /tmp/fixture commit -m x'))).toBe(true);
  });
  test('a push from another worktree of this repository is refused', async ($, on) => {
    fakeWorld(on, {
      toplevel: (a) => (a.startsWith('git -C ../wt rev-parse') ? '/wt\n/repo/.git\n' : undefined),
    });
    await say($, 'push it');
    expect(denied(await bash($, 'git -C ../wt push'), 'another worktree')).toBe(true);
  });
  test('a target git cannot resolve is refused, not waved through', async ($, on) => {
    fakeWorld(on, { fail: (a) => a.startsWith('git -C /nope rev-parse') });
    await say($, 'commit it');
    expect(denied(await bash($, 'git -C /nope commit -m x'), 'the gate failed')).toBe(true);
  });
});

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

describe('after the command', () => {
  test('a commit that landed without a request is reported', async ($, on) => {
    const next = 'd'.repeat(40);
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, [next]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = next;
      },
    });
    const r = await bash($, './release.sh');
    const context = (r as { context?: string[] }).context ?? [];
    expect(context.some((c) => c.includes('landed without the user asking'))).toBe(true);
    expect(context.some((c) => c.includes('did not go through the commit gate'))).toBe(true);
  });
});

describe('the off switch', () => {
  test('only the user can change it', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.enabled',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
    const byUser = await $.config.set({ ...change, origin: { kind: 'composer' } });
    expect(byUser).toEqual({ value: false });
  });
});

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
    const r = await bash($, `jq '.enabledPlugins["review-cycle@oakoss"]=false' ${SETTINGS} > t`);
    expect(denied(r, 'only by the user')).toBe(true);
    expect(denied(await bash($, 'claude plugin disable review-cycle'), 'only by the user')).toBe(
      true,
    );
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
    expect(ran(await monitor('tail -f log'))).toBe(true);
  });
  test('a failed read refuses a JSON edit', async ($, on) => {
    fakeWorld(on, { fsFails: true });
    expect(denied(await $.tool.call(edit('a', 'b')), 'could not check')).toBe(true);
  });
});

describe('the status tool', () => {
  test('reports uncovered paths and consent', async ($, on) => {
    fakeWorld(on);
    await say($, 'commit it');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.uncovered).toEqual([{ path: 'a.ts', state: 'never-reviewed' }]);
    expect(status.consent).toEqual({ commit: true, push: false });
    expect(status.error).toBe(null);
    expect(status.snapshot).toMatch(/^[0-9a-f]{64}$/);
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
});

describe('what the gate reports', () => {
  test('a review that could not be counted is named in the refusal', async ($, on) => {
    fakeWorld(on);
    await review($, { answer: 'Looks fine.' });
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'did not open with the execution receipt')).toBe(true);
  });
  test('a merge that brings in unreviewed content gets no review note', async ($, on) => {
    const next = 'd'.repeat(40);
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, [next]: { 'a.ts': 'theirs' } },
      shell(this: World) {
        this.head = next;
      },
    });
    await say($, 'commit it');
    const r = await bash($, 'git merge topic');
    expect(ran(r)).toBe(true);
    expect((r as { context?: string[] }).context ?? []).toEqual([]);
  });
  test('a plain command runs with a note when the gate cannot watch it', async ($, on) => {
    fakeWorld(on, {
      fail: (a) => a.startsWith('git rev-parse --path-format=absolute --show-toplevel'),
    });
    const r = await bash($, 'ls');
    expect(ran(r)).toBe(true);
    const context = (r as { context?: string[] }).context ?? [];
    expect(context.some((c) => c.includes('could not watch this command'))).toBe(true);
  });
});

describe('failures while judging a commit refuse it', () => {
  const failures: [string, (a: string) => boolean][] = [
    ['the changed-path diff', (a) => a.includes('diff-tree') && a.includes(' -- . ')],
    ['write-tree', (a) => a.includes('write-tree')],
    ['the replayed add', (a) => a === 'git -C . add -A'],
    ['add -u for commit -a', (a) => a === 'git add -u'],
    ['reading HEAD', (a) => a === 'git rev-parse --verify -q HEAD'],
  ];
  for (const [name, fail] of failures) {
    test(name, async ($, on) => {
      let judging = false;
      const w = fakeWorld(on);
      w.fail = (a) => judging && fail(a);
      await review($);
      await say($, 'commit it');
      judging = true;
      const r = await bash(
        $,
        name === 'the replayed add' ? 'git add -A && git commit -m x' : 'git commit -am x',
      );
      expect(ran(r)).toBe(false);
    });
  }
});

describe('what a commit records', () => {
  test('an amend is judged against the parent, so unreviewed HEAD content is refused', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit --amend --no-edit'), 'never reviewed: a.ts')).toBe(
      true,
    );
  });
  test('paths the committed config ignores need no review', async ($, on) => {
    const config = '{"ignore":["dist/**"]}';
    fakeWorld(on, {
      work: { 'a.ts': 'zero', 'dist/x.js': 'built', '.claude/review-cycle.json': config },
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero', '.claude/review-cycle.json': config } },
    });
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
  test('the config itself always needs review, whatever it ignores', async ($, on) => {
    fakeWorld(on, {
      work: { 'a.ts': 'zero', '.claude/review-cycle.json': '{"ignore":["**"]}' },
    });
    await say($, 'commit it');
    const r = await bash($, 'git add -A && git commit -m x');
    expect(denied(r, '.claude/review-cycle.json')).toBe(true);
  });
  test('an ignore entry cannot excuse anything until it is reviewed itself', async ($, on) => {
    fakeWorld(on, {
      work: { 'a.ts': 'one', '.claude/review-cycle.json': '{"ignore":["**"]}' },
    });
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'never reviewed: .claude/review-cycle.json')).toBe(true);
  });
  test('tracker state needs no review', async ($, on) => {
    fakeWorld(on, { work: { 'a.ts': 'zero', '.beads/issues.jsonl': 'x' } });
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });
});

describe('reviews that do not count, and say so', () => {
  test('an aborted leg is named in the refusal', async ($, on) => {
    fakeWorld(on);
    spawns++;
    const r = await ($ as any).agent.spawn({
      tool_use_id: 'ab',
      subagentType: 'review-cycle:code-reviewer',
      prompt: 'review',
      description: 'review',
      background: true,
    });
    await ($ as any).turn.complete({
      answer: RECEIPT,
      durationMs: 1,
      isAborted: true,
      turnId: 'turn-ab',
      agentId: r.agentId,
      reason: 'aborted',
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'did not finish')).toBe(true);
  });
  test('a later valid review clears older failures from the refusal', async ($, on) => {
    const w = fakeWorld(on);
    await review($, { answer: 'Looks fine.' });
    await review($);
    w.work = { 'a.ts': 'two' };
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'edited after the last review')).toBe(true);
    expect(denied(r, 'execution receipt')).toBe(false);
  });
  test('shell aliases that could not be read are reported once', async ($, on) => {
    fakeWorld(on);
    const first = (await bash($, 'ls')) as { context?: string[] };
    const second = (await bash($, 'ls')) as { context?: string[] };
    expect((first.context ?? []).some((c) => c.includes('could not read the user'))).toBe(true);
    expect(second.context ?? []).toEqual([]);
  });
});

describe('the review-pr window', () => {
  test('a prompt queued into the running turn keeps it open', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await ($ as any).prompt.submit({
      text: 'also check x',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 't',
    });
    await review($);
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test("a subagent's review-pr does not open it", async ($, on) => {
    fakeWorld(on);
    await ($ as any).tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr', agentId: 'sub' });
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('/review-cycle:review closes it', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review' });
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
});

describe('consent through the session', () => {
  test("yes to the agent's commit question grants the commit", async ($, on) => {
    fakeWorld(on);
    await review($);
    await ($ as any).turn.complete({
      answer: 'Reviewed and clean.\nWant me to commit this?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
});

describe('the question dialog', () => {
  test(
    "another plugin's dialog grants nothing",
    {
      plugins: [
        {
          name: 'other',
          register(on) {
            on('prompt.submit', async ($, e, next) => {
              await $.ui.ask('Which phrase should the docs quote?', ['Commit changes', 'Other']);
              return next(e);
            });
          },
        },
      ],
    },
    async ($, on) => {
      fakeWorld(on, { dialog: { 'Which phrase should the docs quote?': 'Commit changes' } });
      await review($);
      await say($, 'raise the dialog');
      expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
    },
  );
  test('picking a commit option grants the commit', async ($, on) => {
    fakeWorld(on, { dialog: { 'Commit the change?': 'Review, then commit (Recommended)' } });
    await review($);
    await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [] });
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('picking "Don\'t commit" grants nothing', async ($, on) => {
    fakeWorld(on, { dialog: { 'Commit the change?': "Don't commit" } });
    await review($);
    await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [] });
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
  });
});
