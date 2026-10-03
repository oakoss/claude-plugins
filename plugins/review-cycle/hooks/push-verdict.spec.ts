import { describe, expect, test } from 'vitest';

import { classify } from './command';
import { NO_GRANT, type PushLevel } from './consent';
import type { PushSpec } from './git-args';
import { askingReason, neededFor, parseDryRun, unasked, type DefaultBranch } from './push-verdict';

function specOf(command: string): PushSpec {
  const c = classify(command);
  if (c.kind !== 'gated' || c.push === null) throw new Error(`not a push: ${command}`);
  return c.push;
}

const grant = (push: PushLevel) => ({ ...NO_GRANT, push });

describe('the request a push needs', () => {
  test.each([
    ['git push', 'push'],
    ['git push --force-with-lease', 'lease'],
    ['git push --force', 'bare'],
    ['git push origin +main', 'bare'],
  ])('%s needs %s', (command, needed) => {
    expect(neededFor(specOf(command))).toBe(needed);
  });
});

describe('what a grant covers', () => {
  const cases: [string, PushLevel, string | null][] = [
    ['git push', 'none', 'push'],
    ['git push', 'push', null],
    ['git push --force-with-lease', 'push', 'lease'],
    ['git push --force-with-lease', 'lease', null],
    ['git push --force', 'lease', 'bare'],
    ['git push --force', 'bare', null],
    ['git push', 'bare', null],
  ];
  test.each(cases)('%s under %s', (command, level, missing) => {
    expect(unasked(specOf(command), grant(level))).toBe(missing);
  });
});

// Output copied from git 2.56 `git push --dry-run --porcelain` runs.
const URL = '/tmp/remote.git';
const dry = (...lines: string[]) => [`To ${URL}`, ...lines, 'Done'].join('\n');
const MAIN = new Map<string, DefaultBranch>([[URL, { branch: 'main' }]]);

describe("what git's dry run says a push updates", () => {
  test('reads each ref, its flag and its remote', () => {
    expect(
      parseDryRun(
        dry(
          '*\tHEAD:refs/heads/fix/x\t[new branch]',
          '*\trefs/tags/v1:refs/tags/v1\t[new tag]',
          "Would set upstream of 'fix/x' to 'fix/x' of 'origin'",
        ),
      ),
    ).toEqual([
      { flag: '*', to: 'refs/heads/fix/x', url: URL },
      { flag: '*', to: 'refs/tags/v1', url: URL },
    ]);
  });
  const cases: [string, string, string | null][] = [
    ['a new feature branch', '*\tHEAD:refs/heads/fix/x\t[new branch]', null],
    ['an up-to-date feature branch', '=\tHEAD:refs/heads/fix/x\t[up to date]', null],
    // A commit in the same command lands after the dry run, before the push.
    [
      'an up-to-date default branch',
      '=\trefs/heads/main:refs/heads/main\t[up to date]',
      'it pushes to `main`, the default branch',
    ],
    [
      'the default branch',
      ' \trefs/heads/fix/x:refs/heads/main\tb65222b..9f4a349',
      'it pushes to `main`, the default branch',
    ],
    ['a tag', '*\trefs/tags/v1:refs/tags/v1\t[new tag]', 'it pushes the tag `v1`'],
    ['a delete', '-\t:refs/heads/old\t[deleted]', 'it deletes `old`'],
    [
      'a forced update',
      '+\trefs/heads/x:refs/heads/x\t1..2 (forced update)',
      'it force-updates `x`',
    ],
  ];
  test.each(cases)('%s', (_name, line, reason) => {
    expect(askingReason(parseDryRun(dry(line)), MAIN)).toBe(reason);
  });
  test('a remote whose default branch could not be read asks, saying why', () => {
    const refs = parseDryRun(dry('*\tHEAD:refs/heads/fix/x\t[new branch]'));
    const unreadable = new Map<string, DefaultBranch>([[URL, { unreadable: 'fatal: no' }]]);
    expect(askingReason(refs, unreadable)).toBe(
      `the default branch of ${URL} could not be read (fatal: no)`,
    );
  });
  // Measured: `git push -q --dry-run --porcelain` printed only `Done`.
  test('a dry run that names no ref asks', () => {
    expect(askingReason(parseDryRun('Done\n'), MAIN)).toBe(
      'its dry run named no ref it would update',
    );
  });
});
