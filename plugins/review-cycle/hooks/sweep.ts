// Ends what a review cycle's legs left running in its scratch directory, then
// removes it. Takes its process runner and clock as parameters, so it holds no
// `$` and runs against real processes in tests.

export type Run = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
export type Sleep = (ms: number) => Promise<void>;

export type Swept = { dir: string; stopped: number; removed: boolean; errors: string[] };

// Time a TERM, then a KILL, gets before the next look.
const GRACE_MS = 500;

// The path followed by anything that cannot continue a file name, so a quoted
// or `;`-ended mention matches and `<dir>.log` or `<dir>-old` does not.
function patternOf(dir: string): string {
  const escaped = dir.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return `${escaped}([^-.A-Za-z0-9_]|$)`;
}

function pidsIn(stdout: string, own: number): Set<number> {
  const pids = new Set<number>();
  for (const line of stdout.split('\n')) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 1 && pid !== own) pids.add(pid);
  }
  return pids;
}

// pgrep as well as lsof: a reader blocked opening a pipe under `dir` holds no
// file yet, so lsof misses it. Exit 1 is "no match" for both; a death by
// signal also reads as 1 through the runner, which no look here can tell apart.
async function holders(run: Run, dir: string, own: number, errors: string[]): Promise<Set<number>> {
  const pids = new Set<number>();
  const lsof = await run(['lsof', '-t', '+D', dir]);
  if (lsof.exitCode > 1)
    errors.push(`lsof failed: ${lsof.stderr.trim() || `exit ${lsof.exitCode}`}`);
  for (const pid of pidsIn(lsof.stdout, own)) pids.add(pid);
  const pgrep = await run(['pgrep', '-f', patternOf(dir)]);
  if (pgrep.exitCode > 1)
    errors.push(`pgrep failed: ${pgrep.stderr.trim() || `exit ${pgrep.exitCode}`}`);
  for (const pid of pidsIn(pgrep.stdout, own)) pids.add(pid);
  return pids;
}

function listed(pids: Set<number>): string[] {
  return [...pids].map(String);
}

export async function sweep(run: Run, sleep: Sleep, dir: string, own: number): Promise<Swept> {
  const errors: string[] = [];
  const found = await holders(run, dir, own, errors);
  let left = new Set<number>();
  if (found.size > 0) {
    // kill's exit status is not read: a process that exited between the look
    // and the signal fails it too. The next look decides.
    await run(['kill', '-TERM', ...listed(found)]);
    await sleep(GRACE_MS);
    left = await holders(run, dir, own, errors);
    if (left.size > 0) {
      await run(['kill', '-KILL', ...listed(left)]);
      await sleep(GRACE_MS);
      left = await holders(run, dir, own, errors);
    }
    if (left.size > 0) errors.push(`still running after KILL: ${listed(left).join(' ')}`);
  }
  const rm = await run(['rm', '-rf', '--', dir]);
  const removed = rm.exitCode === 0;
  if (!removed) errors.push(`rm failed: ${rm.stderr.trim() || `exit ${rm.exitCode}`}`);
  const stopped = [...found].filter((pid) => !left.has(pid)).length;
  return { dir, stopped, removed, errors };
}
