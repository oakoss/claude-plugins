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
  // Makes $.process.run itself reject, as a timeout does.
  reject?: (argv: string) => boolean;
  // Answers a git call itself, ahead of the scripted git.
  git?: (argv: string) => Partial<Run> | null | undefined;
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
  // What the user picks in the question dialog, by question; undefined is no answer.
  dialog?:
    | Record<string, string>
    | ((q: Question) => string | undefined | Promise<string | undefined>);
  // Every question the dialog was raised with.
  asked?: Question[];
  // Files outside the repository, by absolute path.
  files?: Record<string, string>;
  // Makes every fs.exists call reject.
  fsFails?: boolean;
  // Every prompt that reached the session, the plugin's own included.
  prompts?: string[];
  // Every tool the plugin registered, by short name.
  registered?: string[];
  // Makes registering this tool fail.
  registerFails?: string;
  // Each armed clock.after: its wait in ms, and what fires it.
  timers?: { ms: number; fire: () => void }[];
  // Environment variables beyond SHELL and HOME.
  env?: Record<string, string>;
  // What $.settings.read answers, by source; 'throw' makes that read reject.
  settings?: Partial<Record<'project' | 'local', object | 'throw'>>;
  // Runs on every settings read, before it answers.
  settingsRead?: () => void;
  // The Bash tool reports the command as failed.
  bashFails?: boolean;
  // Every line the plugin logged.
  logs?: string[];
};

type Run = { exitCode: number; stdout: string; stderr: string };
type Question = { question: string; header?: string; options: { label: string }[] };

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

// A stand-in blob id: the same content always gets the same one.
function blobOf(content: string): string {
  let h = 0;
  for (const ch of content) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
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
      if (w.reject?.(a)) return { deny: 'timed out' };
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
      // The index digest: what is staged, which by default is HEAD's tree.
      if (a.includes('git ls-files -s')) return ok(`${treeId(w, w.commits[w.head] ?? {})}\n`);
      if (a === 'mktemp') return ok('/tmp/scratch-index\n');
      if (a.includes('--git-path index')) return ok('/repo/.git/index\n');
      // A scratch index holds the working tree; the real one stages nothing.
      if (a.includes('write-tree')) {
        const staged = e.init?.env?.GIT_INDEX_FILE ? w.work : (w.commits[w.head] ?? {});
        return ok(`${treeId(w, staged)}\n`);
      }
      const lsTree = /^git --literal-pathspecs ls-tree -r -z (\S+) -- (.+)$/.exec(a);
      if (lsTree) {
        const files = filesOf(lsTree[1] ?? '');
        const hits = (lsTree[2] ?? '').split(' ').filter((p) => files[p] !== undefined);
        return ok(hits.map((p) => `100644 blob ${blobOf(files[p] ?? '')}\t${p}\0`).join(''));
      }
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
    value: ({ SHELL: '/bin/zsh', HOME: '/Users/tester', ...w.env } as Record<string, string>)[
      e.name ?? ''
    ],
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
  on('tool.register', ($: unknown, e: { name: string }) => {
    if (e.name === w.registerFails) return { deny: 'registry closed' };
    (w.registered ??= []).push(e.name);
    return { value: { tool: `mcp__review-cycle__${e.name}` } };
  });
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
        const questions = (e as { questions?: Question[] }).questions ?? [];
        (w.asked ??= []).push(...questions);
        const pick = w.dialog;
        if (typeof pick !== 'function') {
          return { result: { questions, answers: pick ?? {}, annotations: {} } };
        }
        return Promise.all(questions.map(async (q) => [q.question, await pick(q)] as const)).then(
          (picked) => {
            const answers = Object.fromEntries(picked.filter(([, a]) => a !== undefined));
            return { result: { questions, answers, annotations: {} } };
          },
        );
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
      const result = { stdout: `ran ${e.command ?? ''}`, stderr: '', interrupted: false };
      return w.bashFails ? { result, isError: true } : { result };
    },
  );
  on('agent.list', () => ({ value: w.agents ?? [] }));
  on(
    'clock.after',
    ($: unknown, e: { ms: number }) =>
      new Promise((resolve) => {
        (w.timers ??= []).push({ ms: e.ms, fire: () => resolve({ value: undefined }) });
      }),
  );
  on('prompt.submit', async ($: unknown, e: { text: string }) => {
    if (w.submitFails && e.text.startsWith('review-cycle:')) {
      await w.submitGate;
      return { drop: 'refused' };
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
  on('settings.read', ($: unknown, e: { source?: 'project' | 'local' }) => {
    w.settingsRead?.();
    const answer = e.source && w.settings?.[e.source];
    if (answer === 'throw') return { deny: 'settings unreadable' };
    return { value: answer ?? {} };
  });
  on('ui.log', ($: unknown, e: { text: string }) => {
    (w.logs ??= []).push(e.text);
    return { value: undefined };
  });
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
  test('a reviewed commit goes through without a request or a question', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -m x'))).toBe(true);
    expect(w.asked).toBeUndefined();
  });
  test('a request from a peer session grants nothing', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it', 'peer');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
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
  test('a merge needs neither a request nor a review', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git merge topic'))).toBe(true);
    expect(w.asked).toBeUndefined();
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
  test('a tree the check cannot build is refused with the git error that stopped it', async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a === 'git write-tree' });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(await bash($, 'git commit -am x'), 'git write-tree failed: fatal: injected'),
    ).toBe(true);
  });
  test("a replayed git add that fails is refused with git's error", async ($, on) => {
    let judging = false;
    fakeWorld(on, { fail: (a) => judging && a === 'git -C . add a.ts' });
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(await bash($, 'git add a.ts && git commit -m x'), 'git add failed: fatal: injected'),
    ).toBe(true);
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
    expect(
      denied(
        await bash($, 'git -C /nope commit -m x'),
        'so it is refused. The user can run it from their own terminal.',
      ),
    ).toBe(true);
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

  test('a commit a script made without a review is reported', async ($, on) => {
    fakeWorld(on, {
      commits: { [HEAD]: { 'a.ts': 'zero' }, [THEIRS]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = THEIRS;
      },
    });
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, 'records content no reviewer saw (never reviewed: a.ts)')).toBe(true);
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
    // Judged at the side commit, not at the HEAD it returned to.
    expect(
      has(
        context,
        `commit ${THEIRS.slice(0, 12)} records content no reviewer saw (never reviewed: a.ts)`,
      ),
    ).toBe(true);
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
    expect(has(contextOf(await bash($, './sync.sh')), 'records content no reviewer saw')).toBe(
      true,
    );
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
    const context = contextOf(await bash($, './sync.sh'));
    // b.ts came from upstream, so only the rebased change is unreviewed.
    expect(has(context, 'records content no reviewer saw (never reviewed: a.ts)')).toBe(true);
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
    expect(has(contextOf(await bash($, './init.sh')), 'records content no reviewer saw')).toBe(
      true,
    );
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
    expect(has(context, 'records content no reviewer saw')).toBe(true);
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
    expect(has(context, 'records content no reviewer saw')).toBe(true);
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
    const r = await bash(
      $,
      `jq '.enabledPlugins["review-cycle@oakoss"]=false' ${SETTINGS} > t && mv t ${SETTINGS}`,
    );
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

describe('the status tool', () => {
  test('reports uncovered paths and whether a push was asked for', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.uncovered).toEqual([{ path: 'a.ts', state: 'never-reviewed' }]);
    expect(status.pushRequested).toBe(true);
    expect(status.error).toBe(null);
    expect(status.snapshot).toMatch(/^[0-9a-f]{64}$/);
  });
  test('reports no push request for a message without one', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    expect(JSON.parse((r as { result: string }).result).pushRequested).toBe(false);
  });
});

// A store per test, and a fixed clock: 2026-09-26. `clock.sleep` never ends
// unless `hangFirstGet`, where it ends at once so the record waiting on the
// stuck one goes ahead without a real wait.
function fakeStore(
  on: any,
  opts: {
    refuse?: string;
    readFails?: string;
    hangFirstGet?: boolean;
  } = {},
): Map<string, unknown> {
  const store = new Map<string, unknown>();
  let gets = 0;
  on('store.get', ($: unknown, e: { key: string }) => {
    if (opts.hangFirstGet && gets++ === 0) return pending();
    return opts.readFails ? { deny: opts.readFails } : { value: structuredClone(store.get(e.key)) };
  });
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    if (opts.refuse) return { deny: opts.refuse };
    store.set(e.key, structuredClone(e.value));
    return { value: undefined };
  });
  on('store.keys', () => ({ value: [...store.keys()] }));
  on('store.delete', ($: unknown, e: { key: string }) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on('clock.now', () => ({ value: NOW }));
  on('clock.sleep', () => (opts.hangFirstGet ? { value: undefined } : pending()));
  return store;
}

const NOW = Date.UTC(2026, 8, 26, 12);

