// What the band says about a pull request, and when to look again. Pure.
import type { Pull, Watch, Workflow } from '../types';

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const PR_URL = new RegExp(
  `^https://(${LABEL}(?:\\.${LABEL})*)/([\\w-][\\w.-]*/[\\w-][\\w.-]*)/pull/([1-9]\\d{0,9})\\s*$`,
  'gm',
);
const PR_CREATE = /(?:^|[;&|(\n]\s*)gh\s+pr\s+create\b/;
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export type Target = Pick<Watch, 'host' | 'repo' | 'number' | 'url'>;

// The pull request a `gh pr create` printed: the URL on its last line of its own.
export function createdPull(command: string, stdout: string): Target | null {
  if (!PR_CREATE.test(command)) return null;
  const m = [...stdout.matchAll(PR_URL)].at(-1);
  if (!m) return null;
  return { host: m[1]!.toLowerCase(), repo: m[2]!, number: Number(m[3]), url: m[0].trim() };
}

export function errorLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.replace(/^gh: /, '') || 'no message';
}

export type Verdict =
  | { kind: 'running'; gate: Workflow }
  | { kind: 'failing'; workflowId: number; workflow: string; job: string; url: string }
  | { kind: 'ready' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'waiting'; reason: string }
  | { kind: 'closed' };

const gates = (w: Workflow) => w.jobs.some((j) => j.isRequired);
const failed = (conclusion: string | null) => FAILED.has(conclusion ?? '');

// Whether the PR's merge waits on this workflow: one holding a required
// check, or any when nothing on the commit is required.
function counts(pull: Pull): (w: Workflow) => boolean {
  return (w) => !pull.isGated || gates(w);
}

// The job that failed, not the summary job that failed on it.
function failure(pull: Pull): Verdict | null {
  const isCounted = counts(pull);
  for (const w of pull.workflows) {
    if (!isCounted(w)) continue;
    const bad = w.jobs.filter((j) => j.status === 'done' && failed(j.conclusion));
    const job = bad.find((j) => !j.isRequired) ?? bad[0];
    if (job) {
      const url = job.url || w.url;
      return { kind: 'failing', workflowId: w.id, workflow: w.name, job: job.name, url };
    }
  }
  return null;
}

// The running workflow the merge waits on longest.
function gateOf(running: Workflow[], estimates: Record<string, number>, host: string): Workflow {
  let longest = running[0]!;
  for (const w of running) {
    if (
      (estimates[estimateKey(host, w.id)] ?? 0) > (estimates[estimateKey(host, longest.id)] ?? 0)
    ) {
      longest = w;
    }
  }
  return longest;
}

export function estimateKey(host: string, workflowId: number): string {
  return `${host}/${workflowId}`;
}

export function verdictOf(
  pull: Pull,
  estimates: Record<string, number>,
  host = 'github.com',
): Verdict {
  if (pull.state !== 'OPEN') return { kind: 'closed' };
  const fail = failure(pull);
  if (fail) return fail;
  const isCounted = counts(pull);
  const running = pull.workflows.filter((w) => w.status !== 'done' && isCounted(w));
  if (running.length > 0) return { kind: 'running', gate: gateOf(running, estimates, host) };
  if (pull.isDraft) return { kind: 'waiting', reason: 'draft' };
  if (pull.merge === 'DIRTY') return { kind: 'blocked', reason: 'conflicts' };
  if (pull.review === 'CHANGES_REQUESTED') return { kind: 'blocked', reason: 'changes requested' };
  if (pull.merge === 'BEHIND') return { kind: 'blocked', reason: 'behind base' };
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pull.merge)) return { kind: 'ready' };
  if (pull.merge === 'BLOCKED') {
    if (pull.review === 'REVIEW_REQUIRED') return { kind: 'waiting', reason: 'review' };
    // A required check outside any workflow, a GitHub App's, still running.
    if (pull.isRequiredPending) return { kind: 'waiting', reason: 'checks' };
    // Required checks GitHub has not yet started leave the merge blocked.
    if (pull.workflows.length === 0) return { kind: 'waiting', reason: 'checks to start' };
    return { kind: 'blocked', reason: 'blocked' };
  }
  // GitHub computes the merge state lazily and reports UNKNOWN until it has.
  return { kind: 'waiting', reason: 'checking' };
}

// Poll fast while something moves, slowly while it waits on a person. A
// workflow the merge does not wait on still moves the line's marks.
export function delayOf(verdict: Verdict, pull?: Pull): number | null {
  if (verdict.kind === 'closed') return null;
  if (verdict.kind === 'running') return 10_000;
  if (pull?.workflows.some((w) => w.status !== 'done')) return 10_000;
  if (verdict.kind === 'waiting' && verdict.reason !== 'review' && verdict.reason !== 'draft') {
    return 10_000;
  }
  return 60_000;
}

