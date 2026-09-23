// Reads a Bash command into statements, as bash would. Pure: no `$`, no I/O.
//
// The user's shell aliases are expanded while reading, because bash replaces
// an alias's name with its text before it parses the command.

export type Word = {
  // The word's value with quotes removed; substitutions left as written.
  text: string;
  // True when the value depends on expansion ($VAR, $(…), backticks, ~).
  dynamic: boolean;
  // True when an unquoted glob or brace would make the shell rewrite it.
  pattern: boolean;
};

export type Op = '&&' | '||' | '|' | ';' | '&' | '\n' | '';

type Heredoc = { body: string; quoted: boolean };

export type Statement = {
  words: Word[];
  // Command lists this statement runs besides itself: $(…), backticks, ( … ),
  // process substitutions, and substitutions inside ${…} and $((…)).
  inner: Statement[][];
  // Set when the statement is or contains a ( … ) group, a function body or an
  // array, rather than a simple command.
  group: boolean;
  heredocs: Heredoc[];
  // Set when the statement redirects to or from anything, a file or a descriptor.
  redirected: boolean;
  op: Op;
  // Alias names among the words that were not expanded, because they stood
  // where this reader does not look for a command. The shell may still run
  // them: in a case arm, a function body, or as `eval`'s argument.
  aliases: string[];
};

// `text` is the command with its aliases expanded, as far as reading got.
export type Parsed = { statements: Statement[]; text: string } | { error: string; text: string };

// Shell aliases the Bash tool expands: name to replacement text.
export type ShellAliases = ReadonlyMap<string, string>;

// Reserved words after which bash reads a command, so an alias may follow.
const COMMAND_START = new Set([
  '!',
  '{',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'time',
  'nocorrect',
  'noglob',
]);

// Bash stops at recursion, not depth; these bound a pathological table. The
// total is shared with the readers of substitutions, which nest.
const MAX_DEPTH = 50;
const MAX_EXPANSIONS = 10_000;

function newBudget(): { left: number } {
  return { left: MAX_EXPANSIONS };
}

export function assignmentName(w: Word): string | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(w.text);
  return m?.[1] ?? null;
}

export function statement(): Statement {
  return {
    words: [],
    inner: [],
    group: false,
    heredocs: [],
    redirected: false,
    op: '',
    aliases: [],
  };
}

class Lexer {
  i = 0;
  // Open `case` statements, whose patterns end in a bare `)`.
  private cases = 0;
  private pending: { delim: string; stripTabs: boolean; quoted: boolean; st: Statement }[] = [];
  // Aliases being expanded, each until the end of its replacement text: bash
  // does not expand a name again inside its own expansion.
  private active: { name: string; end: number }[] = [];
  // Where the value of an alias ending in a blank ends: the word after it is
  // an alias candidate too. -1 when there is none.
  private aliasNextAt = -1;
  // Where the first word of an alias's value starts: bash tests it for an
  // alias wherever it stands. -1 when there is none.
  private firstAt = -1;
  // Each statement's last reserved word read as a command, such as `then` or
  // `time`; the same word as an argument (`echo time`) starts nothing.
  private reserved = new WeakMap<Statement, number>();

  constructor(
    public s: string,
    private readonly aliases: ShellAliases = new Map(),
    private readonly budget: { left: number } = newBudget(),
  ) {}

  private ch(k = 0): string {
    return this.s[this.i + k] ?? '';
  }

