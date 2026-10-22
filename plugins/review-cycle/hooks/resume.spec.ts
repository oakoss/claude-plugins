import { describe, expect, test } from 'vitest';

import { isReviewSkill, REATTACHED, restOf, RESUMED, resumed, resumeText } from './resume';

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

const made = (text: string) => ({ text });

describe('resumed', () => {
  const skill = withHeadingAt(REATTACHED);
  const summary = { text: 'summary' };

  test('appends the rest of the review in flight', () => {
    expect(resumed([summary], skill, made)).toEqual([summary, { text: resumeText(skill) }]);
  });
  test('replaces a carried copy instead of adding a second', () => {
    const carried = { text: `${RESUMED}. an older copy` };
    expect(resumed([summary, carried], skill, made)).toEqual([
      summary,
      { text: resumeText(skill) },
    ]);
  });
  test('drops a carried copy when no review is in flight', () => {
    expect(resumed([summary, { text: `${RESUMED}. stale` }], null, made)).toEqual([summary]);
  });
  test('adds nothing for a skill the copy holds whole', () => {
    expect(resumed([summary], '# X\n\nshort\n', made)).toEqual([summary]);
    expect(resumed([summary, { text: `${RESUMED}. stale` }], '# X\n\nshort\n', made)).toEqual([
      summary,
    ]);
  });
});

test.each([
  ['review-cycle:review', true],
  ['/review-cycle:review', true],
  [' review-cycle:review ', true],
  ['review', true],
  ['review-cycle:review-pr', false],
  ['other:thing', false],
  [undefined, false],
])('isReviewSkill(%j) is %j', (name, is) => {
  expect(isReviewSkill(name)).toBe(is);
});
