// `codex review` prints its own verdict, which may or may not carry the
// receipt lines a brief asks for, but its log records every command it ran.
// Measured on codex-cli 0.162.1 with output redirected to a file: the log opens
// `OpenAI Codex v<version>`; each command is an `exec` line, the command ending
// ` in <cwd>`, then a status line, ` succeeded in <n>ms:` or
// ` exited <code> in <n>ms:`, then its output; a command Codex refuses appears
// only in an error line. The markers are colored only when FORCE_COLOR is set; with color, text
// inside a command's output, which is printed plain, cannot pass for a marker,
// and without it any status may be output, so every status is `guessed`.
// Commands run in parallel and nothing ties a status to its command, so every
// status read while commands overlap is `guessed` too.

export type CodexCommand = {
  command: string;
  cwd: string | null;
  // `unfinished`: the log ends with no status for it. `rejected`: Codex refused
  // to run it.
  status: 'succeeded' | 'exited' | 'rejected' | 'unfinished';
  exitCode: number | null;
  durationMs: number | null;
  // True when the status could belong to another command: it was read while
  // commands overlapped, or from a log without color.
  guessed: boolean;
  // True when the shell script runs more parts after one joined by `;`, a
  // newline, `||`, `|` or `&`: its exit code is the last part's, so an earlier
  // part's failure would not show.
  masked: boolean;
  firstOutputLine: string;
  lastOutputLine: string;
};

export type CodexLog = {
  // False when the text holds no Codex banner.
  recognized: boolean;
  commands: CodexCommand[];
};

const ESC = String.fromCodePoint(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const BANNER = /^OpenAI Codex v\S+/;
const STATUS = /^ (succeeded|exited (\d{1,9})) in (\d{1,9}(?:\.\d+)?)(ms|s):$/;
// With color, the bold command ends in a reset right before ` in <cwd>`.
const COLORED_CWD = new RegExp(`${ESC}\\[0m in (\\/.*)$`);
// Without color, greedy, so the split falls at the last ` in /`.
const CWD = /^(.*) in (\/.*)$/;
const REJECTED =
  /^\d{4}-\d\d-\d\dT\S+Z\s+ERROR .*exec_command failed: .*Rejected\(\\*"`(.*)` rejected/;
// Codex's own lines, which end a command's output in a log without color.
const SECTION = /^(codex|thinking|user|exec)$|^mcp: |^ERROR: |^warning: |^\d{4}-\d\d-\d\dT\S+Z\s/;
const MAX_LINE = 200;

const plain = (s: string) => s.replace(ANSI, '');
// The refused command sits inside two levels of quoted strings.
const unescape = (s: string) => s.replaceAll(/\\(.)/g, '$1');
const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

type Line = { raw: string; text: string; colored: boolean };

const SHELL = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]*)$/;

// The first shell word of `s`, with its quoting removed.
function shellWord(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length && !/\s/.test(s[i]!)) {
    const c = s[i]!;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      out += s.slice(i + 1, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 1;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '"\\$`'.includes(s[i + 1] ?? '')) i++;
        out += s[i] ?? '';
        i++;
      }
      i++;
    } else {
      if (c === '\\') i++;
      out += s[i] ?? '';
      i++;
    }
  }
  return out;
}

// Words that close or continue a compound command after a separator, rather
// than start a part that would replace the exit code.
const CLOSER = /^(?:then|else|elif|fi|esac)(?=$|[\s;&|)])/;
const HEREDOC = /^<<-?[ \t]*((?:\\.|'[^']*'|"[^"]*"|[^\s;&|<>()\\'"])+)/;
const escapeRegExp = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

// Backslash escapes count in every quote but a single one.
function quoteEnd(script: string, i: number): number {
  const q = script[i];
  let j = i + 1;
  while (j < script.length && script[j] !== q) j += q !== "'" && script[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, script.length);
}

// Whether a part of `script` runs after a separator whose failure the exit
// code would hide: `;`, a newline, `||`, `|` or `&`. `&&` hides nothing, a
// newline after an operator continues the line, and text inside quotes,
// `$(…)`, backticks and heredoc bodies is not a separator.
export function masksFailure(command: string): boolean {
  const shell = SHELL.exec(command);
  const script = shell ? shellWord(shell[1] ?? '') : command;
  let separated = false;
  // A part has run since the last separator or operator, so a newline right
  // after `&&` or `|` separates nothing.
  let part = false;
  let substitution = 0;
  const heredocs: string[] = [];
  const begin = (): boolean => {
    if (separated) return true;
    part = true;
    return false;
  };
  const separate = (masks: boolean) => {
    if (part && masks) separated = true;
    part = false;
  };
  let i = 0;
  while (i < script.length) {
    const c = script[i]!;
    const next = script[i + 1] ?? '';
    if (substitution > 0) {
      if (c === "'" || c === '"' || c === '`') i = quoteEnd(script, i);
      else {
        if (c === '(') substitution++;
        if (c === ')') substitution--;
        i += c === '\\' ? 2 : 1;
      }
      continue;
    }
    if (c === '\\' || c === "'" || c === '"' || c === '`') {
      if (begin()) return true;
      i = c === '\\' ? i + 2 : quoteEnd(script, i);
      continue;
    }
    if (c === '$' && next === '(') {
      if (begin()) return true;
      substitution++;
      i += 2;
      continue;
    }
    if (c === '<' && next === '<') {
      if (script[i + 2] === '<') {
        i += 3;
        continue;
      }
      const word = HEREDOC.exec(script.slice(i));
      if (word) {
        heredocs.push(shellWord(word[1] ?? ''));
        i += word[0].length;
        continue;
      }
    }
    if (c === '\n') {
      let at = i + 1;
      // Skip each heredoc body through its delimiter line.
      for (const delimiter of heredocs.splice(0)) {
        const end = new RegExp(`^[ \\t]*${escapeRegExp(delimiter)}[ \\t]*$`, 'm').exec(
          script.slice(at),
        );
        if (!end) return false;
        at += end.index + end[0].length;
      }
      separate(true);
      i = at;
      continue;
    }
    if (c === '&' && next === '&') {
      separate(false);
      i += 2;
      continue;
    }
    const redirect = c === '&' && (next === '>' || /[<>]$/.test(script.slice(0, i)));
    // A backgrounded part's exit code never reaches the script's.
    if (c === '&' && !redirect && part) return true;
    if (c === ';' || c === '|' || (c === '&' && !redirect)) {
      separate(true);
      i += c === '|' && (next === '|' || next === '&') ? 2 : 1;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(script[i - 1]!))) {
      const end = script.indexOf('\n', i);
      i = end === -1 ? script.length : end;
      continue;
    }
    if (/\s/.test(c) || c === '(' || c === '{') {
      i++;
      continue;
    }
    // In command position, a block's end, or the next clause of an if or case,
    // starts no new part; a closed block is itself a part a later separator hides.
    if (!part && (c === ')' || c === '}' || CLOSER.test(script.slice(i)))) {
      separated = false;
      part = c === ')' || c === '}' || /^(?:fi|esac)\b/.test(script.slice(i));
      i += c === ')' || c === '}' ? 1 : (/^\w+/.exec(script.slice(i))?.[0].length ?? 1);
      continue;
    }
    if (begin()) return true;
    i++;
  }
  return false;
}

