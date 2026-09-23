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
  calls: {
    argv: string[];
    env?: Record<string, string>;
    init?: { env?: Record<string, string>; stdin?: string; timeoutMs?: number };
  }[];
  aliases: string;
  fail: (argv: string) => boolean;
  // Answers a git call itself, ahead of the scripted git.
  git?: (argv: string) => Partial<Run> | undefined;
  // Answers an Edit or Write itself, after it wrote `files`; null keeps the
  // ordinary result.
  tool?: (path: string, files: Record<string, string>) => object | null;
  readFails?: boolean;
  // fs.stat reports the path as something other than a file.
  statKind?: string;
  toplevel?: (argv: string) => string | undefined;
  // Runs as the Bash tool itself, after the gate let the command through.
  shell?: (command: string) => void;
  // The Claude Code shell snapshot's contents; absent means no snapshot yet.
  shellAliases?: string;
  // What the gate's own `<shell> -c -l` alias read returns; it fails when unset.
  ownAliases?: { exitCode: number; stdout: string; stderr?: string } | 'throw';
  // Each commit's parent, when it has one.
  parents?: Record<string, string>;
  // Refs other than HEAD, by name, and each one's reflog as `<id> <message>`
  // lines, newest first.
  refs?: Record<string, string>;
  reflogs?: Record<string, string[]>;
  // Raw for-each-ref lines printed after `refs`, such as symbolic refs.
  refLines?: string[];
  // HEAD's reflog as `<id> <message>` lines, newest first. A Bash call that
  // moves HEAD without adding a line gets `commit: made`, unless `headLogOff`.
  headLog?: string[];
  headLogOff?: boolean;
  // A reftable repository: no logs/HEAD file, though HEAD's reflog exists.
  reftable?: boolean;
  // logs/HEAD exists but cannot be read.
  logUnreadable?: boolean;
  // What $.agent.list reports.
  agents?: { id: string; status: string }[];
  // Makes the plugin's own prompt submissions fail, once `submitGate` settles
  // when it is set.
  submitFails?: boolean;
  submitGate?: Promise<void>;
  // HEAD names no readable commit.
  headMissing?: boolean;
  // What the user picks in the question dialog, keyed by question.
  dialog?: Record<string, string>;
  // Files outside the repository, by absolute path.
  files?: Record<string, string>;
  // Makes every fs.exists call reject.
  fsFails?: boolean;
  // Every prompt that reached the session, the plugin's own included.
  prompts?: string[];
};

