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
  // Makes $.process.run itself reject, as a timeout does, or with
  // `rejectWith`'s message, as a command that cannot start does.
  reject?: (argv: string) => boolean;
  rejectWith?: string;
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
  // The model check's reply text; 'error', 'aborted' or 'throw' fail the call.
  model?: string;
  // Its reply to whether the answer offered a merge's pull request; 'error' or 'throw' fails it.
  target?: string;
  // Runs while the model check is asked.
  onModel?: () => void;
  // Each prompt the model check was sent.
  modelPrompts?: string[];
  // Each call's instructions and token budget, by prompt.
  modelCalls?: { prompt: string; system: string; maxTokens: number }[];
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
  on('model.complete', ($: unknown, e: { prompt: string; maxTokens?: number; system?: string }) => {
    (w.modelPrompts ??= []).push(e.prompt);
    (w.modelCalls ??= []).push({
      prompt: e.prompt,
      system: e.system ?? '',
      maxTokens: e.maxTokens ?? 0,
    });
    w.onModel?.();
    const usage = { input_tokens: 0, output_tokens: 0 };
    if (e.prompt.startsWith("The agent's answer ends:")) {
      if (w.target === 'throw') return { deny: 'model blocked' };
      if (w.target === 'error') {
        return {
          value: {
            isAnswered: false,
            reason: 'api-error',
            status: 529,
            error: 'overloaded',
            usage,
          },
        };
      }
      return { value: { isAnswered: true, text: w.target ?? OFFERED, usage } };
    }
    if (w.model === 'throw') return { deny: 'model blocked' };
    if (w.model === 'aborted') return { value: { isAnswered: false, reason: 'aborted', usage } };
    if (w.model === 'error') {
      return {
        value: {
          isAnswered: false,
          reason: 'api-error',
          status: 529,
          error: 'overloaded',
          usage,
        },
      };
    }
    return { value: { isAnswered: true, text: w.model ?? NOTHING_ASKED, usage } };
  });
  return w;
}

// The model check's answers: nothing asked, and a push asked for now.
const NOTHING_ASKED = '{"steps": {}, "quote": ""}';
// Its answers on a merge's pull request: offered by the answer, or only mentioned.
const OFFERED = '{"offers": true, "sure": true}';

// consent.ts's NO_GRANT, as a kept record holds it.
const NO_GRANT_KEPT = {
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
  comment: false,
};
const MENTIONED = 'The offer names no PR.\n\n{"offers": false, "sure": true}';
const verdictFor = (step: string, quote: string, flags = {}) =>
  JSON.stringify({
    steps: { [step]: { now: true, condition: false, declined: false, ...flags } },
    quote,
  });

const RECEIPT = 'execution: npm test - ok\nattempted-but-failed: none\n\nNo findings.';

async function say($: any, text: string, kind = 'composer') {
  await $.prompt.submit({ text, origin: { kind }, wait: false });
}

// A message typed while the agent's turn is still running.
async function queue($: any, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, turnId: 't' });
}

let spawns = 0;

