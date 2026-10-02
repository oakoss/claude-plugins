import type { Word } from './shell';

export type Refusal = { refuse: string };

export type CommitSpec = {
  all: boolean;
  amend: boolean;
  dryRun: boolean;
  // The commit's own `-c` options, which `-a` staging must see too.
  config: string[];
};

export type PushSpec = {
  // `lease` is --force-with-lease or --force-if-includes; `bare` is --force,
  // -f, --mirror or a `+refspec`, which overwrite whatever the remote holds.
  force: 'none' | 'lease' | 'bare';
  // --tags, --follow-tags, a refs/tags/ refspec or `tag <name>`.
  tags: boolean;
  // --delete, -d, --prune, --mirror or a `:ref` refspec.
  deletes: boolean;
  // --all, --branches or --mirror.
  every: boolean;
  // `default` when none is given, so git's configured default applies.
  remote: 'default' | 'dynamic' | { name: string };
  // The refspecs after the remote; null when one is built at run time.
  refspecs: string[] | null;
  // The push as git is given it, `-c` options then the words after `push`,
  // for the gate to repeat as a dry run; null when a word is built at run time.
  // `end` is the index of the `--` that ends its options, else the length.
  argv: { config: string[]; args: string[]; end: number } | null;
  // An earlier step that can retarget the push, unseen by a dry run run first.
  after: string | null;
};

// `value` takes the rest of the word or else the next word (`--x=v` or
// `--x v` for a long one); `attached` takes only the rest of the word, so
// `-uno` and `--signed=if-asked` but never the next word; a refusal stops
// the read with its reason.
type Kind = 'flag' | 'value' | 'attached' | Refusal;

type Table<L extends string, S extends string> = {
  sub: string;
  long: Readonly<Record<L, Kind>>;
  short: Readonly<Record<S, Kind>>;
  // Whether a short letter the table does not name is refused or let pass.
  otherShort: 'refuse' | 'accept';
  // Refuse an option whose value would be the next word when there is none.
  needsValue: boolean;
};

// Tables are object literals, so a name listed twice does not compile, and
// the option names a callback compares against are their keys, so a
// misspelled one does not compile either.
const table = <L extends string, S extends string>(t: Table<L, S>): Table<L, S> => t;

// A known option as read. `value` is the attached text, or the next word
// for a `value` kind (null when the words ran out).
type Option<L extends string, S extends string> =
  | { long: true; name: L; value: Word | null }
  | { long: false; name: S; value: Word | null };

type Read = { positionals: Word[]; end: number };

function kindOf<K extends string>(names: Readonly<Record<K, Kind>>, name: string): Kind | null {
  return Object.hasOwn(names, name) ? names[name as K] : null;
}

// Git accepts any unambiguous prefix of a long option (`--ame` amends), so
// only exact names are read and any other is refused.
function readOptions<L extends string, S extends string>(
  args: Word[],
  options: Table<L, S>,
  option: (o: Option<L, S>) => void,
  positional: (w: Word, afterOptions: boolean) => Refusal | null = () => null,
): Read | Refusal {
  const positionals: Word[] = [];
  const unknown = (name: string) => ({
    refuse: `git ${options.sub} ${name}, an option the gate does not know. Spell it out in full`,
  });
  const valueless = (name: string) => ({
    refuse: `git ${options.sub} ${name} without a value. Give it one, or leave it out`,
  });
  let end = args.length;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    // An option is read by its name even when its value is built at run
    // time: `--force-with-lease=main:$expect`.
    const t = arg.text;
    if (i > end || !t.startsWith('-') || t === '-') {
      const refused = positional(arg, i > end);
      if (refused) return refused;
      positionals.push(arg);
      continue;
    }
    if (t === '--') {
      end = i;
      continue;
    }
    if (t.startsWith('--')) {
      const name = t.slice(2).split('=')[0] ?? '';
      const kind = kindOf(options.long, name);
      if (kind === null) return unknown(`--${name}`);
      if (typeof kind === 'object') return kind;
      const eq = t.indexOf('=');
      let value: Word | null = eq === -1 ? null : { ...arg, text: t.slice(eq + 1) };
      if (kind === 'value' && eq === -1) {
        value = args[i + 1] ?? null;
        if (++i >= args.length && options.needsValue) return valueless(`--${name}`);
      }
      option({ long: true, name: name as L, value });
      continue;
    }
    for (let j = 1; j < t.length; j++) {
      const letter = t.charAt(j);
      const kind = kindOf(options.short, letter);
      if (kind === null) {
        if (options.otherShort === 'refuse') return unknown(`-${letter}`);
        continue;
      }
      if (typeof kind === 'object') return kind;
      const rest = j < t.length - 1 ? { ...arg, text: t.slice(j + 1) } : null;
      let value: Word | null = kind === 'flag' ? null : rest;
      if (kind === 'value' && rest === null) {
        value = args[i + 1] ?? null;
        if (++i >= args.length && options.needsValue) return valueless(`-${letter}`);
      }
      option({ long: false, name: letter as S, value });
      if (kind !== 'flag') break;
    }
  }
  return { positionals, end };
}

