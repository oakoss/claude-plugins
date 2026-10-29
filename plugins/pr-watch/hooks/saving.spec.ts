import { describe, expect, test } from 'vitest';

import type { Watch } from '../types';
import { flow, job, pull, watched } from './fixtures';
import {
  endOf,
  givenUpOf,
  judgedOf,
  savedAfter,
  type Judged,
  type ReadEnd,
  type Saving,
} from './saving';
import { GIVE_UP_AFTER, tellsOf, type Verdict } from './watch';

const NOW = Date.parse('2026-10-03T22:01:10Z');
const green = () => flow(1, 'CI', [job('CI Summary', 'SUCCESS', true)]);
const lint = flow(2, 'Lint', [job('eslint', 'FAILURE')]);
const config = { isAwake: true, tells: tellsOf('checks and comments', 'never') };

const target = watched(pull([green()]), { checkedAt: NOW - 10_000, told: ['old'] });
const sibling = (over: Partial<Watch> = {}) =>
  watched(pull([green()], { number: 7 }), {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    ...over,
  });
const elsewhere = watched(pull([green()]), { host: 'ghe.example.com', offline: 2 });

const nextOf = (end: ReadEnd) => ('next' in end ? end.next : null);

describe('endOf', () => {
  test('a read that answered clears every failure and records the read', () => {
    const failing = { ...target, error: 'gh failed: x', failures: 3, refused: true, offline: 2 };
    const fresh = pull([green()], { title: 'new' });
    expect(endOf(failing, { kind: 'pull', pull: fresh, limitedUntil: 5 }, NOW)).toEqual({
      kind: 'read',
      next: {
        ...failing,
        pull: fresh,
        error: undefined,
        failures: undefined,
        refused: undefined,
        offline: undefined,
        limitedUntil: 5,
        checkedAt: NOW,
      },
    });
  });

  test('gone and a handoff pass through', () => {
    expect(endOf(target, { kind: 'gone' }, NOW)).toEqual({ kind: 'gone' });
    expect(endOf(target, { kind: 'handoff', to: sibling() }, NOW)).toEqual({
      kind: 'handoff',
      to: sibling(),
    });
  });

  test('a limit or an outage keeps the last good read and never gives up', () => {
    const worn = { ...target, failures: GIVE_UP_AFTER + 2, offline: 3 };
    expect(endOf(worn, { kind: 'limited', until: NOW + 60_000 }, NOW)).toEqual({
      kind: 'limited',
      next: { ...worn, offline: undefined, limitedUntil: NOW + 60_000 },
    });
    expect(endOf(worn, { kind: 'offline', count: 4, limitedUntil: undefined }, NOW)).toEqual({
      kind: 'offline',
      next: { ...worn, offline: 4, limitedUntil: undefined },
    });
  });

  test('a failed read counts, and the count gives up at GIVE_UP_AFTER', () => {
    const end = endOf(target, { kind: 'error', why: 'boom', limitedUntil: undefined }, NOW);
    expect(end).toEqual({
      kind: 'failed',
      next: {
        ...target,
        error: 'gh failed: boom',
        failures: 1,
        refused: undefined,
        offline: undefined,
        limitedUntil: undefined,
      },
    });
    const worn = { ...target, failures: GIVE_UP_AFTER - 1 };
    expect(endOf(worn, { kind: 'error', why: 'boom', limitedUntil: undefined }, NOW).kind).toBe(
      'given-up',
    );
    const offline = { ...target, offline: 2 };
    const failed = endOf(offline, { kind: 'error', why: 'boom', limitedUntil: undefined }, NOW);
    expect(nextOf(failed)?.offline).toBeUndefined();
  });

  test('a refusal stays marked through a later failure of another kind', () => {
    const refusal = 'HTTP 401: Bad credentials (https://api.github.com/graphql)';
    expect(
      nextOf(endOf(target, { kind: 'error', why: refusal, limitedUntil: undefined }, NOW))?.refused,
    ).toBe(true);
    const refused = { ...target, refused: true };
    expect(
      nextOf(endOf(refused, { kind: 'error', why: 'boom', limitedUntil: undefined }, NOW))?.refused,
    ).toBe(true);
  });
});