// Spawns a leg and completes it; `during` runs while the leg is running.
// `answers` completes it once per answer, as a leg reporting more than once does.
async function review(
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
  test('a --continue no reviewer saw is refused, judged on a scratch index', async ($, on) => {
    fakeWorld(on);
    await say($, 'finish the rebase');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, 'never reviewed: a.ts')).toBe(true);
    expect(denied(r, 'then continue')).toBe(true);
  });
  test('a reviewed --continue goes through, its add replayed on a scratch index', async ($, on) => {
    const w = fakeWorld(on);
    await review($);
    await say($, 'finish the rebase');
    expect(ran(await bash($, 'git add -A && GIT_EDITOR=true git merge --continue'))).toBe(true);
    const add = w.calls.find((c) => c.argv.join(' ') === 'git -C . add -A');
    expect(add?.env?.GIT_INDEX_FILE).toBe('/tmp/scratch-index');
  });
  test('a --continue is judged against HEAD, which the rebase already picked', async ($, on) => {
    const head = 'c'.repeat(40);
    const parent = 'b'.repeat(40);
    fakeWorld(on, {
      work: { 'a.ts': 'one' },
      commits: { [head]: { 'a.ts': 'one' }, [parent]: { 'a.ts': 'zero' } },
      parents: { [head]: parent },
    });
    await say($, 'finish the rebase');
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('a --continue with unresolved conflicts names them', async ($, on) => {
    let judging = false;
    fakeWorld(on, {
      git: (a) =>
        judging && a === 'git write-tree'
          ? {
              exitCode: 128,
              stderr: `a.ts: unmerged (${'e'.repeat(40)})\nfatal: git-write-tree: error building trees`,
            }
          : null,
    });
    await review($);
    await say($, 'finish the rebase');
    judging = true;
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, 'conflicts are still unresolved, starting with a.ts (')).toBe(true);
    expect(denied(r, '`git add` or `git rm` them')).toBe(true);
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
        'so it is refused. Tell the user what failed and stop; suggest running the step outside the gate only if they ask.',
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
  // The working tree, which the review covers, holds `one`.
  const MID = 'b'.repeat(40);
  const resolved = {
    [HEAD]: { 'a.ts': 'zero' },
    [MID]: { 'a.ts': 'one' },
    [THEIRS]: { 'a.ts': 'two' },
  };
  test("a --continue's resolution a pre-commit hook changed is reported", async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} commit (cherry-pick): t1`];
      },
    });
    await review($);
    await say($, 'finish it');
    const context = contextOf(await bash($, 'GIT_EDITOR=true git cherry-pick --continue'));
    expect(has(context, 'A pre-commit hook may have changed it')).toBe(true);
  });
  test("a rebase's changed resolution is reported without blaming a pre-commit hook", async ($, on) => {
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [`${THEIRS} rebase (continue): t1`];
      },
    });
    await review($);
    await say($, 'finish it');
    const context = contextOf(await bash($, 'GIT_EDITOR=true git rebase --continue'));
    expect(
      has(
        context,
        "records content no reviewer saw (edited after the last review: a.ts). It changed after the gate's check.",
      ),
    ).toBe(true);
    expect(has(context, 'pre-commit')).toBe(false);
  });
  test('the picks a --continue replays after its resolution are not reported', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      ...quiet,
      commits: resolved,
      shell(this: World) {
        this.head = THEIRS;
        this.headLog = [
          `${THEIRS} rebase (finish): returning to refs/heads/topic`,
          `${THEIRS} rebase (pick): t2`,
          `${MID} rebase (continue): t1`,
        ];
      },
    });
    await review($);
    await say($, 'finish it');
    expect(contextOf(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toEqual([]);
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
  test('a gh stack rebase or sync is watched as a history step, so its replayed commits are not reported', async ($, on) => {
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
          `${THEIRS} rebase (finish): returning to refs/heads/topic`,
          `${THEIRS} rebase (pick): local`,
          `${UP} rebase (start): checkout ${UP}`,
        ];
      },
    });
    await say($, 'force push with lease');
    expect(contextOf(await bash($, 'gh stack rebase --upstack'))).toEqual([]);
    expect(contextOf(await bash($, 'gh stack sync'))).toEqual([]);
    expect(contextOf(await bash($, 'gh -R o/r stack sync'))).toEqual([]);
    expect(
      denied(await bash($, 'gh stack rebase && ./deploy.sh'), 'only as their own command'),
    ).toBe(true);
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
    expect(ran(await monitor('tail -f log'))).toBe(true);
    expect(ran(await monitor('claude plugin uninstall --help'))).toBe(true);
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
  test('an entry recorded is read back unchanged until the file is, then with ids to diff', async ($, on) => {
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
      matched: 1,
      reopened: 0,
      unreadable: 0,
      entries: [
        {
          ...DEFERRED,
          id: expect.stringMatching(/^[0-9a-f]{8}$/),
          date: '2026-09-26',
          changed: false,
          stale: false,
        },
      ],
    });
    w.work['a.ts'] = 'two';
    const after = JSON.parse(await ledger($)).entries[0];
    expect(after).toMatchObject({
      blob: blob.slice(0, 12),
      current: blobOf('two').slice(0, 12),
      changed: true,
    });
    delete w.work['a.ts'];
    expect(JSON.parse(await ledger($)).entries[0]).toMatchObject({ current: null, changed: true });
    expect(JSON.parse(await ledger($, { paths: ['b.ts'] }))).toEqual({
      total: 1,
      matched: 0,
      reopened: 0,
      unreadable: 0,
      entries: [],
    });
    expect(JSON.parse(await ledger($, { query: 'parser' })).matched).toBe(0);
    expect(await ledger($, { query: 3 })).toBe('review-cycle ledger: `query` must be a string.');
    expect(await ledger($, { offset: -1 })).toBe(
      'review-cycle ledger: `offset` must be a whole number, 0 or more.',
    );
    expect(await ledger($, { offset: 1.5 })).toBe(
      'review-cycle ledger: `offset` must be a whole number, 0 or more.',
    );
    expect(JSON.parse(await ledger($, { offset: 0 })).total).toBe(1);
  });
  test('a long ledger is read a page at a time, as one line of JSON', async ($, on) => {
    fakeWorld(on);
    fakeStore(on);
    const reason = 'r'.repeat(300);
    const entries = Array.from({ length: 40 }, (_, i) => ({
      ...DEFERRED,
      finding: `retry ${i}`,
      reason,
    }));
    await record($, { entries });
    const raw = await ledger($, { query: 'retry' });
    expect(raw).not.toContain('\n');
    const first = JSON.parse(raw);
    expect(raw.length).toBeLessThanOrEqual(8000);
    expect(first.matched).toBe(40);
    expect(first.next).toBe(first.entries.length);
    const seen: string[] = first.entries.map((e: { id: string }) => e.id);
    for (let next = first.next; next !== undefined;) {
      const page = JSON.parse(await ledger($, { query: 'retry', offset: next }));
      seen.push(...page.entries.map((e: { id: string }) => e.id));
      next = page.next;
    }
    expect(new Set(seen).size).toBe(40);
    expect(seen).toHaveLength(40);
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

describe('a reload of the module', () => {
  test('keeps what reviewers saw in the host state', async ($, on) => {
    fakeWorld(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await review($);
    await say($, 'push it');
    await settle();
    expect(kept?.shape).toBe('gate-6');
    expect(kept?.value.reviews).toHaveLength(1);
    expect(kept?.value.legs[0]?.[1]).toMatchObject({ done: true, counted: true, spawnedAt: NOW });
    expect(kept?.value.message).toMatchObject({
      tree: expect.any(String),
      nudged: false,
      prWindow: false,
      grant: { push: 'push' },
    });
    expect(kept?.value.mandate).toBeNull();
    await say($, 'do epic cpl-czgp');
    await settle();
    expect(kept?.value.mandate).toEqual({ epic: 'cpl-czgp' });
  });

  test('a save before the session start keeps what the reload left', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    reloadInto(on, keptRecord({ reviews: [review] }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await say($, 'fix the parser');
    await settle();
    expect(kept?.value.reviews).toEqual([review]);
  });

  test('takes back a leg it was running, so its review still counts', async ($, on) => {
    const w = fakeWorld(on);
    reloadInto(on, keptRecord({ legs: [['leg-before', runningLeg(w, NOW)]] }));
    await startSession($);
    await finishLeg($, 'leg-before', false);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('takes back a finished review, so the commit goes through', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    reloadInto(on, keptRecord({ reviews: [review] }));
    await startSession($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('takes back where the rounds count from', async ($, on) => {
    fakeStore(on);
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    reloadInto(on, keptRecord({ reviews: [review, review], roundsFrom: 2 }));
    await startSession($);
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    const status = JSON.parse(r.result);
    expect(status.roundsSinceCommit).toBe(0);
  });

  test('takes back a hold, so a push the user put off still waits', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    reloadInto(on, keptRecord({ held: { step: 'push', how: 'declined' } }));
    await startSession($);
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });

  test("takes back the latest message's grant, so a step it covered still runs", async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test("takes back a kept grant's pull request, the step the reload used to refuse", async ($, on) => {
    fakeWorld(on);
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
  });

  test('takes back what the message pointed at, so an unnamed merge still runs', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, merge: true },
      pointed: { named: [], answer: ['40'], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
  });

  test('a hold kept with its message still refuses after a reload', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await say($, "don't push yet");
    await settle();
    expect(kept?.value.message.grant.push).toBe('none');
    expect(kept?.value.held).toMatchObject({ step: 'push' });
  });

  test('a message heard before the take-back applies on top of the record', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    await sayBeforeRecall($, on, { message }, "don't push yet");
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });

  test('a kept hold outlives an unrelated message heard before the take-back', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    await sayBeforeRecall($, on, { held: { step: 'push', how: 'declined' } }, 'fix the parser');
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });

  test('a kept mandate outlives an unrelated message heard before the take-back', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await sayBeforeRecall($, on, { mandate: { epic: 'cpl-czgp' } }, 'fix the parser');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test('a newer message replaces the kept grant', async ($, on) => {
    fakeWorld(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await settle();
    expect(kept?.value.message.grant.push).toBe('push');
    await say($, 'not yet');
    await settle();
    expect(kept?.value.message.grant.push).toBe('none');
  });

  test("a session's end clears the kept grant", async ($, on) => {
    fakeWorld(on);
    on('session.end', () => ({ sessionId: 's' }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'ship it and merge 12');
    await settle();
    expect(kept?.value.message.grant.pr).toBe(true);
    expect(kept?.value.message.pointed.named).toEqual(['12']);
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await settle();
    expect(kept?.value.message.grant).toEqual(NO_GRANT_KEPT);
    expect(kept?.value.message.pointed).toEqual({ named: [], answer: [], unplaced: false });
  });

  test('takes back an epic mandate, so the job keeps pushing', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    reloadInto(on, keptRecord({ mandate: { epic: 'cpl-czgp' } }));
    await startSession($);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test('takes back a scratch directory, so the sweep still removes it', async ($, on) => {
    const w = fakeWorld(on, { git: (a) => (a.startsWith('test -e') ? { exitCode: 1 } : null) });
    reloadInto(on, keptRecord({ scratch: ['/tmp/review-cycle.abc123'] }));
    await startSession($);
    await $.tool.call({ tool: 'mcp__review-cycle__sweep' });
    expect(w.calls.some((c) => c.argv.join(' ') === 'rm -rf -- /tmp/review-cycle.abc123')).toBe(
      true,
    );
  });

  test('gives a leg taken back the rest of its budget, and caps one past it', async ($, on) => {
    const w = fakeWorld(on);
    reloadInto(
      on,
      keptRecord({
        legs: [
          ['leg-young', runningLeg(w, NOW - 10 * 60_000)],
          ['leg-old', runningLeg(w, NOW - 31 * 60_000)],
          ['leg-done', { ...runningLeg(w, NOW - 40 * 60_000), done: true }],
        ],
      }),
    );
    await startSession($);
    expect(
      legTimers(w)
        .map((t) => t.ms)
        .toSorted((a, b) => a - b),
    ).toEqual([0, 20 * 60_000]);
    w.timers?.find((t) => t.ms === 0)?.fire();
    await settle();
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([
      'review-cycle:code-reviewer (agent leg-old): still running after 30 minutes',
    ]);
  });

  test('sets aside a record it cannot read, and says so', async ($, on) => {
    const w = fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    reloadInto(on, { ...keptRecord({}), legs: 'many' });
    await startSession($);
    expect(toasts).toEqual([
      'review-cycle could not read the reviews it kept, so it starts this load with none',
    ]);
    expect(legTimers(w)).toEqual([]);
  });

  for (const [name, fields] of [
    ['a review without its paths', { reviews: [{ type: 'code-reviewer', trees: ['a', 'b'] }] }],
    ['a hold on no step', { held: { step: 'tag', how: 'declined' } }],
    ['a mandate on no epic', { mandate: { epic: '' } }],
    ['a mandate that is not one', { mandate: 'cpl-czgp' }],
    ['a message without its flags', { message: {} }],
    [
      'a grant that is not one',
      {
        message: {
          tree: null,
          nudged: true,
          prWindow: false,
          grant: { ...NO_GRANT_KEPT, push: 'everything' },
          pointed: { named: [], answer: [], unplaced: false },
        },
      },
    ],
    ...(
      [
        ['no pointed', null],
        ['a pointed name that is a number', { named: [1], answer: [], unplaced: false }],
        ['a pointed without unplaced', { named: [], answer: [] }],
      ] as const
    ).map(
      ([name, pointed]) =>
        [
          name,
          {
            message: { tree: null, nudged: true, prWindow: false, grant: NO_GRANT_KEPT, pointed },
          },
        ] as const,
    ),
    ['a miss that is not one', { misses: [null] }],
    ['a rounds index past its reviews', { roundsFrom: 1 }],
    ['a rounds index below zero', { roundsFrom: -1 }],
    ['no rounds index', { roundsFrom: undefined }],
    ['no pushes', { pushed: undefined }],
    ['a push that names no commit', { pushed: [['/repo/.git\torigin/x', 'zz']] }],
    [
      'a push whose commit is not a string',
      { pushed: [['/repo/.git\torigin/x', ['a'.repeat(40)]]] },
    ],
    ['a push keyed without its repository', { pushed: [['origin/x', 'a'.repeat(40)]] }],
    ['a review skill that is not a path', { reviewing: 1 }],
  ] as const) {
    test(`sets aside a record holding ${name}`, async ($, on) => {
      fakeWorld(on);
      const toasts: string[] = [];
      on('ui.toast', ($$: unknown, e: { text: string }) => {
        toasts.push(e.text);
        return { value: undefined };
      });
      reloadInto(on, { ...keptRecord({}), ...fields });
      await startSession($);
      expect(toasts.filter((t) => t.includes('could not read the reviews it kept'))).toHaveLength(
        1,
      );
    });
  }

  test('a take-back that fails starts fresh, says so once, and keeps from then on', async ($, on) => {
    fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    let writes = 0;
    let isDenied = false;
    on('state.get', ($$: unknown, e: { key: string }, next: any) => {
      if (e.key !== 'gate' || isDenied) return next(e);
      isDenied = true;
      return { deny: 'store unreadable' };
    });
    on('state.set', ($$: unknown, e: { key: string }, next: any) => {
      if (e.key === 'gate') writes += 1;
      return next(e);
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    expect(toasts.filter((t) => t.includes('could not take back its reviews'))).toHaveLength(1);
    expect(writes).toBe(1);
  });

  test('a save that never answers times out, says so, and lets the next one through', async ($, on) => {
    const w = fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    let writes = 0;
    on('state.set', ($$: unknown, e: { key: string }, next: any) => {
      if (e.key !== 'gate') return next(e);
      writes += 1;
      return writes === 1 ? pending() : next(e);
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    for (const t of (w.timers ?? []).filter((t) => t.ms === 5000)) t.fire();
    await settle();
    expect(toasts.filter((t) => t.includes('could not keep its record'))).toHaveLength(1);
    await say($, 'and the lexer');
    await settle();
    expect(writes).toBe(2);
  });

  test('a save that timed out and lands later leaves a newer one standing', async ($, on) => {
    const w = fakeWorld(on);
    const landed: number[] = [];
    const held: (() => void)[] = [];
    on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
      if (e.key !== 'gate') return next(e);
      const go = async () => {
        const out = await next(e);
        if (out?.value?.isSet) landed.push(e.value.value.messages);
        return out;
      };
      if (held.length > 0 || landed.length > 0) return go();
      return new Promise((resolve) => {
        held.push(() => resolve(go()));
      });
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    for (const t of (w.timers ?? []).filter((t) => t.ms === 5000)) t.fire();
    await settle();
    await say($, 'and the lexer');
    await settle();
    for (const release of held) release();
    await settle();
    expect(landed.at(-1)).toBe(2);
  });

  test('saves land in order, the last one holding the latest record', async ($, on) => {
    fakeWorld(on);
    const saved: any[] = [];
    const held: (() => void)[] = [];
    on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
      if (e.key !== 'gate') return next(e);
      saved.push(e.value.value);
      if (saved.length > 1) return next(e);
      return new Promise((resolve) => {
        held.push(() => resolve(next(e)));
      });
    });
    await startSession($);
    await say($, 'fix the parser');
    await say($, 'and the lexer');
    await settle();
    for (const release of held) release();
    await settle();
    expect(saved.at(-1)?.messages).toBe(2);
  });

  test(
    'a load with the gate off keeps finished reviews and drops what only watching kept true',
    { options: { enabled: false } },
    async ($, on) => {
      const w = fakeWorld(on);
      const tree = treeId(w, w.work);
      const review = {
        type: 'review-cycle:code-reviewer',
        trees: [tree, tree],
        reviewedPaths: ['a.ts'],
      };
      const done = { ...runningLeg(w, NOW), done: true, counted: true };
      const capped = { ...runningLeg(w, NOW), capped: true };
      const miss = { message: 'ship it', offer: '', steps: ['push'], refusal: 'r' };
      reloadInto(
        on,
        keptRecord({
          reviews: [review],
          legs: [
            ['leg-running', runningLeg(w, NOW)],
            ['leg-done', done],
            ['leg-capped', capped],
          ],
          message: {
            tree,
            nudged: true,
            prWindow: true,
            grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
            pointed: { named: ['12'], answer: [], unplaced: false },
          },
          messages: 4,
          lastAnswer: 'Push it?',
          misses: [miss],
          held: { step: 'push', how: 'declined' },
          mandate: { epic: 'cpl-czgp' },
          roundsFrom: 1,
        }),
      );
      const saved: any[] = [];
      on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
        if (e.key === 'gate') saved.push(e.value?.value);
        return next(e);
      });
      await startSession($);
      expect(saved.at(-1)).toEqual(
        keptRecord({
          reviews: [review],
          legs: [
            ['leg-done', done],
            ['leg-capped', capped],
          ],
          message: {
            tree: null,
            nudged: false,
            prWindow: false,
            grant: NO_GRANT_KEPT,
            pointed: { named: [], answer: [], unplaced: false },
          },
          messages: 4,
          lastAnswer: '',
          misses: [miss],
          held: null,
          roundsFrom: 1,
        }),
      );
    },
  );

  test(
    'a load with the gate off clears a record it cannot read',
    { options: { enabled: false } },
    async ($, on) => {
      fakeWorld(on);
      reloadInto(on, { ...keptRecord({}), legs: 'many' });
      const saved: unknown[] = [];
      on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
        if (e.key === 'gate') saved.push(e.value?.value);
        return next(e);
      });
      await startSession($);
      expect(saved.at(-1)).toBeNull();
    },
  );

  test('a review kept across a switch-off still covers its commit', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    // What an off-load leaves, as the test above pins it.
    reloadInto(
      on,
      keptRecord({
        reviews: [review],
        message: {
          tree: null,
          nudged: false,
          prWindow: false,
          grant: NO_GRANT_KEPT,
          pointed: { named: [], answer: [], unplaced: false },
        },
      }),
    );
    await startSession($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('says once that it cannot keep its record', async ($, on) => {
    fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    on('state.set', ($$: unknown, e: { key: string }, next: any) =>
      e.key === 'gate' ? { deny: 'store full' } : next(e),
    );
    await startSession($);
    await say($, 'fix the parser');
    await say($, 'and the lexer');
    await settle();
    expect(toasts.filter((t) => t.includes('could not keep its record'))).toHaveLength(1);
  });
});

// The timers a leg's budget arms, not the 5 s waits on a state call.
const legTimers = (w: World) => (w.timers ?? []).filter((t) => t.ms !== 5000);

// A running leg spawned at `at`, on the tree the world holds.
function runningLeg(w: World, at: number) {
  return {
    type: 'review-cycle:code-reviewer',
    counts: true,
    spawnTree: treeId(w, w.work),
    done: false,
    capped: false,
    counted: false,
    spawnedAt: at,
  };
}

// A reloaded module hears a message before its session start, so the message takes the record back.
async function sayBeforeRecall($: any, on: any, kept: Record<string, unknown>, text: string) {
  reloadInto(on, keptRecord(kept));
  await say($, text);
  await startSession($);
  await settle();
}

function keptRecord(over: Record<string, unknown>) {
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
    held: null,
    mandate: null,
    roundsFrom: 0,
    pushed: [],
    reviewing: null,
    ...over,
  };
}

// What a reload finds: the host's copy of what the gate remembered, read once.
function reloadInto(on: any, kept: unknown) {
  let isRead = false;
  on('state.get', ($$: unknown, e: { key: string }, next: any) => {
    if (e.key !== 'gate' || isRead) return next(e);
    isRead = true;
    return { value: { value: { shape: 'gate-6', value: kept }, version: 1 } };
  });
}

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
  test("a leg's counted report clears its earlier drop", async ($, on) => {
    fakeWorld(on);
    await review($, { answers: ['Waiting for the hook tests.', RECEIPT] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.reviews).toBe(1);
    expect(status.droppedReviews).toEqual([]);
  });
  test('an answer after a counted report drops nothing', async ($, on) => {
    fakeWorld(on);
    await review($, { answers: [RECEIPT, 'Anything else?'] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.reviews).toBe(1);
    expect(status.droppedReviews).toEqual([]);
  });
  test('a leg that reports without a receipt again is listed once', async ($, on) => {
    fakeWorld(on);
    await review($, { answers: ['Waiting.', 'Still waiting.'] });
    await review($, { type: 'review-cycle:pr-test-analyzer', answers: ['Waiting.'] });
    const r = await ($ as any).tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.droppedReviews).toEqual([
      'review-cycle:code-reviewer: its report did not open with the execution receipt',
      'review-cycle:pr-test-analyzer: its report did not open with the execution receipt',
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

function reminders(w: World): string[] {
  return (w.contexts ?? []).filter((c) => c.startsWith('review-cycle: your last turn left'));
}

// Sends the next message and returns the reminders it carried.
async function nudges($: any, w: World): Promise<string[]> {
  const before = reminders(w).length;
  await say($, 'thanks');
  return reminders(w).slice(before);
}

async function endTurn($: any, reason = 'answer', answer = 'done') {
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
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(w.prompts).toEqual(['fix it']);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
    expect(reminders(w)[0]).toContain('/review-cycle:review');
    // The reminder is the agent's alone: nothing shows on the user's screen.
    expect(w.statuses ?? []).toEqual([]);
  });
  test('the reminder is built when the prompt is sent', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await review($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('the nudge turned off before the next prompt sends no reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(false) };
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a slash command leaves the reminder for the next message', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/config',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'config', args: '' },
    });
    expect(reminders(w)).toEqual([]);
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('typing the review skill clears the reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/review-cycle:review',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'review-cycle:review', args: '' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a refused prompt leaves the reminder for the next one', async ($, on) => {
    const w = fakeWorld(on, { dropText: 'refuse me' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    expect(reminders(w)).toEqual([]);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('the reminder keeps context other hooks attached', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: 'thanks',
      origin: { kind: 'composer' },
      wait: false,
      context: ['other'],
    });
    expect(w.contexts).toContain('other');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a reminder git cannot build says so', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.fail = (a) => a.includes('diff-tree');
    await say($, 'thanks');
    expect(w.contexts).toEqual([expect.stringContaining('could not check whether your last turn')]);
  });
  test('a slash command does not move the reminder past changes made after it', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/foo',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'foo', args: '' },
    });
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([expect.stringContaining('a.ts')]);
    expect(reminders(w)[0]).toContain('b.ts');
  });
  test('a prompt queued into a running turn does not nudge again', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await queue($, 'also this');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a nudge turned off sends nothing even when the tree cannot be read', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(false) };
    w.fail = (a) => a === 'git add -A';
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a refused review command leaves the reminder owed', async ($, on) => {
    const w = fakeWorld(on, { dropText: '/review-cycle:review' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/review-cycle:review',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'review-cycle:review', args: '' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a turn git cannot check still owes a reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a.includes('diff-tree');
    await endTurn($);
    w.fail = () => false;
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a turn whose tree git cannot read still owes a reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a === 'git add -A';
    await endTurn($);
    w.fail = () => false;
    expect(await nudges($, w)).toEqual([expect.stringContaining('a.ts')]);
  });
  test('a turn git still cannot check at the next prompt says so', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a.includes('diff-tree');
    await endTurn($);
    await say($, 'thanks');
    expect(w.contexts).toEqual([expect.stringContaining('could not check whether your last turn')]);
  });
  test('reviewed changes owe nothing even when the next prompt cannot check', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    await endTurn($);
    w.fail = (a) => a.includes('diff-tree');
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a nudge off when the turn ends owes nothing once it is back on', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(true) };
    expect(await nudges($, w)).toEqual([]);
  });
  test('a message is nudged once, even after the nudge is turned off and on', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    const change = {
      key: 'review-cycle.nudge',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' as const },
    };
    await $.config.set({ ...change, value: false, previous: true });
    await $.config.set({ ...change, value: true, previous: false });
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a prompt sent while the nudge is being decided still carries it', async ($, on) => {
    let sent = false;
    const w = fakeWorld(on, {
      settingsRead: () => {
        if (sent) return;
        sent = true;
        void say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'thanks');
    // The two prompts overlap, so either may carry it, or both.
    expect(reminders(w).length).toBeGreaterThan(0);
  });
  test('a prompt that overtakes the nudge leaves the reminder to the next one', async ($, on) => {
    let overtaken = false;
    const w = fakeWorld(on, {
      settingsRead: async () => {
        if (overtaken) return;
        overtaken = true;
        await say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([expect.stringContaining('a.ts')]);
  });
  test('a review that overtakes the nudge owes no reminder', async ($, on) => {
    let overtaken = false;
    const w = fakeWorld(on, {
      settingsRead: async () => {
        if (overtaken) return;
        overtaken = true;
        await $.prompt.submit({
          text: '/review-cycle:review',
          origin: { kind: 'composer' },
          wait: false,
          command: { name: 'review-cycle:review', args: '' },
        });
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a prompt that overtakes and consumes the older reminder arms no second one', async ($, on) => {
    let armed = false;
    let overtaken = false;
    const w = fakeWorld(on, {
      dropText: 'refuse me',
      settingsRead: async () => {
        if (!armed || overtaken) return;
        overtaken = true;
        await say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    armed = true;
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('the reminder measures from where an older owed one began', async ($, on) => {
    const w = fakeWorld(on, { dropText: 'refuse me' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    const sent = await nudges($, w);
    expect(sent).toEqual([expect.stringContaining('a.ts')]);
    expect(sent[0]).toContain('b.ts');
  });
  test('a new session forgets the reminder the last one owed', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('turning the nudge off where the local file keeps it on keeps the reminder', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: nudge(true) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.config.set({
      key: 'review-cycle.nudge',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('turning the nudge off and on again does not bring the old reminder back', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    const change = {
      key: 'review-cycle.nudge',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' as const },
    };
    await $.config.set({ ...change, value: false, previous: true });
    await $.config.set({ ...change, value: true, previous: false });
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a prompt queued into a running turn carries no reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await queue($, 'also this');
    expect(reminders(w)).toEqual([]);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a review started before the next prompt clears the reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await skill($, 'review-cycle:review');
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a turn that ends by asking the user something is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'answer', 'Fixed. Commit the changes to `fix/x`?');
    expect(await nudges($, w)).toEqual([]);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test("a project's settings turn the nudge off; the local file decides", async ($, on) => {
    const w = fakeWorld(on, { settings: { project: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
    w.settings = { project: nudge(false), local: nudge(true) };
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a settings file that cannot be read sets nothing', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw' } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('one unreadable file leaves the other one in force', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw', local: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
    w.settings = { project: nudge(false), local: 'throw' };
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a nudge value that is not a boolean sets nothing', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { project: { pluginConfigs: { 'review-cycle': { options: { nudge: 'false' } } } } },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
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
    expect(await nudges($, w)).toEqual([]);
  });
  test('reviewed changes are not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('an edit after a finished review is nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('no nudge while a reviewer is still running', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'running' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a reviewer that ended without saying so does not hold the nudge off', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'killed' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a review the agent or user already started is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review' });
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test("a subagent's review does not stand in for the main loop's", async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await skill($, 'review-cycle:review', 'sub');
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
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
    expect(await nudges($, w)).toHaveLength(1);
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
    expect(await nudges($, w)).toEqual([]);
  });
  test('the reminder names only what the turn changed', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'add b');
    w.work = { 'a.ts': 'one', 'b.ts': 'new' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
    expect(reminders(w)[0]).toContain('b.ts');
    expect(reminders(w)[0]).not.toContain('a.ts');
  });
  test('unreviewed work from before the message is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'update the tracker');
    w.work = { 'a.ts': 'one', '.beads/issues.jsonl': 'x' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('each user message is judged from its own starting tree', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'what is next?');
    expect(reminders(w)).toHaveLength(1);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('an interrupted turn is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'aborted');
    expect(await nudges($, w)).toEqual([]);
  });
  test('the next user message allows another nudge', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'and the other one');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
    expect(reminders(w)).toHaveLength(2);
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
  test('a reviewed --continue with it is refused without naming a commit', async ($, on) => {
    fakeWorld(on);
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue && git push');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, 'run the commit on its own')).toBe(false);
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
  test('a request typed into the running turn keeps its push and adds to it', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    await queue($, 'Lets file the beads');
    expect(ran(await bash($, 'git push'))).toBe(true);
    await queue($, 'also open a PR');
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(ran(await bash($, 'git push'))).toBe(true);
  });
  for (const text of ['wait, rename the helper first', "wait, don't push", 'stop', 'please stop']) {
    test(`a hold typed into the running turn drops the push: ${text}`, async ($, on) => {
      fakeWorld(on);
      await say($, 'ship it');
      await queue($, text);
      expect(ran(await bash($, 'git push'))).toBe(false);
    });
  }
  test('a request typed in while the gate checks a push stops it once; the retry runs', async ($, on) => {
    let typed = false;
    fakeWorld(on, {
      git: (a) => {
        if (!typed && a.startsWith('git for-each-ref')) {
          typed = true;
          void queue($, 'Lets file the beads');
        }
        return null;
      },
    });
    await say($, 'ship it');
    expect(denied(await bash($, 'git push'), 'sent a new message')).toBe(true);
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
    // This world answers no dry run, so the only note says where it went is unchecked.
    expect(contextOf(r)).toEqual([
      'review-cycle ran the push the user asked for without fully checking where it goes: its dry run named no ref it would update. If it may have reached the default branch or a tag they did not name, tell them.',
    ]);
  });
  test('a reviewed commit beside it is not reported either', async ($, on) => {
    fakeStore(on);
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
  test('a commit records the review rounds since the last one', async ($, on) => {
    fakeStore(on);
    const w = fakeWorld(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'two' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    const status = async () =>
      JSON.parse(((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result);
    await review($);
    await review($);
    w.work = { 'a.ts': 'two' };
    await review($);
    const before = await status();
    expect(before.roundsSinceCommit).toBe(2);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const after = await status();
    expect(after.rounds).toEqual([{ commit: 'd'.repeat(12), rounds: 2, date: expect.any(String) }]);
    expect(after.roundsSinceCommit).toBe(0);
  });
  test('rounds are recorded only for a commit or --continue the gate judged', async ($, on) => {
    fakeStore(on);
    let moves = false;
    let next = 'd';
    const w = fakeWorld(on, {
      commits: {
        ['c'.repeat(40)]: { 'a.ts': 'zero' },
        ['d'.repeat(40)]: { 'a.ts': 'one' },
        ['e'.repeat(40)]: { 'a.ts': 'one' },
        ['f'.repeat(40)]: { 'a.ts': 'one' },
      },
      shell(this: World) {
        if (moves) this.head = next.repeat(40);
      },
    });
    const status = async () => {
      const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
      return JSON.parse(r.result);
    };
    await review($);
    await say($, 'commit it');
    // Nothing to commit: HEAD stays, so the round still waits for its commit.
    expect(ran(await bash($, 'git commit -m x'))).toBe(true);
    const held = await status();
    expect([held.rounds, held.roundsSinceCommit]).toEqual([[], 1]);
    // A script's commit is not judged, so its rounds go to the next one recorded.
    moves = true;
    expect(ran(await bash($, './release.sh'))).toBe(true);
    const scripted = await status();
    expect([scripted.rounds, scripted.roundsSinceCommit]).toEqual([[], 1]);
    // A --continue the gate judged records its rounds.
    next = 'e';
    w.work = { 'a.ts': 'one', 'b.ts': 'new' };
    await review($);
    w.commits['e'.repeat(40)] = { ...w.work };
    await say($, 'finish the merge');
    expect(ran(await bash($, 'git add -A && GIT_EDITOR=true git merge --continue'))).toBe(true);
    const continued = await status();
    expect(continued.rounds).toEqual([
      { commit: 'e'.repeat(12), rounds: 2, date: expect.any(String) },
    ]);
  });
  test('judged commits sent together record one entry for all of them', async ($, on) => {
    fakeStore(on);
    fakeWorld(on, {
      commits: {
        ['c'.repeat(40)]: { 'a.ts': 'zero' },
        ['d'.repeat(40)]: { 'a.ts': 'one' },
        ['e'.repeat(40)]: { 'a.ts': 'one' },
      },
      shell(this: World, command: string) {
        this.head = (command.endsWith(' a') ? 'd' : 'e').repeat(40);
      },
    });
    await review($);
    await say($, 'commit it');
    const [a, b] = await Promise.all([bash($, 'git commit -am a'), bash($, 'git commit -am b')]);
    expect([ran(a), ran(b)]).toEqual([true, true]);
    expect([contextOf(a), contextOf(b)]).toEqual([[], []]);
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    const { rounds } = JSON.parse(r.result);
    expect(rounds.map((x: { commit: string; rounds: number }) => [x.commit, x.rounds])).toEqual([
      [`${'c'.repeat(12)}..${'e'.repeat(12)}`, 1],
    ]);
  });
  test('a rounds record the store cannot take is named, and the commit still runs', async ($, on) => {
    fakeStore(on, { refuse: 'disk full' });
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
    expect(has(contextOf(r), "could not record this commit's review rounds (1 round:")).toBe(true);
    const s = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    expect(JSON.parse(s.result).roundsSinceCommit).toBe(0);
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

async function startSession($: any) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true });
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
const newBranch = (b: string) => `*\trefs/heads/${b}:refs/heads/${b}\t[new branch]`;
// A dry run to `git@github.com:o/r.git`, whose URL git prints after `To` without its user.
const sshDryRun = (lines: string[]) => ({
  stdout: ['To github.com:o/r.git', ...lines, 'Done'].join('\n'),
});

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
// branch, or fails when `head` is 'fail'; the checkout is on that branch.
function github(
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
function onMain(a: string): Partial<Run> | null {
  return a === 'git symbolic-ref --quiet --short HEAD' ? { stdout: 'main\n' } : github('fix/x')(a);
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

// The on-screen line for a step the setting runs unasked is a /config choice.
const NOTICE = { options: { unaskedNotice: true } };

describe('the stop-before setting', () => {
  test('a push below the rung runs without asking, told to the agent but not shown', async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(ran(r)).toBe(true);
    expect(contextOf(r)).toEqual([RAN_PUSH]);
    expect(w.logs ?? []).toEqual([]);
  });
  test('with the notice on, a push below the rung is shown too', NOTICE, async ($, on) => {
    const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
    await say($, 'fix the parser');
    const r = await bash($, 'git push');
    expect(contextOf(r)).toEqual([RAN_PUSH]);
    expect(w.logs).toEqual([RAN_PUSH]);
  });
  test(
    'a push a script makes below the rung is logged, not reported as unasked',
    NOTICE,
    async ($, on) => {
      const w = fakeWorld(on, pushing({ settings: { local: stops('open PR') } }));
      await say($, 'fix the parser');
      const context = contextOf(await bash($, './release.sh'));
      expect(has(context, RAN_PUSH)).toBe(true);
      expect(has(context, 'without the user asking')).toBe(false);
      expect(w.logs).toHaveLength(1);
    },
  );
  // Each dry-run output is what git 2.56 printed for that push. The last column
  // is what "push it" does: run, stay refused, or run once a request names it.
  const TAG = ['*\trefs/tags/v1:refs/tags/v1\t[new tag]'];
  const asking: [string, readonly string[] | 'fail' | null, string, string][] = [
    [
      'git push origin main',
      [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
      'push it to main',
    ],
    [
      'git push origin @',
      [' \tHEAD:refs/heads/main\tb65222b..9f4a349'],
      'it pushes to `main`, the default branch',
      'push main',
    ],
    ['git push origin v1', TAG, 'it pushes the tag `v1`', 'push the v1 tag'],
    // push.followTags carries a new annotated tag along with the branch.
    ['git push', [NEW_BRANCH, ...TAG], 'it pushes the tag `v1`', 'push the tag'],
    [
      'git push',
      'fail',
      'a dry run of it, which shows what it would push, failed (fatal: Could not read from remote repository.)',
      'runs',
    ],
    ['git push --tags', null, 'it pushes tags', 'runs'],
    ['git push origin --delete old', null, 'it deletes a remote branch', 'runs'],
    ['git push --all', null, 'it pushes every branch', 'runs'],
    ['git push origin "$BRANCH"', null, 'its remote or branch is built at run time', 'refused'],
  ];
  for (const [command, lines, reason, then] of asking) {
    test(`${command} asks whatever the setting: ${reason}`, async ($, on) => {
      const args = command.replace(/^git push ?/, '');
      const git = remoteSide(lines === null ? {} : { [args]: lines });
      fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git }));
      await say($, 'fix the parser');
      const r = await bash($, command);
      expect(denied(r, `This push asks whatever the setting: ${reason}.`)).toBe(true);
      await say($, 'push it');
      if (then === 'refused') {
        expect(denied(await bash($, command), 'Write the remote and branch out.')).toBe(true);
        return;
      }
      if (then !== 'runs') {
        expect(denied(await bash($, command), 'which the request did not name')).toBe(true);
        await say($, then);
      }
      expect(ran(await bash($, command))).toBe(true);
    });
  }
  test('a yes to the offer the refusal suggests lets the push run', async ($, on) => {
    const git = remoteSide({
      'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
    });
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git }));
    await say($, 'push it');
    const r = await bash($, 'git push origin main');
    expect(denied(r, '"Push to `main`?"')).toBe(true);
    await ($ as any).turn.complete({ answer: 'Push to `main`?', reason: 'answer' });
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin main'))).toBe(true);
  });
  test('a push the user asked for that git partly rejects is judged by the refs it lands', async ($, on) => {
    const lines = [
      `To ${REMOTE}`,
      ' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349',
      '!\trefs/heads/other:refs/heads/other\t[rejected] (non-fast-forward)',
      'Done',
    ];
    const rest = remoteSide({});
    const git = (a: string) =>
      a.includes('push --dry-run') && a.includes(DRY_FLAGS)
        ? { exitCode: 1, stdout: lines.join('\n'), stderr: 'error: failed to push some refs\n' }
        : rest(a);
    fakeWorld(on, pushing({ git }));
    await say($, 'push it');
    const r = await bash($, 'git push origin main other');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
  });
  test('a commit before a push the user asked for moves an up-to-date main', async ($, on) => {
    const rest = remoteSide({
      'origin main': ['=\trefs/heads/main:refs/heads/main\t[up to date]'],
    });
    const git = (a: string) =>
      a.startsWith('git symbolic-ref') ? { stdout: 'refs/heads/main\n' } : rest(a);
    fakeWorld(on, pushing({ git }));
    await review($);
    await say($, 'commit and push');
    const r = await bash($, 'git commit -am x && git push origin main');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
    expect(denied(r, 'To commit without pushing, run the commit on its own.')).toBe(true);
  });
  test('a commit before a push asks for an up-to-date main when its branch cannot be read', async ($, on) => {
    const rest = remoteSide({
      'origin main': ['=\trefs/heads/main:refs/heads/main\t[up to date]'],
    });
    const git = (a: string) =>
      a.startsWith('git symbolic-ref')
        ? { exitCode: 128, stderr: 'fatal: not a git repository\n' }
        : rest(a);
    fakeWorld(on, pushing({ git }));
    await review($);
    await say($, 'commit and push');
    const r = await bash($, 'git commit -am x && git push origin main');
    expect(denied(r, '`main`, the default branch, which the request did not name')).toBe(true);
  });
  test("a user's push never deletes the default branch, even named", async ($, on) => {
    const git = remoteSide({ 'origin :main': ['-\t:refs/heads/main\t[deleted]'] });
    fakeWorld(on, pushing({ git }));
    await say($, 'push to main');
    const r = await bash($, 'git push origin :main');
    expect(denied(r, 'it deletes `main`, the default branch')).toBe(true);
    expect(denied(r, 'The gate never does that for the user')).toBe(true);
  });
  test('a git step before a push the user asked for asks, since it can change where it goes', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, 'push it');
    const r = await bash($, 'git fetch && git push');
    expect(denied(r, '`git fetch` runs before it in the same command')).toBe(true);
  });
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
  test('never stop lets a pull request run, logged', NOTICE, async ($, on) => {
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
  test('a pull request that failed is still noted as run', NOTICE, async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('never stop') }, bashFails: true });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr create --fill');
    expect(has(contextOf(r), 'ran a pull request without asking')).toBe(true);
    expect(w.logs).toHaveLength(1);
  });
  test('a permitted push that moved no ref is still noted as run', NOTICE, async ($, on) => {
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
    const remedy = '`gh pr merge 116 --auto`, which leaves';
    expect(denied(await bash($, 'gh pr merge 116 --squash'), remedy)).toBe(true);
    expect(denied(await bash($, 'gh pr merge 116 --body --auto'), remedy)).toBe(true);
    expect(ran(await bash($, 'gh pr merge 116 --auto --squash'))).toBe(true);
  });
  test('a merge asked for once it is ready runs now when GitHub reports it ready', async ($, on) => {
    const git = github('fix/x', 'main', false, 'github.com/o/r', 'CLEAN');
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git });
    await say($, 'Ok, lets merge 116 when its ready');
    expect(denied(await bash($, 'gh pr merge 117 --squash'), 'the user asked to merge #116')).toBe(
      true,
    );
    expect(denied(await bash($, 'gh pr merge 117 --auto'), 'the user asked to merge #116')).toBe(
      true,
    );
    const r = await bash($, 'gh pr merge 116 --squash');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'GitHub reports #116 CLEAN')).toBe(true);
    // Shown whatever the notice setting: GitHub's state, not the setting, let it run.
    expect(w.logs?.some((l) => l.includes('GitHub reports #116 CLEAN'))).toBe(true);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.argv.slice(3))).toContainEqual([
      '116',
      '--json',
      'url,state,mergeStateStatus',
      '--jq',
      String.raw`"\(.url) \(.state) \(.mergeStateStatus)"`,
    ]);
    const repoViews = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh repo view');
    expect(repoViews.map((c) => c.argv.slice(3))).toContainEqual(['--json', 'url', '--jq', '.url']);
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
      'url,isCrossRepository,headRefName',
      '--jq',
      String.raw`"\(.isCrossRepository) \(.url) \(.headRefName)"`,
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
  test('an unasked merge of the version pull request is noted as a release', async ($, on) => {
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      git: github('oakum/version-packages'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 62 --auto');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'ran a release without asking')).toBe(true);
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
  test('a lookup that never answers is tried again for longer, then says to run it again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
    });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(true);
    expect(denied(r, 'Run the same command again')).toBe(true);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.init?.timeoutMs)).toEqual([5000, 10_000]);
  });
  test('a lookup that answers on its second try lets the merge run', async ($, on) => {
    let tries = 0;
    fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view') && tries++ === 0,
    });
    await say($, 'merge 62');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
  });
  test('a slow lookup on a merge the user did not ask for still asks them', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
    });
    await say($, 'fix the parser');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views.map((c) => c.init?.timeoutMs)).toEqual([5000]);
  });
  test('a lookup that cannot start is not retried or taken as slow', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      reject: (a) => a.startsWith('gh pr view'),
      rejectWith: 'spawn gh ENOENT',
    });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
    const views = w.calls.filter((c) => c.argv.slice(0, 3).join(' ') === 'gh pr view');
    expect(views).toHaveLength(1);
  });
  test('a lookup that fails outright asks the user, not to run it again', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'merge 62');
    const r = await bash($, 'gh pr merge 62');
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    expect(denied(r, 'GitHub did not answer in time')).toBe(false);
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
  test('gh stack submit asks for its pull requests and its lease at once, and one yes runs it', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch of the stack with --force-with-lease')).toBe(
      true,
    );
    expect(denied(r, 'with a lease and open its PRs?"')).toBe(true);
    await endTurn(
      $,
      'answer',
      'Force-push the stack `feat/a`, `feat/b` with a lease and open its PRs?',
    );
    await say($, 'yes');
    expect(ran(await bash($, 'gh stack submit --auto'))).toBe(true);
  });
  test('a lease asked in the message still has gh stack submit ask for both, since the answer is a new message', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await endTurn($, 'answer', 'Force-push the stack with a lease?');
    await say($, 'yes');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch')).toBe(true);
    // gh stack link pushes plainly, so it is never asked a lease.
    const link = await bash($, 'gh stack link feat/a feat/b');
    expect(denied(link, "doesn't ask for a pull request")).toBe(true);
    expect(denied(link, 'also pushes every active branch')).toBe(false);
    await endTurn(
      $,
      'answer',
      'Force-push the stack `feat/a`, `feat/b` with a lease and open its PRs?',
    );
    await say($, 'yes');
    expect(ran(await bash($, 'gh stack submit --auto'))).toBe(true);
  });
  test('where the setting allows a push its lease cannot bound, gh stack submit still asks for both; gh stack link never for a lease', async ($, on) => {
    // This clone tracks no stack, so the lease bound cannot be read.
    fakeWorld(on, { settings: { local: stops('open PR') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await bash($, 'gh stack submit --auto');
    expect(denied(r, 'also pushes every active branch')).toBe(true);
    const link = await bash($, 'gh stack link feat/a feat/b');
    expect(denied(link, "doesn't ask for a pull request")).toBe(true);
    expect(denied(link, 'also pushes every active branch')).toBe(false);
  });
  test('gh stack is read: moving around runs, a stack push asks for its lease', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') }, git: github('fix/x') });
    await say($, 'push the stack');
    expect(ran(await bash($, 'gh stack view --json'))).toBe(true);
    expect(ran(await bash($, 'gh stack up'))).toBe(true);
    const r = await bash($, 'gh stack push');
    expect(denied(r, 'pushes every active branch of the stack with --force-with-lease')).toBe(true);
    expect(denied(await bash($, 'gh stack modify'), 'is interactive')).toBe(true);
    expect(denied(await bash($, 'gh stack merge 4 --yes --squash'), 'below it')).toBe(true);
  });
  test('gh stack link pushes its branches: the default one needs naming', async ($, on) => {
    fakeWorld(on, { git: github('fix/x') });
    await say($, 'ship it');
    expect(denied(await bash($, 'gh stack link main feat/a'), '`main`, the default branch')).toBe(
      true,
    );
    expect(ran(await bash($, 'gh stack link feat/a feat/b'))).toBe(true);
    expect(denied(await bash($, 'cd .. && gh stack link feat/a'), 'Run it on its own')).toBe(true);
  });
  test('a stack merge reads GitHub, and merges only what the user named', async ($, on) => {
    const stack = JSON.stringify([
      {
        number: 4,
        pull_requests: [
          { number: 1, merged_at: '2026-10-18T15:02:11Z' },
          { number: 2, merged_at: null },
          { number: 3, merged_at: null },
        ],
      },
    ]);
    // #3 is no stack's number, so the gate asks for the stack holding it.
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/3'
        ? { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)\n' }
        : a === 'gh api -X GET repos/{owner}/{repo}/stacks -f pull_request=3'
          ? { stdout: stack }
          : github('two')(a);
    const w = fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge it');
    expect(denied(await bash($, 'gh stack merge 3 --yes --squash'), 'merges #2, #3 together')).toBe(
      true,
    );
    await say($, 'merge #2 and #3');
    expect(ran(await bash($, 'gh stack merge 3 --yes --squash'))).toBe(true);
    const looked = w.calls.map((c) => c.argv.join(' ')).filter((a) => a.startsWith('gh '));
    // Each layer is bound by the number GitHub resolves, as `gh pr merge` is.
    expect(looked.some((a) => a.startsWith('gh pr view 2 '))).toBe(true);
    expect(looked.some((a) => a.startsWith('gh pr view 3 '))).toBe(true);
  });
  test('a stack push runs on a push request while it overwrites only what this agent pushed', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const THEIRS_TIP = 'b'.repeat(40);
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [
        {
          number: 4,
          trunk: { branch: 'main' },
          branches: [{ branch: 'spike/two', pullRequest: { number: 2 } }],
        },
      ],
    });
    let onRemote = MINE;
    const answers = (a: string): Partial<Run> | null => {
      if (a === 'git symbolic-ref --quiet --short HEAD') return { stdout: 'spike/two\n' };
      if (a.startsWith('git config --get ')) return { exitCode: 1 };
      if (a === 'git remote') return { stdout: 'origin\n' };
      if (a.startsWith('git remote get-url ')) return { stdout: 'git@github.com:o/r.git\n' };
      if (a === 'git ls-remote --heads origin') {
        return { stdout: `${onRemote}\trefs/heads/spike/two\n` };
      }
      return github('spike/two')(a);
    };
    const w = fakeWorld(on, {
      settings: { local: stops('push') },
      git: answers,
      files: { '/repo/.git/gh-stack': catalog },
      shell(this: World, command: string) {
        if (command !== 'gh stack push') return;
        this.refs = { 'refs/remotes/origin/spike/two': MINE };
        this.reflogs = { 'refs/remotes/origin/spike/two': [`${MINE} update by push`] };
      },
    });
    await say($, 'push it');
    expect(denied(await bash($, 'gh stack push'), 'never saw this agent push')).toBe(true);
    // A forced push the user asked for runs, and the gate records what it pushed.
    await say($, 'force push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
    await say($, 'push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
    // Someone else pushed to the branch since.
    onRemote = THEIRS_TIP;
    expect(
      denied(await bash($, 'gh stack push'), 'which the gate did not see this agent push'),
    ).toBe(true);
    const listing = w.calls.find((c) => c.argv.join(' ') === 'git ls-remote --heads origin');
    expect(listing?.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });
  test('a plain git push of a stack layer is sent to gh stack push', async ($, on) => {
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [
        {
          trunk: { branch: 'main' },
          branches: [
            { branch: 'spike/one', pullRequest: { number: 1, merged: true } },
            { branch: 'spike/two', pullRequest: { number: 2 } },
          ],
        },
      ],
    });
    const remote = remoteSide({
      'origin spike/two': [newBranch('spike/two')],
      'origin spike/one': [newBranch('spike/one')],
      'origin fix/x': [newBranch('fix/x')],
      '--force origin spike/two': [
        '+\trefs/heads/spike/two:refs/heads/spike/two\ta...b (forced update)',
      ],
    });
    const w = fakeWorld(on, {
      settings: { local: stops('never stop') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) => {
        if (a.startsWith('git config --get ')) return { exitCode: 1 };
        if (a === 'git remote') return { stdout: 'origin\n' };
        if (a === 'git remote get-url --push --all origin') return { stdout: `${REMOTE}\n` };
        return remote(a);
      },
    });
    await say($, 'push it');
    expect(
      denied(
        await bash($, 'git push origin spike/two'),
        '`spike/two` is a layer of a gh-stack stack',
      ),
    ).toBe(true);
    // One dry run serves every check of the push.
    expect(w.calls.filter((c) => c.argv.includes('--dry-run'))).toHaveLength(1);
    // A merged layer, and a branch in no stack, push as any branch does.
    expect(ran(await bash($, 'git push origin spike/one'))).toBe(true);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    // A delete is judged as any push is, not steered to a command that cannot delete.
    expect(ran(await bash($, 'git push --delete origin spike/two'))).toBe(true);
    // A refusal of its own comes before the steer.
    expect(denied(await bash($, 'git push --force origin spike/two'), 'without a lease')).toBe(
      true,
    );
  });
  test('a layer is steered on an ssh remote, and in a push that also deletes', async ($, on) => {
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [{ trunk: { branch: 'main' }, branches: [{ branch: 'spike/two' }] }],
    });
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) => {
        if (a.startsWith('git config --get ')) return { exitCode: 1 };
        if (a === 'git remote') return { stdout: 'origin\n' };
        if (a === 'git remote get-url --push --all origin') {
          return { stdout: 'git@github.com:o/r.git\n' };
        }
        if (a.includes('push --dry-run origin :old spike/two')) {
          return sshDryRun(['-\t:refs/heads/old\t[deleted]', newBranch('spike/two')]);
        }
        if (a.includes('push --dry-run origin spike/two')) {
          return sshDryRun([newBranch('spike/two')]);
        }
        return remoteSide()(a);
      },
    });
    await say($, 'push it');
    expect(
      denied(await bash($, 'git push origin spike/two'), 'is a layer of a gh-stack stack'),
    ).toBe(true);
    await say($, 'push it, and delete old');
    expect(
      denied(await bash($, 'git push origin :old spike/two'), 'is a layer of a gh-stack stack'),
    ).toBe(true);
  });
  test('a layer pushed to a remote gh-stack does not push it to is not steered', async ($, on) => {
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [{ trunk: { branch: 'main' }, branches: [{ branch: 'spike/two' }] }],
    });
    fakeWorld(on, {
      settings: { local: stops('never stop') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) => {
        if (a === 'git config --get branch.spike/two.pushRemote') return { stdout: 'origin\n' };
        if (a.startsWith('git config --get ')) return { exitCode: 1 };
        if (a === 'git remote get-url --push --all origin') return { stdout: `${REMOTE}\n` };
        if (a.includes('push --dry-run backup ')) {
          return { stdout: `To /backup.git\n${newBranch('spike/two')}\nDone` };
        }
        return remoteSide()(a);
      },
    });
    await say($, 'push it');
    expect(ran(await bash($, 'git push backup spike/two'))).toBe(true);
  });
  test('without a stack catalog, a push gets no extra dry run for it', async ($, on) => {
    const w = fakeWorld(on, { git: remoteSide() });
    await say($, 'push it');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    // The one dry run is the default-branch check's.
    expect(w.calls.filter((c) => c.argv.includes('--dry-run'))).toHaveLength(1);
  });
  test('a push followed by a fetch records the commit the push set', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const FETCHED = 'b'.repeat(40);
    fakeWorld(on, {
      refs: {},
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/spike/two': FETCHED };
        this.reflogs = {
          'refs/remotes/origin/spike/two': [
            `${FETCHED} fetch: fast-forward`,
            `${MINE} update by push`,
          ],
        };
      },
    });
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await bash($, './push-then-fetch.sh');
    await settle();
    expect(kept?.value.pushed).toEqual([['/repo/.git\torigin/spike/two', MINE]]);
  });
  test('the pushes the gate saw are kept, and read back after a reload', async ($, on) => {
    const MINE = 'a'.repeat(40);
    fakeWorld(on, {
      refs: {},
      shell(this: World) {
        this.refs = { 'refs/remotes/origin/spike/two': MINE };
        this.reflogs = { 'refs/remotes/origin/spike/two': [`${MINE} update by push`] };
      },
    });
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await bash($, 'git push origin spike/two');
    await settle();
    expect(kept?.value.pushed).toEqual([['/repo/.git\torigin/spike/two', MINE]]);
  });
  test('a kept push lets a stack push run after a reload', async ($, on) => {
    const MINE = 'a'.repeat(40);
    const catalog = JSON.stringify({
      schemaVersion: 1,
      stacks: [{ trunk: { branch: 'main' }, branches: [{ branch: 'spike/two' }] }],
    });
    fakeWorld(on, {
      settings: { local: stops('push') },
      files: { '/repo/.git/gh-stack': catalog },
      git: (a) =>
        a === 'git symbolic-ref --quiet --short HEAD'
          ? { stdout: 'spike/two\n' }
          : a.startsWith('git config --get ')
            ? { exitCode: 1 }
            : a === 'git remote'
              ? { stdout: 'origin\n' }
              : a.startsWith('git remote get-url ')
                ? { stdout: 'git@github.com:o/r.git\n' }
                : a === 'git ls-remote --heads origin'
                  ? { stdout: `${MINE}\trefs/heads/spike/two\n` }
                  : github('spike/two')(a),
    });
    reloadInto(on, keptRecord({ pushed: [['/repo/.git\torigin/spike/two', MINE]] }));
    await startSession($);
    await say($, 'push it');
    expect(ran(await bash($, 'gh stack push'))).toBe(true);
  });
  test('a stack number is read as a stack, and only a 404 reads it as a pull request', async ($, on) => {
    const stack = JSON.stringify({
      number: 4,
      pull_requests: [
        { number: 2, merged_at: null },
        { number: 3, merged_at: null },
      ],
    });
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/4'
        ? { stdout: stack }
        : a === 'gh api repos/{owner}/{repo}/stacks/5'
          ? { exitCode: 1, stderr: 'gh: Server Error (HTTP 500)\n' }
          : a.includes('pull_request=')
            ? { stdout: `[${stack}]` }
            : github('two')(a);
    const w = fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge #2 and #3');
    expect(ran(await bash($, 'gh stack merge 4 --yes'))).toBe(true);
    expect(denied(await bash($, 'gh stack merge 5 --yes'), '(HTTP 500)')).toBe(true);
    expect(w.calls.some((c) => c.argv.join(' ').includes('pull_request='))).toBe(false);
  });
  test('"merge the stack" and "merge up to #N" merge the stack, and nothing else', async ($, on) => {
    const stack = JSON.stringify({
      number: 4,
      pull_requests: [
        { number: 2, merged_at: null },
        { number: 3, merged_at: null },
      ],
    });
    const answers = (a: string): Partial<Run> | null =>
      a === 'gh api repos/{owner}/{repo}/stacks/4'
        ? { stdout: stack }
        : a === 'gh api repos/{owner}/{repo}/stacks/3'
          ? { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)\n' }
          : a.includes('pull_request=3')
            ? { stdout: `[${stack}]` }
            : github('two')(a);
    fakeWorld(on, { settings: { local: stops('push') }, git: answers });
    await say($, 'merge the stack');
    expect(ran(await bash($, 'gh stack merge 4 --yes'))).toBe(true);
    expect(denied(await bash($, 'gh pr merge 7'), '')).toBe(true);
    await say($, 'merge up to #3');
    expect(ran(await bash($, 'gh stack merge 3 --yes'))).toBe(true);
    await say($, 'merge up to #2');
    expect(denied(await bash($, 'gh stack merge 3 --yes'), 'merges #2, #3 together')).toBe(true);
  });
  test('a merge asked for covers the version pull request, looked up or not', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('oakum/version-packages'),
    });
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 62'))).toBe(true);
    // Named by number, it is looked up to find it was the version pull request.
    expect(w.calls.some((c) => c.argv.join(' ').startsWith('gh pr view 62'))).toBe(true);
  });
  test('a merge asked for by number releases only the version PR it names', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await say($, 'merge 131');
    const other = 'it merges #130, and the user asked to merge #131';
    expect(denied(await bash($, 'gh pr merge 130'), other)).toBe(true);
    await say($, 'merge #130');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a yes to an offer naming the version PR among others releases it', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', 'Merge #3 and #130?');
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  test('a refused yes names the sentence that held the offer', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn(
      $,
      'answer',
      'Should I squash-merge #3, then #4? They touch different files, so neither needs a rebase after the other merges.',
    );
    await say($, 'Ok, lets do that');
    const r = await bash($, 'gh pr merge 3 --squash');
    expect(denied(r, 'held by a condition word in a sentence after its question')).toBe(true);
    expect(denied(r, '"They touch different files')).toBe(true);
    const viaMcp = await mcp($, 'mcp__github__merge_pull_request', {
      owner: 'o',
      repo: 'r',
      pullNumber: 3,
    });
    expect(denied(viaMcp, '"They touch different files')).toBe(true);
    // A prompt queued into the turn keeps the reason; a later message drops it.
    await queue($, 'also update the docs');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), '"They touch')).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), 'held by a condition')).toBe(false);
  });
  test('a refused yes names its reason only for the steps the offer named', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('pr') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I open a PR? After that, CI will run.');
    await say($, 'yes');
    expect(denied(await bash($, 'gh pr create --fill'), '("After that, CI will run.")')).toBe(true);
    const merge = await bash($, 'gh pr merge 3 --squash');
    expect(denied(merge, "doesn't ask for a merge")).toBe(true);
    expect(denied(merge, 'After that')).toBe(false);
  });
  test('a queued retraction drops the reason with the yes', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await say($, 'yes');
    await queue($, 'never mind');
    const r = await bash($, 'gh pr merge 3 --squash');
    expect(denied(r, "doesn't ask for a merge")).toBe(true);
    expect(denied(r, '(their')).toBe(false);
  });
  test('a queued yes to an offer the gate cannot read gets its reason', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await say($, 'fix the parser');
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await queue($, 'yes');
    expect(denied(await bash($, 'gh pr merge 3 --squash'), '("After that, CI will run.")')).toBe(
      true,
    );
  });
  test('a merge offer the gate cannot read names its reason on the release it is', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('oakum/version-packages') });
    await endTurn($, 'answer', 'Should I merge #62? After that, CI will run.');
    await say($, 'yes');
    expect(denied(await bash($, 'gh pr merge 62'), '("After that, CI will run.")')).toBe(true);
  });
  test("a merge offer's reason stays off a push it never offered", async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('push') }, git: remoteSide({}) }));
    await endTurn($, 'answer', 'Should I merge #3? After that, CI will run.');
    await say($, 'yes');
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, "doesn't ask for a push")).toBe(true);
    expect(denied(r, '(their')).toBe(false);
  });
  test('a refused yes to a push or a commit names the condition too', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('commit') }, git: remoteSide({}) }));
    await review($);
    await endTurn($, 'answer', 'Should I commit and push? After that, CI will run.');
    await say($, 'yes');
    expect(denied(await bash($, 'git commit -am x'), '("After that, CI will run.")')).toBe(true);
    expect(denied(await bash($, 'git push origin fix/x'), '("After that, CI will run.")')).toBe(
      true,
    );
    expect(
      denied(await bash($, 'git push origin --delete old'), '("After that, CI will run.")'),
    ).toBe(true);
  });
  test('a pick among offered pull requests merges those, across turns', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I squash-merge #3, then #4?');
    await say($, 'merge both');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    // The agent may end its turn while GitHub recalculates #4; the grant is the message's.
    await endTurn($, 'answer', '#3 merged; GitHub is still checking #4.');
    expect(ran(await bash($, 'gh pr merge 4 --squash'))).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 4 --squash'), "doesn't ask for a merge")).toBe(true);
  });
  test('a narrowing pick merges only the pull request it keeps', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Should I squash-merge #3, then #4?');
    await say($, 'merge #3 but not #4');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    const other = 'it merges #4, and the user asked to merge #3';
    expect(denied(await bash($, 'gh pr merge 4 --squash'), other)).toBe(true);
  });
  test('a yes to a squash-merge offer listing pull requests in turn merges each', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    await endTurn($, 'answer', 'Squash-merge #3, then #4?');
    await say($, 'yes');
    expect(ran(await bash($, 'gh pr merge 3 --squash'))).toBe(true);
    expect(ran(await bash($, 'gh pr merge 4 --squash'))).toBe(true);
    const other = 'it merges #5, and the user asked to merge #3, #4';
    expect(denied(await bash($, 'gh pr merge 5 --squash'), other)).toBe(true);
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
    const other = 'it merges #130, and the user asked to merge #131';
    expect(denied(await bash($, 'gh pr merge 130'), other)).toBe(true);
    await endTurn($, 'answer', 'Release by merging #130?');
    await say($, 'merge it');
    expect(ran(await bash($, 'gh pr merge 130'))).toBe(true);
  });
  // The answer offers an unnumbered merge; its last bullet only mentions release PR #52.
  const mentioned =
    'The branch is current.\n- **Release PR #52:** it should not trigger Visual.\n\nSay the word to merge.';
  test('a merge of a pull request the answer only mentioned runs another', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    const r = await bash($, 'gh pr merge 74 --squash');
    expect(ran(r)).toBe(true);
    expect(r.context?.join('\n')).toContain('the model check read #52 as mentioned');
    expect(w.modelPrompts?.at(-1)).toContain('The candidate: pull request #52.');
    expect(w.modelCalls?.at(-1)).toMatchObject({
      system: expect.stringContaining("Decide whether the agent's answer offers to merge"),
      maxTokens: 100,
    });
  });
  test('a merge of the pull request the answer offered runs no other', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x'), target: OFFERED });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    const other = 'it merges #74, and the user asked to merge #52';
    expect(denied(await bash($, 'gh pr merge 74 --squash'), other)).toBe(true);
  });
  // #40 is offered three paragraphs up; the closing lines name no pull request.
  const farUp = [
    '#40 passes its checks and is ready to merge.',
    'I also looked at the flaky test; it is unrelated.',
    'The docs build is green.',
    'Want me to merge it?',
  ].join('\n\n');
  test('a merge naming no pull request runs one the answer named anywhere', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge that PR');
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
  });
  test('a merge naming no pull request asks before one nothing pointed at', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge that PR');
    const r = await bash($, 'gh pr merge 200 --squash');
    expect(denied(r, 'neither they nor the answer they replied to named #200')).toBe(true);
    expect(denied(r, '"Merge #200?"')).toBe(true);
  });
  test('a queued merge keeps the number it named beside an unnamed one', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge it');
    await queue($, 'and merge 41');
    expect(ran(await bash($, 'gh pr merge 41 --squash'))).toBe(true);
  });
  test('a merge naming no pull request skips the answer’s numbers once the user names one', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp.replace('#40 passes', '#130 fails, and #40 passes'));
    await say($, 'merge it; do not merge 130');
    expect(denied(await bash($, 'gh pr merge 130 --squash'), '"Merge #130?"')).toBe(true);
    await queue($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 130 --squash'), '"Merge #130?"')).toBe(true);
  });
  test('a merge asked for once ready outlasts unrelated messages, until used', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'While we wait on that lets plan out our next bit of work');
    // A wake from another plugin neither grants nor ends it.
    await say($, 'pr-watch: #46 is ready to merge. merge 47', 'plugin');
    expect(await bash($, 'gh pr merge 47 --auto')).toMatchObject({
      deny: expect.stringContaining('#47'),
    });
    expect(await bash($, 'gh pr merge 46 --auto')).not.toHaveProperty('deny');
    await say($, 'thanks');
    expect(await bash($, 'gh pr merge 46 --auto')).toMatchObject({
      deny: expect.stringContaining("doesn't ask for a merge"),
    });
  });
  test('a merge asked for once ready runs on a wake only once it is ready', async ($, on) => {
    let state = 'BLOCKED';
    fakeWorld(on, {
      settings: { local: stops('merge') },
      git: (a) =>
        a === 'git symbolic-ref --quiet --short HEAD'
          ? { stdout: 'main\n' }
          : github('fix/x', 'main', false, 'github.com/o/r', state)(a),
    });
    await say($, 'merge 46 once CI passes');
    await say($, 'While we wait on that lets plan out our next bit of work');
    await say($, 'pr-watch: #46 changed', 'plugin');
    expect(denied(await bash($, 'gh pr merge 46 --squash'), 'BLOCKED')).toBe(true);
    state = 'CLEAN';
    await say($, 'pr-watch: #46 is ready to merge', 'plugin');
    expect(ran(await bash($, 'gh pr merge 46 --squash'))).toBe(true);
  });
  test('a merge now in a later message never reaches a pull request asked for once ready', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, "merge it. merge it when it's ready");
    expect(denied(await bash($, 'gh pr merge 46 --squash'), 'BLOCKED')).toBe(true);
  });
  test('a merge that fails leaves its standing ask', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'thanks');
    w.bashFails = true;
    await bash($, 'gh pr merge 46 --auto');
    w.bashFails = false;
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
  });
  test('using one standing ask leaves the others', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'merge 47 once CI passes');
    await say($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
    expect(ran(await bash($, 'gh pr merge 47 --auto'))).toBe(true);
  });
  test('an unnamed merge once ready ends with its message', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge it once CI passes');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 40 --auto'), 'merge')).toBe(true);
  });
  test('a merge asked for once ready ends on a merge hold, telling the agent', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await say($, 'merge 46 once CI passes');
    await say($, 'hold off on the docs push');
    await say($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 46 --auto'))).toBe(true);
    await say($, 'merge 47 once CI passes');
    await say($, "don't merge 47 yet");
    expect(w.contexts?.join('\n')).toContain("ended the user's standing ask to merge #47");
    await say($, 'merge 48 once CI passes');
    await say($, 'do not push. do not merge 48');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 48 --auto'), 'merge')).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 47 --auto'), 'merge')).toBe(true);
  });
  test('a main condition joins a standing release whose lookup fails', async ($, on) => {
    let listing = true;
    fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('gh api graphql')) return { stdout: 'main PENDING\n' };
        if (a.startsWith('gh pr list --head oakum/version-packages')) {
          return listing
            ? { stdout: '62:OPEN 55:MERGED\n' }
            : { exitCode: 1, stderr: 'gh: timeout' };
        }
        return github('oakum/version-packages')(a);
      },
    });
    await say($, 'release when the release PR is ready');
    listing = false;
    await say($, 'Ok, when main is done and the release PR is ready lets merge it');
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'Run the same command again')).toBe(true);
  });
  test('a release asked for once main and the release PR are ready waits on main', async ($, on) => {
    let rollup = 'PENDING';
    fakeWorld(on, {
      git: (a) => {
        if (a.startsWith('gh api graphql')) return { stdout: `main ${rollup}\n` };
        if (a.startsWith('gh pr list --head oakum/version-packages')) {
          return { stdout: '62:OPEN 55:MERGED\n' };
        }
        return github('oakum/version-packages')(a);
      },
    });
    await say($, 'Ok, when main is done and the release PR is ready lets merge it');
    await say($, 'While we wait on that lets plan out our next bit of work');
    await say($, 'pr-watch: #62 is ready to merge', 'plugin');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'Run the same command again')).toBe(true);
    rollup = 'SUCCESS';
    expect(ran(await bash($, 'gh pr merge 62 --auto'))).toBe(true);
    await say($, 'thanks');
    expect(denied(await bash($, 'gh pr merge 62 --auto'), 'release')).toBe(true);
  });
  test('a queued message keeps what the earlier one pointed at, until it retracts', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    await endTurn($, 'answer', farUp);
    await say($, 'merge that PR');
    await queue($, 'thanks');
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
    await say($, 'merge 41');
    await queue($, "actually, don't merge it");
    await queue($, 'merge it');
    expect(denied(await bash($, 'gh pr merge 41 --squash'), 'named #41')).toBe(true);
  });
  test('a merge naming no pull request asks when the branch read fails', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('merge') }, git: github('fix/x') });
    w.reject = (a) => a === 'git symbolic-ref --quiet --short HEAD';
    await say($, 'merge it');
    const r = await bash($, 'gh pr merge 200 --squash');
    expect(denied(r, 'pointed at #200: reading the current branch failed (')).toBe(true);
    expect(denied(r, '"Merge #200?"')).toBe(true);
  });
  test('an unanswered reading refuses, says why, and is asked again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: 'error',
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    const r = await bash($, 'gh pr merge 74 --squash');
    expect(denied(r, 'the user asked to merge #52')).toBe(true);
    expect(
      denied(r, 'could not judge whether the answer offered #52 (an API error, overloaded)'),
    ).toBe(true);
    w.target = 'throw';
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'model blocked')).toBe(true);
    w.target = MENTIONED;
    expect(ran(await bash($, 'gh pr merge 74 --squash'))).toBe(true);
  });
  test('an unread or unsure reading refuses and is not asked again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: '{"offers": "no", "sure": true}',
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'its reply could not be read')).toBe(
      true,
    );
    w.target = MENTIONED;
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    w.target = '{"offers": false, "sure": false}';
    await say($, 'ok, lets merge');
    const r = await bash($, 'gh pr merge 74 --squash');
    expect(denied(r, 'the user asked to merge #52')).toBe(true);
    expect(denied(r, 'could not judge')).toBe(false);
  });
  test('a reading belongs to its message', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    expect(ran(await bash($, 'gh pr merge 74 --squash'))).toBe(true);
    expect(ran(await bash($, 'gh pr merge 74 --squash'))).toBe(true);
    await endTurn($, 'answer', mentioned);
    w.target = OFFERED;
    await say($, 'ok, lets merge');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    expect(w.modelPrompts?.filter((p) => p.includes('The candidate:'))).toHaveLength(2);
  });
  test('a pull request an earlier queued message typed is not read again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'merge 52');
    await queue($, 'ok, lets merge');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    expect(w.modelPrompts?.some((p) => p.includes('The candidate:'))).not.toBe(true);
  });
  test('a merge a queued message joined is not read again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge');
    await queue($, 'push it');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    expect(w.modelPrompts?.some((p) => p.includes('The candidate:'))).not.toBe(true);
  });
  test('a merge from the Agent SDK is not read again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, lets merge', 'sdk');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    expect(w.modelPrompts?.some((p) => p.includes('The candidate:'))).not.toBe(true);
  });
  test('a pull request the message named is not read again', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { local: stops('release') },
      git: github('fix/x'),
      target: MENTIONED,
    });
    await endTurn($, 'answer', mentioned);
    await say($, 'ok, merge 52');
    expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
      true,
    );
    expect(w.modelPrompts?.some((p) => p.includes('The candidate:'))).not.toBe(true);
  });
  test(
    'with the model check off, the pull request the answer named stands',
    {
      options: { modelCheck: false },
    },
    async ($, on) => {
      fakeWorld(on, {
        settings: { local: stops('release') },
        git: github('fix/x'),
        target: MENTIONED,
      });
      await endTurn($, 'answer', mentioned);
      await say($, 'ok, lets merge');
      expect(denied(await bash($, 'gh pr merge 74 --squash'), 'the user asked to merge #52')).toBe(
        true,
      );
    },
  );
  test('a merge once ready whose lookup fails asks for a release too', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('release') }, git: github('fail') });
    await say($, 'merge it when its ready');
    const r = await bash($, 'gh pr merge 62 --auto');
    expect(denied(r, 'the gate cannot tell whether this is it')).toBe(true);
    expect(denied(r, 'looking up the pull request it merges failed')).toBe(true);
    // A bare --auto merge needs no lookup to point at the branch's pull request.
    const bare = await bash($, 'gh pr merge --auto');
    expect(denied(bare, 'the merge may be a release, which the user has not allowed')).toBe(true);
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
      denied(await bash($, 'git commit -am x && gh pr merge 116'), '`gh` alongside `git commit`'),
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
    const unnamed = await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' });
    expect(denied(unnamed, 'which the request did not name')).toBe(true);
    await say($, 'push it to main');
    expect(ran(await mcp($, 'mcp__github__push_files', { ...files, branch: 'main' }))).toBe(true);
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
  test('a subagent naming gh as data runs', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('never stop') } });
    await say($, 'fix the parser');
    const sub = { agentId: 'sub-1' };
    expect(ran(await bash($, 'for c in none gh docs; do echo "$c"; done', sub))).toBe(true);
    expect(ran(await bash($, 'which gh go', sub))).toBe(true);
    expect(ran(await bash($, 'select x in a gh b; do break; done', sub))).toBe(true);
    const merge = await bash($, '[ -x /usr/local/bin/gh ] && gh pr merge 5', sub);
    expect(denied(merge, 'subagents do not commit, push, open, merge')).toBe(true);
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
    expect(denied(await bash($, force), '"Push to `main`?"')).toBe(true);
    await say($, 'force push to main without a lease');
    expect(ran(await bash($, force))).toBe(true);
  });
  test('a GitHub MCP merge without a number asks where a release could follow', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: stops('release') }, git: github('fix/x') });
    await say($, 'fix the parser');
    const r = await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 });
    expect(denied(r, 'does not name the pull request by number and repository')).toBe(true);
    await say($, 'merge it');
    expect(
      denied(
        await mcp($, 'mcp__github__merge_pull_request', { pullNumber: 5 }),
        'the gate cannot tell whether this is it',
      ),
    ).toBe(true);
    await endTurn($, 'answer', farUp.replace('#40', '#5'));
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
  test('a commit rung asks before a reviewed --continue, and a yes continues', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'fix the parser');
    const r = await bash($, 'GIT_EDITOR=true git rebase --continue');
    expect(denied(r, "doesn't ask for a commit")).toBe(true);
    const offer = 'Commit the resolution to `fix/x` and finish the rebase?';
    expect(denied(r, `"${offer}"`)).toBe(true);
    await ($ as any).turn.complete({
      answer: `Reviewed and clean. ${offer}`,
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'yes');
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('"ok continue" to the offer continues, and commits nothing else', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'fix the parser');
    expect(denied(await bash($, 'GIT_EDITOR=true git rebase --continue'), 'commit')).toBe(true);
    await ($ as any).turn.complete({
      answer: 'Reviewed and clean. Commit the resolution to `fix/x` and finish the rebase?',
      durationMs: 1,
      isAborted: false,
      turnId: 'main-1',
      reason: 'answer',
    });
    await say($, 'ok continue');
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
  });
  test('a finish waiting on CI lets nothing through', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'when CI passes, finish the rebase, then merge it');
    expect(denied(await bash($, 'GIT_EDITOR=true git rebase --continue'), 'commit')).toBe(true);
  });
  test('"finish the rebase" lets that --continue through a commit rung, and nothing else', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('commit') } });
    await review($);
    await say($, 'finish the rebase');
    expect(denied(await bash($, 'GIT_EDITOR=true git merge --continue'), 'commit')).toBe(true);
    expect(denied(await bash($, 'git commit -am x'), "doesn't ask for a commit")).toBe(true);
    expect(ran(await bash($, 'GIT_EDITOR=true git rebase --continue'))).toBe(true);
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
      mandate: null,
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

describe('the Codex command log', () => {
  const E = String.fromCodePoint(27);
  const LOG = [
    'OpenAI Codex v0.162.1',
    `${E}[35m${E}[3mexec${E}[0m${E}[0m`,
    `${E}[1m/bin/zsh -lc 'pnpm test'${E}[0m in /repo`,
    `${E}[31m exited 1 in 147ms:${E}[0m`,
    'failed to load config',
  ].join('\n');
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
    });
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

const pushRan = async ($: any) => ran(await bash($, 'git push origin fix/x'));

describe('an epic mandate', () => {
  const START = 'ok, lets do epic cpl-czgp';

  test('"do epic <id>" lets pushes and pull requests run, never a merge', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    expect(await pushRan($)).toBe(true);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
    expect(denied(await bash($, 'gh pr merge 5 --squash'), 'merge')).toBe(true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toMatchObject({ stopBefore: 'merge', source: 'mandate' });
    expect(status.stopBefore.mandate).toEqual({ epic: 'cpl-czgp' });
  });
  test('it lasts past a message that does not touch it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(true);
  });
  test('a hold ends it, and it stays ended', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'hold off on pushing for now');
    expect(denied(await bash($, 'git push origin fix/x'), 'held off')).toBe(true);
    // "push it" lifts the hold for itself; the job does not come back.
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a start that holds, declines or waits starts nothing', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    for (const text of ["don't do epic cpl-czgp yet", 'do epic cpl-czgp after lunch']) {
      await say($, text);
      expect(await pushRan($)).toBe(false);
    }
  });
  test('a decline of the offer it answers starts none', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await endTurn($, 'answer', 'Push it?');
    await say($, 'Not yet. Do epic cpl-czgp.');
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a hold on any step ends it, a merge mentioned beside a stop included', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'did the merge of 41 go through?');
    await say($, 'push it');
    expect(await pushRan($)).toBe(true);
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
    await say($, START);
    await say($, 'Stop the epic. Do not merge anything.');
    await say($, 'push it');
    await say($, 'how is the parser coming along?');
    expect(await pushRan($)).toBe(false);
  });
  test('a retraction ends it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START);
    await say($, 'stop the epic');
    expect(await pushRan($)).toBe(false);
  });
  test('the Agent SDK starts one, and the agent is told why a step ran', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, START, 'sdk');
    const r = await bash($, 'git push origin fix/x');
    expect(ran(r)).toBe(true);
    expect(contextOf(r).join('\n')).toContain('raised by the user\'s "do epic" request');
  });
  test('a prompt no person typed neither starts nor ends it', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await say($, 'do epic cpl-czgp', 'task-notification');
    expect(await pushRan($)).toBe(false);
    await say($, START);
    await say($, 'hold off on pushing', 'task-notification');
    expect(await pushRan($)).toBe(true);
  });
  test('a push to the default branch still asks', async ($, on) => {
    const main = { 'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'] };
    fakeWorld(on, pushing({ git: remoteSide(main) }));
    await say($, START);
    const r = await bash($, 'git push origin main');
    expect(denied(r, 'it pushes to `main`, the default branch.')).toBe(true);
  });
  test('a setting that stops later stands', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('release') }, git: remoteSide({}) }));
    await say($, START);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.stopBefore).toMatchObject({ stopBefore: 'release', source: 'local' });
  });
});

describe('the model check', () => {
  const SHIP = 'Ok, lets ship the react aria update';
  const LINE =
    'review-cycle: the model check read "ship the react aria update" as asking for a push.';
  const OFF = { options: { modelCheck: false } };

  test('a push the grammar refuses runs on its yes, shown and kept with the misses', async ($, on) => {
    const w = fakeWorld(on, pushing({ model: verdictFor('push', 'ship the react aria update') }));
    await say($, SHIP);
    const r = await bash($, 'git push origin fix/x');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), LINE)).toBe(true);
    expect(has(contextOf(r), 'without the user asking')).toBe(false);
    expect(has(contextOf(r), 'without asking, since')).toBe(false);
    expect(w.logs).toEqual([LINE]);
    expect(w.modelCalls).toMatchObject([
      {
        system: expect.stringContaining('does it ask the agent to take any of these steps now'),
        maxTokens: 300,
      },
    ]);
    const misses = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    expect(JSON.parse((misses as { result: string }).result).misses).toEqual([
      {
        message: SHIP,
        offer: '',
        steps: ['push'],
        refusal: 'granted by the model check: "ship the react aria update"',
      },
    ]);
  });
  test('is not asked about a push the user asked for that goes somewhere they did not name', async ($, on) => {
    let calls = 0;
    const git = remoteSide({
      'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'],
    });
    fakeWorld(
      on,
      pushing({ git, model: verdictFor('push', 'push it'), onModel: () => void calls++ }),
    );
    await say($, 'push it');
    expect(denied(await bash($, 'git push origin main'), 'which the request did not name')).toBe(
      true,
    );
    expect(calls).toBe(0);
  });
  test('a newer message during the call stops the step, and nothing is shown or kept', async ($, on) => {
    const w = fakeWorld(
      on,
      pushing({
        model: verdictFor('push', 'ship the react aria update'),
        onModel: () => void say($, 'wait, stop'),
      }),
    );
    await say($, SHIP);
    expect(denied(await bash($, 'git push origin fix/x'), 'sent a new message')).toBe(true);
    expect(w.logs ?? []).toEqual([]);
    const misses = await $.tool.call({ tool: 'mcp__review-cycle__misses' });
    expect(JSON.parse((misses as { result: string }).result).misses).toEqual([]);
  });
  test('a request typed in during the call stops a step only its yes allowed', async ($, on) => {
    fakeWorld(
      on,
      pushing({
        model: verdictFor('push', 'ship the react aria update'),
        onModel: () =>
          void ($ as any).prompt.submit({
            text: 'Lets file the beads',
            origin: { kind: 'composer' },
            wait: false,
            turnId: 't',
          }),
      }),
    );
    await say($, SHIP);
    expect(denied(await bash($, 'git push origin fix/x'), 'sent a new message')).toBe(true);
  });
  test('its yes covers neither a force push nor a step it did not grant', async ($, on) => {
    fakeWorld(on, pushing({ model: verdictFor('push', 'ship the react aria update') }));
    await say($, SHIP);
    expect(ran(await bash($, 'git push --force origin fix/x'))).toBe(false);
    expect(ran(await bash($, 'gh pr review 116 -a'))).toBe(false);
    expect(ran(await bash($, 'gh release create v1'))).toBe(false);
  });
  test('a gh push to the default branch it grants still asks', async ($, on) => {
    const model = verdictFor('push', 'ship the react aria update');
    fakeWorld(on, { git: github('fix/x'), model });
    await say($, SHIP);
    const r = await bash($, 'gh api repos/{owner}/{repo}/contents/a.md -X PUT -f branch=main');
    expect(denied(r, 'it pushes to `main`, the default branch')).toBe(true);
  });
  test('its yes to a pull request lets the push it needs run', async ($, on) => {
    const w = fakeWorld(on, pushing({ model: verdictFor('pr', 'send it up for review') }));
    await say($, 'sure, send it up for review');
    const r = await bash($, 'git push origin fix/x');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'without the user asking')).toBe(false);
    expect(has(contextOf(r), 'without asking, since')).toBe(false);
    expect(w.logs).toEqual([
      'review-cycle: the model check read "send it up for review" as asking for a pull request.',
    ]);
  });
  test('a push beside a pull request its yes allowed is still reported', async ($, on) => {
    fakeWorld(on, pushing({ model: verdictFor('pr', 'send it up for review') }));
    await say($, 'sure, send it up for review');
    const r = await bash($, 'gh pr create --fill && ./release.sh');
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), 'pushed to origin/fix/x without the user asking')).toBe(true);
  });
  test('its yes to a pull request leaves a push hold in place', async ($, on) => {
    fakeWorld(on, pushing({ model: verdictFor('pr', 'send it up for review') }));
    await say($, 'send it up for review, but keep my local commits off the push');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
  });
  test('its yes to a push leaves a pull request held', async ($, on) => {
    const model = verdictFor('push', 'ship the react aria update');
    fakeWorld(on, { settings: { local: stops('never stop') }, model });
    await say($, SHIP);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(false);
  });
  test('an approval and a release run on its yes', async ($, on) => {
    const w = fakeWorld(on, { model: verdictFor('approve', 'sign off on 116') });
    await say($, 'go ahead and sign off on 116');
    const approved = await bash($, 'gh pr review 116 -a');
    expect(ran(approved)).toBe(true);
    expect(has(contextOf(approved), 'without asking, since')).toBe(false);
    w.model = verdictFor('release', 'cut it');
    await say($, 'yep, cut it');
    const released = await bash($, 'gh release create v1');
    expect(ran(released)).toBe(true);
    expect(has(contextOf(released), 'without asking, since')).toBe(false);
  });
  test('a GitHub tool runs on its yes, told and shown', async ($, on) => {
    const w = fakeWorld(on, { model: verdictFor('pr', 'ship the react aria update') });
    await say($, SHIP);
    const r = await mcp($, 'mcp__github__create_pull_request', {});
    const line =
      'review-cycle: the model check read "ship the react aria update" as asking for a pull request.';
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), line)).toBe(true);
    expect(w.logs).toEqual([line]);
  });
  test('a failed call is asked again by the next step', async ($, on) => {
    const w = fakeWorld(on, pushing({ model: 'error' }));
    await say($, SHIP);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    w.model = verdictFor('push', 'ship the react aria update');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    expect(w.modelPrompts).toHaveLength(2);
  });
  test('it is sent the message and the offer it answered', async ($, on) => {
    const w = fakeWorld(on);
    await ($ as any).turn.complete({ answer: 'Fixed.\nPush fix/x to origin?', reason: 'answer' });
    await say($, 'sure, send it up');
    await bash($, 'git push origin fix/x');
    expect(w.modelPrompts).toEqual([
      "The agent's last question:\n<question>\nFixed.\nPush fix/x to origin?\n</question>\n\nThe person's latest message:\n<message>\nsure, send it up\n</message>",
    ]);
  });
  test('a pull request the grammar refuses runs on its yes', async ($, on) => {
    const w = fakeWorld(on, { model: verdictFor('pr', 'ship the react aria update') });
    await say($, SHIP);
    const r = await bash($, 'gh pr create --fill');
    const line =
      'review-cycle: the model check read "ship the react aria update" as asking for a pull request.';
    expect(ran(r)).toBe(true);
    expect(has(contextOf(r), line)).toBe(true);
    expect(has(contextOf(r), 'without asking, since')).toBe(false);
    expect(w.logs).toEqual([line]);
  });
  test('a no, or a step tied to a condition, leaves the refusal as it was', async ($, on) => {
    const w = fakeWorld(on, {
      model: verdictFor('push', 'ship the react aria update', { condition: true }),
    });
    await say($, SHIP);
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, 'so nothing ran.')).toBe(true);
    expect(denied(r, 'model check')).toBe(false);
    expect(w.logs ?? []).toEqual([]);
  });
  for (const [model, command, why] of [
    ['error', 'git push origin fix/x', 'an API error, overloaded'],
    ['error', 'gh pr create --fill', 'an API error, overloaded'],
    ['aborted', 'git push origin fix/x', 'it ran out of time or was interrupted'],
    ['throw', 'git push origin fix/x', ''],
    [verdictFor('push', 'words never typed'), 'git push origin fix/x', 'its reply quoted words'],
  ]) {
    const label = why === '' ? model : why;
    test(`a failed call (${label}) refuses ${command}, naming why`, async ($, on) => {
      fakeWorld(on, { model });
      await say($, SHIP);
      const r = await bash($, command ?? '');
      expect(denied(r, `The model check could not judge the message (${why}`)).toBe(true);
    });
  }
  test('a reply it cannot read refuses, saying so', async ($, on) => {
    fakeWorld(on, { model: 'it asks to push' });
    await say($, SHIP);
    const r = await bash($, 'git push origin fix/x');
    expect(denied(r, 'could not judge the message (its reply could not be read)')).toBe(true);
  });
  test('a push to the default branch it grants still asks', async ($, on) => {
    const main = { 'origin main': [' \trefs/heads/main:refs/heads/main\tb65222b..9f4a349'] };
    const model = verdictFor('push', 'ship the react aria update');
    fakeWorld(on, pushing({ git: remoteSide(main), model }));
    await say($, SHIP);
    const r = await bash($, 'git push origin main');
    expect(denied(r, 'asks whatever the setting: it pushes to `main`, the default branch.')).toBe(
      true,
    );
  });
  test('it is asked once per message', async ($, on) => {
    const w = fakeWorld(on);
    await say($, SHIP);
    await bash($, 'git push origin fix/x');
    await bash($, 'gh pr create --fill');
    expect(w.modelPrompts).toHaveLength(1);
    await say($, 'and the docs?');
    await bash($, 'git push origin fix/x');
    expect(w.modelPrompts).toHaveLength(2);
  });
  test('a step the grammar grants is never sent to it', async ($, on) => {
    const w = fakeWorld(on, pushing({}));
    await say($, 'push it');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
    expect(w.modelPrompts).toBeUndefined();
  });
  test('after a message that declined a step, it is never asked', async ($, on) => {
    const w = fakeWorld(on, pushing({ model: verdictFor('push', 'not yet') }));
    await ($ as any).turn.complete({ answer: 'Fixed.\nPush fix/x to origin?', reason: 'answer' });
    await say($, 'not yet');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    expect(w.modelPrompts).toBeUndefined();
  });
  test('switched off in /config, it is never asked', OFF, async ($, on) => {
    const w = fakeWorld(on, { model: verdictFor('push', 'ship the react aria update') });
    await say($, SHIP);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    expect(w.modelPrompts).toBeUndefined();
  });
  test('under claude -p it is never asked', async ($, on) => {
    const w = fakeWorld(on, { model: verdictFor('push', 'ship the react aria update') });
    await say($, SHIP, 'sdk');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    expect(w.modelPrompts).toBeUndefined();
  });
  test('only the user switches it, in /config', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.modelCheck',
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

// A world whose engine expands a skill as the hooks above it leave it.
function world(on: any, setup: Partial<World> = {}) {
  on('skill.prompt', ($$: unknown, e: { text: string }) => ({ text: e.text }));
  return fakeWorld(on, setup);
}

const handedBack = (r: any) =>
  (r.messages as { text: string }[]).filter((m) => m.text.startsWith('review-cycle:'));

describe('a compaction during a review', () => {
  // The skill as expanded; the re-attached copy is cut inside Phase 2.
  const SKILL = `Base directory for this skill: /plugins/review-cycle/skills/review\n\n# Review\n\n### Phase 1\n\n${'one '.repeat(4000)}\n\n### Phase 2\n\n${'two '.repeat(2000)}the later phase\n`;
  const SUMMARY = { role: 'user' as const, text: 'This session is being continued.', toolUses: [] };

  // The transcript the engine hands a compaction; the stand-in summarizer ignores it.
  const compact = ($: any, agentId?: string) =>
    $.session.compact({ messages: [SUMMARY], ...(agentId ? { agentId } : {}) });

  async function loadSkill($: any, over: Record<string, unknown> = {}) {
    await $.skill.prompt({
      skill: 'review-cycle:review',
      text: SKILL,
      source: 'plugin',
      pluginName: 'review-cycle',
      ...over,
    });
  }

  function compactsTo(on: any, messages: object[] = [SUMMARY]) {
    on('session.compact', () => ({ messages }));
  }

  test('hands back the phases the re-attached copy drops', async ($, on) => {
    world(on);
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: 123 }));
    await loadSkill($);
    const raw = { role: 'user' as const, text: 'the transcript before compaction', toolUses: [] };
    const r = await ($ as any).session.compact({ messages: [raw] });
    expect(r.messages[0]).toMatchObject({ text: SUMMARY.text });
    expect(r.messages.some((m: { text: string }) => m.text === raw.text)).toBe(false);
    expect(r.tokensAfter).toBe(123);
    const [back] = handedBack(r);
    expect(back).toMatchObject({ role: 'user', toolUses: [] });
    expect(back?.text).toContain('### Phase 2\n\ntwo ');
    expect(back?.text).toContain('the later phase');
    expect(back?.text).not.toContain('### Phase 1');
  });
  test('hands back nothing before the review skill loads', async ($, on) => {
    world(on);
    compactsTo(on);
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
    expect(handedBack(r)).toEqual([]);
  });
  test("hands back nothing for a subagent's compaction", async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($);
    const r = await compact($, 'sub-1');
    expect(r.messages).toHaveLength(1);
  });
  test('hands back nothing once the reviewed work is committed', async ($, on) => {
    fakeStore(on);
    world(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    compactsTo(on);
    await loadSkill($);
    await review($);
    expect(handedBack(await compact($))).toHaveLength(1);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
  });
  test('hands back nothing a second time', async ($, on) => {
    world(on);
    let messages: (typeof SUMMARY)[] = [SUMMARY];
    on('session.compact', () => ({ messages }));
    await loadSkill($);
    const first = await compact($);
    expect(handedBack(first)).toHaveLength(1);
    messages = first.messages;
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test('a summary computed during the review drops the phases once it is committed', async ($, on) => {
    fakeStore(on);
    world(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    let messages: (typeof SUMMARY)[] = [SUMMARY];
    on('session.compact', () => ({ messages }));
    await loadSkill($);
    await review($);
    const during = await compact($);
    messages = during.messages;
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const r = await compact($);
    expect(r.messages).toEqual([SUMMARY]);
  });
  test('only review-cycle loading its review skill starts it', async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($, { pluginName: 'other', source: 'projectSettings' });
    await loadSkill($, { skill: 'review-cycle:review-pr' });
    expect(handedBack(await compact($))).toEqual([]);
  });
  test("a subagent's review hands the main conversation nothing", async ($, on) => {
    world(on, { skillRun: () => loadSkill($) });
    compactsTo(on);
    await skill($, 'review-cycle:review', 'sub');
    expect(handedBack(await compact($))).toEqual([]);
    await skill($, '/review-cycle:review', 'sub');
    expect(handedBack(await compact($))).toEqual([]);
    await skill($, 'review-cycle:review');
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test("a subagent's other skill does not hide the main conversation's review", async ($, on) => {
    world(on, { skillRun: () => loadSkill($) });
    compactsTo(on);
    await skill($, 'other:thing', 'sub');
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test('keeps the text the model reads, not the one the skill computed', async ($, on) => {
    on('skill.prompt', ($$: unknown, e: { text: string }) => ({
      text: `${'x'.repeat(30_000)}\n\n${e.text}`,
    }));
    fakeWorld(on);
    compactsTo(on);
    await loadSkill($);
    const [back] = handedBack(await compact($));
    expect(back?.text).toContain('xxxx');
  });
  test('/clear clears the kept record too', async ($, on) => {
    world(on);
    on('session.end', () => ({ sessionId: 's' }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await loadSkill($);
    await settle();
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await settle();
    expect(kept?.value.reviewing).toBeNull();
  });
  test(
    'switching the gate off forgets a review in flight',
    { options: { enabled: false } },
    async ($, on) => {
      world(on);
      let kept: any = 'unset';
      on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
        if (e.key === 'gate') kept = e.value;
        return next(e);
      });
      reloadInto(on, keptRecord({ reviewing: SKILL }));
      await startSession($);
      await settle();
      expect(kept?.value.reviewing).toBeNull();
    },
  );
  test('the loaded skill is kept for a reload', async ($, on) => {
    world(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await loadSkill($);
    await settle();
    expect(kept?.value.reviewing).toBe(SKILL);
  });
  test('a session ended by /clear ends it', async ($, on) => {
    world(on);
    compactsTo(on);
    on('session.end', () => ({ sessionId: 's' }));
    await loadSkill($);
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
  });
  test(
    'the gate switched off still hands it back',
    { options: { enabled: false } },
    async ($, on) => {
      world(on);
      compactsTo(on);
      await loadSkill($);
      expect(handedBack(await compact($))).toHaveLength(1);
    },
  );
  test('a review in flight outlives a reload', async ($, on) => {
    world(on);
    compactsTo(on);
    reloadInto(on, keptRecord({ reviewing: SKILL }));
    await startSession($);
    expect(handedBack(await compact($))).toHaveLength(1);
  });
});
