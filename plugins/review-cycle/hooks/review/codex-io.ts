import type { MatchedHook } from 'claude-code';

import { messageOf } from '../gate/git';
import type { $, Input, NextOf, Output } from '../state/engine';
import { state } from '../state/gate-state';
import { codexCommand, configuredEffort, EFFORTS, isEffort } from './codex-command';
import { type CodexTokens, codexTokens, readCodexLog } from './codex-log';
import { scratchFromTranscript } from './scratch';

type CodexLogHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__codex_log' }>;
type CodexCommandHook = MatchedHook<'tool.call', { tool: 'mcp__review-cycle__codex_command' }>;

// The Codex leg's receipt comes from its command log, so the cycle grades what
// Codex ran rather than what its verdict says it ran. Gates nothing.
export async function registerCodexLog($: $): Promise<void> {
  try {
    await $.tool.register({
      name: 'codex_log',
      description:
        "Reads a `codex review` output file and lists every command Codex ran, in order: the command, its working directory, `status` (`succeeded`, `exited`, `rejected` when Codex refused to run it, or `unfinished` when the log ends with no status for it), `exitCode`, `durationMs`, `guessed` (true when overlapping commands, or a log without color, leave it unclear which command a status belongs to), `masked` (true when the command chains parts with `;`, a newline, `||`, `|` or `&`, so its exit code is only the last part's), and the first and last non-empty lines of its output, each clipped at 200 characters. `tokens` is the review's token usage, summed over the sessions Codex ran it in (`sessions`: its child, and any session that child started): `input`, `cachedInput` (counted within `input`), `output`, `reasoningOutput` and `total`, or `unavailable` saying why not, as for a review not yet finished. Answers with an error, not an empty list, for a file that is not a Codex log. Build the Codex leg's execution receipt from this, not from its verdict. Read-only.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Absolute path of the Codex leg's output file." },
        },
        required: ['path'],
      },
    });
  } catch {
    // Without it, the skill grades the Codex leg from its verdict.
  }
  try {
    await $.tool.register({
      name: 'codex_command',
      description:
        "Builds the command a review cycle's Codex leg runs, to launch with Bash in the background: its scope, its reasoning effort for the tier and pass, the read-only permission profile writing only to this cycle's scratch directory (call mcp__review-cycle__scratch first), and the brief as Codex's developer instructions, with the sentence telling Codex where it may write appended. Answers with `command` and `effort`, the label for the summary, or with why it built none: a brief or checks holding a double quote, backslash, backtick, dollar sign or line break, which break the command's quoting, are refused, never rewritten.",
      inputSchema: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: 'The ref to review against; leave out for the uncommitted working tree.',
          },
          tier: { type: 'string', enum: ['full', 'light'] },
          pass: {
            type: 'string',
            enum: ['review', 'confirmation'],
            description:
              'confirmation for a pass that only checks fixes, which runs at low effort.',
          },
          effort: {
            type: 'string',
            enum: [...EFFORTS],
            description: 'An effort the user gave explicitly; it wins on any tier.',
          },
          brief: {
            type: 'string',
            description:
              'The brief as one line of plain prose: intent, changed files, settled findings and the question to settle first.',
          },
          checks: {
            type: 'string',
            description:
              "The project's own checks as the leg runs them in its copy, a JavaScript tool by path (node_modules/.bin/<tool>); empty for none.",
          },
          dir: {
            type: 'string',
            description:
              "Absolute path of the checkout Codex reviews when it is not the repository root, such as a pull request's worktree.",
          },
          modules: {
            type: 'string',
            description:
              'Absolute path of the checkout whose node_modules the copy borrows, when `dir` has none.',
          },
        },
        required: ['tier', 'pass', 'brief', 'checks'],
      },
    });
  } catch {
    // Without it, the skill assembles the command as written.
  }
}

