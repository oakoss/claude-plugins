// Scores review-cycle's consent check against the labeled corpus: each message
// goes to the grammar first and, where the grammar grants nothing, to the
// model's reply through judge(), as the gate does. Prints the wrong yeses (a
// step the label does not allow), the misses (a labeled message nothing
// grants), the model's partial grants (a labeled step it leaves out), and the
// messages the grammar refuses that have no reply.
//
//   node scripts/consent-model.ts              replay the recorded replies
//   node scripts/consent-model.ts live [n]     ask the model, as the gate does,
//                                              for every message the grammar
//                                              refuses (or the first n), and
//                                              score those replies
//   node scripts/consent-model.ts adopt <file> record a live run's replies
//   node scripts/consent-model.ts add <file>   add labeled rows ([{ prompt,
//                                              offer?, may }]) to the corpus,
//                                              asking the model only about
//                                              those the grammar refuses
//
// A live run needs Claude Code signed in and costs about $0.001 a message
// (inferred from the 2026-10-13 run: about $0.30 for 299).

/* oxlint-disable eslint/no-console -- a command-line report: printing is its output */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Case = { prompt: string; offer?: string; may: string[]; missed?: boolean };
type Reply = { prompt: string; offer?: string; reply: string };
type Recorded = {
  rules: string;
  model: string;
  effort: string;
  recorded: string;
  // What the run measured, so a claim about latency or tokens can be checked.
  measured?: { p50Ms: number; p95Ms: number; tokens: number };
  // The prompts judge grants from these replies, which the spec holds judge to.
  granted: string[];
  replies: Reply[];
};
type Live = Reply & { ms: number; usage: Record<string, number> | null; error?: string };
type Grant = Record<string, unknown> & { push: string; finish: readonly unknown[] };
type ModelGrant = { push: string; pr: boolean; approve: boolean; release: boolean };
type Judged = { kind: 'granted'; grant: ModelGrant } | { kind: 'refused'; why: string };
type Model = {
  RULES: string;
  askOf: (message: string, offer: string) => string;
  offerOf: (answer: string) => string;
  judge: (reply: string, message: string) => Judged;
};

// The gate's call (register.ts askModel); a live run that differs measures something else.
const CALL = { model: 'sonnet', effort: 'low', maxTokens: 300, timeoutMs: 15_000 };

const HOOKS = 'plugins/review-cycle/hooks';
const REPLIES = join(HOOKS, 'consent-model.replies.json');
const read = (name: string) => readFileSync(join(HOOKS, name), 'utf8');

