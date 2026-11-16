import { firstLine } from '../gate/git';
import type { $ } from '../state/engine';
import { state } from '../state/gate-state';
import { aliasScript, aliasShell, parseShellAliases, readAliases } from './shell';

// Claude Code writes its shell snapshot only once the session's first Bash
// command runs, after this hook, so the gate reads the aliases itself, the
// way the snapshot does, when the session starts. Once per module load: an rc
// file that hangs costs the timeout once, then the snapshot is read instead.
export async function readOwnAliases($: $): Promise<string | null> {
  try {
    const tag = Math.random().toString(36).slice(2);
    const home = await $.env.get('HOME');
    if (!home) return 'HOME is not set';
    const shell = aliasShell(await $.env.get('CLAUDE_CODE_SHELL'), await $.env.get('SHELL'));
    const rc = `${home}/${shell.rc}`;
    const script = aliasScript((await $.fs.exists(rc)) ? rc : null, tag);
    // The environment and time limit Claude Code gives its own snapshot: an rc
    // file can branch on them.
    const env = { CLAUDECODE: '1', SHELL: shell.path, GIT_EDITOR: 'true' };
    const argv = [shell.path, '-c', '-l', script];
    const r = await $.process.run(argv, { stdin: '', timeoutMs: 10_000, env });
    if (r.exitCode !== 0) {
      return `the shell exited ${r.exitCode}: ${firstLine(r.stderr) || 'no output'}`;
    }
    const aliases = readAliases(r.stdout, tag);
    if (aliases === null) return 'the shell stopped before printing its aliases';
    state.shellAliases = aliases;
    state.aliasesLoaded = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Failing both reads leaves the aliases unknown, not empty: the snapshot is
// retried on the next Bash call, and the first unchecked command says so.
export async function loadShellAliases($: $): Promise<void> {
  if (state.aliasesLoaded) return;
  state.ownRead ??= readOwnAliases($);
  const own = await state.ownRead;
  if (state.aliasesLoaded) return;
  try {
    const home = await $.env.get('HOME');
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : null);
    if (!config) throw new Error('neither CLAUDE_CONFIG_DIR nor HOME is set');
    const shell = basenameOf((await $.env.get('SHELL')) ?? '');
    const dir = `${config}/shell-snapshots`;
    const newest = newestSnapshot(await $.fs.list(dir), shell);
    if (newest === null) throw new Error(`no shell snapshot in ${dir} yet`);
    state.shellAliases = parseShellAliases(await $.fs.read(`${dir}/${newest}`), true);
    state.aliasError = null;
    state.aliasesLoaded = true;
  } catch (error) {
    // Another Bash call's read may have succeeded while this one waited.
    if (state.aliasesLoaded) return;
    const snapshot = error instanceof Error ? error.message : String(error);
    state.aliasError = `reading them from the shell failed (${own}); ${snapshot}`;
  }
}

function basenameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

// Snapshot files are named snapshot-<shell>-<milliseconds>-<id>.sh.
function newestSnapshot(
  entries: readonly { name: string; kind: string }[],
  shell: string,
): string | null {
  let best: { name: string; at: number; same: boolean } | null = null;
  for (const e of entries) {
    const m = /^snapshot-([\w-]+?)-(\d+)-[\w-]+\.sh$/.exec(e.name);
    if (e.kind !== 'file' || !m) continue;
    const candidate = { name: e.name, at: Number(m[2]), same: m[1] === shell };
    if (
      best === null ||
      (candidate.same && !best.same) ||
      (candidate.same === best.same && candidate.at > best.at)
    ) {
      best = candidate;
    }
  }
  return best?.name ?? null;
}
