// A scripted git: trees are maps of path to content, the working tree is
// `world.work`, and HEAD points at a commit whose tree is `world.commits[head]`.
// write-tree names the working tree by its content, so an edit made between
// two events yields a different tree, as it would in git.
export type World = {
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
  // Makes $.process.run itself reject, as a timeout does, or with
  // `rejectWith`'s message, as a command that cannot start does.
  reject?: (argv: string) => boolean;
  rejectWith?: string;
  // What $.session.messages() answers; an empty transcript when unset.
  messages?: unknown;
  // Answers a git call itself, ahead of the scripted git.
  git?: (argv: string) => Partial<Run> | null | undefined;
  // Answers an Edit or Write itself, after it wrote `files`; null keeps the
  // ordinary result.
  tool?: (path: string, files: Record<string, string>) => object | null;
  // Runs as the Skill tool itself, as the engine expands the skill.
  skillRun?: () => Promise<unknown>;
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
  // Every context block a hook attached to a prompt.
  contexts?: string[];
  // A prompt with this text is refused beneath the plugin.
  dropText?: string;
  // Every status line the plugin set; undefined clears it.
  statuses?: (string | undefined)[];
  // Every tool the plugin registered, by short name.
  registered?: string[];
  // Makes registering this tool fail.
  registerFails?: string;
  // Each armed clock.after: its wait in ms, and what fires it.
  timers?: { ms: number; fire: () => void }[];
  // What $.clock.now answers; NOW unless a test moves it.
  now?: number;
  // Environment variables beyond SHELL and HOME.
  env?: Record<string, string>;
  // What $.settings.read answers, by source; 'throw' makes that read reject.
  settings?: Partial<Record<'project' | 'local', object | 'throw'>>;
  // Runs on every settings read, before it answers.
  settingsRead?: () => void | Promise<void>;
  // The Bash tool reports the command as failed.
  bashFails?: boolean;
  // Every line the plugin logged.
  logs?: string[];
  // What a reload left in the host's store, which the load's first read of it
  // gets; 'unreadable' refuses that read. Unset, the store starts empty.
  kept?: { record: unknown } | 'unreadable';
  // The load has read its record, so seeding one now would go unread.
  keptRead?: boolean;
};

export type Run = { exitCode: number; stdout: string; stderr: string };
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

