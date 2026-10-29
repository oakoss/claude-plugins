import { describe, expect, test } from 'vitest';

import { readCommand } from './command';
import { NO_GRANT, type PushLevel } from './consent';
import type { PushSpec } from './git-args';
import {
  askingReason,
  neededFor,
  parseDryRun,
  namesTag,
  pushOutcome,
  unasked,
  unnamedTarget,
  type DefaultBranch,
} from './push-verdict';

function specOf(command: string): PushSpec {
  const c = readCommand(command).classification;
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
      { flag: '*', from: 'HEAD', to: 'refs/heads/fix/x', url: URL },
      { flag: '*', from: 'refs/tags/v1', to: 'refs/tags/v1', url: URL },
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

// A push's own reason to ask, recording each time it is checked.
function asked(reason: string | null) {
  const calls: number[] = [];
  const check = () => {
    calls.push(1);
    return Promise.resolve(reason);
  };
  return { calls, check };
}

const refTo = (to: string) => [{ flag: ' ', to, url: URL }];

const MAIN_WHY = 'it pushes to `main`, the default branch, which the request did not name';
const TAG_WHY = 'it pushes the tag `v1.2.0`, which the request did not name';

describe('what a push the user asked for must name', () => {
  test.each([
    ['refs/heads/main', [], MAIN_WHY],
    ['refs/heads/main', ['main'], null],
    ['refs/heads/fix/x', [], null],
    ['refs/tags/v1.2.0', [], TAG_WHY],
    ['refs/tags/v1.2.0', ['tag:*'], null],
    ['refs/tags/v1.2.0', ['tag:1.2.0'], null],
    ['refs/tags/v1.2.0', ['tag:v1'], TAG_WHY],
  ] as const)('%s named by %j', (to, named, why) => {
    expect(unnamedTarget(refTo(to), MAIN, named, null)?.why ?? null).toBe(why);
  });
  test('the offer it suggests is one whose yes names the target', () => {
    expect(unnamedTarget(refTo('refs/heads/main'), MAIN, [], null)?.offer).toBe(
      '"Push to `main`?"',
    );
    expect(unnamedTarget(refTo('refs/tags/v1.2.0'), MAIN, [], null)?.offer).toBe(
      '"Push the `v1.2.0` tag?"',
    );
  });
  test('a default branch it cannot read is taken to be main or master', () => {
    expect(unnamedTarget(refTo('refs/heads/main'), new Map(), [], null)?.why).toBe(MAIN_WHY);
    expect(unnamedTarget(refTo('refs/heads/develop'), new Map(), [], null)).toBeNull();
  });
  test('an up-to-date ref counts only when a commit in the command moves it', () => {
    const upToDate = (from: string) => [{ flag: '=', from, to: 'refs/heads/main', url: URL }];
    expect(unnamedTarget(upToDate('refs/heads/main'), MAIN, [], null)).toBeNull();
    expect(unnamedTarget(upToDate('refs/heads/main'), MAIN, [], 'refs/heads/main')?.why).toBe(
      MAIN_WHY,
    );
    expect(unnamedTarget(upToDate('HEAD'), MAIN, [], 'refs/heads/main')?.why).toBe(MAIN_WHY);
    expect(unnamedTarget(upToDate('refs/heads/main'), MAIN, [], 'refs/heads/feat')).toBeNull();
    expect(unnamedTarget(upToDate('HEAD~0'), MAIN, [], 'refs/heads/main')?.why).toBe(MAIN_WHY);
    expect(unnamedTarget(upToDate('refs/heads/main'), MAIN, [], '*')?.why).toBe(MAIN_WHY);
    const rejected = [{ flag: '!', to: 'refs/heads/main', url: URL }];
    expect(unnamedTarget(rejected, MAIN, [], 'refs/heads/main')).toBeNull();
  });
  test('deleting the default branch is never covered, even when named', () => {
    const del = [{ flag: '-', from: '', to: 'refs/heads/main', url: URL }];
    expect(unnamedTarget(del, MAIN, ['main'], null)).toEqual({
      why: 'it deletes `main`, the default branch',
      offer: null,
    });
  });
  test('a tag is named by its name, with or without a v, or by any-tag', () => {
    expect(namesTag(['tag:*'], 'v2')).toBe(true);
    expect(namesTag(['tag:v2'], '2')).toBe(true);
    expect(namesTag(['tag:review-cycle@0.27.0'], 'review-cycle@0.27.0')).toBe(true);
    expect(namesTag(['tag:0.2.0'], 'v0.3.0')).toBe(false);
  });
});

describe('what a push not covered may do', () => {
  test('a covered push runs and checks nothing', async () => {
    const a = asked('x');
    expect(await pushOutcome(null, false, a.check)).toEqual({ kind: 'covered' });
    expect(a.calls).toEqual([]);
  });
  test('a plain push something lets through runs unasked unless it always asks', async () => {
    expect(await pushOutcome('push', true, asked(null).check)).toEqual({ kind: 'unasked' });
    expect(await pushOutcome('push', true, asked('it pushes a tag').check)).toEqual({
      kind: 'refused',
      missing: 'push',
      always: 'it pushes a tag',
    });
  });
  test('nothing lets it through, or it forces: refused, with nothing checked', async () => {
    for (const [missing, lets] of [
      ['push', false],
      ['lease', true],
      ['bare', true],
    ] as const) {
      const a = asked('x');
      expect(await pushOutcome(missing, lets, a.check)).toEqual({
        kind: 'refused',
        missing,
        always: null,
      });
      expect(a.calls).toEqual([]);
    }
  });
});