const PUSH = table({
  sub: 'push',
  long: {
    repo: 'value',
    'push-option': 'value',
    'receive-pack': 'value',
    exec: 'value',
    signed: 'attached',
    'recurse-submodules': 'attached',
    force: 'flag',
    'force-with-lease': 'flag',
    'force-if-includes': 'flag',
    tags: 'flag',
    'follow-tags': 'flag',
    delete: 'flag',
    prune: 'flag',
    all: 'flag',
    branches: 'flag',
    mirror: 'flag',
    'set-upstream': 'flag',
    verbose: 'flag',
    quiet: 'flag',
    progress: 'flag',
    'no-progress': 'flag',
    verify: 'flag',
    'no-verify': 'flag',
    'dry-run': 'flag',
    porcelain: 'flag',
    atomic: 'flag',
    'no-atomic': 'flag',
    // Accepted but not read: a tag flag anywhere counts as a tag push, which
    // errs toward asking (git keeps --tags and --follow-tags apart).
    'no-tags': 'flag',
    'no-follow-tags': 'flag',
    thin: 'flag',
    'no-thin': 'flag',
    ipv4: 'flag',
    ipv6: 'flag',
    'no-force-with-lease': 'flag',
    'no-force-if-includes': 'flag',
    'no-recurse-submodules': 'flag',
    'no-signed': 'flag',
  },
  short: {
    o: 'value',
    f: 'flag',
    d: 'flag',
    u: 'flag',
    v: 'flag',
    q: 'flag',
    n: 'flag',
    '4': 'flag',
    '6': 'flag',
  },
  otherShort: 'refuse',
  needsValue: true,
});

// What a refspec says about the push, read from the text as written so
// `"+$B"` still shows its `+`. `next` is the refspec after it, if any.
function refspecOf(
  r: string,
  next: boolean,
): Pick<PushSpec, 'deletes' | 'tags'> & { bare: boolean } {
  return {
    bare: r.startsWith('+'),
    deletes: r.startsWith(':'),
    // `git push origin tag v1` pushes refs/tags/v1.
    tags: /(^|:)refs\/tags\//.test(r.replace(/^\+/, '')) || (r === 'tag' && next),
  };
}

export function pushSpec(args: Word[]): PushSpec | Refusal {
  const spec: PushSpec = {
    force: 'none',
    tags: false,
    deletes: false,
    every: false,
    remote: 'default',
    refspecs: [],
    argv: null,
    after: null,
  };
  const bare = () => (spec.force = 'bare');
  const lease = () => (spec.force = spec.force === 'bare' ? 'bare' : 'lease');
  let repo: Word | null = null;
  const read = readOptions(args, PUSH, (o) => {
    if (!o.long) {
      if (o.name === 'f') bare();
      else if (o.name === 'd') spec.deletes = true;
    } else if (o.name === 'force') bare();
    else if (o.name === 'force-with-lease' || o.name === 'force-if-includes') lease();
    else if (o.name === 'tags' || o.name === 'follow-tags') spec.tags = true;
    else if (o.name === 'delete' || o.name === 'prune') spec.deletes = true;
    else if (o.name === 'all' || o.name === 'branches') spec.every = true;
    else if (o.name === 'mirror') {
      // git help push: refs are "force updated" and missing ones "removed".
      bare();
      spec.deletes = true;
      spec.every = true;
    } else if (o.name === 'repo') repo = o.value;
  });
  if ('refuse' in read) return read;
  if (!args.some((w) => w.dynamic)) {
    spec.argv = { config: [], args: args.map((w) => w.text), end: read.end };
  }
  // `--repo` stands in for the remote argument, which wins when both are given.
  const [remote = repo ?? undefined, ...refspecs] = read.positionals;
  if (remote !== undefined) spec.remote = remote.dynamic ? 'dynamic' : { name: remote.text };
  spec.refspecs = refspecs.some((w) => w.dynamic) ? null : refspecs.map((w) => w.text);
  for (const [k, { text }] of refspecs.entries()) {
    const r = refspecOf(text, k < refspecs.length - 1);
    if (r.bare) bare();
    if (r.deletes) spec.deletes = true;
    if (r.tags) spec.tags = true;
  }
  return spec;
}