export function treeId(w: World, files: Record<string, string>): string {
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
export function blobOf(content: string): string {
  let h = 0;
  for (const ch of content) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(5);
}

function ok(stdout = '') {
  return { value: { exitCode: 0, stdout, stderr: '' } };
}

const worlds = new WeakMap<object, World>();

export function fakeWorld(on: any, setup: Partial<World> = {}): World {
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
  worlds.set(on, w);
  // The kit keeps one store for a file's tests, where a save an earlier test
  // left running can land after this one starts, so the load's first read of
  // the gate's record answers from the world.
  on('state.get', ($: unknown, e: { key: string }, next: any) => {
    if (e.key !== 'gate' || w.keptRead) return next(e);
    w.keptRead = true;
    if (w.kept === 'unreadable') return { deny: 'store unreadable' };
    if (w.kept === undefined) return { value: { version: 0 } };
    return { value: { value: { shape: 'gate-12', value: w.kept.record }, version: 1 } };
  });
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
      if (w.reject?.(a)) return { deny: w.rejectWith ?? 'timed out' };
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
      if (e.tool === 'Skill' && w.skillRun) return w.skillRun().then(() => ({ result: 'loaded' }));
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
  on('clock.now', () => ({ value: w.now ?? NOW }));
  on(
    'clock.after',
    ($: unknown, e: { ms: number }) =>
      new Promise((resolve) => {
        (w.timers ??= []).push({ ms: e.ms, fire: () => resolve({ value: undefined }) });
      }),
  );
  on('prompt.submit', async ($: unknown, e: { text: string; context?: string[] }) => {
    if (w.submitFails && e.text.startsWith('review-cycle:')) {
      await w.submitGate;
      return { drop: 'refused' };
    }
    if (e.text === w.dropText) return { drop: 'refused' };
    (w.prompts ??= []).push(e.text);
    (w.contexts ??= []).push(...(e.context ?? []));
    return { text: e.text };
  });
  on('ui.status', ($: unknown, e: { text: string | undefined }) => {
    (w.statuses ??= []).push(e.text);
    return { value: undefined };
  });
  on('agent.spawn', ($: unknown, e: { tool_use_id: string }) => ({
    model: 'test',
    agentId: `leg-${e.tool_use_id}`,
  }));
  on('session.start', () => ({ cwd: '/repo' }));
  on('turn.complete', ($: unknown, e: { answer: string }) => ({ text: e.answer }));
  on('config.set', ($: unknown, e: { value: unknown }) => ({ value: e.value }));
  on('session.messages', () => ({ value: w.messages ?? [] }));
  on('settings.read', async ($: unknown, e: { source?: 'project' | 'local' }) => {
    await w.settingsRead?.();
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

// consent.ts's NO_GRANT, as a kept record holds it.
export const NO_GRANT_KEPT = {
  commit: false,
  finish: [],
  push: 'none',
  pushNamed: [],
  pr: false,
  merge: false,
  mergeNamed: [],
  autoMerge: false,
  readyNamed: [],
  readyRelease: false,
  readyMain: false,
  mergeStack: [],
  approve: false,
  release: false,
  releaseNamed: [],
  comment: false,
};

export const RECEIPT = 'execution: npm test - ok\nattempted-but-failed: none\n\nNo findings.';

export async function say($: any, text: string, kind = 'composer') {
  await $.prompt.submit({ text, origin: { kind }, wait: false });
}

// A message typed while the agent's turn is still running.
export async function queue($: any, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, turnId: 't' });
}

let spawns = 0;

export function countSpawn(): void {
  spawns++;
}

// Spawns a leg and completes it; `during` runs while the leg is running.
// `answers` completes it once per answer, as a leg reporting more than once does.
export async function review(
  $: any,
  opts: {
    type?: string;
    answer?: string;
    answers?: string[];
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
  for (const [i, answer] of (opts.answers ?? [opts.answer ?? RECEIPT]).entries()) {
    await $.turn.complete({
      answer,
      durationMs: 1,
      isAborted: false,
      turnId: `turn-${id}-${i}`,
      agentId: r.agentId,
      reason: 'answer',
    });
  }
}

// A leg still under way: spawned, not yet complete.
export async function legUnderWay($: any, type = 'review-cycle:code-reviewer'): Promise<string> {
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

export async function bash($: any, command: string, extra: Record<string, unknown> = {}) {
  return $.tool.call({ tool: 'Bash', command, ...extra });
}

export function has(context: string[], text: string): boolean {
  return context.some((c) => c.includes(text));
}

export function ran(r: unknown): boolean {
  return typeof r === 'object' && r !== null && 'result' in r;
}

export function denied(r: unknown, text: string): boolean {
  return (
    typeof r === 'object' &&
    r !== null &&
    'deny' in r &&
    typeof r.deny === 'string' &&
    r.deny.includes(text)
  );
}

export function contextOf(r: unknown): string[] {
  return (r as { context?: string[] }).context ?? [];
}

// A store per test, and a fixed clock: 2026-09-26. `clock.sleep` never ends
// unless `hangFirstGet`, where it ends at once so the record waiting on the
// stuck one goes ahead without a real wait.
export function fakeStore(
  on: any,
  opts: {
    refuse?: string;
    refuseFirst?: number;
    refuseWhere?: (key: string, value: any) => boolean;
    readFails?: string;
    hangFirstGet?: boolean;
  } = {},
): Map<string, unknown> {
  const store = new Map<string, unknown>();
  let gets = 0;
  let sets = 0;
  on('store.get', ($: unknown, e: { key: string }) => {
    if (opts.hangFirstGet && gets++ === 0) return pending();
    return opts.readFails ? { deny: opts.readFails } : { value: structuredClone(store.get(e.key)) };
  });
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    if (opts.refuse) return { deny: opts.refuse };
    if (sets++ < (opts.refuseFirst ?? 0)) return { deny: 'disk full' };
    if (opts.refuseWhere?.(e.key, e.value)) return { deny: 'disk full' };
    store.set(e.key, structuredClone(e.value));
    return { value: undefined };
  });
  on('store.keys', () => ({ value: [...store.keys()] }));
  on('store.delete', ($: unknown, e: { key: string }) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on('clock.sleep', () => (opts.hangFirstGet ? { value: undefined } : pending()));
  return store;
}

export const NOW = Date.UTC(2026, 8, 26, 12);

export function pending(): Promise<never> {
  return new Promise<never>((resolve) => {
    void resolve;
  });
}

export function keptRecord(over: Record<string, unknown>) {
  return {
    reviews: [],
    legs: [],
    message: {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: NO_GRANT_KEPT,
      pointed: { named: [], answer: [], unplaced: false },
    },
    messages: 0,
    lastAnswer: '',
    misses: [],
    dropped: [],
    capped: [],
    scratch: [],
    reviewerChanges: [],
    hold: null,
    mandate: null,
    roundsFrom: 0,
    pushed: [],
    reviewing: null,
    ...over,
  };
}

// What a reload finds: the host's copy of what the gate remembered, read once.
export function reloadInto(on: any, kept: unknown) {
  const w = worlds.get(on);
  if (!w) throw new Error('reloadInto needs fakeWorld(on) first');
  if (w.keptRead) throw new Error('reloadInto after the gate already read its record');
  w.kept = { record: kept };
}

export async function endTurn($: any, reason = 'answer', answer = 'done') {
  await $.turn.complete({
    answer,
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: 'main',
    reason,
  });
  // Settles work a hook left pending after returning its result.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export async function skill($: any, name: string, agentId?: string) {
  await $.tool.call({ tool: 'Skill', skill: name, ...(agentId ? { agentId } : {}) });
}

export async function startSession($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true });
}

export async function settle() {
  for (let i = 0; i < 500; i++) await Promise.resolve();
}
export async function finishLeg($: any, agentId: string, isAborted: boolean) {
  await $.turn.complete({
    answer: RECEIPT,
    durationMs: 1,
    isAborted,
    turnId: `turn-${agentId}`,
    agentId,
    reason: isAborted ? 'aborted' : 'answer',
  });
}
export function statusOf(r: unknown) {
  return JSON.parse((r as { result: string }).result);
}

// One model response, its usage as the engine reports it beneath every hook.
export const answered = (usage: Record<string, number> | null): any =>
  async function* (_$: unknown, e: { turnId: string; index: number }) {
    yield* [];
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: usage && { ...usage, model: 'claude-opus-5-5' },
    };
  };