  // Reads statements until end of input, or until an unmatched `)` when
  // parsing inside $( … ) or ( … ).
  list(inParen: boolean): Statement[] {
    // A case inside $( … ) ends its patterns with `)` too.
    const outerCases = this.cases;
    this.cases = 0;
    const out: Statement[] = [];
    let cur = statement();
    const end = (op: Op) => {
      cur.op = op;
      if (cur.words.length > 0 || cur.group || cur.inner.length > 0) out.push(cur);
      cur = statement();
    };
    while (this.i < this.s.length) {
      const before = this.i;
      const c = this.ch();
      if (c === ' ' || c === '\t' || c === '\r') {
        this.i++;
      } else if (c === '\\' && this.ch(1) === '\n') {
        this.i += 2;
      } else if (c === '\n') {
        this.i++;
        end('\n');
        this.heredocs();
      } else if (c === '#' && this.atWordStart()) {
        while (this.i < this.s.length && this.ch() !== '\n') this.i++;
      } else if (c === ')' && this.cases > 0) {
        // A `case` pattern's closing parenthesis; a command follows it.
        this.i++;
        this.firstAt = this.i;
      } else if (c === ')') {
        if (!inParen) throw new Error('unmatched )');
        this.i++;
        end('');
        this.cases = outerCases;
        return out;
      } else if (c === '(') {
        // A group at the start of a statement; later, a function definition's
        // `()` or a `[[ … =~ ( … ) ]]` pattern. Either way it may run code.
        this.i++;
        cur.inner.push(this.list(true));
        cur.group = true;
      } else if (c === ';' || c === '&' || c === '|') {
        const two = this.s.slice(this.i, this.i + 2);
        if (two === '&&' || two === '||') {
          this.i += 2;
          end(two);
        } else if (two === '&>') {
          this.redirect(cur);
        } else if (two === '|&') {
          this.i += 2;
          end('|');
        } else {
          this.i++;
          end(c);
        }
      } else if (c === '<' || c === '>') {
        this.redirect(cur);
      } else if (
        /[0-9]/.test(c) &&
        /^[0-9]+[<>]/.test(this.s.slice(this.i, this.i + 12)) &&
        this.atWordStart()
      ) {
        while (/[0-9]/.test(this.ch())) this.i++;
        this.redirect(cur);
      } else {
        const from = this.i;
        const next = this.aliasNextAt !== -1 && from >= this.aliasNextAt;
        if (next) this.aliasNextAt = -1;
        const first = this.firstAt !== -1 && from >= this.firstAt;
        if (first) this.firstAt = -1;
        const position = this.commandPosition(cur);
        const candidate = next || first || position;
        const w = this.word(cur);
        if (candidate && this.expandAlias(from)) continue;
        const name = this.aliasName(from);
        if (name !== null) cur.aliases.push(name);
        // Only as a command are these reserved words: `echo case` is not one.
        if (position && w.text === 'case' && !w.dynamic) this.cases++;
        if (position && w.text === 'esac' && !w.dynamic) this.cases = Math.max(0, this.cases - 1);
        // A function body's `{` follows `name()` or `function name`.
        const body = w.text === '{' && (cur.group || cur.words[0]?.text === 'function');
        if ((position || body) && !w.dynamic && COMMAND_START.has(w.text)) {
          this.reserved.set(cur, cur.words.length);
        }
        cur.words.push(w);
      }
      if (this.i === before)
        throw new Error(`cannot read the command at "${this.s.slice(this.i, this.i + 20)}"`);
    }
    if (inParen) throw new Error('unterminated (');
    if (this.pending.length > 0) throw new Error('unterminated heredoc');
    end('');
    this.cases = outerCases;
    return out;
  }

  // The alias the word just read from `from` names, as written: a quoted or
  // escaped name (`'gp'`, `\gp`) names none. An alias for `git` itself is
  // left alone, so `git` stays git whatever program it stands for.
  private aliasName(from: number): string | null {
    const raw = this.s.slice(from, this.i).replaceAll('\\\n', '');
    return raw !== 'git' && this.aliases.has(raw) ? raw : null;
  }

  // Whether the next word is read as a command: nothing but assignments since
  // the statement began or since a reserved word such as `{` or `then`.
  private commandPosition(cur: Statement): boolean {
    const start = this.reserved.get(cur) ?? -1;
    let rest = cur.words.slice(start + 1);
    // bash's `time -p` still reads a command next.
    if (cur.words[start]?.text === 'time' && rest[0]?.text === '-p' && !rest[0].dynamic) {
      rest = rest.slice(1);
    }
    return rest.every((w) => assignmentName(w) !== null);
  }

  // Replaces an alias name at `from` with its value, as bash does before
  // reading the command, and rewinds to read the value.
  private expandAlias(from: number): boolean {
    const raw = this.aliasName(from);
    const value = raw === null ? undefined : this.aliases.get(raw);
    if (raw === null || value === undefined) return false;
    this.active = this.active.filter((a) => a.end > from);
    if (this.active.some((a) => a.name === raw)) return false;
    if (this.active.length >= MAX_DEPTH || --this.budget.left < 0) {
      throw new Error('shell aliases nested too deep');
    }
    const shift = value.length - raw.length;
    for (const a of this.active) a.end += shift;
    if (this.aliasNextAt > from) this.aliasNextAt += shift;
    this.active.push({ name: raw, end: from + value.length });
    this.s = this.s.slice(0, from) + value + this.s.slice(this.i);
    this.i = from;
    if (/[ \t]$/.test(value)) this.aliasNextAt = from + value.length;
    // Bash tests the first word of a value for an alias wherever it stands.
    this.firstAt = from;
    return true;
  }

