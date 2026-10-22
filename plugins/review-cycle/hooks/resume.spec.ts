import { describe, expect, test } from 'vitest';

import { REATTACHED, restOf, RESUMED, resumeText } from './resume';

describe('restOf', () => {
  const body = '# T\n\nintro\n\n### A\n\naaaa\n\n### B\n\nbbbb\n';
  test('is null when the copy holds the whole text', () => {
    expect(restOf(body, body.length)).toBeNull();
  });
  test('starts at the heading of the section the cut falls in', () => {
    expect(restOf(body, body.indexOf('bbbb'))).toBe('### B\n\nbbbb\n');
    expect(restOf(body, body.indexOf('aaaa'))).toBe(body.slice(body.indexOf('### A')));
  });
  test('a cut on a heading starts there', () => {
    expect(restOf(body, body.indexOf('### B'))).toBe('### B\n\nbbbb\n');
  });
  test('reads a heading only at the start of a line', () => {
    const inline = '# T\n\nsee ### A here\n\nxxxx\n';
    expect(restOf(inline, inline.indexOf('xxxx'))).toBe(inline);
  });
});

// A heading `at` characters in, inside text long enough to be cut.
const withHeadingAt = (at: number) => `${'a'.repeat(at)}\n### Late\n\n${'b'.repeat(5000)}`;
const startOf = (text: string | null) =>
  text?.slice(text.indexOf('\n\n') + 2, text.indexOf('\n\n') + 12);

describe('resumeText', () => {
  // The note takes the last 100 characters of the limit, so the copy holds 19,900.
  test('a heading the cut copy still holds is where the rest starts', () => {
    expect(startOf(resumeText(withHeadingAt(REATTACHED - 120)))).toBe('### Late\n\n');
  });
  test('a heading inside the truncation note is past the cut', () => {
    expect(startOf(resumeText(`# T\n\n${withHeadingAt(REATTACHED - 90)}`))).toBe('# T\n\naaaaa');
  });
  test('opens with the line a later compaction looks for', () => {
    expect(resumeText(withHeadingAt(REATTACHED))?.startsWith(RESUMED)).toBe(true);
  });
  test('a skill the copy holds whole hands back nothing', () => {
    expect(resumeText('# X\n\nshort\n')).toBeNull();
  });
});