// A promise that never settles.
function pending(): Promise<never> {
  return new Promise<never>((resolve) => {
    void resolve;
  });
}

async function ledger($: any, input: object = {}): Promise<any> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__ledger', ...input });
  return (r as { result: string }).result;
}

async function record($: any, input: object): Promise<string> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__ledger_record', ...input });
  return (r as { result: string }).result;
}

const DEFERRED = {
  path: 'a.ts',
  line: 3,
  kind: 'deferred',
  finding: 'retry has no cap',
  reason: 'needs a new dependency',
  source: 'silent-failure-hunter',
};
const KEY = 'ledger:/repo/.git';

describe('the findings ledger', () => {
  test('both tools are registered at session start', async ($, on) => {
    const w = fakeWorld(on);
    await ($ as any).session.start({ source: 'startup' });
    expect(w.registered).toEqual(expect.arrayContaining(['status', 'ledger', 'ledger_record']));
  });
  test('a ledger tool that cannot register leaves the gate set up', async ($, on) => {
    const w = fakeWorld(on, { registerFails: 'ledger' });
    await ($ as any).session.start({ source: 'startup' });
    expect(w.registered).toContain('status');
  });
  test('an entry recorded is read back with its blob, unchanged until the file is', async ($, on) => {
    const w = fakeWorld(on);
    const store = fakeStore(on);
    expect(JSON.parse(await record($, { entries: [DEFERRED] }))).toEqual({
      added: 1,
      updated: 0,
      resolved: 0,
      kept: 0,
      gone: 0,
      unknown: [],
      evicted: 0,
      total: 1,
    });
    expect([...store.keys()]).toEqual([KEY]);
    expect((store.get(KEY) as { updated: number }).updated).toBe(NOW);
    const read = JSON.parse(await ledger($, { paths: ['a.ts'] }));
    const blob = blobOf('one');
    expect(read).toEqual({
      total: 1,
      unreadable: 0,
      entries: [
        {
          ...DEFERRED,
          id: expect.stringMatching(/^[0-9a-f]{8}$/),
          blob,
          date: '2026-09-26',
          current: blob,
          changed: false,
          stale: false,
        },
      ],
    });
    w.work['a.ts'] = 'two';
    const after = JSON.parse(await ledger($)).entries[0];
    expect(after).toMatchObject({ blob, current: blobOf('two'), changed: true });
    delete w.work['a.ts'];
    expect(JSON.parse(await ledger($)).entries[0]).toMatchObject({ current: null, changed: true });
    expect(JSON.parse(await ledger($, { paths: ['b.ts'] }))).toEqual({
      total: 1,
      unreadable: 0,
      entries: [],
    });
  });
  test('a working tree git cannot list is said on read, and records nothing', async ($, on) => {
    const w = fakeWorld(on);
    fakeStore(on);
    await record($, { entries: [DEFERRED] });
    w.fail = (a) => a.includes('ls-tree');
    expect(JSON.parse(await ledger($)).note).toMatch(/git ls-tree failed: fatal: injected\)$/);
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'x' }] })).toBe(
      'review-cycle ledger: nothing recorded: git ls-tree failed: fatal: injected',
    );
  });
  test('resolve removes an entry', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    await record($, { entries: [DEFERRED] });
    const [entry] = JSON.parse(await ledger($)).entries;
    expect(JSON.parse(await record($, { resolve: [entry.id] }))).toMatchObject({
      resolved: 1,
      total: 0,
    });
  });
  test('two records at once both land', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    await Promise.all([
      record($, { entries: [DEFERRED] }),
      record($, { entries: [{ ...DEFERRED, finding: 'another' }] }),
    ]);
    expect(JSON.parse(await ledger($)).total).toBe(2);
  });
  test('a record stuck on the store makes the next one refuse, not race it', async ($, on) => {
    fakeWorld(on);
    const store = fakeStore(on, { hangFirstGet: true });
    void record($, { entries: [DEFERRED] });
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'next' }] })).toBe(
      'review-cycle ledger: nothing recorded: an earlier record has not finished after 5 seconds',
    );
    // Still stuck, so a third waits on it too rather than on the refused second.
    expect(await record($, { entries: [{ ...DEFERRED, finding: 'third' }] })).toMatch(
      /has not finished after 5 seconds$/,
    );
    expect(store.size).toBe(0);
  });
  test('an invalid batch records nothing and says why', async ($, on) => {
    fakeWorld(on);
    const store = fakeStore(on);
    const r = await record($, { entries: [DEFERRED, { ...DEFERRED, path: './' }] });
    expect(r).toBe('review-cycle ledger: nothing recorded: entries[1]: path is empty');
    expect(store.size).toBe(0);
  });
  test('a store that refuses the write is reported, not swallowed', async ($, on) => {
    fakeWorld(on);
    fakeStore(on, { refuse: 'store over 4 MiB' });
    expect(await record($, { entries: [DEFERRED] })).toMatch(
      /^review-cycle ledger: nothing recorded: .*4 MiB/,
    );
  });
  test('a store that cannot be read is reported, not read as empty', async ($, on) => {
    fakeWorld(on);
    fakeStore(on, { readFails: 'EIO' });
    expect(await ledger($)).toMatch(/^review-cycle ledger: could not be read: .*EIO/);
    expect(await record($, { entries: [DEFERRED] })).toMatch(/nothing recorded: .*EIO/);
  });
  test('outside a repository, both tools say so', async ($, on) => {
    fakeWorld(on, {
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
    });
    fakeStore(on);
    expect(await ledger($)).toBe('review-cycle ledger: not in a git repository.');
    expect(await record($, { entries: [DEFERRED] })).toBe(
      'review-cycle ledger: not in a git repository; nothing recorded.',
    );
  });
  test('paths that are not a list of strings are refused', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    for (const paths of ['a.ts', [1]]) {
      expect(await ledger($, { paths })).toContain('`paths` must be an array');
    }
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

describe('failures while judging a commit refuse it, naming the cause', () => {
  const failures: [string, (a: string) => boolean, string][] = [
    [
      'the changed-path diff',
      (a) => a.includes('diff-tree') && a.includes(' -- . '),
      // Closed by the refusal's `)`, so `HEAD's parent` does not match.
      'could not compare the tree this commit would record with HEAD)',
    ],
    ['write-tree', (a) => a === 'git write-tree', 'git write-tree failed: fatal: injected'],
    ['the replayed add', (a) => a === 'git -C . add -A', 'git add failed: fatal: injected'],
    ['add -u for commit -a', (a) => a === 'git add -u', 'git add -u failed: fatal: injected'],
    [
      'reading HEAD',
      (a) => a === 'git rev-parse --verify -q HEAD^{commit}',
      'git rev-parse HEAD failed: fatal: injected',
    ],
    ['mktemp', (a) => a === 'mktemp', 'mktemp failed: fatal: injected'],
    [
      'the index path',
      (a) => a.includes('--git-path index'),
      'git rev-parse --git-path index failed: fatal: injected',
    ],
    [
      'the index copy',
      (a) => a.startsWith('sh -c') && a.includes('/repo/.git/index'),
      'copying the index failed: fatal: injected',
    ],
  ];
  for (const [name, fail, cause] of failures) {
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
      expect(denied(r, cause)).toBe(true);
    });
  }
  test('a write-tree that prints no tree id says what it printed', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on);
    w.git = (a) => (judging && a === 'git write-tree' ? { stdout: 'garbage\n' } : null);
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'printed no tree id: garbage')).toBe(true);
  });
  test('a step that fails with no error output gives its exit code', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on);
    w.git = (a) =>
      judging && a === 'git write-tree' ? { exitCode: 128, stdout: '', stderr: '' } : null;
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(denied(await bash($, 'git commit -am x'), 'git write-tree failed: exit 128')).toBe(true);
  });
  test('an amend whose parent tree cannot be read says so', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    let judging = false;
    const w = fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    w.fail = (a) => judging && a === `git rev-parse ${parent}^{tree}`;
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git commit --amend --no-edit'),
        "could not read the tree of HEAD's parent",
      ),
    ).toBe(true);
  });
  test('a failed add -A builds no working tree, and says why', async ($, on) => {
    const w = fakeWorld(on);
    w.fail = (a) => a === 'git add -A';
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.worktreeTree).toBe(null);
    expect(status.error).toBe('git add -A failed: fatal: injected');
  });
  test("a reviewer whose finishing tree cannot be built is dropped with git's reason", async ($, on) => {
    let finishing = false;
    fakeWorld(on, { fail: (a) => finishing && a === 'git add -A' });
    await review($, {
      during: () => {
        finishing = true;
      },
    });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.droppedReviews).toEqual([
      'review-cycle:code-reviewer: git add -A failed: fatal: injected',
    ]);
  });
  test("a failed comparison on an amend names HEAD's parent", async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    let judging = false;
    const w = fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    w.fail = (a) => judging && a.includes('diff-tree') && a.includes(' -- . ');
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git commit --amend --no-edit'),
        "could not compare the tree this commit would record with HEAD's parent",
      ),
    ).toBe(true);
  });
  test('a failed comparison on an unborn branch names the empty tree', async ($, on) => {
    let judging = false;
    const w = fakeWorld(on, { headMissing: true, work: { 'a.ts': 'one' } });
    w.fail = (a) => judging && a.includes('diff-tree') && a.includes(' -- . ');
    await review($);
    await say($, 'commit it');
    judging = true;
    expect(
      denied(
        await bash($, 'git add -A && git commit -m first'),
        'could not compare the tree this commit would record with the empty tree',
      ),
    ).toBe(true);
  });
  test('a runner that rejects is named by its step, and not read as unreadable', async ($, on) => {
    const w = fakeWorld(on);
    w.reject = (a) => a === 'git write-tree';
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.error).toContain('git write-tree failed');
    expect(status.error).toContain('timed out');
  });
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

