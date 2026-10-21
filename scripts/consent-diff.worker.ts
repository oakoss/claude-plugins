// One share of consent-diff's cases, judged by both grammars in a worker
// thread. Each changed verdict carries its case's place in the whole run, so
// the main thread merges the shares into the order one thread would print.

import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

export type Grammar = {
  grantOf: (prompt: string, previousAnswer?: string) => Record<string, unknown>;
  holdsOf: (prompt: string, previousAnswer?: string) => boolean;
  // Whether a message typed into a running turn replaces its grant; absent
  // before #182.
  dropsGrant?: (prompt: string, previousAnswer?: string) => boolean;
  // The epic a typed message starts a job on; absent before review-cycle's
  // epic mandate.
  mandateOf?: (prompt: string, previousAnswer?: string) => string | null;
};

export type Share = {
  before: string;
  after: string;
  queued: boolean;
  jobs: boolean;
  // Messages with their offers, and the place of the share's first case.
  entries: [prompt: string, offers: string[]][];
  start: number;
};

// A group of changed verdicts: how many, where the first fell, and the first
// three examples with their places.
export type Group = { count: number; first: number; examples: [at: number, text: string][] };

// A verdict as one comparable line: the grant's non-default fields in key
// order, whether it holds (the reason a hold gives is wording, not a verdict)
// and the epic it starts a job on.
function verdict(
  g: Grammar,
  prompt: string,
  offer: string,
  queued: boolean,
  jobs: boolean,
): string {
  const out: string[] = [];
  const fields = Object.entries(g.grantOf(prompt, offer)).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of fields) {
    if (value === false || value === 'none' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    if (value === true) out.push(key);
    else out.push(`${key}=${Array.isArray(value) ? value.join('+') : String(value)}`);
  }
  if (g.holdsOf(prompt, offer)) out.push('held');
  if (queued && g.dropsGrant?.(prompt, offer)) out.push('drops a queued grant');
  const epic = jobs ? (g.mandateOf?.(prompt, offer) ?? null) : null;
  if (epic !== null) out.push(`starts a job on ${epic}`);
  return out.join(', ') || 'nothing';
}

async function judge(share: Share): Promise<[string, Group][]> {
  const before = (await import(pathToFileURL(share.before).href)) as Grammar;
  const after = (await import(pathToFileURL(share.after).href)) as Grammar;
  const groups = new Map<string, Group>();
  let at = share.start;
  for (const [prompt, offers] of share.entries) {
    for (const offer of offers) {
      const i = at++;
      const was = verdict(before, prompt, offer, share.queued, share.jobs);
      const now = verdict(after, prompt, offer, share.queued, share.jobs);
      if (was === now) continue;
      const key = `${was}  →  ${now}`;
      const group = groups.get(key) ?? { count: 0, first: i, examples: [] };
      group.count++;
      if (group.examples.length < 3) {
        group.examples.push([
          i,
          offer === ''
            ? JSON.stringify(prompt)
            : `${JSON.stringify(prompt)} after ${JSON.stringify(offer)}`,
        ]);
      }
      groups.set(key, group);
    }
  }
  return [...groups];
}

if (parentPort !== null) parentPort.postMessage(await judge(workerData as Share));
