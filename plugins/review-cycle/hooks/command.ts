// Classifies a Bash command for the commit gate. Pure: no `$`, no I/O.
//
// The accepted shape is deliberately narrow: an optional leading `cd <dir>`,
// then any of `git add …`, read-only git commands and steps such as
// `git fetch` that commit nothing, then at most one `git commit …` (or one
// command that makes commits from history, such as `git merge`) and at most
// one `git push …`, joined by `&&`, `;` or newlines.
// Every other command that would commit or push is refused. Text naming git
// is data only where nothing will run it: an argument to `grep` or `printf`,
// a quoted heredoc into `cat`. Handed to anything that runs code — a shell,
// an interpreter, `xargs`, `find -exec` — it is refused.

import { addArgv, commitSpec, pushSpec, type CommitSpec, type PushSpec } from './git-args';
import { apiActions, asking, type GhAction, type GhContext, type Unlookable } from './github';
import { PUBLISH_TEXT, publishActionsOf } from './publish';
import {
  assignmentName,
  parse,
  QUALIFIER,
  type ShellAliases,
  type Statement,
  type Word,
} from './shell';

// The mode must come before the name: `git config <name> <value> --get` still
// writes (measured on git 2.56).
function readsConfig(args: Word[]): boolean {
  const named = args.findIndex((w) => !w.text.startsWith('-'));
  const before = named === -1 ? args : args.slice(0, named);
  return before.some((w) => /^(--get(-all|-regexp)?|--list|-l)$/.test(w.text));
}