  private atWordStart(): boolean {
    const p = this.s[this.i - 1];
    return p === undefined || /[\s;&|()]/.test(p);
  }

  private redirect(cur: Statement): void {
    const rest = this.s.slice(this.i);
    const op = /^(<<<|<<-|<<|&>>|&>|>>|>&|<&|>\||<>|<|>)/.exec(rest)?.[0] ?? '>';
    this.i += op.length;
    cur.redirected = true;
    if ((op === '<' || op === '>') && this.ch() === '(') {
      // Process substitution: `<( … )` and `>( … )` run a command list.
      this.i++;
      cur.inner.push(this.list(true));
      return;
    }
    while (this.ch() === ' ' || this.ch() === '\t') this.i++;
    if (op === '<<' || op === '<<-') {
      const from = this.i;
      const target = this.word(cur);
      const quoted = /['"\\]/.test(this.s.slice(from, this.i));
      this.pending.push({ delim: target.text, stripTabs: op === '<<-', quoted, st: cur });
      return;
    }
    // `2>&1` and friends name a descriptor, not a file.
    if ((op === '>&' || op === '<&') && /^[0-9-]/.test(this.ch())) {
      while (/[0-9-]/.test(this.ch())) this.i++;
      return;
    }
    this.word(cur);
  }

  // Heredoc bodies start on the line after their operator. An unquoted body
  // is expanded by the shell, so its substitutions run like any others.
  private heredocs(): void {
    for (const h of this.pending) {
      const lines: string[] = [];
      for (;;) {
        if (this.i >= this.s.length) throw new Error('unterminated heredoc');
        const nl = this.s.indexOf('\n', this.i);
        const line = this.s.slice(this.i, nl === -1 ? this.s.length : nl);
        this.i = nl === -1 ? this.s.length : nl + 1;
        if ((h.stripTabs ? line.replace(/^\t+/, '') : line) === h.delim) break;
        lines.push(line);
      }
      const body = lines.join('\n');
      h.st.heredocs.push({ body, quoted: h.quoted });
      if (!h.quoted && /\$\(|`/.test(body))
        h.st.inner.push(substitutionsIn(body, this.aliases, this.budget));
    }
    this.pending = [];
  }

  word(cur: Statement): Word {
    let text = '';
    let dynamic = false;
    let pattern = false;
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.ch();
      if (c === '(' && text.endsWith('=')) {
        // An array assignment, `name=( … )`: its elements may substitute.
        this.i++;
        cur.inner.push(this.list(true));
        cur.group = true;
        dynamic = true;
        continue;
      }
      if (/[\s;&|<>()]/.test(c)) break;
      if (c === '\\') {
        if (this.ch(1) === '\n') {
          this.i += 2;
          continue;
        }
        text += this.ch(1);
        this.i += 2;
      } else if (c === "'") {
        const close = this.s.indexOf("'", this.i + 1);
        if (close === -1) throw new Error("unterminated '");
        text += this.s.slice(this.i + 1, close);
        this.i = close + 1;
      } else if (c === '$' && this.ch(1) === "'") {
        const close = this.ansiEnd(this.i + 2);
        text += decodeAnsiC(this.s.slice(this.i + 2, close));
        this.i = close + 1;
      } else if (c === '"') {
        this.i++;
        for (;;) {
          if (this.i >= this.s.length) throw new Error('unterminated "');
          const d = this.ch();
          if (d === '"') {
            this.i++;
            break;
          }
          if (d === '\\' && /["\\$`\n]/.test(this.ch(1))) {
            if (this.ch(1) !== '\n') text += this.ch(1);
            this.i += 2;
          } else if (d === '$' || d === '`') {
            text += this.expansion(cur);
            dynamic = true;
          } else {
            text += d;
            this.i++;
          }
        }
      } else if (c === '$' || c === '`') {
        text += this.expansion(cur);
        dynamic = true;
      } else {
        if (c === '~' && this.i === start) dynamic = true;
        if (/[*?[{]/.test(c)) pattern = true;
        text += c;
        this.i++;
      }
    }
    return { text, dynamic, pattern };
  }

  private ansiEnd(from: number): number {
    for (let j = from; j < this.s.length; j++) {
      if (this.s[j] === '\\') j++;
      else if (this.s[j] === "'") return j;
    }
    throw new Error("unterminated $'");
  }

  // The index just past the bracket closing the one at `open`.
  private closing(open: number, left: string, right: string): number {
    let depth = 0;
    for (let j = open; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '\\') j++;
      else if (c === "'" || c === '"') {
        // A quoted bracket does not count: `${x:-"}"}`.
        const close = this.s.indexOf(c, j + 1);
        if (close === -1) break;
        j = close;
      } else if (c === left) depth++;
      else if (c === right && --depth === 0) return j + 1;
    }
    throw new Error(`unterminated ${left}`);
  }