export function readCodexLog(log: string): CodexLog {
  const lines: Line[] = log
    .split(/\r?\n/)
    .map((raw) => ({ raw, text: plain(raw), colored: raw.includes(ESC) }));
  // Read from the markers, since a command's own output may be colored.
  const colored = lines.some((l) => l.colored && l.text === 'exec');
  const recognized = lines.some((l) => BANNER.test(l.text));
  // With color, only colored lines are markers; without it, any line is.
  const isMarker = (l: Line) => !colored || l.colored;
  const isExec = (l: Line | undefined) => l !== undefined && isMarker(l) && l.text === 'exec';
  const headerEnd = (l: Line): [string, string] | null => {
    if (colored) {
      const m = COLORED_CWD.exec(l.raw);
      return m ? [plain(l.raw.slice(0, m.index)), m[1] ?? ''] : null;
    }
    const m = CWD.exec(l.text);
    return m ? [m[1] ?? '', m[2] ?? ''] : null;
  };
  const commands: CodexCommand[] = [];
  const pending: CodexCommand[] = [];
  let justHeaded: CodexCommand | null = null;
  // Set once a status arrives while two commands are open, until none is.
  let overlapped = false;
  // The command whose output is being read.
  let reading: CodexCommand | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isExec(line)) {
      const header: string[] = [];
      let cwd: string | null = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const h = lines[j]!;
        // A header cut short ends at the next command.
        if (isExec(h)) break;
        const end = headerEnd(h);
        if (end) {
          header.push(end[0]);
          cwd = end[1];
          j++;
          break;
        }
        header.push(h.text);
      }
      const text = header.join('\n').trim();
      const command: CodexCommand = {
        command: text,
        cwd,
        status: 'unfinished',
        exitCode: null,
        durationMs: null,
        guessed: false,
        masked: masksFailure(text),
        firstOutputLine: '',
        lastOutputLine: '',
      };
      commands.push(command);
      pending.push(command);
      justHeaded = cwd === null ? null : command;
      reading = null;
      i = j;
      continue;
    }
    const status = isMarker(line) ? STATUS.exec(line.text) : null;
    const direct = justHeaded !== null && pending.includes(justHeaded);
    const command = direct ? justHeaded : pending[0];
    if (status && command) {
      // A command still open when another's status arrives could own it,
      // whether or not its own status ever comes.
      overlapped ||= pending.length > 1;
      pending.splice(pending.indexOf(command), 1);
      const code = status[2] === undefined ? 0 : Number(status[2]);
      command.status = code === 0 ? 'succeeded' : 'exited';
      command.exitCode = code;
      const n = Number(status[3]);
      command.durationMs = Math.round(status[4] === 's' ? n * 1000 : n);
      command.guessed = overlapped || !colored;
      if (pending.length === 0) overlapped = false;
      reading = command;
      justHeaded = null;
      i++;
      continue;
    }
    justHeaded = null;
    const rejected = isMarker(line) ? REJECTED.exec(line.text) : null;
    if (rejected) {
      const text = unescape(unescape(rejected[1] ?? ''));
      commands.push({
        command: text,
        cwd: null,
        status: 'rejected',
        exitCode: null,
        durationMs: null,
        guessed: !colored,
        masked: masksFailure(text),
        firstOutputLine: '',
        lastOutputLine: '',
      });
      reading = null;
    } else if (colored ? line.colored : SECTION.test(line.text)) {
      // Codex's own lines (`codex`, `thinking`, hook notes) end a command's output.
      reading = null;
    } else if (reading && line.text.trim() !== '') {
      const text = clip(line.text.trim());
      if (reading.firstOutputLine === '') reading.firstOutputLine = text;
      reading.lastOutputLine = text;
    }
    i++;
  }
  return { recognized, commands };
}
