// Pure. Narration that dodges the line patterns cannot dodge arithmetic, so
// the text the tool wrote is also checked for comment density. Borderline
// cases are left to the cleanup agent.

export type Written = {
  path: string;
  // The file's text after the tool ran.
  file: string;
  // What the tool wrote: a Write's content or an Edit's new_string.
  text: string;
  // An Edit's old_string; null for a Write, whose text is the whole file and
  // may open with a header. An Edit that creates a file is judged as an edit.
  replaced: string | null;
};

const BINARY = /\.(lock|lockb|png|jpe?g|gif|webp|pdf|zip|tar|gz|bin|exe|so|dylib|dll|wasm)$/i;
const GENERATED = /\/(node_modules|\.git|dist|build|target|\.next|\.venv)\//;
// '#' is a heading in prose, and prose cleanup is the de-slopify skill's job.
const PROSE = /\.(md|markdown|txt|rst|adoc)$/i;
// '#' documents these formats; a comment-heavy config is not slop.
const CONFIG = /\.(ya?ml|toml|ini|cfg|conf)$/i;
// Larger files are not scanned: they are generated or data, and slow to read.
export const MAX_BYTES = 1_048_576;

// The star, '#' and '--' forms need whitespace or the line's end after them,
// so C dereferences (*p = 1;), #include, #[attributes], shebangs and --i do
// not count as comments.
const COMMENT = /^\s*(\/\/|#(\s|$)|--(\s|\[|$)|\/\*|\*(\s|\/|$))/;

const PATTERNS: readonly { label: string; line: RegExp; unless?: RegExp }[] = [
  {
    label: 'Section-marker comments (per policy: avoid)',
    line: /^\s*(\/\/|#|--|\/\*)\s*={3,}/,
  },
  {
    label: 'Likely restate-the-code comments',
    line: /^\s*(\/\/|#|--)\s+(initializes|fetches|creates|validates|downloads|sets|gets|returns|handles|processes|increments|decrements|iterates over)\s+/,
  },
  {
    label: 'AI-flavored comment phrasings',
    line: /^\s*(\/\/|#|--)\s+(Here we|Let's|Let us|We can|This (function|method|class|component|module)( does| handles| simply| basically))/,
  },
  {
    label: 'Hedge-prefix comments (consider rewording or removing)',
    line: /^\s*(\/\/|#|--)\s+(Note|Important|NB|FYI):/,
  },
  {
    label: 'TODO/FIXME without ticket reference',
    line: /^\s*(\/\/|#|--)\s+(TODO|FIXME|HACK|XXX)(\s*:|\s+[^#A-Z0-9h])/,
    unless: /#[0-9]+|[A-Z]{2,}-[0-9]+|https?:\/\//,
  },
  {
    label: "Hedge words in comments (per policy: avoid 'obviously', 'basically', 'just')",
    line: /^\s*(\/\/|#|--)\s.*(obviously|basically|essentially|simply|just |actually )/,
  },
  {
    label:
      'History-flavored comments (describe the current invariant; the before/after story belongs in the commit message)',
    line: /^\s*(\/\/|#|--)\s.*(previously|formerly|used to be |no longer |renamed from |as it did (while|when|before)|after (the|this) (refactor|review|migration|change))/i,
  },
];

export function skipsPath(path: string): boolean {
  return BINARY.test(path) || GENERATED.test(path) || PROSE.test(path);
}

function lines(text: string): string[] {
  return text.replace(/\n+$/, '').split('\n');
}

// A Write is the whole file, whose header comment is legitimate: drop the
// shebang and the leading run of comment and blank lines before counting.
function withoutHeader(text: string): string[] {
  const all = lines(text);
  const body = all.findIndex(
    (l, i) => !(i === 0 && /^\s*#!/.test(l)) && !COMMENT.test(l) && /\S/.test(l),
  );
  return body === -1 ? [] : all.slice(body);
}

function density(w: Written): string | null {
  const written = w.replaced === null ? withoutHeader(w.text) : lines(w.text);
  if (written.join('\n') === '') return null;
  const total = written.filter((l) => l.length > 0).length;
  const comments = written.filter((l) => COMMENT.test(l)).length;
  const nonblank = written.filter((l) => /\S/.test(l)).length;
  // Rewriting a comment block as a comment block is comment-editing, often
  // fixing this check's own finding; both sides must be all comment, so a
  // one-line comment anchor cannot wave a narrated block through.
  const old = w.replaced === null ? [] : lines(w.replaced).filter((l) => /\S/.test(l));
  const oldComments = old.filter((l) => COMMENT.test(l)).length;
  if (old.length > 0 && oldComments >= old.length && nonblank > 0 && comments >= nonblank) {
    return null;
  }
  if (comments < 4 || total === 0 || Math.floor((comments * 100) / total) < 30) return null;
  return `${comments} of ${total} written lines are comments. Per the comment policy most WHAT-comments must be removed; keep only those stating a non-obvious WHY.`;
}

// Each finding as its label and up to three `line:text` matches.
export function slopFindings(w: Written): string[] {
  if (skipsPath(w.path)) return [];
  const findings: string[] = [];
  if (!CONFIG.test(w.path)) {
    const dense = density(w);
    if (dense) findings.push(`High comment density in this edit:\n${dense}`);
  }
  const file = lines(w.file);
  for (const p of PATTERNS) {
    const hits = file
      .map((l, i) => `${i + 1}:${l}`)
      .filter((_, i) => p.line.test(file[i] ?? '') && !p.unless?.test(file[i] ?? ''))
      .slice(0, 3);
    if (hits.length > 0) findings.push(`${p.label}:\n${hits.join('\n')}`);
  }
  return findings;
}

export function slopDirective(path: string, findings: string[]): string {
  return `review-cycle: comment slop detected in ${path}. Fix it NOW with a follow-up Edit, before continuing with the task — the comment policy is mandatory, not advisory. Remove every comment that restates WHAT the code does; keep a comment only when it states a non-obvious WHY the code cannot express, and compress kept comments to one or two lines — consequences the reader can derive, backstory, and before/after history go in the commit message, not the code. Do not wait to be asked.\n\n${findings.join('\n\n')}`;
}
