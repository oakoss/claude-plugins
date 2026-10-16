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
      const command: CodexCommand = {
        command: header.join('\n').trim(),
        cwd,
        status: 'unfinished',
        exitCode: null,
        durationMs: null,
        guessed: false,
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
      commands.push({
        command: unescape(unescape(rejected[1] ?? '')),
        cwd: null,
        status: 'rejected',
        exitCode: null,
        durationMs: null,
        guessed: !colored,
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
