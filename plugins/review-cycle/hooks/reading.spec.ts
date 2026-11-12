import { describe, expect, test } from 'vitest';

import { combine, NO_GRANT, NOTHING_POINTED, pointedBy } from './consent';
import corpus from './consent.corpus.json' with { type: 'json' };
import { dropsGrant, endsReady, grantOf, holdOf, unreadOffer } from './exact';
import { consentJoined, consentOf, ownWords, readMessage, type Consent } from './reading';

const OFFERS = [
  '',
  'Want me to push the branch and open a pull request?',
  'Should I merge #3 and #4? CI is green on both.',
  'Merge the version PR to release?',
];

const cases: [string, string][] = (corpus as { prompt: string; offer?: string }[]).flatMap((c) =>
  [...OFFERS, ...(c.offer === undefined ? [] : [c.offer])].map((o): [string, string] => [
    c.prompt,
    o,
  ]),
);

describe('readMessage', () => {
  test('reads each field as the reader does, over the labeled corpus', () => {
    for (const [text, before] of cases) {
      const grant = grantOf(text, before);
      expect(readMessage(text, before), `${text} ‹after› ${before}`).toEqual({
        text,
        grant,
        hold: holdOf(text, before),
        unread: unreadOffer(text, before),
        pointed: pointedBy(text, before, grant),
        drops: dropsGrant(text, before),
        ends: endsReady(text, before),
      });
    }
  });
});

const pasted = (id: string, body: string) =>
  `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;

describe('ownWords', () => {
  test('drops each pasted block, keeping the words around it', () => {
    const text = `I called it out and it still blocked me.\n\n${pasted('c986', '❯ Push to main')}\nthoughts?`;
    expect(ownWords(text)).toBe('I called it out and it still blocked me.\n\n\nthoughts?');
  });
  test('a block closes only on its own id', () => {
    const text = pasted('0a1b', `x\n</pasted_content id="2c3d">\npush it`);
    expect(ownWords(text)).toBe('');
  });
  test.each(['example', 'wxyz', '0a1b2', '0A1B'])(
    'a block whose id %j is not four lowercase hex digits, as Claude Code writes them, is words',
    (id) => {
      const typed = pasted(id, 'push it');
      expect(ownWords(typed)).toBe(typed);
    },
  );
  test('tags typed inside a line are words, and none leaves a break to split them', () => {
    const inline = `don't <pasted_content id="0a1b">\nx\n</pasted_content id="0a1b"> push it`;
    expect(ownWords(inline)).toBe(inline);
    const openMidLine = `don't <pasted_content id="0a1b">\nx\n</pasted_content id="0a1b">`;
    expect(ownWords(openMidLine)).toBe(openMidLine);
    const closeMidLine = `<pasted_content id="0a1b">\nx\n</pasted_content id="0a1b"> push it`;
    expect(ownWords(closeMidLine)).toBe(closeMidLine);
    const quoted =
      'Is `<pasted_content id="0e1f">` right?\nDo not push yet.\nAnd `</pasted_content id="0e1f">`?';
    expect(ownWords(quoted)).toBe(quoted);
    expect(readMessage(ownWords(quoted), '').hold).not.toBeNull();
  });
  test("an unclosed tag is the user's words", () => {
    const text = '<pasted_content id="0a1b">\npush it';
    expect(ownWords(text)).toBe(text);
  });
  test('a pasted request grants nothing, and one typed beside a paste still does', () => {
    const paste = pasted('c986', '❯ You can push it to main\n❯ Push to main');
    expect(readMessage(ownWords(`Why was this refused?\n\n${paste}`), '').grant.push).toBe('none');
    expect(readMessage(ownWords(`push it\n\n${paste}`), '').grant.push).toBe('push');
  });
});

describe('a queued message', () => {
  const offer = 'Should I merge #3 and #4? CI is green on both.';
  const first = consentOf(readMessage('merge #3', offer));

  test('joins the turn it was typed into', () => {
    const next = readMessage('and push it', offer);
    expect(next.drops).toBe(false);
    expect(consentJoined(first, next)).toEqual({
      grant: combine(first.grant, next.grant),
      unread: first.unread,
      said: null,
      pointed: { ...first.pointed, named: ['3'] },
    });
  });

  test('a hold or retraction replaces the consent, and clears even its own unread reason', () => {
    const withReason: Consent = { ...first, unread: { why: 'unread', steps: ['merge'] } };
    const held = readMessage('actually, hold off', offer);
    expect(held.drops).toBe(true);
    const next = { ...held, unread: { why: 'its own', steps: [] } };
    expect(consentJoined(withReason, next)).toEqual({
      grant: next.grant,
      unread: null,
      said: 'actually, hold off',
      pointed: next.pointed,
    });
  });

  test('keeps the first unread reason over a later one', () => {
    const empty: Consent = { grant: NO_GRANT, unread: null, said: 'x', pointed: NOTHING_POINTED };
    const reason = { why: 'unread', steps: ['push' as const] };
    const later = { ...readMessage('ok', ''), drops: false, unread: { why: 'later', steps: [] } };
    expect(consentJoined({ ...empty, unread: reason }, later).unread).toBe(reason);
    expect(consentJoined(empty, later).unread).toBe(later.unread);
  });
});

describe('a fresh message', () => {
  test('starts the consent from itself alone', () => {
    const r = readMessage('push it', '');
    expect(consentOf(r)).toEqual({
      grant: r.grant,
      unread: r.unread,
      said: 'push it',
      pointed: r.pointed,
    });
  });
});