type Run = { exitCode: number; stdout: string; stderr: string };

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
    (
      $: unknown,
      e: {
        argv: string[];
        init?: { env?: Record<string, string>; stdin?: string; timeoutMs?: number };
      },
    ) => {
      w.calls.push({ argv: e.argv, env: e.init?.env, init: e.init });
      if (e.argv[1] === '-c' && e.argv[2] === '-l') {
        if (w.ownAliases === 'throw') return { deny: 'timed out' };
        const r = w.ownAliases ?? { exitCode: 127, stdout: '' };
        // <tag> in a fake answer stands for the read's own marker tag.
        const tag = /review-cycle: aliases (\w+)/.exec(e.argv[3] ?? '')?.[1] ?? '';
        const stdout = r.stdout.replaceAll('<tag>', tag);
        return { value: { stderr: r.exitCode === 0 ? '' : 'zsh: not found', ...r, stdout } };
      }
      const a = e.argv.join(' ');
      if (w.fail(a)) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: injected' } };
      const own = w.git?.(a);
      if (own) return { value: { exitCode: 0, stdout: '', stderr: '', ...own } };
      const top = w.toplevel?.(a);
      if (top !== undefined) return ok(top);
      if (a.includes('--show-toplevel')) return ok('/repo\n/repo/.git\n');
      if (a.includes('--verify -q HEAD^{commit}')) {
        return w.headMissing
          ? { value: { exitCode: 1, stdout: '', stderr: '' } }
          : ok(`${w.head}\n`);
      }
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
      if (a.startsWith('git for-each-ref')) {
        const lines = Object.entries(w.refs ?? {}).map(([n, id]) => `${id}\t\t${n}`);
        return ok([...lines, ...(w.refLines ?? [])].join('\n'));
      }
      const reflog = /^git log -g -n 50 --format=%H %gs (\S+) --$/.exec(a);
      if (reflog) {
        // git prints nothing and exits 0 for a ref it keeps no reflog for.
        const lines = w.reflogs?.[reflog[1] ?? ''] ?? [];
        return ok(lines.map((l) => `${l}\n`).join(''));
      }
      if (a === 'git rev-list -g --count HEAD') {
        return w.headMissing
          ? { value: { exitCode: 128, stdout: '', stderr: 'fatal: bad revision' } }
          : ok(`${w.headLog?.length ?? 0}\n`);
      }
      if (a.includes('--git-path logs/HEAD')) return ok('/repo/.git/logs/HEAD\n');
      if (e.argv[0] === 'sh' && e.argv.at(-1) === '/repo/.git/logs/HEAD') {
        if (w.logUnreadable) {
          return { value: { exitCode: 2, stdout: '', stderr: "awk: can't open file" } };
        }
        return ok(w.reftable ? 'none\n' : `${w.headLog?.length ?? 0}\n`);
      }
      if (a === 'git reflog exists HEAD') {
        return { value: { exitCode: w.reftable ? 0 : 1, stdout: '', stderr: '' } };
      }
      const headLog = /^git log -g -n (\d+) --date=raw --format=\S+ \S+ HEAD --$/.exec(a);
      if (headLog) {
        if (w.headMissing)
          return { value: { exitCode: 128, stdout: '', stderr: 'fatal: bad revision' } };
        const lines = w.headLog ?? [];
        // Each entry's date is its distance from the oldest, so it stays fixed
        // as newer entries are added above it.
        const shown = lines.slice(0, Number(headLog[1])).map((l, i) => {
          const space = l.indexOf(' ');
          return `${l.slice(0, space)}\0HEAD@{${lines.length - i} +0000}\0t <t@t>\0${l.slice(space + 1)}`;
        });
        return ok(shown.map((l) => `${l}\n`).join(''));
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
    if (w.readFails && w.files?.[path] !== undefined) return { deny: 'EIO' };
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
  on('fs.stat', ($: unknown, e: { path?: string } | string) => {
    const path = typeof e === 'string' ? e : (e.path ?? '');
    const text = w.files?.[path];
    if (text === undefined) return { deny: 'ENOENT' };
    const size = new TextEncoder().encode(text).length;
    return { value: { kind: w.statKind ?? 'file', size, mtimeMs: 0 } };
  });
  on(
    'tool.call',
    (
      $: unknown,
      e: {
        tool: string;
        command?: string;
        file_path?: string;
        content?: string;
        old_string?: string;
        new_string?: string;
      },
    ) => {
      if (e.tool === 'AskUserQuestion') {
        return { result: { questions: [], answers: w.dialog ?? {}, annotations: {} } };
      }
      if (e.tool === 'Write' || e.tool === 'Edit') {
        const path = e.file_path ?? '';
        w.files ??= {};
        w.files[path] =
          e.tool === 'Write'
            ? (e.content ?? '')
            : (w.files[path] ?? '').replace(e.old_string ?? '', () => e.new_string ?? '');
        return w.tool?.(path, w.files) ?? { result: { filePath: path } };
      }
      const head = w.head;
      const logged = w.headLog?.length ?? 0;
      w.shell?.(e.command ?? '');
      if (w.head !== head && (w.headLog?.length ?? 0) === logged && !w.headLogOff) {
        w.headLog = [`${w.head} commit: made`, ...(w.headLog ?? [])];
      }
      return { result: { stdout: `ran ${e.command ?? ''}`, stderr: '', interrupted: false } };
    },
  );
  on('agent.list', () => ({ value: w.agents ?? [] }));
  on('prompt.submit', async ($: unknown, e: { text: string }) => {
    if (w.submitFails && e.text.startsWith('review-cycle:')) {
      await w.submitGate;
      throw new Error('refused');
    }
    (w.prompts ??= []).push(e.text);
    return { text: e.text };
  });
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

function has(context: string[], text: string): boolean {
  return context.some((c) => c.includes(text));
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
  const HEAD = 'c'.repeat(40);
  const THEIRS = 'd'.repeat(40);
  const UP = 'a'.repeat(40);
  // A snapshot exists, so the only notes are about what the command did.
  const quiet = { shellAliases: '' };

  test('a commit that landed without a request is reported', async ($, on) => {
    fakeWorld(on, {
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, 'landed without the user asking')).toBe(true);
    expect(has(context, 'did not go through the commit gate')).toBe(true);
  });
  for (const message of [
    'checkout: moving from main to topic',
    `reset: moving to ${THEIRS}`,
    'pull --ff-only: Fast-forward',
    'merge origin/main: Fast-forward',
    'rebase (finish): returning to refs/heads/main',
  ]) {
    test(`HEAD moved by "${message}" is not a commit`, async ($, on) => {
      fakeWorld(on, {
        ...quiet,
        commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'other' } },
        shell(this: World) {
          this.head = THEIRS;
          this.headLog = [`${THEIRS} ${message}`];
        },
      });
      expect(contextOf(await bash($, './move.sh'))).toEqual([]);
    });
  }
  test('a side-branch commit is judged apart from a reviewed one on this branch', async ($, on) => {
    const SIDE = 'b'.repeat(40);
    fakeWorld(on, {
      ...quiet,
      commits: {
        [HEAD]: { 'a.ts': 'zero' },
        [SIDE]: { 'a.ts': 'zero', 's.ts': 'side' },
        [THEIRS]: { 'a.ts': 'one' },
      },
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} commit: main`,
          `${HEAD} checkout: moving from side to main`,
          `${SIDE} commit: side`,
          `${HEAD} checkout: moving from main to side`,
          ...(this.headLog ?? []),
        ];
      },
    });
    await review($);
    const context = contextOf(await bash($, './two.sh'));
    expect(has(context, 'records content no reviewer saw (never reviewed: s.ts)')).toBe(true);
  });
  test('a commit on another branch is reported after HEAD comes back', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.headLog = [
          `${HEAD} checkout: moving from side to main`,
          `${THEIRS} commit: side`,
          `${HEAD} checkout: moving from main to side`,
          ...(this.headLog ?? []),
        ];
      },
    });
    const context = contextOf(await bash($, './side.sh'));
    expect(has(context, `commit ${THEIRS.slice(0, 12)} landed without the user asking`)).toBe(true);
    // Judged at the side commit, not at the HEAD it returned to.
    expect(has(context, 'records content no reviewer saw (never reviewed: a.ts)')).toBe(true);
  });
  test('a pull that merges records a commit', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'merged' } },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} pull: Merge made by the 'ort' strategy.`];
      },
    });
    expect(has(contextOf(await bash($, './sync.sh')), 'landed without the user asking')).toBe(true);
  });
  test('a rebase is judged from the commit it rebased onto', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: {
        [HEAD]: { 'a.ts': 'zero' },
        [UP]: { 'a.ts': 'zero', 'b.ts': 'upstream' },
        [THEIRS]: { 'a.ts': 'one', 'b.ts': 'upstream' },
      },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} pull --rebase (finish): returning to refs/heads/main`,
          `${THEIRS} pull --rebase (pick): local`,
          `${UP} pull --rebase (start): checkout ${UP}`,
        ];
      },
    });
    await review($);
    const context = contextOf(await bash($, './sync.sh'));
    expect(has(context, 'landed without the user asking')).toBe(true);
    expect(has(context, 'records content no reviewer saw')).toBe(false);
  });
  test('a commit built with plumbing and reached by a reset is not seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} reset: moving to ${THEIRS}`];
      },
    });
    expect(contextOf(await bash($, './plumb.sh'))).toEqual([]);
  });
  test('a HEAD that moved without a reflog entry is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headLogOff: true,
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    expect(has(contextOf(await bash($, './ship.sh')), 'HEAD moved without a reflog entry')).toBe(
      true,
    );
  });
  test('a reflog that no longer reaches the start is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headLog: [`${HEAD} commit: base`],
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} commit: other history`];
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'does not reach where the command began'),
    ).toBe(true);
  });
  test("a failed read of HEAD's reflog is reported", async ($, on) => {
    let after = false;
    fakeWorld(on, {
      ...quiet,
      fail: (a) => after && /^git log -g -n \d+ --date=raw/.test(a),
      shell() {
        after = true;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command committed'),
    ).toBe(true);
  });
  test('a HEAD that stops naming a commit is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.headMissing = true;
      },
    });
    expect(has(contextOf(await bash($, './break.sh')), 'HEAD no longer resolves')).toBe(true);
  });
  test('the first commit on an unborn branch is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headMissing: true,
      commits: { [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.headMissing = false;
        this.head = THEIRS;
      },
    });
    expect(has(contextOf(await bash($, './init.sh')), 'landed without the user asking')).toBe(true);
  });
  test('a command that adds more entries than the gate reads is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          ...Array.from({ length: 201 }, (_, i) => `${THEIRS} commit: ${i}`),
          ...(this.headLog ?? []),
        ];
      },
    });
    expect(has(contextOf(await bash($, './many.sh')), 'which the gate does not read')).toBe(true);
  });
  test('a start that could not be read names why', async ($, on) => {
    fakeWorld(on, { ...quiet, fail: (a) => a.startsWith('git log -g -n 3') });
    expect(has(contextOf(await bash($, 'ls')), 'git log -g HEAD failed: fatal: injected')).toBe(
      true,
    );
  });
  test('a commit that lands while HEAD ends unborn is reported as unchecked', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      headMissing: true,
      shell(this: World) {
        this.headLog = [
          `${THEIRS} checkout: moving from main to other`,
          `${THEIRS} commit (initial): x`,
        ];
      },
    });
    expect(has(contextOf(await bash($, './orphan.sh')), 'grew while HEAD ended unborn')).toBe(true);
  });
  test('an unborn HEAD whose log cannot be read is reported as unchecked', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true, logUnreadable: true });
    expect(has(contextOf(await bash($, 'ls')), "awk: can't open file")).toBe(true);
  });
  test('an unborn HEAD in a reftable repository is reported as unchecked', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true, reftable: true });
    expect(has(contextOf(await bash($, 'ls')), 'cannot be read while HEAD is unborn')).toBe(true);
  });
  test('an unborn HEAD that stays unborn is not reported', async ($, on) => {
    fakeWorld(on, { ...quiet, headMissing: true });
    expect(contextOf(await bash($, 'ls'))).toEqual([]);
  });
  test('a new commit whose tree cannot be read is reported', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      fail: (a) => a === `git rev-parse ${THEIRS}^{tree}`,
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), `could not check commit ${THEIRS.slice(0, 12)}`),
    ).toBe(true);
  });

  test('a commit a script made and pushed is reported, push included', async ($, on) => {
    fakeWorld(on, {
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.head = THEIRS;
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} update by push`, `${HEAD} update by push`],
        };
      },
    });
    const context = contextOf(await bash($, './ship.sh'));
    expect(has(context, 'landed without the user asking')).toBe(true);
    expect(has(context, 'pushed to origin/main without the user')).toBe(true);
  });
  test('a push the gate did not see is reported unless the user asked for one', async ($, on) => {
    const w = fakeWorld(on, {
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} update by push`, `${HEAD} fetch`],
        };
      },
    });
    const unasked = contextOf(await bash($, './ship.sh'));
    expect(has(unasked, 'pushed to origin/main without the user')).toBe(true);
    w.refs = { 'refs/remotes/origin/main': HEAD };
    await say($, 'push it');
    expect(contextOf(await bash($, './ship.sh'))).toEqual([]);
  });
  test('a push that creates a remote-tracking ref is seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/side': THEIRS };
        this.reflogs = { 'refs/remotes/origin/side': [`${THEIRS} update by push`] };
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'pushed to origin/side without the user'),
    ).toBe(true);
  });
  test('a push from a fresh clone, whose reflog starts at the push, is seen', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = { 'refs/remotes/origin/main': [`${THEIRS} update by push`] };
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'pushed to origin/main without the user'),
    ).toBe(true);
  });
  test('a fetch after an earlier push is not a push', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': THEIRS };
        this.reflogs = {
          'refs/remotes/origin/main': [`${THEIRS} fetch: fast-forward`, `${HEAD} update by push`],
        };
      },
    });
    expect(contextOf(await bash($, 'git fetch'))).toEqual([]);
  });
  test('a renamed remote is not a push', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      refs: { 'refs/remotes/origin/main': HEAD },
      shell(this: World) {
        this.refs = { 'refs/remotes/upstream/main': HEAD };
        this.reflogs = {
          'refs/remotes/upstream/main': [
            `${HEAD} remote: renamed refs/remotes/origin/main to refs/remotes/upstream/main`,
            `${HEAD} update by push`,
          ],
        };
      },
    });
    expect(contextOf(await bash($, 'git remote rename origin upstream'))).toEqual([]);
  });
  test('a symbolic remote-tracking ref is not read', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      shell(this: World) {
        this.refLines = [`${THEIRS}\trefs/remotes/origin/main\trefs/remotes/origin/HEAD`];
        this.reflogs = { 'refs/remotes/origin/HEAD': [`${THEIRS} update by push`] };
      },
    });
    expect(contextOf(await bash($, './ship.sh'))).toEqual([]);
  });
  test('a reflog that cannot be read hides neither the push check nor the commit', async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      refs: { 'refs/remotes/origin/main': HEAD },
      fail: (a) => a.startsWith('git log -g -n 50'),
      shell(this: World) {
        this.head = THEIRS;
        this.refs = { 'refs/remotes/origin/main': THEIRS };
      },
    });
    const context = contextOf(await bash($, './ship.sh'));
    expect(has(context, 'could not check whether this command pushed')).toBe(true);
    expect(has(context, 'landed without the user asking')).toBe(true);
  });
  test('refs that cannot be read are reported, not passed over', async ($, on) => {
    fakeWorld(on, { ...quiet, fail: (a) => a.startsWith('git for-each-ref') });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command committed'),
    ).toBe(true);
  });
  test('refs unreadable after the command are reported as an unchecked push', async ($, on) => {
    let after = false;
    fakeWorld(on, {
      ...quiet,
      fail: (a) => after && a.startsWith('git for-each-ref'),
      shell() {
        after = true;
      },
    });
    expect(
      has(contextOf(await bash($, './ship.sh')), 'could not check whether this command pushed'),
    ).toBe(true);
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

function contextOf(r: unknown): string[] {
  return (r as { context?: string[] }).context ?? [];
}

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
  test("the gate's own read covers the first call, before any snapshot exists", async ($, on) => {
    const w = fakeWorld(on, {
      ownAliases: {
        exitCode: 0,
        stdout:
          "\nreview-cycle: aliases <tag>\nalias gp='git push'\nreview-cycle: end of aliases <tag>\n",
      },
      files: { '/Users/tester/.zshrc': '' },
    });
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    const reads = w.calls.filter((c) => c.argv[1] === '-c' && c.argv[2] === '-l');
    await say($, 'fix the parser');
    const r = (await bash($, 'gp')) as { deny?: string; context?: string[] };
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(reads.map((c) => c.argv.slice(0, 3))).toEqual([['/bin/zsh', '-c', '-l']]);
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
    ['reading HEAD', (a) => a === 'git rev-parse --verify -q HEAD^{commit}'],
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

function nudges(w: World): string[] {
  return (w.prompts ?? []).filter((p) => p.startsWith('review-cycle: this turn left'));
}

async function endTurn($: any, reason = 'answer') {
  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: 'main',
    reason,
  });
  // The nudge is submitted without waiting on it.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function skill($: any, name: string, agentId?: string) {
  await $.tool.call({ tool: 'Skill', skill: name, ...(agentId ? { agentId } : {}) });
}

async function startLeg($: any) {
  await $.agent.spawn({
    tool_use_id: 'running',
    subagentType: 'review-cycle:code-reviewer',
    prompt: 'review',
    description: 'review',
    background: true,
  });
}

describe('the review nudge', () => {
  test('a turn that left unreviewed changes is told to review, once', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
    expect(nudges(w)[0]).toContain('/review-cycle:review');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a turn that changed nothing is not nudged, whatever was unreviewed before', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'what is next?');
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('reviewed changes are not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('an edit after a finished review is nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('no nudge while a reviewer is still running', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'running' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('a reviewer that ended without saying so does not hold the nudge off', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'killed' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a review the agent or user already started is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review' });
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test("a subagent's review does not stand in for the main loop's", async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await skill($, 'review-cycle:review', 'sub');
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a prompt queued mid-turn keeps the turn’s starting tree', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await $.prompt.submit({
      text: 'also x',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 'main',
    });
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a reviewer whose start could not be recorded still holds the nudge off', async ($, on) => {
    let spawning = false;
    const w = fakeWorld(on, {
      agents: [{ id: 'leg-running', status: 'running' }],
      fail: (a) => spawning && a.includes('write-tree'),
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    spawning = true;
    await startLeg($);
    spawning = false;
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('the nudge names only what this turn changed', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'add b');
    w.work = { 'a.ts': 'one', 'b.ts': 'new' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
    expect(nudges(w)[0]).toContain('b.ts');
    expect(nudges(w)[0]).not.toContain('a.ts');
  });
  test('unreviewed work from before the message is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'update the tracker');
    w.work = { 'a.ts': 'one', '.beads/issues.jsonl': 'x' };
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('each user message is judged from its own starting tree', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'what is next?');
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a nudge the session refused is tried again', async ($, on) => {
    const w = fakeWorld(on, { submitFails: true });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toEqual([]);
    w.submitFails = false;
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a refusal that lands after a dialog answer still allows a retry', async ($, on) => {
    let open: (() => void) | undefined;
    const submitGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const w = fakeWorld(on, { submitFails: true, submitGate });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [] });
    open?.();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    w.submitFails = false;
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('an interrupted turn is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'aborted');
    expect(nudges(w)).toEqual([]);
  });
  test('the next user message allows another nudge', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'and the other one');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(2);
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
