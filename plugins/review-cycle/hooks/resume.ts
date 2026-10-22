// What a compaction drops from the review skill. Claude Code re-attaches an
// invoked skill after a compaction cut to its first REATTACHED characters,
// counted on the text the skill expanded to, a 100-character note included
// (measured on 2.1.296 and 2.1.308). The review skill is about three times
// that, so a review compacted mid-cycle loses every phase from Phase 3 on.
// Pure.

export const REATTACHED = 20_000;
export const KEPT = REATTACHED - 100;

// The text from the heading of the section the cut falls in, or null when the
// copy holds it whole.
export function restOf(text: string, kept = KEPT): string | null {
  if (text.length <= kept) return null;
  let from = 0;
  for (const m of text.matchAll(/^#{2,3} /gm)) {
    if (m.index > kept) break;
    from = m.index;
  }
  return text.slice(from);
}

// How the handed-back text opens, so a compaction can find a copy already there.
export const RESUMED =
  'review-cycle: the copy of the review skill re-attached after this compaction stops partway';

export function resumeText(text: string): string | null {
  const rest = restOf(text);
  if (rest === null) return null;
  return [
    `${RESUMED}. If that review is still under way, its later phases follow, from the section where that copy is cut; follow them as the skill. If it has finished, ignore them.`,
    '',
    rest,
  ].join('\n');
}