const interactive = (flag: string): Refusal => ({
  refuse: `git commit ${flag}, which stages interactively`,
});
const stageFirst = (flag: string): Refusal => ({
  refuse: `git commit ${flag}. Stage with \`git add\`, then run \`git commit\` alone`,
});

const COMMIT = table({
  sub: 'commit',
  long: {
    patch: interactive('--patch'),
    interactive: interactive('--interactive'),
    include: stageFirst('--include'),
    only: stageFirst('--only'),
    'pathspec-from-file': {
      refuse: 'git commit --pathspec-from-file. Stage with `git add`, then commit',
    },
    message: 'value',
    file: 'value',
    'reuse-message': 'value',
    'reedit-message': 'value',
    template: 'value',
    author: 'value',
    date: 'value',
    cleanup: 'value',
    fixup: 'value',
    squash: 'value',
    trailer: 'value',
    all: 'flag',
    amend: 'flag',
    'dry-run': 'flag',
    'no-edit': 'flag',
    edit: 'flag',
    'no-verify': 'flag',
    verify: 'flag',
    signoff: 'flag',
    'no-signoff': 'flag',
    'no-gpg-sign': 'flag',
    'allow-empty': 'flag',
    'allow-empty-message': 'flag',
    quiet: 'flag',
    verbose: 'flag',
    status: 'flag',
    'no-status': 'flag',
    'reset-author': 'flag',
    short: 'flag',
    branch: 'flag',
    porcelain: 'flag',
    long: 'flag',
    null: 'flag',
    'no-post-rewrite': 'flag',
    'gpg-sign': 'flag',
    'untracked-files': 'flag',
  },
  short: {
    p: interactive('-p'),
    i: stageFirst('-i'),
    o: stageFirst('-o'),
    m: 'value',
    F: 'value',
    C: 'value',
    c: 'value',
    t: 'value',
    S: 'attached',
    u: 'attached',
    a: 'flag',
  },
  otherShort: 'accept',
  needsValue: false,
});

const PATHSPECS: Refusal = {
  refuse: 'git commit with pathspecs. Stage them with `git add`, then run `git commit` alone',
};

export function commitSpec(args: Word[]): CommitSpec | Refusal {
  const spec: CommitSpec = { all: false, amend: false, dryRun: false, config: [] };
  const read = readOptions(
    args,
    COMMIT,
    (o) => {
      if (o.long ? o.name === 'all' : o.name === 'a') spec.all = true;
      else if (o.long && o.name === 'amend') spec.amend = true;
      else if (o.long && o.name === 'dry-run') spec.dryRun = true;
    },
    (w, afterOptions) =>
      w.dynamic && !afterOptions
        ? {
            refuse:
              'git commit with a pathspec built from a variable or substitution. Stage with `git add`, then commit',
          }
        : PATHSPECS,
  );
  return 'refuse' in read ? read : spec;
}

export function addArgv(config: string[], args: Word[]): string[] | Refusal {
  for (const w of args) {
    if (w.dynamic)
      return { refuse: 'git add with an argument built from a variable or substitution' };
    if (w.text.includes('{') && w.pattern)
      return { refuse: 'git add with a brace expansion; list the paths' };
    if (
      /^(-p|-i|-e|--patch|--interactive|--edit)$/.test(w.text) ||
      /^-[a-zA-Z]*[pie][a-zA-Z]*$/.test(w.text)
    ) {
      return { refuse: `git add ${w.text}, which stages interactively` };
    }
    if (w.text.startsWith('--pathspec-from-file'))
      return { refuse: 'git add --pathspec-from-file' };
  }
  return [...config, 'add', ...args.map((w) => w.text)];
}