export async function step($: any, agentId?: string) {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId });
  let r = await s.next();
  while (!r.done) r = await s.next();
  return r.value;
}
export const USAGE = {
  input_tokens: 2,
  output_tokens: 300,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 5000,
};

export async function reviewerChanges($: any): Promise<string[]> {
  const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
  return JSON.parse((r as { result: string }).result).reviewerChanges;
}

export function stops(stopBefore: string) {
  return { pluginConfigs: { 'review-cycle': { options: { stopBefore } } } };
}

export const updating = (prUpdates: string) => ({
  pluginConfigs: { 'review-cycle': { options: { prUpdates } } },
});

export const REMOTE = '/remote.git';
export const DRY_FLAGS = '--dry-run --porcelain --no-verify --no-quiet --recurse-submodules=no';
export const NEW_BRANCH = '*\tHEAD:refs/heads/fix/x\t[new branch]';
// The remote as the gate's always-ask check sees it: what git's dry run
// prints for each push, keyed by the words after `push` ('fail' for a dry run
// that fails), and the remote's default branch (null when unreadable).
export function remoteSide(
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
// branch, or fails when `head` is 'fail'; the checkout is on that branch.
export function github(
  head: string,
  defaultBranch = 'main',
  fork = false,
  repo = 'github.com/o/r',
  mergeState = 'BLOCKED',
): (a: string) => Partial<Run> | null {
  return (a) => {
    if (a === 'git symbolic-ref --quiet --short HEAD' && head !== 'fail') {
      return { stdout: `${head}\n` };
    }
    if (a.startsWith('gh pr view')) {
      if (head === 'fail') return { exitCode: 1, stderr: 'no pull requests found for branch "x"' };
      if (a.includes('mergeStateStatus')) {
        const n = /gh pr view (\d+)/.exec(a)?.[1] ?? '7';
        return { stdout: `https://${repo}/pull/${n} OPEN ${mergeState}\n` };
      }
      // The update-branch lookup's jq prints fork, pull request URL and head branch.
      const update = a.includes('isCrossRepository');
      return { stdout: update ? `${fork} https://${repo}/pull/7 ${head}\n` : `${head}\n` };
    }
    if (a.startsWith('gh repo view') && a.includes('.url')) return { stdout: `https://${repo}\n` };
    if (a.startsWith('gh repo view')) return { stdout: `${defaultBranch}\n` };
    return null;
  };
}

// On main, merging pull requests headed by fix/x.
export function onMain(a: string): Partial<Run> | null {
  return a === 'git symbolic-ref --quiet --short HEAD' ? { stdout: 'main\n' } : github('fix/x')(a);
}

// A world on fix/x whose next Bash call moves origin/fix/x, as a push does.
export function pushing(setup: Partial<World>): Partial<World> {
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
