import { describe, expect, test } from 'claude-code/testing';

import {
  bash,
  denied,
  endTurn,
  fakeStore,
  fakeWorld,
  finishLeg,
  keptRecord,
  NO_GRANT_KEPT,
  NOW,
  onMain,
  pending,
  pushing,
  ran,
  reloadInto,
  remoteSide,
  review,
  say,
  settle,
  skill,
  startSession,
  statusOf,
  stops,
  treeId,
  type World,
} from '../fixtures';

describe('a reload of the module', () => {
  test('keeps what reviewers saw in the host state', async ($, on) => {
    fakeWorld(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await review($);
    await say($, 'push it');
    await settle();
    expect(kept?.shape).toBe('gate-11');
    expect(kept?.value.reviews).toHaveLength(1);
    expect(kept?.value.legs[0]?.[1]).toMatchObject({ done: true, counted: true, spawnedAt: NOW });
    expect(kept?.value.message).toMatchObject({
      tree: expect.any(String),
      nudged: false,
      prWindow: false,
      grant: { push: 'push' },
    });
    expect(kept?.value.mandate).toBeNull();
    await say($, 'do epic cpl-czgp');
    await settle();
    expect(kept?.value.mandate).toEqual({ epic: 'cpl-czgp' });
  });

  test('a save before the session start keeps what the reload left', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    reloadInto(on, keptRecord({ reviews: [review] }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await say($, 'fix the parser');
    await settle();
    expect(kept?.value.reviews).toEqual([review]);
  });

  test('takes back a leg it was running, so its review still counts', async ($, on) => {
    const w = fakeWorld(on);
    reloadInto(on, keptRecord({ legs: [['leg-before', runningLeg(w, NOW)]] }));
    await startSession($);
    await finishLeg($, 'leg-before', false);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('takes back a finished review, so the commit goes through', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    reloadInto(on, keptRecord({ reviews: [review] }));
    await startSession($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('takes back where the rounds count from', async ($, on) => {
    fakeStore(on);
    const w = fakeWorld(on);
    const review = (files: Record<string, string>) => {
      const tree = treeId(w, files);
      return { type: 'review-cycle:code-reviewer', trees: [tree, tree], reviewedPaths: ['a.ts'] };
    };
    const reviews = [review({ 'a.ts': 'x' }), review({ 'a.ts': 'y' }), review(w.work)];
    reloadInto(on, keptRecord({ reviews, roundsFrom: 1 }));
    await startSession($);
    const r = (await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any;
    const status = JSON.parse(r.result);
    expect(status.roundsSinceCommit).toBe(2);
  });

  test('takes back a hold, so a push the user put off still waits', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    reloadInto(on, keptRecord({ hold: { floor: { step: 'push', how: 'declined' } } }));
    await startSession($);
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });

  test('a request inside a pasted block is not the user asking', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    const paste =
      '<pasted_content id="c986">\n❯ Push to main\n❯ push it\n</pasted_content id="c986">';
    await say($, `I called it out this time and it still blocked me.\n\n${paste}`);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
    const s = JSON.parse(
      ((await $.tool.call({ tool: 'mcp__review-cycle__status' })) as any).result,
    );
    expect(s.pushRequested).toBe(false);
    await say($, `push it\n\n${paste}`);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });
  test("takes back the latest message's grant, so a step it covered still runs", async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test("takes back a kept grant's pull request, the step the reload used to refuse", async ($, on) => {
    fakeWorld(on);
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'gh pr create --fill'))).toBe(true);
  });

  test('takes back what the message pointed at, so an unnamed merge still runs', async ($, on) => {
    fakeWorld(on, { settings: { local: stops('merge') }, git: onMain });
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, merge: true },
      pointed: { named: [], answer: ['40'], unplaced: false },
    };
    reloadInto(on, keptRecord({ message }));
    await startSession($);
    expect(ran(await bash($, 'gh pr merge 40 --squash'))).toBe(true);
  });

  test('a hold kept with its message still refuses after a reload', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await say($, "don't push yet");
    await settle();
    expect(kept?.value.message.grant.push).toBe('none');
    expect(kept?.value.hold).toMatchObject({ floor: { step: 'push' } });
  });

  test('a message heard before the take-back applies on top of the record', async ($, on) => {
    const w = fakeWorld(on, pushing({ git: remoteSide({}) }));
    const message = {
      tree: null,
      nudged: true,
      prWindow: false,
      grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
      pointed: { named: [], answer: [], unplaced: false },
    };
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    await sayBeforeRecall($, on, { message, reviews: [review] }, "don't push yet");
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });

  test('a kept hold outlives an unrelated message heard before the take-back', async ($, on) => {
    fakeWorld(on, pushing({ settings: { local: stops('never stop') }, git: remoteSide({}) }));
    await sayBeforeRecall(
      $,
      on,
      { hold: { floor: { step: 'push', how: 'declined' } } },
      'fix the parser',
    );
    expect(denied(await bash($, 'git push origin fix/x'), 'held off (')).toBe(true);
  });

  test('a kept mandate outlives an unrelated message heard before the take-back', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    await sayBeforeRecall($, on, { mandate: { epic: 'cpl-czgp' } }, 'fix the parser');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test('a newer message replaces the kept grant', async ($, on) => {
    fakeWorld(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'push it');
    await settle();
    expect(kept?.value.message.grant.push).toBe('push');
    await say($, 'not yet');
    await settle();
    expect(kept?.value.message.grant.push).toBe('none');
  });

  test("a session's end clears the kept grant", async ($, on) => {
    fakeWorld(on);
    on('session.end', () => ({ sessionId: 's' }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await say($, 'ship it and merge 12');
    await settle();
    expect(kept?.value.message.grant.pr).toBe(true);
    expect(kept?.value.message.pointed.named).toEqual(['12']);
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await settle();
    expect(kept?.value.message.grant).toEqual(NO_GRANT_KEPT);
    expect(kept?.value.message.pointed).toEqual({ named: [], answer: [], unplaced: false });
  });

  test('takes back an epic mandate, so the job keeps pushing', async ($, on) => {
    fakeWorld(on, pushing({ git: remoteSide({}) }));
    reloadInto(on, keptRecord({ mandate: { epic: 'cpl-czgp' } }));
    await startSession($);
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(true);
  });

  test('takes back a scratch directory, so the sweep still removes it', async ($, on) => {
    const w = fakeWorld(on, { git: (a) => (a.startsWith('test -e') ? { exitCode: 1 } : null) });
    reloadInto(on, keptRecord({ scratch: ['/tmp/review-cycle.abc123'] }));
    await startSession($);
    await $.tool.call({ tool: 'mcp__review-cycle__sweep' });
    expect(w.calls.some((c) => c.argv.join(' ') === 'rm -rf -- /tmp/review-cycle.abc123')).toBe(
      true,
    );
  });

  test('gives a leg taken back the rest of its budget, and caps one past it', async ($, on) => {
    const w = fakeWorld(on);
    reloadInto(
      on,
      keptRecord({
        legs: [
          ['leg-young', runningLeg(w, NOW - 10 * 60_000)],
          ['leg-old', runningLeg(w, NOW - 31 * 60_000)],
          ['leg-done', { ...runningLeg(w, NOW - 40 * 60_000), done: true }],
        ],
      }),
    );
    await startSession($);
    expect(
      legTimers(w)
        .map((t) => t.ms)
        .toSorted((a, b) => a - b),
    ).toEqual([0, 20 * 60_000]);
    w.timers?.find((t) => t.ms === 0)?.fire();
    await settle();
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([
      'review-cycle:code-reviewer (agent leg-old): still running after 30 minutes',
    ]);
  });

  test('a leg taken back and then finished is not capped by its budget', async ($, on) => {
    const w = fakeWorld(on);
    reloadInto(on, keptRecord({ legs: [['leg-back', runningLeg(w, NOW - 10 * 60_000)]] }));
    await startSession($);
    await finishLeg($, 'leg-back', false);
    for (const t of legTimers(w)) t.fire();
    await settle();
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });

  test('sets aside a record it cannot read, and says so', async ($, on) => {
    const w = fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    reloadInto(on, { ...keptRecord({}), legs: 'many' });
    await startSession($);
    expect(toasts).toEqual([
      'review-cycle could not read the reviews it kept, so it starts this load with none',
    ]);
    expect(legTimers(w)).toEqual([]);
  });

  for (const [name, fields] of [
    ['a review without its paths', { reviews: [{ type: 'code-reviewer', trees: ['a', 'b'] }] }],
    ['a hold on no step', { hold: { floor: { step: 'tag', how: 'declined' } } }],
    ['a mandate on no epic', { mandate: { epic: '' } }],
    ['a mandate that is not one', { mandate: 'cpl-czgp' }],
    ['a message without its flags', { message: {} }],
    [
      'a grant that is not one',
      {
        message: {
          tree: null,
          nudged: true,
          prWindow: false,
          grant: { ...NO_GRANT_KEPT, push: 'everything' },
          pointed: { named: [], answer: [], unplaced: false },
        },
      },
    ],
    ...(
      [
        ['no pointed', null],
        ['a pointed name that is a number', { named: [1], answer: [], unplaced: false }],
        ['a pointed without unplaced', { named: [], answer: [] }],
      ] as const
    ).map(
      ([name, pointed]) =>
        [
          name,
          {
            message: { tree: null, nudged: true, prWindow: false, grant: NO_GRANT_KEPT, pointed },
          },
        ] as const,
    ),
    ['a miss that is not one', { misses: [null] }],
    ['a rounds index past its reviews', { roundsFrom: 2 }],
    ['a rounds index below zero', { roundsFrom: -1 }],
    ['no rounds index', { roundsFrom: undefined }],
    ['no pushes', { pushed: undefined }],
    ['a push that names no commit', { pushed: [['/repo/.git\torigin/x', 'zz']] }],
    [
      'a push whose commit is not a string',
      { pushed: [['/repo/.git\torigin/x', ['a'.repeat(40)]]] },
    ],
    ['a push keyed without its repository', { pushed: [['origin/x', 'a'.repeat(40)]] }],
    ['a review skill that is not a path', { reviewing: 1 }],
  ] as const) {
    test(`sets aside a record holding ${name}`, async ($, on) => {
      const w = fakeWorld(on);
      const toasts: string[] = [];
      on('ui.toast', ($$: unknown, e: { text: string }) => {
        toasts.push(e.text);
        return { value: undefined };
      });
      const tree = treeId(w, w.work);
      const review = { type: 'review-cycle:code-reviewer', trees: [tree, tree], reviewedPaths: [] };
      reloadInto(on, { ...keptRecord({ reviews: [review] }), ...fields });
      await startSession($);
      expect(toasts.filter((t) => t.includes('could not read the reviews it kept'))).toHaveLength(
        1,
      );
      const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
      expect(status.reviews).toBe(0);
    });
  }

  test('a take-back that fails starts fresh, says so once, and keeps from then on', async ($, on) => {
    fakeWorld(on, { kept: 'unreadable' });
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    let writes = 0;
    on('state.set', ($$: unknown, e: { key: string }, next: any) => {
      if (e.key === 'gate') writes += 1;
      return next(e);
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    expect(toasts.filter((t) => t.includes('could not take back its reviews'))).toHaveLength(1);
    expect(writes).toBe(1);
  });

  test('a save that never answers times out, says so, and lets the next one through', async ($, on) => {
    const w = fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    let writes = 0;
    on('state.set', ($$: unknown, e: { key: string }, next: any) => {
      if (e.key !== 'gate') return next(e);
      writes += 1;
      return writes === 1 ? pending() : next(e);
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    for (const t of (w.timers ?? []).filter((t) => t.ms === 5000)) t.fire();
    await settle();
    expect(toasts.filter((t) => t.includes('could not keep its record'))).toHaveLength(1);
    await say($, 'and the lexer');
    await settle();
    expect(writes).toBe(2);
  });

  test('a save that timed out and lands later leaves a newer one standing', async ($, on) => {
    const w = fakeWorld(on);
    const landed: number[] = [];
    const held: (() => void)[] = [];
    on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
      if (e.key !== 'gate') return next(e);
      const go = async () => {
        const out = await next(e);
        if (out?.value?.isSet) landed.push(e.value.value.messages);
        return out;
      };
      if (held.length > 0 || landed.length > 0) return go();
      return new Promise((resolve) => {
        held.push(() => resolve(go()));
      });
    });
    await startSession($);
    await say($, 'fix the parser');
    await settle();
    for (const t of (w.timers ?? []).filter((t) => t.ms === 5000)) t.fire();
    await settle();
    await say($, 'and the lexer');
    await settle();
    for (const release of held) release();
    await settle();
    expect(landed.at(-1)).toBe(2);
  });

  test('saves land in order, the last one holding the latest record', async ($, on) => {
    fakeWorld(on);
    const saved: any[] = [];
    const held: (() => void)[] = [];
    on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
      if (e.key !== 'gate') return next(e);
      saved.push(e.value.value);
      if (saved.length > 1) return next(e);
      return new Promise((resolve) => {
        held.push(() => resolve(next(e)));
      });
    });
    await startSession($);
    await say($, 'fix the parser');
    await say($, 'and the lexer');
    await settle();
    for (const release of held) release();
    await settle();
    expect(saved.at(-1)?.messages).toBe(2);
  });

  test(
    'a load with the gate off keeps finished reviews and drops what only watching kept true',
    { options: { enabled: false } },
    async ($, on) => {
      const w = fakeWorld(on);
      const tree = treeId(w, w.work);
      const review = {
        type: 'review-cycle:code-reviewer',
        trees: [tree, tree],
        reviewedPaths: ['a.ts'],
      };
      const done = { ...runningLeg(w, NOW), done: true, counted: true };
      const capped = { ...runningLeg(w, NOW), capped: true };
      const miss = {
        message: 'ship it',
        offer: '',
        steps: ['push'],
        refusal: 'r',
        kind: 'refused',
        saved: true,
        key: '1-a',
      };
      reloadInto(
        on,
        keptRecord({
          reviews: [review],
          legs: [
            ['leg-running', runningLeg(w, NOW)],
            ['leg-done', done],
            ['leg-capped', capped],
          ],
          message: {
            tree,
            nudged: true,
            prWindow: true,
            grant: { ...NO_GRANT_KEPT, push: 'push', pr: true },
            pointed: { named: ['12'], answer: [], unplaced: false },
          },
          messages: 4,
          lastAnswer: 'Push it?',
          misses: [miss],
          hold: { floor: { step: 'push', how: 'declined' } },
          mandate: { epic: 'cpl-czgp' },
          roundsFrom: 1,
        }),
      );
      const saved: any[] = [];
      on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
        if (e.key === 'gate') saved.push(e.value?.value);
        return next(e);
      });
      await startSession($);
      expect(saved.at(-1)).toEqual(
        keptRecord({
          reviews: [review],
          legs: [
            ['leg-done', done],
            ['leg-capped', capped],
          ],
          message: {
            tree: null,
            nudged: false,
            prWindow: false,
            grant: NO_GRANT_KEPT,
            pointed: { named: [], answer: [], unplaced: false },
          },
          messages: 4,
          lastAnswer: '',
          misses: [miss],
          hold: null,
          roundsFrom: 1,
        }),
      );
    },
  );

  test(
    'a load with the gate off clears a record it cannot read',
    { options: { enabled: false } },
    async ($, on) => {
      fakeWorld(on);
      reloadInto(on, { ...keptRecord({}), legs: 'many' });
      const saved: unknown[] = [];
      on('state.set', ($$: unknown, e: { key: string; value: any }, next: any) => {
        if (e.key === 'gate') saved.push(e.value?.value);
        return next(e);
      });
      await startSession($);
      expect(saved.at(-1)).toBeNull();
    },
  );

  test('a review kept across a switch-off still covers its commit', async ($, on) => {
    const w = fakeWorld(on);
    const tree = treeId(w, w.work);
    const review = {
      type: 'review-cycle:code-reviewer',
      trees: [tree, tree],
      reviewedPaths: ['a.ts'],
    };
    // What an off-load leaves.
    reloadInto(
      on,
      keptRecord({
        reviews: [review],
        message: {
          tree: null,
          nudged: false,
          prWindow: false,
          grant: NO_GRANT_KEPT,
          pointed: { named: [], answer: [], unplaced: false },
        },
      }),
    );
    await startSession($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git add -A && git commit -m x'))).toBe(true);
  });

  test('says once that it cannot keep its record', async ($, on) => {
    fakeWorld(on);
    const toasts: string[] = [];
    on('ui.toast', ($$: unknown, e: { text: string }) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    on('state.set', ($$: unknown, e: { key: string }, next: any) =>
      e.key === 'gate' ? { deny: 'store full' } : next(e),
    );
    await startSession($);
    await say($, 'fix the parser');
    await say($, 'and the lexer');
    await settle();
    expect(toasts.filter((t) => t.includes('could not keep its record'))).toHaveLength(1);
  });
});

// The timers a leg's budget arms, not the 5 s waits on a state call.
const legTimers = (w: World) => (w.timers ?? []).filter((t) => t.ms !== 5000);

// A running leg spawned at `at`, on the tree the world holds.
function runningLeg(w: World, at: number) {
  return {
    type: 'review-cycle:code-reviewer',
    counts: true,
    spawnTree: treeId(w, w.work),
    done: false,
    capped: false,
    counted: false,
    spawnedAt: at,
  };
}

// A reloaded module hears a message before its session start, so the message takes the record back.
async function sayBeforeRecall($: any, on: any, kept: Record<string, unknown>, text: string) {
  reloadInto(on, keptRecord(kept));
  await say($, text);
  await startSession($);
  await settle();
}

describe("a session's end", () => {
  test('a yes after it answers no offer from before it', async ($, on) => {
    fakeWorld(on, pushing({}));
    on('session.end', () => ({ sessionId: 's' }));
    await endTurn($, 'answer', 'Should I push fix/x?');
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await say($, 'yes');
    expect(ran(await bash($, 'git push origin fix/x'))).toBe(false);
  });
});

// A world whose engine expands a skill as the hooks above it leave it.
function world(on: any, setup: Partial<World> = {}) {
  on('skill.prompt', ($$: unknown, e: { text: string }) => ({ text: e.text }));
  return fakeWorld(on, setup);
}

const handedBack = (r: any) =>
  (r.messages as { text: string }[]).filter((m) => m.text.startsWith('review-cycle:'));

describe('a compaction during a review', () => {
  // The skill as expanded; the re-attached copy is cut inside Phase 2.
  const SKILL = `Base directory for this skill: /plugins/review-cycle/skills/review\n\n# Review\n\n### Phase 1\n\n${'one '.repeat(4000)}\n\n### Phase 2\n\n${'two '.repeat(2000)}the later phase\n`;
  const SUMMARY = { role: 'user' as const, text: 'This session is being continued.', toolUses: [] };

  // The transcript the engine hands a compaction; the stand-in summarizer ignores it.
  const compact = ($: any, agentId?: string) =>
    $.session.compact({ messages: [SUMMARY], ...(agentId ? { agentId } : {}) });

  async function loadSkill($: any, over: Record<string, unknown> = {}) {
    await $.skill.prompt({
      skill: 'review-cycle:review',
      text: SKILL,
      source: 'plugin',
      pluginName: 'review-cycle',
      ...over,
    });
  }

  function compactsTo(on: any, messages: object[] = [SUMMARY]) {
    on('session.compact', () => ({ messages }));
  }

  test('hands back the phases the re-attached copy drops', async ($, on) => {
    world(on);
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: 123 }));
    await loadSkill($);
    const raw = { role: 'user' as const, text: 'the transcript before compaction', toolUses: [] };
    const r = await ($ as any).session.compact({ messages: [raw] });
    expect(r.messages[0]).toMatchObject({ text: SUMMARY.text });
    expect(r.messages.some((m: { text: string }) => m.text === raw.text)).toBe(false);
    expect(r.tokensAfter).toBe(123);
    const [back] = handedBack(r);
    expect(back).toMatchObject({ role: 'user', toolUses: [] });
    expect(back?.text).toContain('### Phase 2\n\ntwo ');
    expect(back?.text).toContain('the later phase');
    expect(back?.text).not.toContain('### Phase 1');
  });
  test('hands back nothing before the review skill loads', async ($, on) => {
    world(on);
    compactsTo(on);
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
    expect(handedBack(r)).toEqual([]);
  });
  test("hands back nothing for a subagent's compaction", async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($);
    const r = await compact($, 'sub-1');
    expect(r.messages).toHaveLength(1);
  });
  test('hands back nothing once the reviewed work is committed', async ($, on) => {
    fakeStore(on);
    world(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    compactsTo(on);
    await loadSkill($);
    await review($);
    expect(handedBack(await compact($))).toHaveLength(1);
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
  });
  test('hands back nothing a second time', async ($, on) => {
    world(on);
    let messages: (typeof SUMMARY)[] = [SUMMARY];
    on('session.compact', () => ({ messages }));
    await loadSkill($);
    const first = await compact($);
    expect(handedBack(first)).toHaveLength(1);
    messages = first.messages;
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test('a summary computed during the review drops the phases once it is committed', async ($, on) => {
    fakeStore(on);
    world(on, {
      commits: { ['c'.repeat(40)]: { 'a.ts': 'zero' }, ['d'.repeat(40)]: { 'a.ts': 'one' } },
      shell(this: World) {
        this.head = 'd'.repeat(40);
      },
    });
    let messages: (typeof SUMMARY)[] = [SUMMARY];
    on('session.compact', () => ({ messages }));
    await loadSkill($);
    await review($);
    const during = await compact($);
    messages = during.messages;
    await say($, 'fix the parser');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
    const r = await compact($);
    expect(r.messages).toEqual([SUMMARY]);
  });
  test('only review-cycle loading its review skill starts it', async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($, { pluginName: 'other', source: 'projectSettings' });
    expect(handedBack(await compact($))).toEqual([]);
  });
  test("hands back review-pr's later phases until its main-session sweep", async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($, { skill: 'review-cycle:review-pr' });
    const [back] = handedBack(await compact($));
    expect(back?.text).toContain('the later phase');
    await $.tool.call({ tool: 'mcp__review-cycle__sweep', agentId: 'leg-1' });
    expect(handedBack(await compact($))).toHaveLength(1);
    await $.tool.call({ tool: 'mcp__review-cycle__sweep' });
    expect(handedBack(await compact($))).toEqual([]);
  });
  test("a subagent's review-pr hands the main conversation nothing", async ($, on) => {
    world(on, { skillRun: () => loadSkill($, { skill: 'review-cycle:review-pr' }) });
    compactsTo(on);
    await skill($, 'review-cycle:review-pr', 'sub');
    expect(handedBack(await compact($))).toEqual([]);
  });
  test("a review's sweep keeps its later phases, which run to the commit", async ($, on) => {
    world(on);
    compactsTo(on);
    await loadSkill($, { skill: 'review-cycle:review-pr' });
    await loadSkill($, { skill: 'review-cycle:review' });
    await $.tool.call({ tool: 'mcp__review-cycle__sweep' });
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test("a subagent's review hands the main conversation nothing", async ($, on) => {
    world(on, { skillRun: () => loadSkill($) });
    compactsTo(on);
    await skill($, 'review-cycle:review', 'sub');
    expect(handedBack(await compact($))).toEqual([]);
    await skill($, '/review-cycle:review', 'sub');
    expect(handedBack(await compact($))).toEqual([]);
    await skill($, 'review-cycle:review');
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test("a subagent's other skill does not hide the main conversation's review", async ($, on) => {
    world(on, { skillRun: () => loadSkill($) });
    compactsTo(on);
    await skill($, 'other:thing', 'sub');
    expect(handedBack(await compact($))).toHaveLength(1);
  });
  test('keeps the text the model reads, not the one the skill computed', async ($, on) => {
    on('skill.prompt', ($$: unknown, e: { text: string }) => ({
      text: `${'x'.repeat(30_000)}\n\n${e.text}`,
    }));
    fakeWorld(on);
    compactsTo(on);
    await loadSkill($);
    const [back] = handedBack(await compact($));
    expect(back?.text).toContain('xxxx');
  });
  test('/clear clears the kept record too', async ($, on) => {
    world(on);
    on('session.end', () => ({ sessionId: 's' }));
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await loadSkill($);
    await settle();
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    await settle();
    expect(kept?.value.reviewing).toBeNull();
  });
  test(
    'switching the gate off forgets a review in flight',
    { options: { enabled: false } },
    async ($, on) => {
      world(on);
      let kept: any = 'unset';
      on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
        if (e.key === 'gate') kept = e.value;
        return next(e);
      });
      reloadInto(on, keptRecord({ reviewing: SKILL }));
      await startSession($);
      await settle();
      expect(kept?.value.reviewing).toBeNull();
    },
  );
  test('the loaded skill is kept for a reload', async ($, on) => {
    world(on);
    let kept: any = null;
    on('state.set', ($$: unknown, e: { key: string; value: unknown }, next: any) => {
      if (e.key === 'gate') kept = e.value;
      return next(e);
    });
    await startSession($);
    await loadSkill($);
    await settle();
    expect(kept?.value.reviewing).toBe(SKILL);
  });
  test('a session ended by /clear ends it', async ($, on) => {
    world(on);
    compactsTo(on);
    on('session.end', () => ({ sessionId: 's' }));
    await loadSkill($);
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } });
    const r = await compact($);
    expect(r.messages).toHaveLength(1);
  });
  test(
    'the gate switched off still hands it back',
    { options: { enabled: false } },
    async ($, on) => {
      world(on);
      compactsTo(on);
      await loadSkill($);
      expect(handedBack(await compact($))).toHaveLength(1);
    },
  );
  test('a review in flight outlives a reload', async ($, on) => {
    world(on);
    compactsTo(on);
    reloadInto(on, keptRecord({ reviewing: SKILL }));
    await startSession($);
    expect(handedBack(await compact($))).toHaveLength(1);
  });
});