function nudge(value: boolean) {
  return { pluginConfigs: { 'review-cycle': { options: { nudge: value } } } };
}

function nudges(w: World): string[] {
  return (w.prompts ?? []).filter((p) => p.startsWith('review-cycle: this turn left'));
}

async function endTurn($: any, reason = 'answer', answer = 'done') {
  await $.turn.complete({
    answer,
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
  test('a turn that ends by asking the user something is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'answer', 'Fixed. Commit the changes to `fix/x`?');
    expect(nudges(w)).toEqual([]);
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test("a project's settings turn the nudge off; the local file decides", async ($, on) => {
    const w = fakeWorld(on, { settings: { project: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toEqual([]);
    w.settings = { project: nudge(false), local: nudge(true) };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a settings file that cannot be read sets nothing', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw' } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('one unreadable file leaves the other one in force', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw', local: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toEqual([]);
    w.settings = { project: nudge(false), local: 'throw' };
    await endTurn($);
    expect(nudges(w)).toEqual([]);
  });
  test('a nudge value that is not a boolean sets nothing', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { project: { pluginConfigs: { 'review-cycle': { options: { nudge: 'false' } } } } },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(nudges(w)).toHaveLength(1);
  });
  test('a turn with nothing to nudge reads no settings', async ($, on) => {
    let reads = 0;
    fakeWorld(on, { settingsRead: () => void reads++ });
    await say($, 'fix it');
    const before = reads;
    await endTurn($);
    expect(reads).toBe(before);
  });
  test('only the user changes the nudge setting', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.nudge',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
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
  test("yes to the agent's push question grants the push", async ($, on) => {
    const w = fakeWorld(on);
    await ($ as any).turn.complete({
      answer: 'Committed.\nWant me to push this?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(w.asked).toBeUndefined();
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
              await $.ui.ask('Which phrase should the docs quote?', ['Push changes', 'Other']);
              return next(e);
            });
          },
        },
      ],
    },
    async ($, on) => {
      fakeWorld(on, { dialog: { 'Which phrase should the docs quote?': 'Push changes' } });
      await say($, 'raise the dialog');
      expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
    },
  );
  test("the agent's own dialog grants nothing", async ($, on) => {
    const w = fakeWorld(on, {
      dialog: (q) => (q.question === 'Push the branch?' ? 'Push' : undefined),
    });
    await ($ as any).tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: 'Push the branch?', options: [{ label: 'Push' }] }],
    });
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
    expect(w.asked).toHaveLength(1);
  });
});

describe('a push the user did not ask for', () => {
  test('is refused with a request to ask in the reply, and no dialog', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, "the user's latest message doesn't ask for a push, so nothing ran.")).toBe(
      true,
    );
    expect(denied(r, 'stop and ask them in your reply')).toBe(true);
    expect(denied(r, 'The command: git push origin fix/x')).toBe(true);
    expect(w.asked).toBeUndefined();
  });
  test('runs once the next message says yes to the question', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    await ($ as any).turn.complete({
      answer: 'Fixed.\nPush fix/x to origin?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });
  test('stays refused when the next message asks for something else', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    await ($ as any).turn.complete({
      answer: 'Fixed.\nPush fix/x to origin?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'not yet, rename the helper first');
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });
  test('a reviewed commit with it is refused whole, naming the commit on its own', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x && git push');
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a push alone does not mention a commit', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), 'To commit without pushing')).toBe(false);
  });
  test('names what a shell alias expands to', async ($, on) => {
    fakeWorld(on, { shellAliases: "alias -- ship='git push --force origin main'\n" });
    await say($, 'fix the parser');
    expect(
      denied(
        await bash($, 'ship'),
        'The command: ship (aliases expanded: git push --force origin main)',
      ),
    ).toBe(true);
  });
  test('quotes only the start of a long command', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    const r = await bash($, `git push origin ${'x'.repeat(400)}`);
    expect(denied(r, `The command: git push origin ${'x'.repeat(284)}…`)).toBe(true);
    expect(denied(r, 'x'.repeat(286))).toBe(false);
  });
  test('a commit no reviewer saw is refused for the review first', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git commit -am x && git push'), 'never reviewed')).toBe(true);
  });
  test('a dry run needs neither a review nor a request', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit --dry-run -am x'))).toBe(true);
  });
  test('a push typed into the running turn grants it', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    await ($ as any).prompt.submit({
      text: 'push it',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 't',
    });
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  test('a shell alias that runs another program for git is refused first', async ($, on) => {
    fakeWorld(on, { shellAliases: "alias -- git='hub'\n" });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), '`git` is a shell alias here (for `hub`)')).toBe(true);
  });
});

describe('a force push', () => {
  test('a push request does not cover it; one that names a force does', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    const r = await bash($, 'git push --force-with-lease origin fix/x');
    expect(denied(r, "doesn't ask for a force push")).toBe(true);
    expect(denied(r, '"Force-push `fix/x` to `origin` with a lease?"')).toBe(true);
    await say($, 'force push it');
    expect(ran(await bash($, 'git push --force-with-lease origin fix/x'))).toBe(true);
  });
  test('a bare --force points to the lease unless named', async ($, on) => {
    fakeWorld(on);
    await say($, 'force push it');
    const r = await bash($, 'git push --force origin fix/x');
    expect(denied(r, 'Use `--force-with-lease --force-if-includes` instead;')).toBe(true);
    expect(denied(r, 'without a lease?"')).toBe(true);
    expect(denied(await bash($, 'git push origin +fix/x'), 'a bare --force')).toBe(true);
    await say($, 'force push it without a lease');
    expect(ran(await bash($, 'git push --force origin fix/x'))).toBe(true);
  });
  test('with no request at all, the bare refusal says the lease needs one too', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push -f'), 'which also needs their request')).toBe(true);
  });
  test('a commit with a force push is told to run on its own', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'push it');
    const r = await bash($, 'git commit -am x && git push --force-with-lease');
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
    expect(denied(r, "doesn't ask for a force push")).toBe(true);
  });
});

describe('a push the user asked for', () => {
  test('is not reported as one the user did not ask for', async ($, on) => {
    const head = 'c'.repeat(40);
    const theirs = 'd'.repeat(40);
    fakeWorld(on, {
      refs: { 'refs/remotes/origin/main': head },
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/main': theirs };
        this.reflogs = {
          'refs/remotes/origin/main': [`${theirs} update by push`, `${head} fetch`],
        };
      },
    });
    await say($, 'push it');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([]);
  });
  test('a reviewed commit beside it is not reported either', async ($, on) => {
    fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([]);
  });
  test('a message the user sends while the gate reads the repository stops it', async ($, on) => {
    let armed = false;
    fakeWorld(on, {
      git: (a) => {
        if (armed && a.includes('for-each-ref')) {
          armed = false;
          void ($ as any).prompt.submit({
            text: 'stop',
            origin: { kind: 'composer' },
            wait: false,
            turnId: 't',
          });
        }
        return null;
      },
    });
    await say($, 'push it');
    armed = true;
    expect(denied(await bash($, 'git push'), 'while the gate was checking')).toBe(true);
  });
  test('a message during the review check of a commit and push stops both', async ($, on) => {
    let armed = false;
    fakeWorld(on, {
      git: (a) => {
        if (armed && a.includes('write-tree')) {
          armed = false;
          void ($ as any).prompt.submit({
            text: 'stop',
            origin: { kind: 'composer' },
            wait: false,
            turnId: 't',
          });
        }
        return null;
      },
    });
    await review($);
    await say($, 'commit and push');
    armed = true;
    expect(
      denied(await bash($, 'git commit -am x && git push'), 'while the gate was checking'),
    ).toBe(true);
  });
  test(
    'a call a hook above abandons does not run',
    {
      plugins: [
        {
          name: 'above',
          tier: 'prepend',
          register(on) {
            on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
              if (!e.command.includes('abandoned')) return next(e);
              // Gives up while the gate is still reading the repository.
              void next(e);
              return { deny: 'above' };
            });
          },
        },
      ],
    },
    async ($, on) => {
      const ranCommands: string[] = [];
      fakeWorld(on, {
        shell: (command) => {
          ranCommands.push(command);
        },
      });
      await say($, 'push it');
      expect(denied(await bash($, 'git push origin abandoned'), 'above')).toBe(true);
      await settle();
      expect(ranCommands).toEqual([]);
      expect(ran(await bash($, 'git push'))).toBe(true);
    },
  );
  test(
    'a GitHub MCP call a hook above abandons does not run',
    {
      plugins: [
        {
          name: 'above',
          tier: 'prepend',
          register(on) {
            on('tool.call', { tool: 'mcp__github__create_pull_request' }, async ($, e, next) => {
              void next(e);
              return { deny: 'above' };
            });
          },
        },
      ],
    },
    async ($, on) => {
      const calls: string[] = [];
      fakeWorld(on, {
        settings: { local: stops('never stop') },
        shell: (command) => {
          calls.push(command);
        },
      });
      await say($, 'fix the parser');
      expect(denied(await mcp($, 'mcp__github__create_pull_request', {}), 'above')).toBe(true);
      await settle();
      expect(calls).toEqual([]);
    },
  );
});