export async function onCodexCommand(
  $: $,
  e: Input<CodexCommandHook>,
  _next: NextOf<CodexCommandHook>,
): Promise<Output<CodexCommandHook>> {
  const { base, tier, pass, effort, brief, checks, dir, modules } = e as Record<string, unknown>;
  // A reload or a resume empties state.scratch; the transcript still names the
  // directory the cycle's legs were given.
  let scratch = state.scratch.at(-1);
  if (scratch === undefined) {
    const earlier = await scratchFromTranscript($);
    scratch = earlier.dirs.at(-1);
  }
  if (scratch === undefined) {
    return {
      result:
        'review-cycle codex_command: no scratch directory. Call mcp__review-cycle__scratch first; when it makes none, skip the Codex leg and record it as `skipped (no scratch directory)`.',
    };
  }
  if (
    (tier !== 'full' && tier !== 'light') ||
    (pass !== 'review' && pass !== 'confirmation') ||
    typeof brief !== 'string' ||
    typeof checks !== 'string' ||
    (base !== undefined && typeof base !== 'string') ||
    (dir !== undefined && typeof dir !== 'string') ||
    (modules !== undefined && typeof modules !== 'string') ||
    (effort !== undefined && !isEffort(effort))
  ) {
    return {
      result: 'review-cycle codex_command: tier, pass, brief or checks is missing or invalid.',
    };
  }
  const codexHome = (await $.env.get('CODEX_HOME')) ?? '';
  const userHome = (await $.env.get('HOME')) ?? '';
  const home = codexHome !== '' ? codexHome : userHome !== '' ? `${userHome}/.codex` : null;
  let toml: string | null = null;
  try {
    if (home !== null && (await $.fs.exists(`${home}/config.toml`))) {
      toml = await $.fs.read(`${home}/config.toml`);
    }
  } catch {
    // An unreadable config counts as no effort configured.
  }
  const built = codexCommand(
    {
      scope: base === undefined ? { uncommitted: true } : { base },
      tier,
      pass,
      effort: effort ?? null,
      brief,
      checks,
      ...(dir !== undefined && { dir }),
      ...(modules !== undefined && { modules }),
    },
    scratch,
    `${$.plugin.root}/scripts/copy-tree.sh`,
    configuredEffort(toml),
  );
  if ('refused' in built) return { result: `review-cycle codex_command: ${built.refused}` };
  return { result: JSON.stringify(built, null, 2) };
}

export async function onCodexLog(
  $: $,
  e: Input<CodexLogHook>,
  _next: NextOf<CodexLogHook>,
): Promise<Output<CodexLogHook>> {
  const { path } = e as { path?: unknown };
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { result: 'review-cycle codex_log: `path` must be an absolute path.' };
  }
  try {
    if (!(await $.fs.exists(path))) {
      return { result: `review-cycle codex_log: no file at ${path}.` };
    }
    const { recognized, sessionId, commands } = readCodexLog(await $.fs.read(path));
    // An empty list would read as a Codex that ran nothing.
    if (!recognized) {
      return {
        result: `review-cycle codex_log: ${path} is not a codex review log (no \`OpenAI Codex v\` banner).`,
      };
    }
    let tokens: CodexTokens;
    try {
      // An empty CODEX_HOME is unset to Codex too.
      const codexHome = (await $.env.get('CODEX_HOME')) ?? '';
      const userHome = (await $.env.get('HOME')) ?? '';
      let home: string | null = null;
      if (codexHome !== '') home = codexHome;
      else if (userHome !== '') home = `${userHome}/.codex`;
      tokens = await codexTokens(
        (argv) => $.process.run(argv, { stdin: '', timeoutMs: 30_000 }),
        (p) => $.fs.exists(p),
        home ? `${home}/sessions` : null,
        sessionId,
      );
    } catch (error) {
      tokens = { sessionId, unavailable: messageOf(error) };
    }
    if (tokens.total !== undefined) state.codexRead.set(path, tokens.total);
    return { result: JSON.stringify({ commands, tokens }, null, 2) };
  } catch (error) {
    return { result: `review-cycle codex_log: could not read ${path}: ${messageOf(error)}` };
  }
}