describe('judgedOf', () => {
  const seen = { merged: [], asked: [] };
  const read = { ...target, pull: pull([green()]) };

  test('a line that changed says so in a toast, once, and dates what it shows', () => {
    const { next, judged } = judgedOf(
      { ...target, shown: 'running' },
      { ...read, shownAt: 1 },
      { kind: 'ready' },
      NOW,
      seen,
    );
    expect(next).toMatchObject({ shown: 'ready', shownAt: NOW });
    expect(judged.moved).toEqual({ toast: { text: '#128 is ready to merge', isUrgent: true } });
    const again = judgedOf(
      { ...target, shown: 'ready' },
      { ...read, shown: 'ready', shownAt: 1 },
      { kind: 'ready' },
      NOW,
      seen,
    );
    expect(again.next.shownAt).toBe(1);
    expect(again.judged.moved).toBeNull();
    const undated = judgedOf(
      { ...target, shown: 'ready' },
      { ...read, shown: 'ready' },
      { kind: 'ready' },
      NOW,
      seen,
    );
    expect(undated.next.shownAt).toBe(NOW);
  });

  test('only a ready line or a failure is urgent; a push names no merge', () => {
    const failing: Verdict = {
      kind: 'merged-failing',
      workflowId: 2,
      workflow: 'Lint',
      job: 'eslint',
      url: 'u',
    };
    expect(judgedOf(target, read, failing, NOW, seen).judged.moved?.toast?.isUrgent).toBe(true);
    const push = { ...read, number: 0, push: { branch: 'b', pushedAt: 0 } };
    const merged = judgedOf(target, read, { kind: 'merged-passed' }, NOW + 3_600_000, seen);
    const pushed = judgedOf(target, push, { kind: 'merged-passed' }, NOW + 3_600_000, seen);
    expect(merged.judged.moved?.toast).toEqual({
      text: expect.stringContaining('merged'),
      isUrgent: false,
    });
    expect(pushed.judged.moved?.toast?.text).not.toContain('merged');
  });

  test('a merge still in its grace, or a ready line GitHub is checking, shows nothing new', () => {
    const fresh = {
      ...read,
      pull: pull([green()], { state: 'MERGED', mergedAt: '2026-10-03T22:01:00Z' }),
    };
    const early = judgedOf(target, fresh, { kind: 'merged-passed' }, NOW, seen);
    expect(early).toEqual({
      next: fresh,
      judged: expect.objectContaining({ isEarly: true, moved: null }),
    });
    const checking = judgedOf(target, read, { kind: 'waiting', reason: 'checking' }, NOW, seen);
    expect(checking.judged.moved).toBeNull();
  });

  test('a merge Claude made is its own unless it asked to hear of it', () => {
    const id = 'github.com/o/r#128';
    expect(
      judgedOf(target, read, { kind: 'ready' }, NOW, { merged: [id], asked: [] }).judged,
    ).toMatchObject({
      isOwnMerge: true,
      isWakeAsked: false,
    });
    expect(
      judgedOf(target, read, { kind: 'ready' }, NOW, { merged: [id], asked: [id] }).judged,
    ).toMatchObject({
      isOwnMerge: false,
      isWakeAsked: true,
    });
  });
});

const judged = (over: Partial<Judged> = {}): Judged => ({
  verdict: { kind: 'ready' },
  isEarly: false,
  isOwnMerge: false,
  isWakeAsked: false,
  moved: null,
  ...over,
});