// A leg still under way: spawned, not yet complete.
async function legUnderWay($: any, type = 'review-cycle:code-reviewer'): Promise<string> {
  spawns++;
  const r = await $.agent.spawn({
    tool_use_id: `c${spawns}`,
    subagentType: type,
    prompt: 'review',
    description: 'review',
    background: true,
  });
  return r.agentId;
}
async function reviewerChanges($: any): Promise<string[]> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
  return JSON.parse((r as { result: string }).result).reviewerChanges;
}

async function settle() {
  for (let i = 0; i < 500; i++) await Promise.resolve();
}
async function finishLeg($: any, agentId: string, isAborted: boolean) {
  await $.turn.complete({
    answer: RECEIPT,
    durationMs: 1,
    isAborted,
    turnId: `turn-${agentId}`,
    agentId,
    reason: isAborted ? 'aborted' : 'answer',
  });
}
function statusOf(r: unknown) {
  return JSON.parse((r as { result: string }).result);
}

function stops(stopBefore: string) {
  return { pluginConfigs: { 'review-cycle': { options: { stopBefore } } } };
}

const REMOTE = '/remote.git';
const DRY_FLAGS = '--dry-run --porcelain --no-verify --no-quiet --recurse-submodules=no';
const NEW_BRANCH = '*\tHEAD:refs/heads/fix/x\t[new branch]';

// The remote as the gate's always-ask check sees it: what git's dry run
// prints for each push, keyed by the words after `push` ('fail' for a dry run
// that fails), and the remote's default branch (null when unreadable).
function remoteSide(
  dryRuns: Record<string, readonly string[] | 'fail'> = {},
  head: string | null = 'main',
): (a: string) => Partial<Run> | null {
  return (a) => {
    if (/^git (?:-c \S+ )*push --dry-run /.test(a) && a.includes(DRY_FLAGS)) {
      const args = a
        .replace(/^git (?:-c \S+ )*push --dry-run ?/, '')
        .replace(DRY_FLAGS, '')
        .replaceAll(/\s+/g, ' ')
        .trim();
      const lines = dryRuns[args] ?? [NEW_BRANCH];
      if (lines === 'fail') {
        return { exitCode: 128, stderr: 'fatal: Could not read from remote repository.\n' };
      }
      return { stdout: [`To ${REMOTE}`, ...lines, 'Done'].join('\n') };
    }
    if (a.startsWith('git ls-remote --symref')) {
      return head === null
        ? { exitCode: 128, stderr: 'fatal: unable to access\n' }
        : { stdout: `ref: refs/heads/${head}\tHEAD\nabc\tHEAD\n` };
    }
    return null;
  };
}

// GitHub as the gate sees it: `gh pr view` names the merged pull request's
// branch, or fails when `head` is 'fail'.
function github(
  head: string,
  defaultBranch = 'main',
  fork = false,
  repo = 'github.com/o/r',
): (a: string) => Partial<Run> | null {
  return (a) => {
    if (a.startsWith('gh pr view')) {
      if (head === 'fail') return { exitCode: 1, stderr: 'no pull requests found for branch "x"' };
      // The update-branch lookup's jq prints fork, pull request URL and head branch.
      const update = a.includes('isCrossRepository');
      return { stdout: update ? `${fork} https://${repo}/pull/7 ${head}\n` : `${head}\n` };
    }
    if (a.startsWith('gh repo view')) return { stdout: `${defaultBranch}\n` };
    return null;
  };
}

async function mcp($: any, tool: string, args: Record<string, unknown>, extra = {}) {
  return $.tool.call({ tool, ...args, ...extra });
}

// A world on fix/x whose next Bash call moves origin/fix/x, as a push does.
function pushing(setup: Partial<World>): Partial<World> {
  return {
    refs: { 'refs/remotes/origin/fix/x': 'c'.repeat(40) },
    git: remoteSide(),
    shell(this: World) {
      this.refs = { 'refs/remotes/origin/fix/x': 'd'.repeat(40) };
      this.reflogs = { 'refs/remotes/origin/fix/x': [`${'d'.repeat(40)} update by push`] };
    },
    ...setup,
  };
}

const RAN_PUSH =
  'review-cycle: ran a push without asking, since the stop-before setting is open PR (.claude/settings.local.json).';

