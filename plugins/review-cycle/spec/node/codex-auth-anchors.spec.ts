// Prose anchors for the Codex auth vocabulary, which spans four files with
// nothing else linking them: both review skills, the init skill, and the
// plugin README.
//
// The incident: `codex login status` exits 0 and prints `Logged in using
// ChatGPT` whether the stored credential works, has been revoked server-side,
// or is an `auth.json` containing only `{}`. Its verdict is a pure function of
// whether that file exists and parses. The cycle recorded that as auth
// `confirmed`, spawned the Codex leg on it, and the leg died on a 401.
//
// These check that four named files use one label for the probe's exit-0
// outcome, that none reports it as confirmed auth by any wording seen so far,
// and that neither review skill has reverted to forbidding the read of the
// leg's output. They match phrases: a rewrite keeping every anchored phrase
// while changing what the surrounding rule means passes, and no substring
// match closes that.
//
// Both banned-wording checks anchor the invariant as well as the stale
// literal, because banning only the old wording (`✓ authed`, and the refuted
// `crashed run and a clean run look alike`) lets the same defect return in the
// new vocabulary.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { expectAnchors, REPO_ROOT } from './agents';

const REVIEW = 'plugins/review-cycle/skills/review/SKILL.md';
const REVIEW_PR = 'plugins/review-cycle/skills/review-pr/SKILL.md';
const INIT = 'plugins/review-cycle/skills/init/SKILL.md';
const README = 'plugins/review-cycle/README.md';

// Distinct surfaces, counted after dedup: a duplicated entry would otherwise
// hold the count while a surface silently left every loop below.
const SURFACE_COUNT = 4;

const AUTH_SURFACES = [REVIEW, REVIEW_PR, INIT, README];

// A regular file, not merely readable: a directory would otherwise read as
// empty, which the banned-wording checks would read as clean.
function read(rel: string): string {
  const file = path.join(REPO_ROOT, rel);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile())
    throw new Error(`${rel} — missing or not a regular file`);
  return readFileSync(file, 'utf8');
}

// Soft, so every banned phrase present is reported on its own.
function expectAbsent(text: string, rel: string, banned: readonly (readonly [string, string])[]) {
  for (const [needle, reason] of banned) {
    expect.soft(text.includes(needle), `${rel} — ${reason}`).toBe(false);
  }
}

test('the surface list has not collapsed', () => {
  const n = new Set(AUTH_SURFACES).size;
  expect(
    n,
    `AUTH_SURFACES lists ${n} distinct files, expected ${SURFACE_COUNT} — a surface that leaves takes its coverage with it`,
  ).toBe(SURFACE_COUNT);
});

test("no surface reports the probe's exit 0 as confirmed auth", () => {
  for (const rel of AUTH_SURFACES) {
    expectAbsent(read(rel), rel, [
      ['auth `confirmed`', 'reports auth confirmed'],
      ['auth: confirmed', 'summary enum offers confirmed'],
      ['✓ authed', 'checkmark for an unexercised credential'],
    ]);
  }
  // The invariant, not only the old wording: the checkmark can return in the
  // new vocabulary without reusing the banned literal.
  expectAnchors(read(INIT), INIT, [
    ['use the `-` glyph, not `✓`', 'no rule keeping the exit-0 line off the checkmark'],
  ]);
});

test('all four surfaces name the exit-0 outcome the same way', () => {
  for (const rel of AUTH_SURFACES) {
    expectAnchors(read(rel), rel, [
      ['stored session (not exercised)', 'does not use the shared label'],
    ]);
  }
});

test("neither review skill forbids reading the leg's own output", () => {
  expectAnchors(read(REVIEW), REVIEW, [
    [
      'Open the output file before composing the failure message',
      "no imperative to open the leg's output",
    ],
  ]);
  expectAnchors(read(REVIEW_PR), REVIEW_PR, [
    ['Open that file before filling', "no imperative to open the leg's output"],
  ]);
  for (const rel of [REVIEW, REVIEW_PR]) {
    const text = read(rel);
    // The justification was measured false: the file records
    // `[exited with code N]` on a clean and a crashed run alike. Matched
    // loosely so a paraphrase cannot slip it back in.
    expect
      .soft(
        text.split('\n').some((line) => /crashed.*clean run|look alike/i.test(line)),
        `${rel} — the refuted 'look alike' justification is back`,
      )
      .toBe(false);
    expectAbsent(text, rel, [
      ['not from the output file', 'the prohibition is back alongside the instruction'],
    ]);
  }
});
