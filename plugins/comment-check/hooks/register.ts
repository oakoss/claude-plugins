import type { EngineInterface, Register, ToolCallResult } from 'claude-code';

import { MAX_BYTES, skipsPath, slopDirective, slopFindings, type Written } from './slop';

type $ = EngineInterface;

// Runs after the tool, so it sees the file the call left.
export const register: Register = (on) => {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e);
    return withSlop($, r, { path: e.file_path, text: e.new_string, replaced: e.old_string });
  });
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await next(e);
    return withSlop($, r, { path: e.file_path, text: e.content, replaced: null });
  });
};

// A refused or failed call wrote nothing, so it is not scanned.
async function withSlop<N extends string>(
  $: $,
  r: ToolCallResult<N>,
  w: Omit<Written, 'file'>,
): Promise<ToolCallResult<N>> {
  if (r.deny !== undefined || r.isError === true) return r;
  const note = await slopNote($, w);
  return note === null ? r : { ...r, context: [...(r.context ?? []), note] };
}

// Never refuses: the write has already happened. Files outside a git
// repository are not scanned.
async function slopNote($: $, w: Omit<Written, 'file'>): Promise<string | null> {
  const { path } = w;
  if (skipsPath(path)) return null;
  try {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '.' : path.slice(0, slash) || '/';
    // git's messages are matched in English, so its locale is pinned.
    const repo = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], {
      timeoutMs: 60_000,
      env: { LC_ALL: 'C', LANGUAGE: 'C' },
    });
    if (repo.exitCode !== 0) {
      if (repo.stderr.includes('not a git repository')) return null;
      const line = repo.stderr.trim().split('\n')[0] ?? '';
      const why = line === '' ? `exit ${repo.exitCode}` : line;
      return `comment-check: git failed (${why}); comment-slop scan skipped.`;
    }
    if (!(await $.fs.exists(path))) return null;
    const { kind, size } = await $.fs.stat(path);
    if (kind !== 'file' || size > MAX_BYTES) return null;
    const findings = slopFindings({ ...w, file: await $.fs.read(path) });
    return findings.length > 0 ? slopDirective(path, findings) : null;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `comment-check: comment-slop scan skipped (${why}).`;
  }
}