describe('the stop-before setting', () => {
  test('a push below the rung runs without asking, logged and told to the agent', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([RAN_PUSH]);
    expect(w.logs).toEqual([RAN_PUSH]);
  });
  test('a push a script makes below the rung is logged, not reported as unasked', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, RAN_PUSH)).toBe(true);
    expect(has(context, 'without the user asking')).toBe(false);
    expect(w.logs).toHaveLength(1);
  });
  // Each dry-run output is what git 2.56 printed for that push.
  const asking: [string, readonly string[] | 'fail' | null, string][] = [
    [
      'git push origin main',
      [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
    ],
    [
      'git push origin @',
      [' \tHEAD:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
    ],
    ['git push origin v1', ['*\trefs/tags/v1:refs/tags/v1\t[new tag]'], 'it pushes the tag `v1`'],
    // push.followTags carries a new annotated tag along with the branch.
    ['git push', [NEW_BRANCH, '*\trefs/tags/v1:refs/tags/v1\t[new tag]'], 'it pushes the tag `v1`'],
    [
      'git push',
      'fail',
      'a dry run of it, which shows what it would push, failed (fatal: Could not read from remote repository.)',
    ],
    ['git push --tags', null, 'it pushes tags'],
    ['git push origin --delete old', null, 'it deletes a remote branch'],
    ['git push --all', null, 'it pushes every branch'],
    ['git push origin "$BRANCH"', null, 'its remote or branch is built at run time'],
  ];
  for (const [command, lines, reason] of asking) {
    test(`${command} asks whatever the setting: ${reason}`, async ($, on) => {
      const args = command.replace(/^git push ?/, '');
      const git = remoteSide(lines === null ? {} : { [args]: lines });
      fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git }));
      await say($, 'fix the parser');
      const r = await bash($, command);
      expect(denied(r, `This push asks whatever the setting: ${reason}.`)).toBe(true);
      await say($, 'push it');
      expect(ran(await bash($, command))).toBe(true);
    });
  }
  test('a remote branch delete asks a question its reply grants', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin --delete old');
    expect(denied(r, '"Delete `fix/x` from `origin`?"')).toBe(true);
    expect(denied(r, '`gh pr merge --delete-branch`')).toBe(true);
    await endTurn($, 'answer', 'Delete `old` from `origin`?');
    await say($, 'Lets delete it');
    expect(ran(await bash($, 'git push origin --delete old'))).toBe(true);
  });
  test("a pull request's push runs unnoted, but still asks before main", async ($, on) => {
    const w = fakeWorld(
      on,
      pushing({
        git: remoteSide({ 'origin main': [' \trefs/heads/main:refs/heads/main\t1..2'] }),
      }),
    );
    await say($, 'open a PR');
    const r = await bash($, 'git push -u origin HEAD');
    expect(ran(r)).toBe(true);
    expect(w.logs ?? []).toEqual([]);
    expect(has(contextOf(r), 'without')).toBe(false);
    expect(denied(await bash($, 'git push origin main'), 'the default branch')).toBe(true);
  });
  test('a held pull request request lets no push through', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'open a PR. do not push.');
    expect(denied(await bash($, 'git push -u origin HEAD'), 'held off (')).toBe(true);
  });
  test("a script's push under a pull request request is still reported", async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'open a PR');
    const context = contextOf(await bash($, './release.sh'));
    expect(has(context, 'without the user asking for a push')).toBe(true);
  });
  test("the dry run carries the push's own -c options", async ($, on) => {
    const upstream = ' \trefs/heads/fix/x:refs/heads/main\t1..2';
    const w = fakeWorld(
      on,
      pushing({
        settings: { local: stops('never stop') },
        git: (a) =>
          a.startsWith('git -c push.default=upstream push') && a.includes('--dry-run')
            ? { stdout: [`To ${REMOTE}`, upstream, 'Done'].join('\n') }
            : remoteSide()(a),
      }),
    );
    await say($, 'fix the parser');
    const r = await bash($, 'git -c push.default=upstream push');
    expect(denied(r, 'the default branch')).toBe(true);
    const probe = w.calls.find((c) => c.argv.includes('--dry-run'));
    expect(probe?.init?.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });
  // Measured on git 2.56: a later --no-verify and --no-quiet win, and an
  // option before the push's own `--` would take a flag as its value.
  const flags = DRY_FLAGS.split(' ');
  const probes: [string, string[]][] = [
    ['git push -q --verify origin main', ['-q', '--verify', 'origin', 'main', ...flags]],
    ['git push origin -- main', ['origin', ...flags, '--', 'main']],
    ['git push -o -- origin main', ['-o', '--', 'origin', 'main', ...flags]],
  ];
  for (const [command, words] of probes) {
    test(`the dry run of ${command} leads with --dry-run and ends its options with the flags`, async ($, on) => {
      const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
      await say($, 'fix the parser');
      await bash($, command);
      const probe = w.calls.find((c) => c.argv.includes('--porcelain'));
      expect(probe?.argv).toEqual(['git', 'push', '--dry-run', ...words]);
    });
  }
  test('a push option with no value is refused before any dry run', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push origin main -o'), 'without a value')).toBe(true);
    expect(w.calls.some((c) => c.argv.includes('--porcelain'))).toBe(false);
  });
  test('a push after a step that can retarget it asks, without a dry run', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git checkout main && git push');
    expect(denied(r, '`git checkout` runs before it in the same command')).toBe(true);
    expect(w.calls.some((c) => c.argv.includes('--porcelain'))).toBe(false);
  });
  test('a quiet push and a commit with its push are still judged', async ($, on) => {
    const main = ['=\trefs/heads/main:refs/heads/main\t[up to date]'];
    fakeWorld(
      on,
      pushing({
        settings: { local: stops('never stop') },
        git: remoteSide({ '-q origin main': main, 'origin main': main }),
      }),
    );
    await review($);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push -q origin main'), 'the default branch')).toBe(true);
    expect(
      denied(await bash($, 'git commit -am x && git push origin main'), 'the default branch'),
    ).toBe(true);
  });
  test('an unreadable setting leaves its rung out of the commit refusal', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'could not read .claude/settings.local.json')).toBe(true);
    expect(denied(r, 'the stop-before setting is')).toBe(false);
  });
  test('a commit dry run needs no request at a commit rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit --dry-run -am x'))).toBe(true);
  });
  test("a remote whose default branch can't be read asks", async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}, null) }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(
      denied(r, `the default branch of ${REMOTE} could not be read (fatal: unable to access)`),
    ).toBe(true);
  });
  test('at the default setting, a refused push skips the always-ask reason', async ($, on) => {
    fakeWorld(on, pushing({}));
    await say($, 'fix the parser');
    const r = await bash($, 'git push origin main');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, 'asks whatever the setting')).toBe(false);
  });
  test('an unreadable settings file stops before a commit too', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await review($);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
  });
  test('a force push asks whatever the setting', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push --force-with-lease'), 'force push')).toBe(true);
  });
  test('a pull request a newer message overtakes does not run, and logs nothing', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: (a) => {
        if (!typed && a.startsWith('git for-each-ref')) {
          typed = true;
          void say($, "don't open a PR");
        }
        return null;
      },
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('a pull request at the rung is refused, naming the branch to ask about', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr create --fill');
    expect(denied(r, "doesn't ask for a pull request")).toBe(true);
    expect(denied(r, '"Open a PR from `fix/x` into `main`?"')).toBe(true);
  });
  test('by default a pull request asks, and a request for one lets it run', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'pull request')).toBe(true);
    await say($, 'open a PR');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('never stop lets a pull request run, logged', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(w.logs?.[0]).toContain('ran a pull request without asking');
  });
  test('outside a repository a newer message still stops a pull request', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: (a) =>
        a.includes('--show-toplevel')
          ? { exitCode: 128, stderr: 'fatal: not a git repository' }
          : null,
      settingsRead: () => {
        if (typed) return;
        typed = true;
        void say($, 'actually, rename the helper first');
      },
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh -R o/r pr create --fill');
    expect(denied(r, 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  // The note says the step ran, not that it succeeded, so it stands either way.
  test('a pull request that failed is still noted as run', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') }, bashFails: true });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr create --fill');
    expect(has(contextOf(r), 'ran a pull request without asking')).toBe(true);
    expect(w.logs).toHaveLength(1);
  });
  test('a permitted push that moved no ref is still noted as run', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: remoteSide() });
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(w.logs).toEqual([RAN_PUSH]);
  });
  test('a failure while judging a pull request refuses it', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      reject: (a) => a.includes('--show-toplevel'),
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr create --fill'), 'the gate failed')).toBe(true);
  });
  test('Monitor refuses a pull request', async ($, on) => {
    fakeWorld(on);
    const r = await $.tool.call({ tool: 'Monitor', command: 'gh pr create --fill' } as never);
    expect(denied(r, 'opens, merges, approves or comments on a pull request')).toBe(true);
    const merge = await $.tool.call({ tool: 'Monitor', command: 'gh pr merge 116' } as never);
    expect(denied(merge, 'Monitor runs commands the gate does not check')).toBe(true);
  });
  test('a merge asks at a merge rung and runs once asked for', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 116 --squash'), "doesn't ask for a merge")).toBe(true);
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 116 --squash --delete-branch'))).toBe(true);
  });
  test('a merge asked for once it is ready runs only with --auto', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'Lets merge it when its ready');
    expect(denied(await bash($, 'gh pr merge 116 --squash'), '--auto`, naming')).toBe(true);
    expect(denied(await bash($, 'gh pr merge 116 --body --auto'), '--auto`, naming')).toBe(true);
    expect(ran(await bash($, 'gh pr merge 116 --auto --squash'))).toBe(true);
  });
  test('a merge below the rung runs, noted', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 116');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran a merge without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv).toEqual([
      'gh',
      'pr',
      'view',
      '116',
      '--json',
      'headRefName',
      '--jq',
      '.headRefName',
    ]);
    expect(view?.init?.timeoutMs).toBe(5000);
  });
  test("merging oakum's version pull request is a release", async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('oakum/version-packages'),
    });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 62'), "doesn't ask for a release")).toBe(true);
    await say($, 'release it');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
  });
  test('"merge the release" merges the version pull request, and no other', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('merge') },
      git: github('oakum/version-packages'),
    });
    await say($, 'Ok, lets merge the release');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
    w.git = github('feat/x');
    expect(denied(await bash($, 'gh pr merge 63'), 'merge')).toBe(true);
  });
  test('a refusal of a step the message named is kept as a miss; one it did not name is not', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('merge') },
      git: github('oakum/version-packages'),
    });
    const misses = async () => {
      const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
      return JSON.parse((r as { result: string }).result).misses;
    };
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    expect(await misses()).toEqual([]);
    await say($, 'can we merge the version PRs whenever');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    // Refused again, it is kept once.
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    const [miss, ...rest] = await misses();
    expect(rest).toEqual([]);
    expect(miss.message).toBe('can we merge the version PRs whenever');
    expect(miss.steps).toEqual(['merge']);
    expect(miss.refusal).toContain('stop and ask them in your reply');
    // A "yes" to an offer the grammar did not read is kept with that offer, a
    // dotted version and all.
    const closing = 'All green.\nShould I go ahead with the version bump merge for `v0.25.0`?';
    await endTurn($, 'answer', closing);
    await say($, 'yep');
    w.git = github('oakum/version-packages');
    expect(denied(await bash($, 'gh pr merge 62'), 'release')).toBe(true);
    const all = await misses();
    const latest = all.at(-1);
    expect(latest.offer).toBe(closing);
    expect(latest.steps).toEqual(['merge']);
  });
  test('a miss needs the refused step named, and an offer counts only when answered', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('commit') },
      git: github('feat/x'),
    });
    const count = async () => {
      const r = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
      return JSON.parse((r as { result: string }).result).misses.length;
    };
    // A push named, a merge refused.
    await say($, 'push it later');
    expect(denied(await bash($, 'gh pr merge 63'), 'merge')).toBe(true);
    // A commit refused: not consent the grammar reads.
    await say($, 'did the push fail?');
    expect(denied(await bash($, 'git commit -m x'), 'commit')).toBe(true);
    // An offer of a merge the message does not answer.
    await endTurn($, 'answer', 'Tests pass.\nShould I merge 63?');
    for (const text of [
      'now fix the lexer too',
      'please fix the lexer',
      "let's fix it first",
      'do it later',
      'go ahead and fix the lexer',
    ]) {
      await say($, text);
      expect(denied(await bash($, 'gh pr merge 63'), 'merge')).toBe(true);
    }
    expect(await count()).toBe(0);
    // A bare force push named and refused is kept, as on the gh path.
    await say($, 'force push it whenever');
    expect(denied(await bash($, 'git push --force origin fix/x'), 'bare force')).toBe(true);
    expect(await count()).toBe(1);
  });
  test('a merge whose pull request cannot be looked up asks where a release would', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'fix the parser');
    expect(
      denied(await bash($, 'gh pr merge'), 'looking up the pull request it merges failed'),
    ).toBe(true);
    expect(denied(await bash($, 'gh pr merge "$PR"'), 'built at run time')).toBe(true);
    expect(
      denied(
        await bash($, 'env -C ../other gh pr merge 62'),
        'something outside the words the gate looks up picks where it merges',
      ),
    ).toBe(true);
    expect(
      denied(await bash($, 'gh pr merge 62 && echo merged'), 'Run the merge as its own command'),
    ).toBe(true);
    // Asked for both, the merge runs whichever it is.
    await say($, 'merge it and release it');
    expect(ran(await bash($, 'gh pr merge'))).toBe(true);
  });
  test('a lookup that throws asks', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
    });
    await say($, 'fix the parser');
    expect(
      denied(await bash($, 'gh pr merge 62'), 'looking up the pull request it merges failed'),
    ).toBe(true);
  });
  test('--admin is handed to the user, even when the merge was asked for', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'merge it');
    const r = await bash($, 'gh pr merge 116 --admin=true');
    expect(denied(r, 'past branch protection')).toBe(true);
    expect(denied(r, 'Give the user the command to run themselves')).toBe(true);
  });
  test('an approval and a merge are asked for apart', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'approve it');
    expect(denied(await bash($, 'gh pr merge 116'), "doesn't ask for a merge")).toBe(true);
    expect(ran(await bash($, 'gh pr review 116 -a'))).toBe(true);
    await say($, 'merge it');
    expect(denied(await bash($, 'gh pr review 116 --approve=true'), 'an approval')).toBe(true);
  });
  test('an approval below the rung runs, noted as one; a hold stops it', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr review 116 -ab LGTM');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran an approval without asking')).toBe(true);
    await say($, "don't merge yet");
    expect(denied(await bash($, 'gh pr review 116 -a'), 'held off')).toBe(true);
    expect(denied(await bash($, 'gh release create v1'), 'held off')).toBe(true);
  });
  test('a comment always asks unless the review is addressed', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr comment 116 --body done'), 'a comment on GitHub')).toBe(
      true,
    );
    expect(denied(await bash($, 'gh pr review 116 -c -b ok'), 'a comment on GitHub')).toBe(true);
    expect(denied(await bash($, 'gh issue comment 9 --body ok'), 'a comment on GitHub')).toBe(true);
    await say($, 'address the review comments');
    expect(ran(await bash($, 'gh pr comment 116 --body done'))).toBe(true);
  });
  test('a reply lifts no hold', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    await say($, 'address the review comments');
    expect(denied(await bash($, 'git push'), 'held off')).toBe(true);
  });
  test('a gh alias is refused, asked for or not, and gh is never asked for its aliases', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'merge it');
    const r = await bash($, 'gh m 116');
    expect(denied(r, '`gh m` is a gh alias or extension')).toBe(true);
    expect(denied(r, 'Run the gh command itself, written out')).toBe(true);
    expect(denied(await bash($, 'gh pr m 116'), '`gh pr m` is a gh alias')).toBe(true);
    expect(ran(await bash($, 'gh pr view 116'))).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ') === 'gh alias list')).toBe(false);
  });
  test('a merge asked for covers the version pull request, looked up or not', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('oakum/version-packages'),
    });
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ').startsWith('gh pr view'))).toBe(false);
  });
  test('a merge asked for by number releases only the version PR it names', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, 'merge 131');
    expect(denied(await bash($, 'gh pr merge 130'), "doesn't ask for a release")).toBe(true);
    await say($, 'merge #130');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a merge asked for with a release held off does not release', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, "merge #130. don't release yet.");
    expect(denied(await bash($, 'gh pr merge 130'), 'held off')).toBe(true);
  });
  test('"merge it" naming another pull request elsewhere asks before releasing', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, 'merge it; do not merge 130');
    expect(denied(await bash($, 'gh pr merge 130'), "doesn't ask for a release")).toBe(true);
    await endTurn($, 'answer', 'Merge #131? #130 is the version PR, which releases.');
    await say($, 'merge it');
    expect(denied(await bash($, 'gh pr merge 130'), "doesn't ask for a release")).toBe(true);
    await endTurn($, 'answer', 'Release by merging #130?');
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a merge once ready whose lookup fails asks for a release too', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'merge it when its ready');
    const r = await bash($, 'gh pr merge 62 --auto');
    expect(denied(r, 'the merge may be a release, which the user has not allowed')).toBe(true);
    expect(denied(r, '"Merge and release #62?"')).toBe(true);
  });
  test('a held merge asks; one beside a commit is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, "don't merge yet");
    expect(
      denied(
        await bash($, 'gh pr merge 116'),
        "held off (their message mentioned a merge without asking for one) and hasn't asked for a merge since",
      ),
    ).toBe(true);
    await review($);
    await say($, 'commit it and merge it');
    expect(
      denied(await bash($, 'git commit -am x && gh pr merge 116'), '`gh` alongside a commit'),
    ).toBe(true);
  });
  test('a GitHub MCP merge is judged as gh pr merge, under any server name', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 116, commit_message: 'long text' };
    const r = await mcp($, 'mcp__github__merge_pull_request', pr);
    expect(denied(r, "doesn't ask for a merge")).toBe(true);
    expect(
      denied(r, 'mcp__github__merge_pull_request {"owner":"o","repo":"r","pullNumber":116}'),
    ).toBe(true);
    const other = 'mcp__gh__work__merge_pull_request';
    expect(denied(await mcp($, other, pr), "doesn't ask for a merge")).toBe(true);
    await say($, 'merge it');
    expect(denied(await mcp($, other, pr), 'review-cycle')).toBe(false);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['116', '--repo', 'o/r']);
  });
  test('a GitHub MCP review approves only with APPROVE', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') } });
    await say($, 'fix the parser');
    const review = { owner: 'o', repo: 'r', pullNumber: 116, method: 'create' };
    const r = await mcp($, 'mcp__github__pull_request_review_write', {
      ...review,
      event: 'APPROVE',
    });
    expect(has(contextOf(r), 'ran an approval without asking')).toBe(true);
    const comment = { ...review, event: 'COMMENT' };
    expect(
      denied(await mcp($, 'mcp__github__pull_request_review_write', comment), 'a comment'),
    ).toBe(true);
    expect(
      denied(await mcp($, 'mcp__github__add_issue_comment', { issue_number: 9 }), 'a comment'),
    ).toBe(true);
  });
  test("updating a pull request's branch asks when its head is the default branch", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('main') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(denied(r, 'it pushes to `main`, the default branch')).toBe(true);
  });
  test("updating a feature pull request's branch runs below the rung, noted", async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['7', '--repo', 'o/r']);
    const repo = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repo?.argv[3]).toBe('github.com/o/r');
  });
  test("a pull request's branch update asks when its head cannot be looked up", async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fail') });
    await say($, 'fix the parser');
    const pr = { owner: 'o', repo: 'r', pullNumber: 7 };
    const r = await mcp($, 'mcp__github__update_pull_request_branch', pr);
    expect(denied(r, 'looking up the pull request it updates failed')).toBe(true);
  });
  test("a fork pull request's branch update asks whatever the setting", async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: github('develop', 'main', true),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch 7');
    expect(denied(r, "it updates a branch in the pull request's fork")).toBe(true);
  });
  test('gh pr update-branch is a push to the pull request branch', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch 7 -R o/r');
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(view?.argv.slice(3, 6)).toEqual(['7', '--repo', 'o/r']);
    expect(denied(await bash($, 'gh pr update-branch 7 --rebase'), 'bare force')).toBe(true);
    const moved = await bash($, 'cd ../x && gh pr update-branch 7');
    expect(denied(moved, 'the pull request it updates cannot be looked up')).toBe(true);
  });
  test("a pull request named by URL is checked against its own repository's default", async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('open PR') },
      git: github('release', 'release', false, 'ghe.example.com/o2/r2'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr update-branch https://ghe.example.com/o2/r2/pull/7');
    expect(denied(r, 'it pushes to `release`, the default branch')).toBe(true);
    const repo = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repo?.argv[3]).toBe('ghe.example.com/o2/r2');
  });
  test('a GraphQL rebase of a pull request branch needs a bare force', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'push it');
    const rebase =
      'gh api graphql -f query=\'mutation { updatePullRequestBranch(input: {pullRequestId: "X", updateMethod: REBASE}) { clientMutationId } }\'';
    expect(denied(await bash($, rebase), 'bare force')).toBe(true);
  });
  test('a GitHub MCP commit is a push, and asks on the default branch', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const files = { owner: 'o', repo: 'r', files: [], message: 'm' };
    const r = await mcp($, 'mcp__github__push_files', { ...files, branch: 'fix/x' });
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
    const view = w.calls.find((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(view?.argv.slice(3)).toEqual([
      'o/r',
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ]);
    const main = await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' });
    expect(denied(main, 'it pushes to `main`, the default branch')).toBe(true);
    expect(denied(main, 'It writes to GitHub directly, so no review covers it.')).toBe(true);
    await say($, 'push it');
    const looked = w.calls.length;
    expect(ran(await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' }))).toBe(true);
    expect(w.calls.slice(looked).some((c) => c.argv.join(' ').startsWith('gh repo view'))).toBe(
      false,
    );
  });
  test('a hold stops a GitHub MCP pull request at every rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, "don't open a PR yet");
    expect(denied(await mcp($, 'mcp__github__create_pull_request', {}), 'held off')).toBe(true);
  });
  test('a requested pull request lets no GitHub API push through', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('push') }, git: github('fix/x') });
    await say($, 'open a PR');
    const files = { owner: 'o', repo: 'r', files: [], message: 'm', branch: 'fix/x' };
    const r = await mcp($, 'mcp__github__push_files', files);
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(await bash($, 'gh pr update-branch 7 -R o/r'), "doesn't ask for a push")).toBe(
      true,
    );
  });
  test('a GitHub MCP push asks at the default setting', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__create_or_update_file', { branch: 'fix/x' });
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, '"Push `fix/x` to `origin`?"')).toBe(true);
  });
  test('a package publish is the release step', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'pnpm -r publish'), "doesn't ask for a release")).toBe(true);
    expect(denied(await bash($, 'pnpm exec oakum release'), 'a release')).toBe(true);
    expect(ran(await bash($, 'npm publish --dry-run'))).toBe(true);
    await say($, 'publish it');
    expect(ran(await bash($, 'pnpm -r publish'))).toBe(true);
  });
  test('a publish below the rung runs, noted; a subagent is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    const r = await bash($, 'cargo publish');
    expect(has(contextOf(r), 'ran a release without asking')).toBe(true);
    const sub = await bash($, 'npm publish', { agentId: 'sub-1' });
    expect(denied(sub, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('marking a pull request ready is the pull request step', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'gh pr ready 119'), "doesn't ask for a pull request")).toBe(true);
    const draft = { owner: 'o', repo: 'r', pullNumber: 119, draft: false };
    const mcpReady = await mcp($, 'mcp__github__update_pull_request', draft);
    expect(denied(mcpReady, "doesn't ask for a pull request")).toBe(true);
    expect(ran(await bash($, 'gh pr ready 119 --undo'))).toBe(true);
    await say($, 'mark it ready for review');
    expect(ran(await bash($, 'gh pr ready 119'))).toBe(true);
  });
  test('a GitHub MCP write from a subagent is refused', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'ship it');
    const r = await mcp($, 'mcp__github__create_pull_request', {}, { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  const unreadDefaults: [Partial<Run> | 'reject', string][] = [
    [{ exitCode: 1, stderr: 'HTTP 404' }, 'looking up the default branch failed (HTTP 404)'],
    [{ stdout: '\n' }, 'looking up the default branch printed nothing'],
    ['reject', 'looking up the default branch failed'],
  ];
  for (const [answer, why] of unreadDefaults) {
    test(`a GitHub push asks when ${why}`, async ($, on) => {
      fakeWorld(on, {
        settings: { local: stops('never stop') },
        git: (a) => (a.startsWith('gh repo view') && answer !== 'reject' ? answer : null),
        reject: (a) => answer === 'reject' && a.startsWith('gh repo view'),
      });
      await say($, 'fix the parser');
      const push = { owner: 'o', repo: 'r', branch: 'fix/x' };
      expect(denied(await mcp($, 'mcp__github__push_files', push), why)).toBe(true);
    });
  }
  test('a forced ref update needs a bare force, not a push request', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'push it');
    const force = 'gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true -f sha=abc';
    const r = await bash($, force);
    expect(denied(r, "doesn't ask for a bare force")).toBe(true);
    expect(denied(r, '"Force-push `fix/x` to `origin` without a lease?"')).toBe(true);
    await say($, 'force push it without a lease');
    expect(ran(await bash($, force))).toBe(true);
  });
  test('a GitHub MCP merge without a number asks where a release could follow', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 });
    expect(denied(r, 'does not name the pull request by number and repository')).toBe(true);
    await say($, 'merge it');
    expect(ran(await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 }))).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ').startsWith('gh pr view'))).toBe(false);
  });
  test('a GitHub MCP call a newer message overtakes does not run', async ($, on) => {
    let typed = false;
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      settingsRead: () => {
        if (typed) return;
        typed = true;
        void say($, "actually, don't open it yet");
      },
    });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__create_pull_request', {});
    expect(denied(r, 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
  });
  test('a gh api push to a feature branch runs below the rung, noted', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh api -X PUT repos/o/r/contents/a.md -f branch=fix/x -f message=m');
    expect(has(contextOf(r), 'ran a push without asking')).toBe(true);
  });
  test('gh api writes are judged by endpoint', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    expect(
      denied(
        await bash($, 'gh api -X PUT repos/{owner}/{repo}/pulls/116/merge'),
        "doesn't ask for a merge",
      ),
    ).toBe(true);
    expect(
      denied(
        await bash($, 'gh api repos/{owner}/{repo}/contents/a.md -X PUT -f branch=main'),
        'it pushes to `main`, the default branch',
      ),
    ).toBe(true);
    expect(denied(await bash($, 'gh api graphql -f query="$Q"'), 'Write the query out')).toBe(true);
    expect(ran(await bash($, 'gh api repos/{owner}/{repo}/pulls/116'))).toBe(true);
  });
  test('the project file cannot stop later than the user', async ($, on) => {
    fakeWorld(on, { settings: { project: stops('never stop') } });
    await say($, 'fix the parser');
    expect(denied(await bash($, 'git push'), "doesn't ask for a push")).toBe(true);
  });
  test('settings that cannot be read stop before every step', async ($, on) => {
    fakeWorld(on, { settings: { project: 'throw', local: stops('never stop') } });
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(denied(r, 'could not read .claude/settings.json: ')).toBe(true);
    expect(denied(r, 'settings unreadable, so the gate stops before every step')).toBe(true);
    expect(denied(r, "doesn't ask for a push")).toBe(true);
  });
  test('an unreadable local file is named as the one that failed', async ($, on) => {
    fakeWorld(on, { settings: { local: 'throw' } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore.unreadable).toContain('.claude/settings.local.json: ');
    expect(status.stopBefore.from).toBe('unreadable settings');
    expect(
      denied(await bash($, 'gh pr create'), 'could not read .claude/settings.local.json'),
    ).toBe(true);
  });
  test('a held message still runs what it asks for', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "push it; don't open a PR yet");
    expect(ran(await bash($, 'git push'))).toBe(true);
    expect(denied(await bash($, 'gh pr create'), 'held off (')).toBe(true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect([status.stopBefore.held, status.mayPush, status.mayOpenPr]).toEqual([true, true, false]);
  });
  test('a commit rung asks before a reviewed commit, and a yes commits', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, "doesn't ask for a commit")).toBe(true);
    expect(denied(r, '"Commit the changes to `fix/x`?"')).toBe(true);
    await ($ as any).turn.complete({
      answer: 'Reviewed and clean. Commit the changes to `fix/x`?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a hold does not stop a commit', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, "don't push yet");
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('a hold makes every step ask until a message asks for one', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') } }));
    await say($, "don't push yet");
    expect(denied(await bash($, 'git push'), 'held off (')).toBe(true);
    await say($, 'rename the helper');
    expect(denied(await bash($, 'gh pr create'), 'held off (')).toBe(true);
    await say($, 'push it');
    expect(ran(await bash($, 'git push'))).toBe(true);
    await say($, 'rename it back');
    expect(ran(await bash($, 'gh pr create'))).toBe(true);
  });
  test('a subagent is refused at every rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'ship it');
    const r = await bash($, 'gh pr create --fill', { agentId: 'sub-1' });
    expect(denied(r, 'subagents do not commit, push, open, merge')).toBe(true);
  });
  test('the status tool reports what may run and why', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('open PR') } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toEqual({
      stopBefore: 'open PR',
      source: 'local',
      from: '.claude/settings.local.json',
      held: false,
      heldBy: null,
    });
    await say($, 'anything else before we merge?');
    const held = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(held.stopBefore).toMatchObject({
      held: true,
      heldBy: { step: 'merge', how: 'mentioned' },
    });
    expect([status.mayCommit, status.mayPush, status.mayOpenPr]).toEqual([true, true, false]);
  });
  test('the status tool says a commit may not run at a commit rung', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await say($, 'fix the parser');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect([status.mayCommit, status.mayPush]).toEqual([false, false]);
  });
  test('only the user changes it', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.stopBefore',
      value: 'never stop',
      previous: 'push',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
    expect(await $.config.set({ ...change, origin: { kind: 'composer' } })).toEqual({
      value: 'never stop',
    });
  });
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