// What the line says, as a key: a new failure differs from an old one.
export function shownOf(verdict: Verdict): string {
  if (verdict.kind === 'failing')
    return `failing:${JSON.stringify([verdict.workflow, verdict.job])}`;
  return verdict.kind;
}

export function toastOf(label: string, verdict: Verdict, shown?: string): string | null {
  if (shownOf(verdict) === shown) return null;
  if (verdict.kind === 'ready') return `${label} is ready to merge`;
  if (verdict.kind === 'failing') return `${label} ${verdict.workflow}: ${verdict.job} failed`;
  return null;
}

export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

// A bar `width` cells wide, filled to `fraction` in eighths of a cell.
export function barOf(fraction: number, width: number): { filled: string; rest: string } {
  const eighths = Math.round(Math.min(Math.max(fraction, 0), 1) * width * 8);
  const full = Math.floor(eighths / 8);
  const head = EIGHTHS[eighths % 8] ?? '';
  const filled = '█'.repeat(full) + head;
  return { filled, rest: '░'.repeat(width - full - (head ? 1 : 0)) };
}

export function markOf(w: Workflow): string {
  if (w.status !== 'done') return '●';
  return PASSED.has(w.conclusion ?? '') ? '✓' : '✗';
}

export type Segment = { text: string; color?: string; isDim?: boolean; url?: string };

const BAR_MAX = 24;
const BAR_MIN = 8;

function markSegment(w: Workflow): Segment {
  const mark = markOf(w);
  return {
    text: ` · ${w.name} ${mark}`,
    color: mark === '✗' ? 'red' : mark === '●' ? 'yellow' : undefined,
    isDim: mark === '✓',
  };
}

// One line of the band. A running gate whose length is known draws a bar that
// stops short of full until the run ends.
export function lineOf(
  watch: Watch,
  now: number,
  estimates: Record<string, number>,
  columns: number,
): Segment[] {
  const label = { text: `#${watch.number}`, color: 'cyan', url: watch.url };
  const pull = watch.pull;
  if (!pull) {
    const why = watch.error ?? 'loading…';
    return [
      label,
      {
        text: ` ${why}`,
        isDim: watch.error === undefined,
        color: watch.error === undefined ? undefined : 'red',
      },
    ];
  }
  const v = verdictOf(pull, estimates, watch.host);
  const tail: Segment[] = [];
  if (pull.isTruncated) tail.push({ text: ' · more checks not shown', isDim: true });
  if (watch.error !== undefined) tail.push({ text: ` · ${watch.error}`, color: 'red' });
  if (v.kind === 'closed') return [label, { text: ` ${pull.state.toLowerCase()}`, isDim: true }];
  // Other workflows, while they run or once they failed; on a running line,
  // every other workflow.
  const others = (skip: number | null) =>
    pull.workflows
      .filter((w) => w.id !== skip && (v.kind === 'running' || markOf(w) !== '✓'))
      .map((w) => markSegment(w));
  if (v.kind === 'ready') {
    return [label, { text: ' ✓ ready to merge', color: 'green' }, ...others(null), ...tail];
  }
  if (v.kind === 'failing') {
    const text = ` ✗ ${v.workflow}: ${v.job} failed`;
    const reason = { text, color: 'red', url: v.url || undefined };
    return [label, reason, ...others(v.workflowId), ...tail];
  }
  if (v.kind === 'blocked') {
    return [label, { text: ` ⚠ ${v.reason}`, color: 'yellow' }, ...others(null), ...tail];
  }
  if (v.kind === 'waiting') {
    return [label, { text: ` ○ waiting on ${v.reason}`, isDim: true }, ...others(null), ...tail];
  }
  const gate = v.gate;
  const elapsed = now - Date.parse(gate.startedAt);
  const estimate = estimates[estimateKey(watch.host, gate.id)] ?? 0;
  const head = [label, { text: ` ● ${gate.name} `, color: 'yellow', url: gate.url || undefined }];
  if (gate.isRerun) return [...head, { text: 're-run', isDim: true }, ...others(gate.id), ...tail];
  if (estimate <= 0) {
    return [...head, { text: clockText(elapsed), isDim: true }, ...others(gate.id), ...tail];
  }
  const times = ` ${clockText(elapsed)} / ~${clockText(estimate)}`;
  const used = `#${watch.number} ● ${gate.name} `.length + times.length;
  const width = Math.max(BAR_MIN, Math.min(BAR_MAX, columns - used - 2));
  const bar = barOf(Math.min(elapsed / estimate, 0.97), width);
  return [
    ...head,
    { text: bar.filled, color: 'yellow' },
    { text: bar.rest, isDim: true },
    { text: times, isDim: true },
    ...others(gate.id),
    ...tail,
  ];
}
