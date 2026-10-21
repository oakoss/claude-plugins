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
//
// A live run needs Claude Code signed in and costs about $0.001 a message
// (inferred from the 2026-10-13 run: about $0.30 for 299).

/* oxlint-disable eslint/no-console -- a command-line report: printing is its output */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Node strips types but resolves only full paths, and consent-model.ts imports
// './consent' bare; copies with that one import spelled out load as they are.
const dir = mkdtempSync(join(tmpdir(), 'consent-model-'));
let grantOf: (prompt: string, offer?: string) => Grant;
let model: Model;
// The spec's check of the replies' rules, by the same hash.
let rulesHash: (rules: string) => string;
try {
  writeFileSync(join(dir, 'consent.ts'), read('consent.ts'));
  writeFileSync(join(dir, 'ledger.ts'), read('ledger.ts'));
  ({ hashOf: rulesHash } = (await import(pathToFileURL(join(dir, 'ledger.ts')).href)) as {
    hashOf: typeof rulesHash;
  });
  writeFileSync(
    join(dir, 'consent-model.ts'),
    read('consent-model.ts').replace("from './consent';", "from './consent.ts';"),
  );
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

const grammarSteps = (g: Grant): string[] =>
  [
    g.push === 'none' ? '' : 'push',
    g.pr ? 'pr' : '',
    g.merge || g.autoMerge || g.readyRelease ? 'merge' : '',
    g.approve ? 'approve' : '',
    g.release || g.readyRelease ? 'release' : '',
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

const [mode, arg] = process.argv.slice(2);
if (mode === 'live') {
  const n = arg === undefined ? refused.length : Number(arg);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`live [n]: n must be a whole number above 0, not ${arg}`);
  const requests = refused.slice(0, n);
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
    replies: run.results.map(({ prompt, offer, reply }) =>
      offer === undefined ? { prompt, reply } : { prompt, offer, reply },
    ),
  };
  writeFileSync(REPLIES, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`recorded ${next.replies.length} replies to ${REPLIES}`);
} else {
  const stale = recorded.rules !== rulesHash(model.RULES);
  if (stale)
    console.log('FAILED: RULES changed since these replies were recorded: run live, then adopt');
  const { wrong, unreplied } = score(recorded.replies);
  process.exitCode = stale || wrong > 0 || unreplied > 0 ? 1 : 0;
}