describe('savedAfter', () => {
  const offlineSibling = sibling({ offline: 2 });
  const read = { ...target, pull: pull([green()]), checkedAt: NOW };
  const save = (s: Saving, all: Watch[] = [target, offlineSibling, elsewhere], cfg = config) =>
    savedAfter(all, target, s, cfg);

  test('a line gone or closed leaves, and the host’s other lines drop their offline note', () => {
    const left = [{ ...offlineSibling, offline: undefined }, elsewhere];
    for (const kind of ['gone', 'closed'] as const) expect(save({ kind }).list).toEqual(left);
    const next = { ...target, error: 'gh failed: x', failures: GIVE_UP_AFTER };
    expect(save({ kind: 'given-up', next }).list).toEqual(left);
  });

  test('an outage puts its note on every line of the host; a limit its pause', () => {
    const next = { ...target, offline: 3 };
    expect(save({ kind: 'offline', next }).list).toEqual([
      next,
      { ...offlineSibling, offline: 3 },
      elsewhere,
    ]);
    const limited = { ...target, limitedUntil: NOW + 60_000 };
    expect(save({ kind: 'limited', next: limited }).list).toEqual([
      limited,
      { ...offlineSibling, offline: undefined, limitedUntil: NOW + 60_000 },
      elsewhere,
    ]);
  });

  test('a push hands its line and what Claude was told to the pull request it heads', () => {
    const to = sibling({ told: ['pr'] });
    expect(save({ kind: 'handoff', to: sibling() }, [target, elsewhere]).list).toEqual([
      elsewhere,
      sibling({ told: ['old'] }),
    ]);
    expect(save({ kind: 'handoff', to: sibling() }, [target, to]).list).toEqual([
      sibling({ told: ['pr', 'old'] }),
    ]);
    expect(save({ kind: 'handoff', to: sibling() }, [elsewhere])).toMatchObject({
      list: [elsewhere],
      isSaved: false,
    });
    const other = { ...offlineSibling, number: 9, url: 'https://github.com/o/r/pull/9' };
    expect(save({ kind: 'handoff', to: sibling() }, [target, other]).list).toEqual([
      { ...other, offline: undefined },
      sibling({ told: ['old'] }),
    ]);
  });

  test('a fresh read wakes with what neither line on the host was told', () => {
    const failing = { ...read, pull: pull([green(), lint]) };
    const verdict: Verdict = {
      kind: 'failing',
      workflowId: 2,
      workflow: 'Lint',
      job: 'eslint',
      url: 'u',
    };
    const s = { kind: 'judged', next: failing, judged: judged({ verdict }) } as const;
    const { woke, list, isSaved } = save(s, [target, offlineSibling]);
    expect(isSaved).toBe(true);
    expect(woke?.text).toContain('Lint');
    expect(list[0]?.told).toEqual(expect.arrayContaining(woke?.told ?? ['missing']));
    const told = { ...offlineSibling, told: woke?.told };
    expect(save(s, [target, told]).woke?.text).toBeNull();
    const fromTarget = savedAfter([offlineSibling], { ...target, told: woke?.told }, s, config);
    expect(fromTarget.woke?.text).toBeNull();
  });

  test('with waking off, nothing new counts as told', () => {
    const failing = { ...read, pull: pull([green(), lint]) };
    const verdict: Verdict = {
      kind: 'failing',
      workflowId: 2,
      workflow: 'Lint',
      job: 'eslint',
      url: 'u',
    };
    const s = { kind: 'judged', next: failing, judged: judged({ verdict }) } as const;
    expect(save(s, [target], { ...config, isAwake: false }).list[0]?.told).toEqual([]);
  });

  test('a stack layer whose line moved has the layers above it read at once', () => {
    const stack = { number: 9, trunk: 'main', layers: [127, 128, 129, 130] };
    const layer = { ...read, pull: pull([green()], { stack }) };
    const moved = judged({ moved: { toast: null } });
    expect(save({ kind: 'judged', next: layer, judged: moved }).restack).toEqual([
      'github.com/o/r#129',
      'github.com/o/r#130',
    ]);
    expect(save({ kind: 'judged', next: layer, judged: judged() }).restack).toEqual([]);
  });

  test('a fresh read of an open pull request takes its push line’s row', () => {
    const push = watched(undefined, { number: 0, push: { branch: 'feat/x', pushedAt: 0 } });
    const head = { branch: 'feat/x', repo: 'o/r' };
    const next = { ...read, pull: pull([green()], { head }) };
    const { list } = save({ kind: 'judged', next, judged: judged() }, [push, elsewhere, target]);
    expect(list.map((w) => w.number)).toEqual([128, 128]);
    expect(list[0]?.push).toBeUndefined();
  });

  test('a read of a line unwatched meanwhile saves nothing of it', () => {
    const s = { kind: 'judged', next: read, judged: judged() } as const;
    expect(save(s, [elsewhere])).toMatchObject({ list: [elsewhere], isSaved: false });
  });
});

describe('givenUpOf', () => {
  test('names the line, its last failure, and how to watch it again', () => {
    const next = { ...target, error: 'gh failed: boom' };
    expect(givenUpOf(next)).toBe(
      `pr-watch: ${GIVE_UP_AFTER} reads of o/r#128 in a row failed, so pr-watch stopped watching it. The last: gh failed: boom\nWatch it again with pr-watch's watch tool once gh can read it. https://github.com/o/r/pull/128`,
    );
    const push = { ...next, push: { branch: 'b', pushedAt: 0 } };
    expect(givenUpOf(push)).toContain('the push to b on o/r');
    expect(givenUpOf(push)).toContain('follows the branch again on its next push');
  });
});