// Node strips types but resolves only full paths, and the hooks import each
// other bare ('./consent'); each module is copied with the modules it imports
// at runtime, every relative import spelled out.
const RUNTIME_IMPORT = /^import\s+(?!type\b)[^;]*?\sfrom\s+'\.\/([\w-]+)'/gm;
const dir = mkdtempSync(join(tmpdir(), 'consent-model-'));
const copy = (name: string): void => {
  if (existsSync(join(dir, `${name}.ts`))) return;
  const source = read(`${name}.ts`);
  writeFileSync(
    join(dir, `${name}.ts`),
    source.replaceAll(/from '\.\/([\w-]+)'/g, "from './$1.ts'"),
  );
  for (const [, next] of source.matchAll(RUNTIME_IMPORT)) if (next) copy(next);
};
let grantOf: (prompt: string, offer?: string) => Grant;
let model: Model;
// The spec's check of the replies' rules, by the same hash.
let rulesHash: (rules: string) => string;
try {
  for (const name of ['consent', 'consent-model', 'ledger']) copy(name);
  ({ hashOf: rulesHash } = (await import(pathToFileURL(join(dir, 'ledger.ts')).href)) as {
    hashOf: typeof rulesHash;
  });
  ({ grantOf } = (await import(pathToFileURL(join(dir, 'consent.ts')).href)) as {
    grantOf: typeof grantOf;
  });
  model = (await import(pathToFileURL(join(dir, 'consent-model.ts')).href)) as Model;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const corpus = JSON.parse(read('consent.corpus.json')) as Case[];
const recorded = JSON.parse(readFileSync(REPLIES, 'utf8')) as Recorded;
const keyOf = (c: { prompt: string; offer?: string }) => `${c.prompt}\u0000${c.offer ?? ''}`;

// As consent.corpus.spec.ts and consent-model.spec.ts count them, so a row add writes passes both.
const grammarSteps = (g: Grant): string[] =>
  [
    g.push === 'none' ? '' : 'push',
    g.pr ? 'pr' : '',
    g.merge || g.autoMerge ? 'merge' : '',
    g.approve ? 'approve' : '',
    g.release ? 'release' : '',
    g.comment ? 'comment' : '',
    g.finish.length > 0 ? 'finish' : '',
  ].filter(Boolean);

const modelSteps = (j: Judged): string[] =>
  j.kind === 'granted'
    ? [
        j.grant.push === 'none' ? '' : 'push',
        j.grant.pr ? 'pr' : '',
        j.grant.approve ? 'approve' : '',
        j.grant.release ? 'release' : '',
      ].filter(Boolean)
    : [];

const refused = corpus.filter((c) => grammarSteps(grantOf(c.prompt, c.offer)).length === 0);

// A case recorded more than once is scored by every reply, as the spec checks
// them: a step any of them grants counts.
function score(replies: readonly Reply[]): { wrong: number; unreplied: number } {
  const replyOf = new Map<string, string[]>();
  for (const r of replies) replyOf.set(keyOf(r), [...(replyOf.get(keyOf(r)) ?? []), r.reply]);
  type Row = { c: Case; by: 'grammar' | 'model' | 'none'; got: string[] };
  const rows: Row[] = [];
  const unreplied: Case[] = [];
  for (const c of corpus) {
    const grammar = grammarSteps(grantOf(c.prompt, c.offer));
    if (grammar.length > 0) {
      rows.push({ c, by: 'grammar', got: grammar });
      continue;
    }
    const said = replyOf.get(keyOf(c)) ?? [];
    if (said.length === 0) unreplied.push(c);
    const got = [...new Set(said.flatMap((reply) => modelSteps(model.judge(reply, c.prompt))))];
    rows.push({ c, by: got.length > 0 ? 'model' : 'none', got });
  }
  const labeled = rows.filter((r) => r.c.may.length > 0);
  const wrong = rows.filter((r) => r.got.some((s) => !r.c.may.includes(s)));
  const missed = labeled.filter((r) => r.got.length === 0);
  // `may` lists what a message is allowed to grant, not what it must, so only
  // the model's grants are held to it: a ship it read as a push alone leaves the PR.
  const partial = labeled.filter(
    (r) => r.by === 'model' && r.c.may.some((s) => s !== 'merge' && !r.got.includes(s)),
  );
  const show = (r: Row) => {
    const offer = r.c.offer === undefined ? '' : ` ‹after› ${r.c.offer.split('\n').at(-1)}`;
    return `  ${JSON.stringify(r.c.prompt)}${offer}: may [${r.c.may.join(', ')}], ${r.by} granted [${r.got.join(', ')}]`;
  };
  const section = (title: string, list: Row[]) => {
    console.log(`${title}: ${list.length}`);
    for (const r of list) console.log(show(r));
  };
  console.log(
    `${corpus.length} cases, ${labeled.length} labeled with a step; grammar grants ` +
      `${rows.filter((r) => r.by === 'grammar').length}, the model ` +
      `${rows.filter((r) => r.by === 'model').length}; ${replies.length} replies to ${replyOf.size} messages`,
  );
  section('wrong yeses', wrong);
  section('missed', missed);
  section('partial', partial);
  // A live run over the first n leaves the rest unreplied, so they are counted, not listed.
  console.log(`refused by the grammar with no reply: ${unreplied.length}`);
  if (unreplied.length <= 20)
    for (const c of unreplied) console.log(`  ${JSON.stringify(c.prompt)}`);
  return { wrong: wrong.length, unreplied: unreplied.length };
}

// A throwaway mod whose /consent-probe makes the gate's call for each request
// and writes what came back; $.model.complete is reachable only from a mod.
function probe(requests: readonly { prompt: string; offer?: string }[], out: string): string {
  const root = mkdtempSync(join(tmpdir(), 'consent-probe-'));
  mkdirSync(join(root, '.claude-plugin'));
  mkdirSync(join(root, 'hooks'));
  writeFileSync(
    join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({
      name: 'consent-probe',
      version: '0.0.0',
      description: 'consent:model live run',
    }),
  );
  writeFileSync(join(root, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.ts'] }));
  // The gate cuts the offer with offerOf before asking, so the probe does too.
  const asks = requests.map((r) => ({
    ...r,
    ask: model.askOf(r.prompt, model.offerOf(r.offer ?? '')),
  }));
  // Written after every call, so a run cut short keeps what it paid for.
  writeFileSync(
    join(root, 'hooks/register.ts'),
    `import type { Register } from 'claude-code';
const RULES = ${JSON.stringify(model.RULES)};
const HASH = ${JSON.stringify(rulesHash(model.RULES))};
const ASKS = ${JSON.stringify(asks)};
const CALL = ${JSON.stringify(CALL)};
const OUT = ${JSON.stringify(out)};
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'consent-probe', description: 'consent:model live run' });
    return next(e);
  });
  on('command.run', { command: 'consent-probe' }, async ($) => {
    const results = [];
    for (const a of ASKS) {
      const base = { prompt: a.prompt, offer: a.offer };
      try {
        const started = await $.clock.now();
        const r = await $.model.complete({ ...CALL, system: [{ text: RULES, cache: true }], prompt: a.ask });
        const ms = (await $.clock.now()) - started;
        results.push(r.isAnswered
          ? { ...base, reply: r.text, ms, usage: r.usage }
          : { ...base, reply: '', ms, usage: null, error: r.reason });
      } catch (error) {
        results.push({ ...base, reply: '', ms: 0, usage: null, error: String(error) });
      }
      await $.fs.write(OUT, JSON.stringify({ rules: HASH, results }, null, 2));
    }
    const failed = results.filter((r) => r.error !== undefined).length;
    return { text: results.length + ' asked, ' + failed + ' unanswered', exitCode: failed > 0 ? 1 : 0 };
  });
};
`,
  );
  return root;
}

const pct = (xs: number[], p: number) =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

// Latency over the answered calls, and every token a call counted, cached or not.
function measuredOf(answered: readonly Live[]): NonNullable<Recorded['measured']> {
  const ms = answered.map((r) => r.ms);
  const tokens = answered.map((r) =>
    Object.values(r.usage ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0),
  );
  const mean = tokens.reduce((a, b) => a + b, 0) / Math.max(1, tokens.length);
  return { p50Ms: pct(ms, 50), p95Ms: pct(ms, 95), tokens: Math.round(mean) };
}

// Asks the model about each request through the probe, and where it wrote the replies.
function ask(requests: readonly { prompt: string; offer?: string }[]): {
  live: Live[];
  out: string;
} {
  const out = join(mkdtempSync(join(tmpdir(), 'consent-live-')), 'replies.json');
  console.log(
    `asking ${CALL.model} (effort ${CALL.effort}) about ${requests.length} messages, about $${(requests.length * 0.001).toFixed(2)}`,
  );
  const root = probe(requests, out);
  // The probe exits 1 when a call went unanswered; what it wrote is read either way.
  let ran: unknown = null;
  try {
    execFileSync('claude', ['-p', '--plugin-dir', root, '/consent-probe'], {
      stdio: 'inherit',
      timeout: requests.length * CALL.timeoutMs + 5 * 60_000,
    });
  } catch (error) {
    ran = error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (!existsSync(out)) {
    throw new Error(
      '/consent-probe wrote nothing: the command did not run under claude -p (not signed in, not registered, or it threw before its first reply)',
      { cause: ran },
    );
  }
  const { results: live } = JSON.parse(readFileSync(out, 'utf8')) as {
    rules: string;
    results: Live[];
  };
  return { live, out };
}

const STEPS = new Set(['push', 'pr', 'merge', 'approve', 'release', 'comment', 'finish']);

const grantedBy = (replies: readonly Reply[]): string[] =>
  [
    ...new Set(
      replies.filter((r) => model.judge(r.reply, r.prompt).kind === 'granted').map((r) => r.prompt),
    ),
  ].toSorted();

// Labeled rows to add, each checked as the corpus spec checks it.
function rowsOf(file: string): Case[] {
  let rows: unknown;
  try {
    rows = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: not readable JSON`, { cause: error });
  }
  if (!Array.isArray(rows)) throw new Error(`${file}: expected an array of labeled rows`);
  return rows.map((row, i) => {
    const r = row as Partial<Case> & Record<string, unknown>;
    const extra = Object.keys(r).filter((k) => !['prompt', 'offer', 'may'].includes(k));
    if (
      typeof r.prompt !== 'string' ||
      r.prompt.trim() === '' ||
      (r.offer !== undefined && typeof r.offer !== 'string') ||
      !Array.isArray(r.may) ||
      !r.may.every((s) => STEPS.has(s)) ||
      extra.length > 0
    ) {
      throw new Error(
        `${file} row ${i}: needs a prompt, an optional offer and may (steps from ${[...STEPS].join(', ')}), nothing else`,
      );
    }
    return { prompt: r.prompt, ...(r.offer === undefined ? {} : { offer: r.offer }), may: r.may };
  });
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'live') {
  const n = arg === undefined ? refused.length : Number(arg);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`live [n]: n must be a whole number above 0, not ${arg}`);
  const requests = refused.slice(0, n);
  const { live, out } = ask(requests);
  const answered = live.filter((r) => r.error === undefined);
  const m = measuredOf(answered);
  console.log(
    `${answered.length} of ${live.length} answered; p50 ${m.p50Ms} ms, p95 ${m.p95Ms} ms; ${m.tokens} tokens a call`,
  );
  for (const r of live.filter((x) => x.error !== undefined)) {
    console.log(`  unanswered ${JSON.stringify(r.prompt)}: ${r.error}`);
  }
  console.log(`replies: ${out}`);
  // An unanswered call is no reply, so it is never scored as a miss.
  const { wrong } = score(answered);
  const short = requests.length - answered.length;
  if (short > 0) console.log(`FAILED: ${short} of ${requests.length} messages got no reply`);
  process.exitCode = short > 0 || wrong > 0 ? 1 : 0;
} else if (mode === 'adopt') {
  if (arg === undefined) throw new Error('adopt needs the replies file a live run printed');
  const run = JSON.parse(readFileSync(arg, 'utf8')) as { rules: string; results: Live[] };
  // Only a whole run against the current RULES replaces the recording.
  if (run.rules !== rulesHash(model.RULES)) {
    throw new Error(`${arg} answered other RULES (${run.rules}); run live again`);
  }
  const failed = run.results.filter((r) => r.error !== undefined).length;
  const asked = new Set(run.results.map(keyOf));
  const left = refused.filter((c) => !asked.has(keyOf(c))).length;
  if (failed > 0 || left > 0) {
    throw new Error(
      `${arg} is not a whole run: ${failed} unanswered, ${left} messages the grammar refuses not asked`,
    );
  }
  const next: Recorded = {
    rules: run.rules,
    model: CALL.model,
    effort: CALL.effort,
    recorded: new Date().toISOString().slice(0, 10),
    measured: measuredOf(run.results),
    granted: grantedBy(run.results),
    replies: run.results.map(({ prompt, offer, reply }) =>
      offer === undefined ? { prompt, reply } : { prompt, offer, reply },
    ),
  };
  writeFileSync(REPLIES, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`recorded ${next.replies.length} replies to ${REPLIES}`);
} else if (mode === 'add') {
  if (arg === undefined) {
    throw new Error(
      'add needs a JSON file of labeled rows: [{ "prompt", "offer"?, "may": [...] }]',
    );
  }
  // A reply to other RULES would leave the spec failing on the whole recording.
  if (recorded.rules !== rulesHash(model.RULES)) {
    throw new Error('RULES changed since the replies were recorded: run live, then adopt, first');
  }
  const known = new Set(corpus.map((c) => keyOf(c)));
  const added: Case[] = [];
  for (const row of rowsOf(arg)) {
    if (known.has(keyOf(row))) continue;
    known.add(keyOf(row));
    const got = grammarSteps(grantOf(row.prompt, row.offer));
    // A step outside the label is the grammar's wrong yes: a fix, not a row.
    const beyond = got.filter((s) => !row.may.includes(s));
    if (beyond.length > 0) {
      throw new Error(
        `the grammar grants ${beyond.join(', ')} for ${JSON.stringify(row.prompt)}, which the label does not allow: fix the grammar or the label first`,
      );
    }
    const missed = row.may.length > 0 && !got.some((s) => row.may.includes(s));
    added.push(missed ? { ...row, missed: true } : row);
  }
  const asking = added.filter((c) => grammarSteps(grantOf(c.prompt, c.offer)).length === 0);
  const { live, out } = asking.length === 0 ? { live: [], out: '' } : ask(asking);
  // Matched by message, since a probe cut off partway leaves a valid prefix.
  const answered = new Map(
    live.filter((r) => r.error === undefined).map((r) => [keyOf(r), r] as const),
  );
  const unanswered = asking.filter((c) => !answered.has(keyOf(c)));
  if (unanswered.length > 0) {
    throw new Error(
      `${unanswered.length} of ${asking.length} got no reply: nothing added (the replies it got are in ${out})`,
    );
  }
  const replies = asking.map((c): Reply => {
    const reply = answered.get(keyOf(c))?.reply ?? '';
    return c.offer === undefined
      ? { prompt: c.prompt, reply }
      : { prompt: c.prompt, offer: c.offer, reply };
  });
  // A model grant outside the label is a RULES change to make, not a row.
  for (const r of replies) {
    const may = added.find((c) => keyOf(c) === keyOf(r))?.may ?? [];
    const beyond = modelSteps(model.judge(r.reply, r.prompt)).filter((s) => !may.includes(s));
    if (beyond.length > 0) {
      throw new Error(
        `the model grants ${beyond.join(', ')} for ${JSON.stringify(r.prompt)}, which the label does not allow: nothing added (its reply is in ${out})`,
      );
    }
  }
  if (added.length === 0) {
    console.log('added nothing: every row is in the corpus already');
  } else {
    // Formatted beside the corpus first, so a formatting failure leaves both files as they were.
    const corpusFile = join(HOOKS, 'consent.corpus.json');
    const staged = join(HOOKS, '.consent.corpus.adding.json');
    try {
      try {
        writeFileSync(staged, `${JSON.stringify([...corpus, ...added], null, 2)}\n`);
        execFileSync(join('node_modules', '.bin', 'oxfmt'), [staged]);
      } catch (error) {
        throw new Error(
          `could not format the corpus: nothing added (replies in ${out || 'none'})`,
          { cause: error },
        );
      }
      if (replies.length > 0) {
        // A reply left by a run that failed before its rename is replaced, not doubled.
        const adding = new Set(replies.map((r) => keyOf(r)));
        const all = [...recorded.replies.filter((r) => !adding.has(keyOf(r))), ...replies];
        const next: Recorded = { ...recorded, granted: grantedBy(all), replies: all };
        writeFileSync(REPLIES, `${JSON.stringify(next, null, 2)}\n`);
      }
      renameSync(staged, corpusFile);
    } finally {
      rmSync(staged, { force: true });
    }
    console.log(
      `added ${added.length} rows (${added.filter((c) => c.missed === true).length} the grammar misses) and ${replies.length} replies`,
    );
  }
} else {
  const stale = recorded.rules !== rulesHash(model.RULES);
  if (stale)
    console.log('FAILED: RULES changed since these replies were recorded: run live, then adopt');
  const { wrong, unreplied } = score(recorded.replies);
  process.exitCode = stale || wrong > 0 || unreplied > 0 ? 1 : 0;
}