  // Reads one `$…` or backtick expansion starting at this.i, recording any
  // command list it runs, and returns its source text.
  private expansion(cur: Statement): string {
    const from = this.i;
    const c = this.ch();
    if (c === '`') {
      const close = this.s.indexOf('`', this.i + 1);
      if (close === -1) throw new Error('unterminated `');
      const body = this.s.slice(this.i + 1, close).replaceAll('\\`', '`');
      cur.inner.push(new Lexer(body, this.aliases, this.budget).list(false));
      this.i = close + 1;
    } else if (this.ch(1) === '(' && this.ch(2) === '(') {
      const close = this.closing(this.i + 1, '(', ')');
      cur.inner.push(
        substitutionsIn(this.s.slice(this.i + 3, close - 2), this.aliases, this.budget),
      );
      this.i = close;
    } else if (this.ch(1) === '(') {
      this.i += 2;
      cur.inner.push(this.list(true));
    } else if (this.ch(1) === '{') {
      const close = this.closing(this.i + 1, '{', '}');
      cur.inner.push(
        substitutionsIn(this.s.slice(this.i + 2, close - 1), this.aliases, this.budget),
      );
      this.i = close;
    } else {
      this.i++;
      while (/[A-Za-z0-9_@*#?$!-]/.test(this.ch())) {
        this.i++;
        if (!/[A-Za-z0-9_]/.test(this.ch(-1))) break;
      }
    }
    return this.s.slice(from, this.i);
  }
}

const ANSI_C: Record<string, string> = {
  a: '\u0007',
  b: '\b',
  e: '\u001B',
  E: '\u001B',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

// The value bash gives a `$'…'` word: `$'co\x6dmit'` is `commit`.
function decodeAnsiC(body: string): string {
  return body.replaceAll(
    /\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g,
    (_, esc: string) => {
      const kind = esc[0] ?? '';
      if (kind === 'x' || kind === 'u' || kind === 'U') {
        return String.fromCodePoint(Number.parseInt(esc.slice(1), 16));
      }
      if (/[0-7]/.test(kind)) return String.fromCodePoint(Number.parseInt(esc, 8));
      if (kind === 'c') return String.fromCodePoint((esc.codePointAt(1) ?? 0) & 31);
      return ANSI_C[kind] ?? kind;
    },
  );
}

// The command lists substituted into text that is not itself a command: the
// body of `${…}`, `$((…))` or an unquoted heredoc.
function substitutionsIn(
  text: string,
  aliases: ShellAliases,
  budget?: { left: number },
): Statement[] {
  const found: Statement[] = [];
  for (let j = 0; j < text.length; j++) {
    const at = text[j];
    if (at === '\\') {
      j++;
    } else if (at === '`' || (at === '$' && (text[j + 1] === '(' || text[j + 1] === '{'))) {
      const lexer = new Lexer(text.slice(j), aliases, budget);
      const holder = statement();
      // word() reads the expansion exactly as it is read anywhere else.
      holder.words.push(lexer.word(holder));
      if (holder.inner.length > 0) found.push(holder);
      j += Math.max(lexer.i - 1, 0);
    }
  }
  return found;
}

export function parse(command: string, aliases: ShellAliases = new Map()): Parsed {
  const lexer = new Lexer(command, aliases);
  try {
    const statements = lexer.list(false);
    return { statements, text: lexer.s };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), text: lexer.s };
  }
}

// As Claude Code picks the shell for its own snapshot: by name.
function shellKind(path: string): 'zsh' | 'bash' | null {
  if (path.includes('zsh')) return 'zsh';
  return path.includes('bash') ? 'bash' : null;
}

// Login files can print to stdout, so the aliases sit between two marker
// lines; an rc that `exec`s away never prints the second. `tag` is fresh per
// read, so no rc file or alias value prints a marker line by accident.
function markers(tag: string): [string, string] {
  return [`review-cycle: aliases ${tag}`, `review-cycle: end of aliases ${tag}`];
}