describe('the leg time budget', () => {
  test('a leg past its budget asks the session to stop it, and is capped, not dropped', async ($, on) => {
    const w = fakeWorld(on);
    const id = await legUnderWay($);
    expect(w.timers?.map((t) => t.ms)).toEqual([30 * 60_000]);
    w.timers?.[0]?.fire();
    await settle();
    const asked = (w.prompts ?? []).filter((p) => p.includes('past its 30-minute budget'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`(agent ${id})`);
    expect(asked[0]).toContain('TaskStop');
    await finishLeg($, id, true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([
      `review-cycle:code-reviewer (agent ${id}): still running after 30 minutes`,
    ]);
    expect(status.droppedReviews).toEqual([]);
  });
  test('a review-pr leg, which counts toward nothing, still gets a budget', async ($, on) => {
    const w = fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await legUnderWay($);
    expect(w.timers?.map((t) => t.ms)).toEqual([30 * 60_000]);
  });
  test('a leg that finished in time is not capped when its timer fires', async ($, on) => {
    const w = fakeWorld(on);
    const id = await legUnderWay($);
    await finishLeg($, id, false);
    w.timers?.[0]?.fire();
    await settle();
    expect((w.prompts ?? []).filter((p) => p.includes('budget'))).toEqual([]);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
  test('a refused request to stop the leg is recorded', async ($, on) => {
    const w = fakeWorld(on, { submitFails: true });
    const id = await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toContain(
      `review-cycle:code-reviewer (agent ${id}): the request to stop it was refused (refused)`,
    );
  });
  test("a new cycle's scratch call clears the last cycle's capped legs even when it fails", async ($, on) => {
    const w = fakeWorld(on, { fail: (a) => a.startsWith('mktemp -d') });
    await ($ as any).session.start({ source: 'startup' });
    await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
  test("a new cycle's scratch directory clears the last cycle's capped legs", async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) => (a.startsWith('mktemp -d') ? { stdout: '/tmp/review-cycle.abc123\n' } : null),
    });
    await ($ as any).session.start({ source: 'startup' });
    await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
});

describe('reviewer containment', () => {
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
  test("a reviewer's command that changes the repository is reported", async ($, on) => {
    const w = fakeWorld(on);
    // As `--show-scope -z` prints it: scope, then key and value, each ended by NUL.
    let config = 'local\0core.bare\nfalse\0local\0x.demo\none\ntwo\0';
    let global = 'global\0user.name\nme\0';
    let staged = 'a'.repeat(40);
    let branch = 'refs/heads/main\n';
    w.git = (a) => {
      if (a === 'git config --list --show-scope -z') return { stdout: `${global}${config}` };
      if (a.includes('git ls-files -s')) return { stdout: staged };
      if (a === 'git symbolic-ref -q HEAD') return { stdout: branch };
      return null;
    };
    w.shell = (c) => {
      if (c.startsWith('sed')) w.work['a.ts'] = 'two';
      if (c.startsWith('git config user.email')) config += 'local\0user.email\nx@y\0';
      if (c.startsWith('git add')) staged = 'b'.repeat(40);
      if (c.startsWith('git switch')) branch = 'refs/heads/scratch\n';
      if (c.startsWith('git reset')) w.head = 'd'.repeat(40);
      if (c.startsWith('git config --global')) global = 'global\0user.name\nyou\0';
      if (c.startsWith('git config x.demo')) config = config.replace('two', 'three');
    };
    const leg = await legUnderWay($);
    const first = await bash($, "sed -i '' s/one/two/ a.ts", { agentId: leg });
    expect(ran(first)).toBe(true);
    expect(has(first.context ?? [], 'the working tree of the repository under review')).toBe(true);
    // The gate's own note on the same call survives beside the reviewer's.
    expect(has(first.context ?? [], "could not read the user's shell aliases")).toBe(true);
    const clean = await bash($, 'cp -r . /tmp/copy', { agentId: leg });
    expect(ran(clean) && (clean.context ?? []).length === 0).toBe(true);
    for (const c of [
      'git config --global user.name you',
      'git config user.email x@y',
      'git config x.demo one',
      'git add a.ts',
      'git switch -c scratch',
    ]) {
      await bash($, c, { agentId: leg });
    }
    await bash($, 'git reset --soft HEAD~1', { agentId: leg });
    expect(await reviewerChanges($)).toEqual([
      "review-cycle:code-reviewer: the working tree changed while `sed -i '' s/one/two/ a.ts` ran",
      'review-cycle:code-reviewer: the local git config changed while `git config user.email x@y` ran',
      'review-cycle:code-reviewer: the local git config changed while `git config x.demo one` ran',
      'review-cycle:code-reviewer: the staged content changed while `git add a.ts` ran',
      'review-cycle:code-reviewer: HEAD changed while `git switch -c scratch` ran',
      'review-cycle:code-reviewer: HEAD changed while `git reset --soft HEAD~1` ran',
    ]);
  });
  test("the main session's commands are not compared", async ($, on) => {
    const w = fakeWorld(on);
    w.shell = () => {
      w.work['a.ts'] = 'two';
    };
    const r = await bash($, 'echo hi > a.ts');
    expect(ran(r) && !has(r.context ?? [], 'of the repository under review changed')).toBe(true);
    expect(await reviewerChanges($)).toEqual([]);
  });
  test('a working tree that cannot be built leaves the other parts compared', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    let config = 'local\0core.bare\nfalse\0';
    w.git = (a) => (a === 'git config --list --show-scope -z' ? { stdout: config } : null);
    w.fail = (a) => a === 'git add -A';
    w.shell = () => {
      config += 'local\0user.email\nx@y\0';
    };
    await bash($, 'git config user.email x@y', { agentId: leg });
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: the local git config changed while `git config user.email x@y` ran',
      'review-cycle:code-reviewer: could not check the working tree (git add -A failed: fatal: injected) while `git config user.email x@y` ran',
    ]);
  });
  test('an unreadable part is said, and the readable parts are still compared', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    let reads = 0;
    // Readable before the command, unreadable after it.
    w.fail = (a) => a === 'git rev-parse --verify -q HEAD' && ++reads > 1;
    w.shell = () => {
      w.work['a.ts'] = 'two';
    };
    const r = await bash($, 'ls', { agentId: leg });
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
    expect(await reviewerChanges($)).toEqual([
      'review-cycle:code-reviewer: the working tree changed while `ls` ran',
      'review-cycle:code-reviewer: could not check HEAD while `ls` ran',
    ]);
  });
  test('an unreadable HEAD is said, not reported as a change', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    w.fail = (a) => a === 'git rev-parse --verify -q HEAD';
    const r = await bash($, 'ls', { agentId: leg });
    expect(ran(r)).toBe(true);
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
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
  test('a background command is said to be checked only until it returns', async ($, on) => {
    fakeWorld(on);
    const leg = await legUnderWay($);
    const r = await bash($, 'pnpm test', { agentId: leg, run_in_background: true });
    expect(has(r.context ?? [], 'runs in the background')).toBe(true);
  });
  test('a detached or unborn HEAD is read, not said unreadable', async ($, on) => {
    const w = fakeWorld(on);
    const leg = await legUnderWay($);
    for (const [argv, why] of [
      ['git symbolic-ref -q HEAD', 'detached'],
      ['git rev-parse --verify -q HEAD', 'unborn'],
    ] as const) {
      w.git = (a) => (a === argv ? { exitCode: 1, stdout: '' } : null);
      const r = await bash($, `echo ${why}`, { agentId: leg });
      expect(ran(r) && !has(r.context ?? [], 'could not check')).toBe(true);
    }
    // Both reads exiting 1 is no state git has: a read that failed.
    w.git = (a) =>
      a.startsWith('git rev-parse --verify -q HEAD') || a === 'git symbolic-ref -q HEAD'
        ? { exitCode: 1, stdout: '' }
        : null;
    const r = await bash($, 'ls', { agentId: leg });
    expect(has(r.context ?? [], 'could not check whether this command changed HEAD')).toBe(true);
  });
  for (const [argv, part] of [
    ['ls-files -s', 'the staged content'],
    ['git config --list --show-scope', 'the local git config'],
  ] as const) {
    test(`unreadable ${part} is said`, async ($, on) => {
      const w = fakeWorld(on);
      const leg = await legUnderWay($);
      w.fail = (a) => a.includes(argv);
      const r = await bash($, 'ls', { agentId: leg });
      expect(has(r.context ?? [], `could not check whether this command changed ${part}`)).toBe(
        true,
      );
    });
  }
});