export const BUILTIN_RUNNERS: ReadonlySet<string> = new Set(['.', 'eval', 'source']);
// Commands that run their arguments, or their standard input, as code.
export const INTERPRETERS: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'eval',
  'source',
  '.',
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'tsx',
  'ts-node',
  'lua',
  'perl',
  'ruby',
  'php',
  'find',
  'parallel',
  'watch',
  'script',
  'expect',
  'osascript',
  'uv',
  'mise',
  'nix-shell',
  'sudo',
  'doas',
]);
export const KEYWORDS: ReadonlySet<string> = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'for',
  'case',
  'esac',
  'select',
  'function',
  'coproc',
  '[[',
  ']]',
  'repeat',
  'always',
  'nocorrect',
  'noglob',
]);
// Commands that record existing commits. Their `--continue` forms record a
// conflict resolution instead, which is new content, so those are refused.
const HISTORY = new Set(['merge', 'cherry-pick', 'revert', 'pull', 'rebase']);
// A mention of a git command that commits or pushes.
// `git` and the subcommand as separate words, so `pre-commit`, `.git/hooks/`,
// `fix/merge-conflicts` and helpers like `git merge-base` do not count.
const MENTION =
  /(^|[\s;&|('"`=/])git(\s+-\S+(\s+[^\s-]\S*)?)*\s+(commit|push|merge(?!-(base|tree|file)\b)|cherry-pick|revert|am|pull|rebase)\b|(^|[\s;&|('"`=/])git-(commit|push|merge(?!-(base|tree|file)\b)|cherry-pick|revert|am|pull|rebase)\b/;
// sed's `e` command and s///e, and awk's system() and pipes, run shell code.
const RUNS_SHELL: Record<string, RegExp> = {
  sed: /\/[gipIwmM0-9]*e[gipIwmM0-9]*(['"\s;}]|$)|(^|[\s;'"{])e(\s|$)/,
  awk: /system\s*\(|\|\s*getline|["']\s*\|\s*"|\|\s*"/,
  gawk: /system\s*\(|\|\s*getline|["']\s*\|\s*"|\|\s*"/,
};
// Commands whose arguments are only ever data, never a command to run.
const DATA = new Set([
  'echo',
  'printf',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'ag',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'sort',
  'uniq',
  'jq',
  'tr',
  'cut',
  'diff',
  'gh',
  'bd',
  'column',
]);
// A committing verb as a word of its own, as in `$GIT commit`, not `commit-gate`.
const WORD_VERB = /(^|[\s'"`])(commit|push|merge|cherry-pick|revert|am|pull|rebase)([\s'"`]|$)/;
// Shells that run the script on their standard input when given no script.
const STDIN_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
// Git commands that write commits or push other than commit and push
// themselves; none is needed for everyday work, so none is judged.
const REFUSED = new Set([
  'send-pack',
  'http-push',
  'fast-import',
  'commit-tree',
  'filter-branch',
  'am',
]);
// Steps that commit nothing and leave the index alone, allowed before the one
// command that commits or pushes.
const NEUTRAL = new Set([
  'fetch',
  'checkout',
  'switch',
  'branch',
  'tag',
  'stash',
  'remote',
  'worktree',
]);
// Of those, the ones that can change HEAD or the index: fine before a push or
// a history command, but not before a commit the gate judges from the index.
const MOVES_INDEX = new Set(['checkout', 'switch', 'stash', 'worktree']);
// Steps that change the index; run them on their own before the commit.
const RESTAGE = new Set(['rm', 'mv', 'restore', 'reset', 'apply', 'update-index']);
const READ_ONLY = new Set([
  'grep',
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'describe',
  'ls-files',
  'shortlog',
  'blame',
  'whatchanged',
  'cat-file',
  'rev-list',
  'name-rev',
  'merge-base',
]);
// Author and committer identity, and GIT_TERMINAL_PROMPT; any other GIT_*
// variable can point git at a different index, directory or object store than
// the one checked.
const ALLOWED_GIT_ENV = /^GIT_((AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)|TERMINAL_PROMPT)$/;
// These name a program git runs, so only a bare program name (`cat`, `true`)
// is allowed: anything longer could run a commit of its own.
const GIT_PROGRAM_ENV = /^GIT_(PAGER|EDITOR|SEQUENCE_EDITOR)$/;
// Git's own options before the subcommand that take a separate value.
const GIT_VALUE_OPTIONS = new Set(['--attr-source', '--list-cmds']);

export type GitCall = {
  // Options before the subcommand that `add` replays (`-c key=value` pairs).
  config: string[];
  // `-C` directories, in order, relative to the statement's directory.
  dirs: string[];
  sub: string;
  args: Word[];
};

type Kind =
  // `dir` is null when the directory is not a literal path.
  | { kind: 'cd'; dir: string | null }
  // `via` is a reserved word the command runs under, such as `if` or `!`.
  | { kind: 'git'; git: GitCall; via: string | null }
  // Literal variable assignments with no substitution or redirect: they run nothing.
  | { kind: 'assign' }
  // `words` are the command's words after assignments and reserved words.
  | { kind: 'other'; head: string; words: Word[] }
  // `always` refusals stand whatever the command's text mentions.
  | { kind: 'refuse'; reason: string; always?: boolean };

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

// Git's global options before the subcommand. Only `-C` and `-c` are kept;
// options that point git at a different repository are refused. A `-C` built
// at run time is allowed only for a subcommand that neither commits nor could
// be an alias, which git would look up in that directory.
function gitCall(words: Word[], first: string | null): GitCall | { refuse: string } | null {
  const config: string[] = [];
  const dirs: string[] = [];
  if (first !== null) return { config, dirs, sub: first, args: words.slice(1) };
  let dynamicDir = false;
  let i = 1;
  for (let w = words[i]; w !== undefined; w = words[i]) {
    if (w.dynamic)
      return {
        refuse: 'git run with an option or subcommand built from a variable or substitution',
      };
    const t = w.text;
    if (t === '-C' || t === '-c') {
      const v = words[i + 1];
      if (!v || (v.dynamic && t === '-c'))
        return { refuse: `git ${t} with a value built from a variable or substitution` };
      dynamicDir ||= v.dynamic;
      if (t === '-C') dirs.push(v.text);
      else config.push('-c', v.text);
      i += 2;
    } else if (/^-C./.test(t)) {
      dirs.push(t.slice(2));
      i++;
    } else if (
      /^--(git-dir|work-tree|namespace|bare|config-env|exec-path|super-prefix)(=|$)/.test(t)
    ) {
      return { refuse: `git ${t.split('=')[0]}, which points git at another repository` };
    } else if (GIT_VALUE_OPTIONS.has(t)) {
      i += 2;
    } else if (t.startsWith('-')) {
      i++;
    } else if (w.pattern) {
      return { refuse: `git ${t}, a subcommand the shell would expand` };
    } else {
      const args = words.slice(i + 1);
      if (dynamicDir && !reads(t, args) && !NEUTRAL.has(t))
        return { refuse: 'git -C with a directory built from a variable or substitution' };
      return { config, dirs, sub: t, args };
    }
  }
  return null;
}

function reads(sub: string, args: Word[]): boolean {
  return READ_ONLY.has(sub) || (sub === 'config' && readsConfig(args));
}

function kindOf(st: Statement): Kind {
  let words = st.words;
  let assigned = false;
  let via: string | null = null;
  for (let first = words[0]; first !== undefined; first = words[0]) {
    const name = assignmentName(first);
    if (name) {
      const value = first.text.slice(name.length + 1);
      const program = GIT_PROGRAM_ENV.test(name) && !first.dynamic && /^[\w.-]+$/.test(value);
      if (name.startsWith('GIT_') && !ALLOWED_GIT_ENV.test(name) && !program) {
        return { kind: 'refuse', reason: `${name}, which changes what git commits` };
      }
      assigned = true;
    } else if (!first.dynamic && KEYWORDS.has(first.text)) {
      via ??= first.text;
    } else {
      break;
    }
    words = words.slice(1);
  }
  const [head, arg] = words;
  if (head === undefined) {
    // A substitution or redirect runs between the gate's check and the commit.
    const inert = st.inner.length === 0 && !st.redirected;
    if (assigned && via === null && inert) return { kind: 'assign' };
    return { kind: 'other', head: via ?? '', words };
  }
  if (head.dynamic) {
    return { kind: 'refuse', reason: 'a command name built from a variable or substitution' };
  }
  if (head.pattern) return { kind: 'refuse', reason: 'a command name the shell would expand' };
  if (head.text === 'cd' && !assigned && via === null) {
    if (words.length !== 2 || !arg || arg.dynamic) return { kind: 'cd', dir: null };
    return { kind: 'cd', dir: arg.text };
  }
  const name = basename(head.text.replace(/^=/, ''));
  const plumbing = /^git-(.+)$/.exec(name)?.[1] ?? null;
  if (name !== 'git' && plumbing === null) return { kind: 'other', head: name, words };
  const g = gitCall(words, plumbing);
  if (g === null) return { kind: 'other', head: name, words };
  if ('refuse' in g) return { kind: 'refuse', reason: g.refuse, always: true };
  return { kind: 'git', git: g, via };
}

function commits(sub: string): boolean {
  return sub === 'commit' || sub === 'push' || HISTORY.has(sub);
}

// A fast-forward pull records no commit. The last of `--ff`, `--no-ff` and
// `--ff-only` wins, and a run-time word could be any; `merge --ff-only -s ours`
// still records a merge, so merge is not included.
function fastForwardOnly(g: GitCall): boolean {
  if (g.sub !== 'pull' || g.args.some((w) => w.dynamic)) return false;
  return g.args.findLast((w) => /^--(no-)?ff(-only)?$/.test(w.text))?.text === '--ff-only';
}

function records(g: GitCall): boolean {
  return commits(g.sub) && !fastForwardOnly(g);
}

function textOf(st: Statement): string {
  return [...st.words.map((w) => w.text), ...st.heredocs.map((h) => h.body)].join(' ');
}

export function every(
  list: Statement[],
  visit: (st: Statement, nested: boolean) => string | null,
  nested = false,
): string | null {
  for (const st of list) {
    const found = visit(st, nested);
    if (found) return found;
    for (const inner of st.inner) {
      const deeper = every(inner, visit, true);
      if (deeper) return deeper;
    }
  }
  return null;
}

// The git calls a command's words make after the first, as `arch -arm64 git
// push` or `flock /tmp/l git commit` would run them. A data command's words
// are never run.
function gitCallsIn(words: Word[]): (GitCall | { refuse: string })[] {
  if (DATA.has(basename(words[0]?.text ?? ''))) return [];
  const calls: (GitCall | { refuse: string })[] = [];
  for (const [i, w] of words.entries()) {
    if (i === 0 || w.dynamic) continue;
    const name = basename(w.text);
    const plumbing = /^git-(.+)$/.exec(name)?.[1] ?? null;
    if (name !== 'git' && plumbing === null) continue;
    const g = gitCall(words.slice(i), plumbing);
    if (g !== null) calls.push(g);
  }
  return calls;
}

// Whether any word after the first starts a git command that commits or
// pushes, or a variable stands in for git before a committing subcommand.
function runsGit(words: Word[]): string | null {
  if (DATA.has(basename(words[0]?.text ?? ''))) return null;
  for (const [i, w] of words.entries()) {
    if (i === 0 || !w.dynamic) continue;
    const next = words.slice(i + 1).find((x) => !x.text.startsWith('-'));
    if (next && (commits(next.text) || REFUSED.has(next.text))) {
      return `\`${w.text} ${next.text}\``;
    }
  }
  for (const g of gitCallsIn(words)) {
    if ('refuse' in g) return 'git with options the gate cannot read';
    // Run through another program, a fast-forward's arguments go unread.
    if (commits(g.sub) || REFUSED.has(g.sub)) return `git ${g.sub}`;
  }
  return null;
}

// A program among the words that runs code it is given: `bash -c`, or
// `timeout 5 sh` reading a script from a pipe. Every word is checked, since
// anything can run the command after its own options.
function runsCode(
  words: Word[],
  own: string,
  mentions: boolean,
  aliases: ShellAliases,
): string | null {
  if (DATA.has(basename(words[0]?.text ?? ''))) return null;
  for (const [i, w] of words.entries()) {
    if (w.dynamic) continue;
    const name = basename(w.text);
    const runs = Object.hasOwn(RUNS_SHELL, name) ? RUNS_SHELL[name] : undefined;
    if (runs && runs.test(own) && MENTION.test(own)) {
      return `\`${name}\` running a git commit or push`;
    }
    // xargs builds its command from its input, which anything in the command
    // may feed it; one running a data command runs nothing else.
    if (name === 'xargs') {
      const target = words.slice(i + 1).find((x) => !x.text.startsWith('-'));
      if (mentions && !DATA.has(basename(target?.text ?? ''))) {
        return '`xargs` given a git commit or push to run';
      }
      continue;
    }
    if (!INTERPRETERS.has(name)) continue;
    // Builtins run code only as the command itself: `fd x .` searches `.`.
    if (i > 0 && BUILTIN_RUNNERS.has(name)) continue;
    // A shell with no script reads one from its standard input: a pipe or
    // heredoc anywhere in the command can feed it.
    const scriptless =
      STDIN_SHELLS.has(name) &&
      words.slice(i + 1).every((x) => x.text.startsWith('-') && x.text !== '-c');
    // A shell's `-c` script is a command like any other; judge it as one.
    const c = words.findIndex((x, j) => j > i && x.text === '-c');
    const script = c === -1 ? undefined : words[c + 1];
    if (
      STDIN_SHELLS.has(name) &&
      script &&
      !script.dynamic &&
      classify(script.text, aliases).kind !== 'none'
    ) {
      return `\`${name} -c\` running a git commit or push`;
    }
    if (MENTION.test(own) || (scriptless && mentions)) {
      return `\`${name}\` given a git commit or push to run`;
    }
  }
  return null;
}

// Whether an alias's value, with the aliases inside it expanded and the
// words that follow it in `rest`, names a git command that commits or pushes:
// `g push` with `g=git` does.
function aliasMentionsGit(name: string, aliases: ShellAliases, rest = ''): boolean {
  const value = aliases.get(name);
  if (value === undefined) return false;
  return MENTION.test(` ${parse(value, aliases).text} ${rest}`);
}

// A reason to refuse found anywhere in the command, or null; the shape of the
// top-level commit or push is checked in classify(). `text` is the command
// with its aliases expanded.
function hidden(statements: Statement[], text: string, aliases: ShellAliases): string | null {
  const mentions = MENTION.test(text);
  return every(statements, (st, nested) => {
    const k = kindOf(st);
    // Where the reader simplifies the shell's grammar — a case arm, a
    // function body, eval's argument — an alias it left unexpanded may run.
    const structured =
      st.group ||
      st.words.some((w) => !w.dynamic && KEYWORDS.has(w.text)) ||
      (k.kind === 'other' && BUILTIN_RUNNERS.has(k.head));
    const words = st.words.map((w) => w.text);
    const unread = !structured
      ? undefined
      : st.aliases.find((a) =>
          aliasMentionsGit(a, aliases, words.slice(words.indexOf(a) + 1).join(' ')),
        );
    if (unread !== undefined) {
      return `the shell alias \`${unread}\`, which runs a git commit or push where the gate cannot read it`;
    }
    const own = ` ${textOf(st)}`;
    const splits = st.words.some((w) => /^(-S|--split-string)/.test(w.text));
    if (splits && st.words.some((w) => basename(w.text) === 'env') && MENTION.test(own)) {
      return 'env -S running a git commit or push';
    }
    if (k.kind === 'refuse') {
      return k.always || mentions || WORD_VERB.test(text) ? k.reason : null;
    }
    if (k.kind === 'git') {
      const sub = k.git.sub;
      if (REFUSED.has(sub)) return `git ${sub}, which writes commits the gate cannot judge`;
      if (
        sub === 'config' &&
        !readsConfig(k.git.args) &&
        k.git.args.some((w) => /^alias\./i.test(w.text)) &&
        statements.length > 1
      ) {
        return 'a git alias defined alongside other commands, which the gate reads only beforehand';
      }
      if (sub === 'subtree' && k.git.args.some((w) => /^(push|add|merge|pull)$/.test(w.text))) {
        return 'git subtree, which commits or pushes where the gate cannot judge it';
      }
      if (records(k.git) || sub === 'add') {
        if (nested) return `git ${sub} inside a substitution, group or heredoc`;
        if (k.via) return `git ${sub} run through ${k.via}`;
        return null;
      }
      // A fast-forward's own `git pull` is not a mention; its arguments may be.
      const judged = fastForwardOnly(k.git)
        ? ` ${[...k.git.args.map((w) => w.text), ...st.heredocs.map((h) => h.body)].join(' ')}`
        : own;
      if (!READ_ONLY.has(sub) && MENTION.test(judged)) {
        return `git ${sub} running a git command that commits or pushes`;
      }
      return null;
    }
    if (k.kind === 'other') {
      const found = runsGit(k.words);
      if (found) return `${found} run through \`${k.head}\``;
      // `echo push | xargs git`: git's subcommand arrives at run time.
      const bare = k.words.some(
        (w, i) =>
          i > 0 &&
          !w.dynamic &&
          basename(w.text) === 'git' &&
          gitCall(k.words.slice(i), null) === null,
      );
      if (bare && WORD_VERB.test(text)) {
        return `git run through \`${k.head}\` with its subcommand supplied at run time`;
      }
      // eval reads its arguments as a command, aliases and all.
      const run =
        k.head === 'eval'
          ? ` ${
              parse(
                k.words
                  .slice(1)
                  .map((w) => w.text)
                  .join(' '),
                aliases,
              ).text
            }`
          : own;
      const code = runsCode(k.words, run, mentions, aliases);
      if (code) return code;
    }
    return null;
  });
}

type Gated = {
  kind: 'gated';
  // Directory the git statements run in, relative to the shell's cwd.
  dir: string;
  // Each `git add` to replay: the words after `git`, config options first.
  adds: string[][];
} & (
  | { commit: CommitSpec; history: null; push: PushSpec | null }
  | { commit: null; history: string; push: PushSpec | null }
  | { commit: null; history: null; push: PushSpec }
);

export type Classification = { kind: 'none' } | { kind: 'refuse'; reason: string } | Gated;

const SHAPE =
  'Run the commit as its own command, optionally after `git add …` and read-only git commands, joined with && (for example `git add -A && git commit -m …`).';

function joinDir(base: string, dirs: string[]): string {
  let d = base;
  for (const x of dirs) d = x.startsWith('/') ? x : d === '.' ? x : `${d}/${x}`;
  return d;
}

// Git calls anywhere in the command whose subcommand git does not ship under
// that name, so it may be an alias. `inline` is a `-c alias.<sub>=…` value.
export function possibleAliases(
  command: string,
  aliases: ShellAliases = new Map(),
): { sub: string; inline: string | null }[] {
  // Read twice: with git as itself, so `git ci` is looked up even under
  // `git='hub'`, and through the `git` alias, which can add its own `-c alias.<sub>=…`.
  const out = aliasCallsIn(command, withoutGit(aliases));
  if (!aliases.has('git')) return out;
  for (const a of aliasCallsIn(command, aliases)) {
    if (!out.some((o) => o.sub === a.sub && o.inline === a.inline)) out.push(a);
  }
  return out;
}

function aliasCallsIn(
  command: string,
  aliases: ShellAliases,
): { sub: string; inline: string | null }[] {
  const parsed = parse(command, aliases);
  if ('error' in parsed) return [];
  const out: { sub: string; inline: string | null }[] = [];
  every(parsed.statements, (st) => {
    const k = kindOf(st);
    const calls = k.kind === 'git' ? [k.git] : k.kind === 'other' ? gitCallsIn(k.words) : [];
    for (const g of calls) {
      if ('refuse' in g || reads(g.sub, g.args) || commits(g.sub) || g.sub === 'add') continue;
      const prefix = `alias.${g.sub}=`;
      const inline = g.config.find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? null;
      out.push({ sub: g.sub, inline });
    }
    return null;
  });
  return out;
}

// A `!` git alias runs its text in a shell, with the alias's arguments
// appended: one that ends in a bare `git`, or passes them on, runs whatever
// it is given.
function shellAliasCommits(script: string): boolean {
  if (classify(script).kind !== 'none' || /\$[@*1-9]/.test(script)) return true;
  const parsed = parse(script);
  if ('error' in parsed) return true;
  // An inline `-c alias.x=…` defines a git alias the gate cannot look up.
  if (possibleAliases(script).some((a) => a.inline !== null)) return true;
  const words = parsed.statements.at(-1)?.words ?? [];
  return words.some(
    (w, i) => !w.dynamic && basename(w.text) === 'git' && gitCall(words.slice(i), null) === null,
  );
}

// Whether alias `sub` ends up committing or pushing, following aliases of
// aliases through `lookup` (the expansion of a name, or null for none). An
// expansion may lead with git's own options (`-c x=y commit`). Too deep a
// chain counts as committing: it cannot be followed to the end.
export function aliasCommits(sub: string, lookup: (name: string) => string | null): boolean {
  let name = sub;
  for (let depth = 0; depth < 8; depth++) {
    const expansion = lookup(name)?.trim();
    if (!expansion) return false;
    if (expansion.startsWith('!')) return shellAliasCommits(expansion.slice(1));
    // Git splits an alias as a shell would, quotes included.
    const parsed = parse(expansion);
    if ('error' in parsed) return true;
    const words = (parsed.statements[0]?.words ?? []).map((w) => w.text);
    let i = 0;
    while (i < words.length && (words[i] ?? '').startsWith('-')) {
      i += words[i] === '-c' || words[i] === '-C' || GIT_VALUE_OPTIONS.has(words[i] ?? '') ? 2 : 1;
    }
    const next = words[i] ?? '';
    if (commits(next) || REFUSED.has(next)) return true;
    name = next;
  }
  return true;
}

function execs(w: Word): boolean {
  return /^(--exec(=|$)|-[a-zA-Z]*x[a-zA-Z]*$)/.test(w.text);
}

function withoutGit(aliases: ShellAliases): ShellAliases {
  if (!aliases.has('git')) return aliases;
  const own = new Map(aliases);
  own.delete('git');
  return own;
}

// A shell alias for git itself can run anything in git's place, or more than
// git. A command that reaches it is judged on its expansion, which is what
// runs; one whose expansion does not read as git is refused.
export function classify(command: string, aliases: ShellAliases = new Map()): Classification {
  const git = aliases.get('git');
  const own = withoutGit(aliases);
  const plain = judge(command, own);
  // Read both ways: `eval` reparses its text, so whether the alias is reached
  // cannot be told from the outer command.
  if (git === undefined || plain.kind === 'refuse') return plain;
  const expanded = judge(command, aliases);
  if (expanded.kind === 'gated' || (plain.kind === 'none' && expanded.kind === 'none')) {
    return expanded;
  }
  return {
    kind: 'refuse',
    reason: `\`git\` is a shell alias here (for \`${git}\`), so git would not run as the gate reads it. Run \`\\git …\` so git runs as itself`,
  };
}

// A filter that reads the pipe to its end and runs nothing: `tail` with a
// count, or `wc` with its counting flags. Anything that may stop reading early
// (`head`, `grep -q`, a file operand) can kill a hook still printing, so git
// aborts while the pipeline reports success.
// One count: from the start (`+N`), or a nonzero last-N. GNU `tail` exits at
// once on a zero count and BSD `tail` on a second count, neither reading.
const COUNT = String.raw`(\+\d{1,9}|0*[1-9]\d{0,8})`;
const TAIL_ONE = new RegExp(`^(-0*[1-9]\\d{0,8}|-[nc]${COUNT}|--(lines|bytes)=${COUNT})$`);
const TAIL_COUNT = new RegExp(`^${COUNT}$`);

function readsToEnd(head: string, args: string[]): boolean {
  if (head === 'wc') return args.every((a) => /^-[lcwm]+$/.test(a));
  if (head !== 'tail' || args.length > 2) return false;
  const [a, b] = args;
  if (a === undefined) return true;
  if (b === undefined) return TAIL_ONE.test(a);
  return (a === '-n' || a === '-c') && TAIL_COUNT.test(b);
}

// `op` is the operator after a statement, so a filter fed by a pipe is one
// whose predecessor ends in `|`; one ending in `&` would run the whole
// pipeline in the background, past the gate's check after the command.
function isOutputFilter({ st, k }: { st: Statement; k: Kind }, fed: Statement): boolean {
  return (
    fed.op === '|' &&
    st.op !== '&' &&
    k.kind === 'other' &&
    !st.redirected &&
    st.inner.length === 0 &&
    readsToEnd(
      k.head,
      k.words.slice(1).map((w) => w.text),
    )
  );
}

function judge(command: string, aliases: ShellAliases): Classification {
  const parsed = parse(command, aliases);
  if ('error' in parsed) {
    // The qualifier's code can spell a commit any way, so nothing around it is read.
    if (parsed.error === QUALIFIER) {
      return {
        kind: 'refuse',
        reason: `${QUALIFIER}, which the gate does not read. Run the command without it`,
      };
    }
    // The shell joins a backslash-newline before it reads anything.
    const flat = command.replaceAll('\\\n', '');
    const tokens = flat.split(/[^\w.:@+-]+/);
    const aliased = tokens.some((w, i) =>
      aliasMentionsGit(w, aliases, tokens.slice(i + 1).join(' ')),
    );
    return MENTION.test(flat) || /\bgit\b/.test(flat) || /\bgit\b/.test(parsed.text) || aliased
      ? { kind: 'refuse', reason: `the command could not be read (${parsed.error})` }
      : { kind: 'none' };
  }
  const sts = parsed.statements;

  const reason = hidden(sts, parsed.text, aliases);
  if (reason) return { kind: 'refuse', reason: `${reason}. ${SHAPE}` };

  const all = sts.map((st) => ({ st, k: kindOf(st) }));
  const sensitive = all.some(({ k }) => k.kind === 'git' && records(k.git));
  if (!sensitive) return { kind: 'none' };
  // A pipe into a plain output filter at the very end reads what the commit or
  // push printed and runs nothing, so it is set aside before judging.
  let end = all.length;
  while (end > 1 && isOutputFilter(all[end - 1]!, all[end - 2]!.st)) end--;
  const pairs = all.slice(0, end);
  if (end < all.length) {
    const tail = pairs[end - 1]!;
    pairs[end - 1] = { ...tail, st: { ...tail.st, op: '' } };
  }

  let base = '.';
  let dir: string | null = null;
  const adds: string[][] = [];
  let commit: CommitSpec | null = null;
  let history: string | null = null;
  let push: PushSpec | null = null;
  let movedIndex: string | null = null;
  let retargeted: string | null = null;
  for (const [i, { st, k }] of pairs.entries()) {
    if (st.op !== '' && st.op !== '&&' && st.op !== ';' && st.op !== '\n') {
      return {
        kind: 'refuse',
        reason: `a commit or push in a command joined with \`${st.op}\`. ${SHAPE}`,
      };
    }
    if (st.group)
      return { kind: 'refuse', reason: `a group or function alongside a commit or push. ${SHAPE}` };
    if (k.kind === 'refuse') return { kind: 'refuse', reason: `${k.reason}. ${SHAPE}` };
    if (k.kind === 'assign') continue;
    if (k.kind === 'cd') {
      if (i !== 0) return { kind: 'refuse', reason: `a cd after the first command. ${SHAPE}` };
      if (k.dir === null) {
        return {
          kind: 'refuse',
          reason: `a cd whose directory is not a literal path, before a commit or push. ${SHAPE}`,
        };
      }
      base = k.dir;
      continue;
    }
    if (k.kind === 'other')
      return {
        kind: 'refuse',
        reason: `${k.head ? `\`${k.head}\`` : 'an assignment with a substitution or redirect'} alongside a commit or push. ${SHAPE}`,
      };
    const g = k.git;
    const d = joinDir(base, g.dirs);
    if (reads(g.sub, g.args)) continue;
    if ((NEUTRAL.has(g.sub) || fastForwardOnly(g)) && !commit && history === null && !push) {
      // A pull moves HEAD, and `--squash` stages what it brings in.
      if (MOVES_INDEX.has(g.sub) || g.sub === 'pull') movedIndex = g.sub;
      // Any of them can move HEAD, a branch, an upstream or a remote URL.
      retargeted ??= g.sub;
      continue;
    }
    if (RESTAGE.has(g.sub)) {
      return {
        kind: 'refuse',
        reason: `git ${g.sub} alongside a commit. Run it as its own command first, then commit`,
      };
    }
    if (dir !== null && d !== dir)
      return { kind: 'refuse', reason: `git commands in different directories. ${SHAPE}` };
    dir = d;
    if (g.sub === 'add') {
      if (commit || history || push)
        return { kind: 'refuse', reason: `git add after the commit. ${SHAPE}` };
      // With `;`, a failed add still lets the commit run, on an index the
      // gate never judged.
      if (st.op !== '&&') {
        return {
          kind: 'refuse',
          reason: `git add joined with \`${st.op === '\n' ? 'a newline' : st.op}\`. ${SHAPE}`,
        };
      }
      const argv = addArgv(g.config, g.args);
      if ('refuse' in argv) return { kind: 'refuse', reason: `${argv.refuse}. ${SHAPE}` };
      adds.push(argv);
    } else if (g.sub === 'push') {
      if (push) return { kind: 'refuse', reason: `more than one push. ${SHAPE}` };
      const spec = pushSpec(g.args);
      if ('refuse' in spec) return { kind: 'refuse', reason: spec.refuse };
      push = {
        ...spec,
        argv: spec.argv === null ? null : { ...spec.argv, config: g.config },
        // `git rebase <upstream> <branch>` checks the branch out first.
        after: retargeted ?? history,
      };
    } else {
      if (commit || history || push)
        return {
          kind: 'refuse',
          reason: `more than one command that commits, or one after a push. ${SHAPE}`,
        };
      if (g.sub === 'commit') {
        if (movedIndex !== null) {
          return {
            kind: 'refuse',
            reason: `git ${movedIndex} before a commit can change what it records. Run it as its own command first, then commit`,
          };
        }
        const spec = commitSpec(g.args);
        if ('refuse' in spec) return { kind: 'refuse', reason: spec.refuse };
        commit = { ...spec, config: g.config };
      } else if (HISTORY.has(g.sub)) {
        if (adds.length > 0)
          return { kind: 'refuse', reason: `git add before git ${g.sub}. ${SHAPE}` };
        if (g.sub === 'rebase' && g.args.some(execs)) {
          return {
            kind: 'refuse',
            reason: `git ${g.sub} --exec, which runs commands the gate cannot see. The user can run it from their terminal`,
          };
        }
        if (g.args.some((w) => w.text === '--continue')) {
          return {
            kind: 'refuse',
            reason: `git ${g.sub} --continue records the conflict resolution, content no reviewer has seen. Review the resolution first; the user can finish it from their terminal`,
          };
        }
        history = g.sub;
      } else {
        return { kind: 'refuse', reason: `git ${g.sub} alongside a commit or push. ${SHAPE}` };
      }
    }
  }
  const at = dir ?? base;
  if (commit) return { kind: 'gated', dir: at, adds, commit, history: null, push };
  if (history !== null) return { kind: 'gated', dir: at, adds, commit: null, history, push };
  if (push) return { kind: 'gated', dir: at, adds, commit: null, history: null, push };
  throw new Error('a command that commits was classified with nothing to gate');
}

function tame(text: string): string {
  return text
    .trim()
    .replaceAll(/[\p{Zs}\t]*\r?\n\s*/gu, ' ⏎ ')
    .replaceAll(/[\p{Zs}\t]+/gu, ' ')
    .replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '\u{FFFD}');
}

// gh's own commands (gh 2.102.0's `gh --help`). Any other word is a gh alias
// or an extension, which the gate does not read.
const GH_COMMANDS = new Set([
  'agent-task',
  'alias',
  'api',
  'attestation',
  'auth',
  'browse',
  'cache',
  'codespace',
  'cs',
  'completion',
  'config',
  'copilot',
  'discussion',
  'extension',
  'ext',
  'extensions',
  'gist',
  'gpg-key',
  'help',
  'issue',
  'label',
  'licenses',
  'org',
  'pr',
  'preview',
  'project',
  'release',
  'repo',
  'ruleset',
  'run',
  'search',
  'secret',
  'skill',
  'ssh-key',
  'status',
  'variable',
  'version',
  'workflow',
]);
// The verbs of the groups the ladder reads; any other word there is an alias
// (`pr m`), so it asks.
const GH_VERBS: Record<string, ReadonlySet<string>> = {
  pr: new Set([
    'create',
    'new',
    'list',
    'ls',
    'status',
    'checkout',
    'co',
    'checks',
    'close',
    'comment',
    'diff',
    'edit',
    'lock',
    'merge',
    'ready',
    'reopen',
    'revert',
    'review',
    'unlock',
    'update-branch',
    'view',
  ]),
  issue: new Set([
    'create',
    'new',
    'list',
    'ls',
    'status',
    'close',
    'comment',
    'delete',
    'develop',
    'edit',
    'lock',
    'pin',
    'reopen',
    'transfer',
    'unlock',
    'unpin',
    'view',
  ]),
  release: new Set([
    'create',
    'new',
    'list',
    'ls',
    'delete',
    'delete-asset',
    'download',
    'edit',
    'upload',
    'verify',
    'verify-asset',
    'view',
  ]),
};

// gh's options that take a value: `gh -R o/r pr create`, `gh pr -R o/r create`.
const GH_VALUE = new Set(['-R', '--repo', '--hostname']);
// `gh pr merge`'s options that take a value.
const MERGE_VALUE = new Set([
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-t',
  '--subject',
  '--match-head-commit',
  '-A',
  '--author-email',
]);
const RELEASE_WRITES = new Set(['create', 'new', 'edit', 'delete', 'delete-asset', 'upload']);
// Read as text when the command does not parse: opening a pull request, and
// any other gh write, which then cannot be read further.
const GH_PR = /\bgh\b[^|;&\n]*\bpr\s+(?:[^\s;&|]+\s+)*?(create|new|ready)\b/;
const GH_WRITE =
  /\bgh\b[^|;&\n]*\b((pr\s+(?:[^\s;&|]+\s+)*?(merge|review|comment)|issue\s+(?:[^\s;&|]+\s+)*?comment|release\s+(?:[^\s;&|]+\s+)*?(create|new|edit|delete|upload))\b|api\s(?:[^|;&\n]*\s)?(-X|--method|-[fF]|--field|--raw-field|--input))/;

const isRepo = (t: string) => t === '-R' || t === '--repo';
const namesRepo = (t: string) => isRepo(t) || t.startsWith('--repo=') || /^-R./.test(t);

// The repository an option names: `-R o/r`, `-Ro/r`, `--repo o/r`, `--repo=o/r`.
function repoAt(words: Word[], i: number): Word | null {
  const w = words[i];
  const t = w?.text ?? '';
  if (w && t.startsWith('--repo=')) return { ...w, text: t.slice('--repo='.length) };
  if (w && /^-R./.test(t)) return { ...w, text: t.slice(2) };
  return words[i + 1] ?? null;
}

// Skips options from `i`, noting the repository one names.
function pastOptions(words: Word[], from: number, into: { repo: Word | null }): number {
  let i = from;
  while (words[i]?.text.startsWith('-')) {
    const t = words[i]?.text ?? '';
    if (namesRepo(t)) into.repo = repoAt(words, i);
    i += GH_VALUE.has(t) ? 2 : 1;
  }
  return i;
}

// Go's strconv.ParseBool, which gh's flags use: `--approve=0` is unset.
const FALSE = new Set(['0', 'f', 'F', 'false', 'False', 'FALSE']);

// Whether a gh boolean flag is set, as gh's flag parser reads it: `--name`,
// `--name=<true>`, or its letter in a short cluster before a letter that takes
// the rest as its value (`-ab LGTM` approves, `-a=false` does not).
function flagSet(words: Word[], long: string, short: string | null, valueLetters: string): boolean {
  return words.some(({ text: t }) => {
    if (t === `--${long}`) return true;
    if (t.startsWith(`--${long}=`)) return !FALSE.has(t.slice(long.length + 3));
    if (short === null || !/^-[^-]/.test(t)) return false;
    for (let i = 1; i < t.length; i++) {
      const letter = t.charAt(i);
      if (letter === short) return t[i + 1] === '=' ? !FALSE.has(t.slice(i + 2)) : true;
      if (valueLetters.includes(letter)) return false;
    }
    return false;
  });
}

// Whether a word built at run time may be a flag or a selector rather than
// the value of an option that takes one (`-b "$BODY"`, `--subject="$S"`,
// `-b"$BODY"`). Unquoted, a value may split into words that are flags.
function builtArgs(rest: Word[], values: ReadonlySet<string>): boolean {
  return rest.some((w, i) => {
    if (!w.dynamic) return false;
    if (w.splits) return true;
    if (values.has(rest[i - 1]?.text ?? '')) return false;
    const option = /^(--[^=]+)=/.exec(w.text)?.[1] ?? /^(-[^-])./.exec(w.text)?.[1];
    return option === undefined || !values.has(option);
  });
}

const REVIEW_VALUE = new Set(['-b', '--body', '-F', '--body-file', '-R', '--repo']);

// What a `gh pr` command names for `gh pr view` to look up, or why it cannot be.
function lookupOf(
  rest: Word[],
  repo: Word | null,
  context: GhContext,
): readonly string[] | Unlookable {
  let selector: Word | null = null;
  let target = repo;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]?.text ?? '';
    if (namesRepo(t)) {
      target = repoAt(rest, i);
      if (isRepo(t)) i++;
    } else if (MERGE_VALUE.has(t)) i++;
    else if (!t.startsWith('-') && selector === null) selector = rest[i] ?? null;
  }
  if (context === 'beside') return { cannot: 'beside' };
  if (context === 'elsewhere' || target?.dynamic) return { cannot: 'elsewhere' };
  return [...(selector ? [selector.text] : []), ...(target ? ['--repo', target.text] : [])];
}

function mergeOf(words: Word[], from: number, repo: Word | null, context: GhContext): GhAction {
  const rest = words.slice(from);
  return {
    kind: 'merge',
    admin: flagSet(rest, 'admin', null, ''),
    lookup: lookupOf(rest, repo, context),
  };
}

// The gh command at `at`. An alias or extension is not read, so the agent
// writes gh's own words; `fed` is xargs or parallel supplying the rest.
function ghAt(
  words: Word[],
  at: number,
  context: GhContext,
  fed: boolean,
): GhAction | GhAction[] | null {
  const seen = { repo: null as Word | null };
  const sub = pastOptions(words, at + 1, seen);
  const group = words[sub]?.text;
  const fromInput = { kind: 'unread', why: 'its gh command comes from its input' } as const;
  if (group === undefined) return fed ? fromInput : null;
  if (words[sub]?.dynamic) return { kind: 'unread', why: 'its gh command is built at run time' };
  if (!GH_COMMANDS.has(group)) {
    return {
      kind: 'unread',
      why: `\`gh ${group}\` is a gh alias or extension, which the gate does not read`,
    };
  }
  if (group === 'api') {
    // `gh --hostname h api …` sends it to another host.
    const host = words.slice(at + 1, sub).some((w) => /^--hostname(=|$)/.test(w.text));
    return apiActions(words.slice(sub + 1), host ? 'elsewhere' : context, fed);
  }
  const verbs = GH_VERBS[group];
  if (verbs === undefined) return null;
  const verbAt = pastOptions(words, sub + 1, seen);
  const verb = words[verbAt]?.text;
  if (verb === undefined) return fed ? fromInput : null;
  if (words[verbAt]?.dynamic) return { kind: 'unread', why: 'its gh command is built at run time' };
  if (!verbs.has(verb)) {
    return {
      kind: 'unread',
      why: `\`gh ${group} ${verb}\` is a gh alias, which the gate does not read`,
    };
  }
  const w = words;
  const rest = w.slice(verbAt + 1);
  // A flag built at run time or fed by xargs could approve, merge with
  // --admin or point --repo elsewhere, which the words do not show.
  const unreadArgs = {
    kind: 'unread',
    why: `the arguments of \`gh pr ${verb}\` are built at run time or come from its input`,
  } as const;
  if (group === 'pr') {
    if (verb === 'create' || verb === 'new' || verb === 'revert') return { kind: 'pr' };
    if (verb === 'merge') {
      if (fed || builtArgs(rest, new Set([...MERGE_VALUE, '-R', '--repo']))) return unreadArgs;
      return mergeOf(w, verbAt + 1, seen.repo, context);
    }
    if (verb === 'review') {
      if (fed || builtArgs(rest, REVIEW_VALUE)) return unreadArgs;
      return { kind: flagSet(rest, 'approve', 'a', 'bFR') ? 'approve' : 'comment' };
    }
    if (verb === 'comment') return { kind: 'comment' };
    // `--undo` turns it back into a draft, which asks nobody to review it.
    if (verb === 'ready') {
      // A value built at run time may be `false`, which marks it ready.
      const built = rest.some((w) => w.dynamic && w.text.startsWith('--undo='));
      return flagSet(rest, 'undo', null, '') && !built ? null : { kind: 'pr' };
    }
    // Merges or rebases the base into the pull request's own branch.
    if (verb === 'update-branch') {
      if (fed || builtArgs(rest, new Set(['-R', '--repo']))) return unreadArgs;
      if (flagSet(rest, 'rebase', null, '')) {
        return { kind: 'push', ref: asking("it rebases the pull request's branch", true) };
      }
      const lookup = lookupOf(rest, seen.repo, context);
      return 'cannot' in lookup
        ? { kind: 'push', ref: asking('the pull request it updates cannot be looked up', false) }
        : { kind: 'push', ref: { head: lookup } };
    }
  }
  if (group === 'issue' && verb === 'comment') return { kind: 'comment' };
  if (group === 'release' && RELEASE_WRITES.has(verb)) return { kind: 'release' };
  return null;
}

// Commands that hand their input to the command they run.
const FROM_INPUT = new Set(['xargs', 'parallel']);

// As for git, `gh` or a publisher at any word runs unless the first word is a data command:
// `timeout 60 gh pr create`, `sudo -u bot gh …`. Quoted text is not read, so
// `bash -c "gh pr create"` goes unseen: a well-meaning agent writes it plainly.
function ghActionsOf(st: Statement, alone: boolean): GhAction[] {
  const first = basename(st.words[0]?.text ?? '');
  // `gh` is a data command to the git check: what it is given never runs git.
  if (first !== 'gh' && DATA.has(first)) return [];
  const found: GhAction[] = [];
  const published = publishActionsOf(st.words);
  for (const [at, word] of st.words.entries()) {
    const publish = published.get(at);
    if (publish) found.push(publish);
    if (basename(word.text) !== 'gh') continue;
    const before = st.words.slice(0, at);
    const fed = before.some((w) => FROM_INPUT.has(basename(w.text)));
    // `env -C dir`, `sudo -D dir`: the merge runs where the lookup does not.
    // gh finds its repository through git, so GIT_DIR= and the like move it too.
    const moved = before.some((w) => /^(GH_(REPO|HOST)|GIT_\w+)=|^-[CD]|^--chdir/.test(w.text));
    const context = moved ? 'elsewhere' : alone ? 'fixed' : 'beside';
    const action = ghAt(st.words, at, context, fed);
    if (Array.isArray(action)) found.push(...action);
    else if (action) found.push(action);
  }
  return found;
}

// Every gh command or package publish in the command that opens, merges,
// approves, comments on, releases or pushes, read as text when the command
// does not parse.
export function ghActions(command: string, aliases: ShellAliases = new Map()): GhAction[] {
  const parsed = parse(command, aliases);
  if ('error' in parsed) {
    const found: GhAction[] = [];
    if (GH_PR.test(parsed.text)) found.push({ kind: 'pr' });
    if (GH_WRITE.test(parsed.text) || PUBLISH_TEXT.test(parsed.text)) {
      found.push({ kind: 'unread', why: 'it does not parse', remedy: 'Write it so it parses.' });
    }
    return found;
  }
  const found: GhAction[] = [];
  const alone = parsed.statements.length === 1;
  every(parsed.statements, (st, nested) => {
    found.push(...ghActionsOf(st, alone && !nested));
    return null;
  });
  return found;
}

// Whether the command opens a pull request with `gh pr create` (or its alias
// `gh pr new`).
export function opensPr(command: string, aliases: ShellAliases = new Map()): boolean {
  return ghActions(command, aliases).some((a) => a.kind === 'pr');
}

// The command as the gate's push refusal quotes it: every line, runs of spaces
// collapsed, and characters that could hide or reorder text replaced. A
// command that uses shell aliases also shows their expansion, which is what runs.
export function shownCommand(command: string, aliases: ShellAliases = new Map()): string {
  const raw = tame(command);
  const expanded = tame(parse(command, aliases).text);
  return expanded === raw ? raw : `${raw} (aliases expanded: ${expanded})`;
}