// Claude Code's own listing, so the gate holds the Bash tool's exact values.
const LISTING = "alias | sed 's/^alias //g' | sed 's/^/alias -- /' | head -n 1000";

// Laid out as Claude Code's snapshot script is: bash reads a line whole before
// running it, so an alias the rc defines applies only from the next line. The
// rc path is a literal and its existence decided by the caller, as Claude Code
// does, so an rc that moves $HOME or redefines `[` changes nothing here; with no
// rc there is nothing to list. An rc's DEBUG trap would print between the
// markers, and its own `echo` function would print the markers.
export function aliasScript(rc: string | null, tag: string): string {
  const [start, end] = markers(tag);
  const file = rc === null ? null : `'${rc.replaceAll("'", String.raw`'\''`)}'`;
  const lines = [`trap - DEBUG 2>/dev/null; builtin echo; builtin echo '${start}'`];
  if (file !== null) lines.unshift(`source ${file} < /dev/null > /dev/null 2>&1`);
  if (file !== null) lines.push(LISTING);
  lines.push(`builtin echo '${end}'`);
  return lines.join('\n');
}

// The aliases a reader's output holds, or null when the shell stopped short.
// Every listing line starts `alias -- `; anything else between the markers is
// the rc's own output, such as an ERR trap's.
export function readAliases(out: string, tag: string): Map<string, string> | null {
  const [startLine, endLine] = markers(tag);
  const lines = out.split('\n');
  const start = lines.indexOf(startLine);
  const end = lines.lastIndexOf(endLine);
  if (start === -1 || end <= start) return null;
  return parseShellAliases(lines.slice(start + 1, end).join('\n'), true);
}

// The shell and rc file Claude Code uses for its own snapshot.
export function aliasShell(
  claudeShell: string | undefined,
  shell: string | undefined,
): { path: string; rc: '.zshrc' | '.bashrc' } {
  const usable = (s: string | undefined) => (s !== undefined && shellKind(s) ? s : undefined);
  const path = usable(claudeShell) ?? usable(shell) ?? 'zsh';
  return { path, rc: shellKind(path) === 'bash' ? '.bashrc' : '.zshrc' };
}

// Where the ANSI-C quoted text opened at `from` closes.
function ansiEnd(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === "'") return j;
  }
  return s.length;
}

// A login file can print a terminal escape sequence ahead of a line. Control
// characters inside a value stay: bash reads `\x01#` as a word, not a comment.
function printable(line: string): string {
  const bell = line.startsWith('\u001B]') ? line.indexOf('\u0007') : -1;
  return line.slice(bell + 1);
}

// Whether `s` ends inside a '…' or $'…' quote.
function quoteOpen(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("$'", i)) {
      const end = ansiEnd(s, i + 2);
      if (end >= s.length) return true;
      i = end + 1;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return true;
      i = end + 1;
    } else {
      i += s[i] === '\\' ? 2 : 1;
    }
  }
  return false;
}

// A value as the shell quoted it: '…', $'…' and backslash escapes,
// concatenated. zsh ends a value holding a quote with `'\'`, bash with `'\'''`.
function unquoteWord(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("$'", i)) {
      const end = ansiEnd(s, i + 2);
      out += decodeAnsiC(s.slice(i + 2, end));
      i = end + 1;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return out + s.slice(i + 1);
      out += s.slice(i + 1, end);
      i = end + 1;
    } else if (s[i] === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

// Alias definitions as `alias` prints them in zsh (`name=value`) or bash
// (`alias name='value'`), or as a Claude Code shell snapshot holds them
// (`alias -- name='value'`, among function bodies that are skipped).
export function parseShellAliases(out: string, listing = false): Map<string, string> {
  const aliases = new Map<string, string>();
  const lines = out.split('\n').map((l) => printable(l));
  const prefixed = listing || lines.some((l) => l.startsWith('alias '));
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (prefixed && !raw.startsWith('alias ')) continue;
    const m = /^('[^']*'|[^=\s]+)=(.*)$/s.exec(raw.replace(/^alias\s+(--\s+)?/, ''));
    if (!m?.[1]) continue;
    let value = m[2] ?? '';
    // bash prints a value holding a newline across lines, quote still open.
    while (quoteOpen(value) && i + 1 < lines.length) value += `\n${lines[++i] ?? ''}`;
    aliases.set(m[1].replaceAll("'", ''), unquoteWord(value));
  }
  return aliases;
}
